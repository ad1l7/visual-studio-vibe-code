import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentSpec, EngineId, Plan, TaskSpec } from '../plan/schema.ts';
import { dependentsOf, topoOrder } from '../plan/validate.ts';
import { agentSystemPrompt, conflictPrompt, taskPrompt } from '../planner/prompts.ts';
import type { AgentResult, AgentRunner, PermissionMode, RunMeta } from '../runners/types.ts';
import { scaffoldProject } from '../scaffold/scaffold.ts';
import { newRunId, ProjectStore } from '../storage.ts';
import { Mutex } from '../util/mutex.ts';
import { plural } from '../util/plural.ts';
import { execCapture } from '../util/process.ts';
import { changedFiles, commitAll } from '../workspace/git.ts';
import type { TaskWorktree, Workspace } from '../workspace/worktrees.ts';
import { initialSnapshot, reduce, type RunEvent, type RunSnapshot, type TaskState } from './state.ts';

/** Инструменты, разрешённые агентам по умолчанию (остальные CLI отклонит без вопросов). */
export const DEFAULT_ALLOWED_TOOLS = [
  'Read', 'Write', 'Edit', 'MultiEdit', 'Glob', 'Grep', 'LS', 'TodoWrite', 'WebSearch', 'WebFetch',
  'Bash(npm *)', 'Bash(npx *)', 'Bash(pnpm *)', 'Bash(yarn *)', 'Bash(node *)', 'Bash(tsc *)',
  'Bash(python *)', 'Bash(python3 *)', 'Bash(pip *)', 'Bash(pytest *)', 'Bash(go *)', 'Bash(cargo *)',
  'Bash(ls *)', 'Bash(mkdir *)', 'Bash(cat *)', 'Bash(git status*)', 'Bash(git diff*)', 'Bash(git log*)',
];

export interface RunSettings {
  /** Сколько агентов работает одновременно. */
  concurrency: number;
  /** Попыток на задачу (повтор — с текстом ошибки, в той же сессии агента). */
  maxAttempts: number;
  defaultEngine: EngineId;
  model?: string;
  permissionMode: PermissionMode;
  allowedTools: string[];
  checkTimeoutMs: number;
  worktreesRoot?: string;
}

export const DEFAULT_SETTINGS: RunSettings = {
  concurrency: 3,
  maxAttempts: 2,
  defaultEngine: 'claude-code',
  permissionMode: 'acceptEdits',
  allowedTools: DEFAULT_ALLOWED_TOOLS,
  checkTimeoutMs: 10 * 60_000,
};

export interface OrchestratorOptions {
  projectDir: string;
  plan: Plan;
  runners: Partial<Record<EngineId, AgentRunner>>;
  settings?: Partial<RunSettings>;
  runId?: string;
}

class Cancelled extends Error {}

/**
 * Выполняет план: запускает задачи по графу зависимостей параллельно,
 * каждую — в отдельном worktree, проверяет и вливает результат в main.
 */
export class Orchestrator {
  readonly runId: string;
  readonly settings: RunSettings;
  private snapshot: RunSnapshot;
  private readonly plan: Plan;
  private readonly store: ProjectStore;
  private readonly listeners = new Set<(e: RunEvent, s: RunSnapshot) => void>();
  private readonly abort = new AbortController();
  private readonly gitLock = new Mutex();
  private writeQueue: Promise<unknown> = Promise.resolve();
  private ws?: Workspace;

  constructor(private readonly o: OrchestratorOptions) {
    this.plan = o.plan;
    this.settings = { ...DEFAULT_SETTINGS, ...stripUndefined(o.settings ?? {}) };
    this.runId = o.runId ?? newRunId();
    this.store = new ProjectStore(o.projectDir);
    this.snapshot = initialSnapshot(this.runId, this.plan);
  }

  get state(): RunSnapshot {
    return this.snapshot;
  }

  get stopped(): boolean {
    return this.abort.signal.aborted;
  }

  subscribe(fn: (e: RunEvent, s: RunSnapshot) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  stop(): void {
    if (this.stopped) return;
    this.emit({ type: 'log', ts: Date.now(), level: 'info', message: 'Остановка по запросу пользователя…' });
    this.abort.abort();
  }

  async start(): Promise<RunSnapshot> {
    await this.store.createRun(this.runId);
    this.emit({ type: 'run', ts: Date.now(), status: 'running', message: `Запуск ${this.runId}: ${plural(this.plan.tasks.length, ['задача', 'задачи', 'задач'])}, ${plural(this.plan.agents.length, ['агент', 'агента', 'агентов'])}` });
    try {
      this.ws = await scaffoldProject(this.o.projectDir, this.plan);
      await this.schedule();
    } catch (err) {
      this.emit({ type: 'log', ts: Date.now(), level: 'error', message: `Сбой оркестратора: ${errorText(err)}` });
    }
    this.finish();
    await this.flush();
    return this.snapshot;
  }

  private async schedule(): Promise<void> {
    const order = topoOrder(this.plan);
    const tasks = new Map(this.plan.tasks.map((t) => [t.id, t]));
    const running = new Map<string, Promise<void>>();

    for (;;) {
      if (!this.stopped) {
        for (const id of order) {
          if (running.size >= this.settings.concurrency) break;
          const st = this.snapshot.tasks[id]!;
          const ready = st.status === 'pending' && tasks.get(id)!.dependsOn.every((d) => this.snapshot.tasks[d]?.status === 'done');
          if (!ready) continue;
          // Ставим статус сразу, чтобы задача не запустилась дважды.
          this.patch(id, { status: 'running', startedAt: Date.now() });
          const p = this.runTask(tasks.get(id)!).finally(() => running.delete(id));
          running.set(id, p);
        }
      }
      if (running.size === 0) break;
      await Promise.race(running.values());
    }
  }

  private finish(): void {
    const ts = Date.now();
    for (const t of Object.values(this.snapshot.tasks)) {
      if (t.status === 'pending') this.patch(t.id, { status: this.stopped ? 'cancelled' : 'blocked' });
    }
    const all = Object.values(this.snapshot.tasks);
    const done = all.filter((t) => t.status === 'done').length;
    const status = this.stopped ? 'stopped' : done === all.length ? 'done' : 'failed';
    const message =
      status === 'done'
        ? `Готово: все задачи (${all.length}) выполнены и влиты в main`
        : status === 'stopped'
          ? `Остановлено: выполнено ${done} из ${all.length}`
          : `Завершено с ошибками: выполнено ${done} из ${all.length}`;
    this.emit({ type: 'run', ts, status, message });
  }

  private async runTask(task: TaskSpec): Promise<void> {
    const agent = this.plan.agents.find((a) => a.id === task.agentId)!;
    const engine = agent.engine ?? this.settings.defaultEngine;
    const runner = this.o.runners[engine];
    let wt: TaskWorktree | undefined;
    let merged = false;
    try {
      if (!runner) throw new Error(`движок «${engine}» не подключён`);
      wt = await this.gitLock.run(() => this.ws!.create(this.runId, task.id));
      this.patch(task.id, { branch: wt.branch });
      this.log('info', `${agent.role} начинает «${task.title}»`, task.id);

      await this.develop(task, agent, runner, wt);
      this.patch(task.id, { status: 'merging' });
      const files = await this.integrate(task, agent, runner, wt);
      merged = true;
      this.patch(task.id, { status: 'done', finishedAt: Date.now(), files });
      this.log('success', `«${task.title}» готово и влито в main (${plural(files.length, ['файл', 'файла', 'файлов'])})`, task.id);
    } catch (err) {
      const cancelled = err instanceof Cancelled || this.stopped;
      this.patch(task.id, { status: cancelled ? 'cancelled' : 'failed', finishedAt: Date.now(), error: cancelled ? undefined : errorText(err) });
      if (!cancelled) {
        this.log('error', `«${task.title}» не выполнена: ${errorText(err)}`, task.id);
        for (const dep of dependentsOf(this.plan, task.id)) {
          if (this.snapshot.tasks[dep]?.status === 'pending') this.patch(dep, { status: 'blocked', error: `зависит от невыполненной задачи «${task.title}»` });
        }
      }
    } finally {
      // Влитую ветку удаляем; неудачную оставляем — её можно посмотреть в git.
      if (wt) await this.gitLock.run(() => this.ws!.remove(wt!, merged)).catch(() => {});
    }
  }

  /** Агент делает задачу; при ошибке или проваленной проверке — повтор в той же сессии. */
  private async develop(task: TaskSpec, agent: AgentSpec, runner: AgentRunner, wt: TaskWorktree): Promise<void> {
    let retryReason: string | undefined;
    for (let attempt = 1; attempt <= this.settings.maxAttempts; attempt++) {
      this.patch(task.id, { status: 'running', attempts: attempt });
      if (attempt > 1) this.log('info', `Повторная попытка ${attempt}/${this.settings.maxAttempts}`, task.id);
      const res = await this.runAgent(task, agent, runner, wt.path, taskPrompt(this.plan, task, this.doneTasks(), retryReason), { purpose: 'task', taskId: task.id, agentId: agent.id, scope: agent.scope });
      if (!res.ok) {
        retryReason = res.error ?? 'агент завершился с ошибкой';
        continue;
      }
      this.patch(task.id, { summary: res.text });
      await commitAll(wt.path, `${agent.id}: ${task.title}`);

      if (agent.checkCommand) {
        this.patch(task.id, { status: 'checking', lastAction: `Проверка: ${agent.checkCommand}` });
        const check = await execCapture(agent.checkCommand, [], { cwd: wt.path, shell: true, timeoutMs: this.settings.checkTimeoutMs, signal: this.abort.signal }).catch((e: Error) => ({ code: -1, stdout: '', stderr: e.message }));
        if (this.stopped) throw new Cancelled();
        if (check.code !== 0) {
          retryReason = `Команда \`${agent.checkCommand}\` завершилась с кодом ${check.code}:\n${tail(check.stdout + check.stderr, 3000)}`;
          this.log('error', `Проверка не пройдена (${agent.checkCommand})`, task.id);
          continue;
        }
        this.log('success', `Проверка пройдена (${agent.checkCommand})`, task.id);
      }
      return;
    }
    throw new Error(retryReason ?? 'исчерпаны попытки');
  }

  /** Подтягивает свежий main в ветку задачи, при конфликте зовёт агента, затем перематывает main. */
  private async integrate(task: TaskSpec, agent: AgentSpec, runner: AgentRunner, wt: TaskWorktree) {
    for (let round = 0; round < 5; round++) {
      const conflicts = await this.gitLock.run(() => this.ws!.mergeMainInto(wt));
      if (conflicts.length) {
        this.log('info', `Конфликт с изменениями других агентов: ${conflicts.join(', ')} — агент разрешает`, task.id);
        const res = await this.runAgent(task, agent, runner, wt.path, conflictPrompt(conflicts), { purpose: 'resolve-conflict', taskId: task.id, agentId: agent.id, scope: agent.scope });
        const left = await this.filesWithMarkers(wt.path, conflicts);
        if (!res.ok || left.length) {
          await this.ws!.abortMerge(wt);
          throw new Error(`не удалось разрешить конфликт: ${res.ok ? `остались маркеры в ${left.join(', ')}` : res.error}`);
        }
        await commitAll(wt.path, `${agent.id}: слияние с main`);
      }
      const files = await this.gitLock.run(async () => {
        const changes = await changedFiles(this.ws!.projectDir, this.ws!.mainBranch, wt.branch);
        return (await this.ws!.fastForwardMain(wt)) ? changes : undefined;
      });
      if (files) return files;
    }
    throw new Error('не удалось влить изменения в main');
  }

  private async runAgent(task: TaskSpec, agent: AgentSpec, runner: AgentRunner, cwd: string, prompt: string, meta: RunMeta): Promise<AgentResult> {
    if (this.stopped) throw new Cancelled();
    let result: AgentResult | undefined;
    const prev = this.snapshot.tasks[task.id]!;
    for await (const ev of runner.run({
      cwd,
      prompt,
      systemPrompt: agentSystemPrompt(this.plan, agent),
      model: this.settings.model,
      permissionMode: this.settings.permissionMode,
      allowedTools: this.settings.permissionMode === 'bypassPermissions' ? undefined : this.settings.allowedTools,
      resumeSessionId: prev.sessionId,
      signal: this.abort.signal,
      meta,
    })) {
      this.emit({ type: 'agent', ts: Date.now(), taskId: task.id, agentId: agent.id, event: ev });
      if (ev.type === 'session' && ev.sessionId) this.patch(task.id, { sessionId: ev.sessionId });
      if (ev.type === 'result') result = ev.result;
    }
    if (this.stopped) throw new Cancelled();
    result ??= { ok: false, text: '', error: 'агент завершился без результата' };
    const cur = this.snapshot.tasks[task.id]!;
    this.patch(task.id, { costUsd: cur.costUsd + (result.costUsd ?? 0), sessionId: result.sessionId ?? cur.sessionId });
    return result;
  }

  private doneTasks() {
    return this.plan.tasks
      .filter((t) => this.snapshot.tasks[t.id]?.status === 'done')
      .map((t) => ({ id: t.id, title: t.title, summary: this.snapshot.tasks[t.id]?.summary }));
  }

  private async filesWithMarkers(dir: string, files: string[]): Promise<string[]> {
    const left: string[] = [];
    for (const f of files) {
      const text = await readFile(join(dir, f), 'utf8').catch(() => '');
      if (/^(<{7}|>{7})( |$)/m.test(text)) left.push(f);
    }
    return left;
  }

  private patch(taskId: string, patch: Partial<Omit<TaskState, 'id'>>): void {
    this.emit({ type: 'task', ts: Date.now(), taskId, patch });
  }

  private log(level: 'info' | 'error' | 'success', message: string, taskId?: string): void {
    this.emit({ type: 'log', ts: Date.now(), level, message, taskId });
  }

  private emit(e: RunEvent): void {
    this.snapshot = reduce(this.snapshot, e);
    const snap = this.snapshot;
    // Запись на диск — последовательно, чтобы события не перемешались.
    this.writeQueue = this.writeQueue
      .then(() => this.store.appendEvent(this.runId, e))
      .then(() => (e.type === 'agent' ? undefined : this.store.saveSnapshot(snap)))
      .catch(() => {});
    for (const fn of this.listeners) {
      try {
        fn(e, snap);
      } catch {
        // слушатель не должен ронять оркестратор
      }
    }
  }

  private async flush(): Promise<void> {
    await this.writeQueue;
    await this.store.saveSnapshot(this.snapshot).catch(() => {});
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function tail(s: string, max: number): string {
  return s.length > max ? `…${s.slice(-max)}` : s;
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
