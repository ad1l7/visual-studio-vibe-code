import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import {
  clarify,
  generatePlan,
  Orchestrator,
  parsePlan,
  ProjectStore,
  Workspace,
  type AgentEvent,
  type Answers,
  type ClarifyQuestion,
  type EngineId,
  type Plan,
  type RunEvent,
  type RunnerRegistry,
  type RunSettings,
  type RunSnapshot,
} from '@vibe/core';

/** Сообщение, которое уходит в браузер по SSE. */
export type StreamMessage =
  | { type: 'hello'; snapshot: RunSnapshot | null; running: boolean }
  | { type: 'run-event'; event: RunEvent }
  | { type: 'planner'; text: string };

const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N}_-]{0,63}$/u;
const IGNORED = new Set(['.git', 'node_modules', 'dist', 'build', '.next', '.venv', '__pycache__']);

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface TreeNode {
  name: string;
  path: string;
  dir: boolean;
  children?: TreeNode[];
}

class ProjectSession {
  orchestrator?: Orchestrator;
  plannerBusy = false;
  readonly clients = new Set<(m: StreamMessage) => void>();
  readonly store: ProjectStore;

  constructor(
    readonly name: string,
    readonly dir: string,
  ) {
    this.store = new ProjectStore(dir);
  }

  get running() {
    return !!this.orchestrator && ['idle', 'running'].includes(this.orchestrator.state.status);
  }

  broadcast(m: StreamMessage) {
    for (const send of this.clients) send(m);
  }
}

export class ProjectManager {
  private readonly sessions = new Map<string, ProjectSession>();

  constructor(
    readonly root: string,
    private readonly runners: RunnerRegistry,
  ) {}

  async list() {
    await mkdir(this.root, { recursive: true });
    const entries = await readdir(this.root, { withFileTypes: true });
    const projects = [];
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue;
      const dir = join(this.root, e.name);
      const store = new ProjectStore(dir);
      const plan = await store.loadPlan().catch(() => undefined);
      const snap = await store.latestSnapshot().catch(() => undefined);
      projects.push({
        name: e.name,
        title: plan?.project.name ?? e.name,
        hasPlan: !!plan,
        lastRun: snap ? { status: snap.status, startedAt: snap.startedAt } : null,
        running: this.sessions.get(e.name)?.running ?? false,
        modifiedAt: (await stat(dir)).mtimeMs,
      });
    }
    return projects.sort((a, b) => b.modifiedAt - a.modifiedAt);
  }

  async create(name: string) {
    if (!NAME_RE.test(name)) throw new HttpError(400, 'Имя проекта: буквы, цифры, «-» и «_», без пробелов');
    const dir = join(this.root, name);
    if (existsSync(dir)) throw new HttpError(409, 'Проект с таким именем уже есть');
    await mkdir(dir, { recursive: true });
    await Workspace.open(dir);
    return { name };
  }

  session(name: string): ProjectSession {
    if (!NAME_RE.test(name)) throw new HttpError(400, 'Некорректное имя проекта');
    const dir = join(this.root, name);
    if (!existsSync(dir)) throw new HttpError(404, 'Проект не найден');
    let s = this.sessions.get(name);
    if (!s) this.sessions.set(name, (s = new ProjectSession(name, dir)));
    return s;
  }

  async details(name: string) {
    const s = this.session(name);
    return {
      name,
      path: s.dir,
      spec: (await s.store.loadSpec()) ?? '',
      plan: (await s.store.loadPlan().catch(() => undefined)) ?? null,
      snapshot: s.orchestrator?.state ?? (await s.store.latestSnapshot()) ?? null,
      running: s.running,
    };
  }

  private runner(engine: EngineId) {
    const r = this.runners[engine];
    if (!r) throw new HttpError(400, `Движок «${engine}» не подключён`);
    return r;
  }

  private async withPlanner<T>(s: ProjectSession, fn: (onEvent: (e: AgentEvent) => void) => Promise<T>): Promise<T> {
    if (s.plannerBusy) throw new HttpError(409, 'Планировщик уже работает над этим проектом');
    if (s.running) throw new HttpError(409, 'Сейчас идёт запуск агентов');
    s.plannerBusy = true;
    const onEvent = (e: AgentEvent) => {
      if (e.type === 'status') s.broadcast({ type: 'planner', text: e.text });
      if (e.type === 'tool') s.broadcast({ type: 'planner', text: e.summary });
    };
    try {
      return await fn(onEvent);
    } finally {
      s.plannerBusy = false;
    }
  }

  async clarify(name: string, body: { spec: string; engine: EngineId; model?: string }): Promise<ClarifyQuestion[]> {
    const s = this.session(name);
    if (!body.spec?.trim()) throw new HttpError(400, 'ТЗ пустое');
    await s.store.saveSpec(body.spec);
    return this.withPlanner(s, (onEvent) => clarify(body.spec, { runner: this.runner(body.engine), cwd: s.dir, model: body.model, onEvent }));
  }

  async plan(name: string, body: { spec: string; questions?: ClarifyQuestion[]; answers?: Answers; engine: EngineId; model?: string }): Promise<Plan> {
    const s = this.session(name);
    if (!body.spec?.trim()) throw new HttpError(400, 'ТЗ пустое');
    const plan = await this.withPlanner(s, (onEvent) =>
      generatePlan({ spec: body.spec, questions: body.questions, answers: body.answers }, { runner: this.runner(body.engine), cwd: s.dir, model: body.model, onEvent }),
    );
    const answered = (body.questions ?? []).filter((q) => body.answers?.[q.id]?.trim());
    const fullSpec = answered.length ? `${body.spec.trim()}\n\n## Уточнения\n${answered.map((q) => `- ${q.question} — ${body.answers![q.id]}`).join('\n')}` : body.spec;
    await s.store.saveSpec(fullSpec);
    await s.store.savePlan(plan);
    return plan;
  }

  async savePlan(name: string, input: unknown): Promise<Plan> {
    const s = this.session(name);
    if (s.running) throw new HttpError(409, 'Нельзя менять план во время запуска');
    let plan: Plan;
    try {
      plan = parsePlan(input);
    } catch (err) {
      throw new HttpError(400, err instanceof Error ? err.message : String(err));
    }
    await s.store.savePlan(plan);
    return plan;
  }

  async run(name: string, settings: Partial<RunSettings>) {
    const s = this.session(name);
    if (s.running) throw new HttpError(409, 'Агенты уже работают');
    if (s.plannerBusy) throw new HttpError(409, 'Дождитесь окончания планирования');
    const plan = await s.store.loadPlan();
    if (!plan) throw new HttpError(400, 'Сначала составьте план');
    const engine = settings.defaultEngine ?? 'claude-code';
    const info = await this.runner(engine).info();
    if (!info.available) throw new HttpError(400, `${info.name} недоступен. ${info.hint ?? ''}`);

    const orch = new Orchestrator({ projectDir: s.dir, plan, runners: this.runners, settings });
    s.orchestrator = orch;
    orch.subscribe((event) => s.broadcast({ type: 'run-event', event }));
    s.broadcast({ type: 'hello', snapshot: orch.state, running: true });
    void orch.start();
    return { runId: orch.runId };
  }

  stop(name: string) {
    const s = this.session(name);
    s.orchestrator?.stop();
    return { ok: true };
  }

  async tree(name: string): Promise<TreeNode[]> {
    const s = this.session(name);
    const walk = async (dir: string, depth: number): Promise<TreeNode[]> => {
      const entries = await readdir(dir, { withFileTypes: true });
      const nodes: TreeNode[] = [];
      for (const e of entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))) {
        if (IGNORED.has(e.name) || e.name === '.gitkeep') continue;
        const abs = join(dir, e.name);
        const path = relative(s.dir, abs).split(sep).join('/');
        if (path === '.vibe/runs') continue;
        if (e.isDirectory()) nodes.push({ name: e.name, path, dir: true, children: depth < 8 ? await walk(abs, depth + 1) : [] });
        else nodes.push({ name: e.name, path, dir: false });
      }
      return nodes;
    };
    return walk(s.dir, 0);
  }

  async file(name: string, path: string): Promise<{ path: string; content: string; truncated: boolean }> {
    const s = this.session(name);
    const abs = resolve(s.dir, path);
    if (abs !== s.dir && !abs.startsWith(s.dir + sep)) throw new HttpError(400, 'Путь вне проекта');
    if (abs.split(sep).includes('.git')) throw new HttpError(400, 'Недоступно');
    const info = await stat(abs).catch(() => null);
    if (!info?.isFile()) throw new HttpError(404, 'Файл не найден');
    const LIMIT = 256 * 1024;
    const buf = await readFile(abs);
    const slice = buf.subarray(0, LIMIT);
    if (slice.includes(0)) return { path, content: '(двоичный файл)', truncated: false };
    return { path, content: slice.toString('utf8'), truncated: buf.length > LIMIT };
  }

  subscribe(name: string, send: (m: StreamMessage) => void): () => void {
    const s = this.session(name);
    s.clients.add(send);
    void (async () => {
      const snapshot = s.orchestrator?.state ?? (await s.store.latestSnapshot()) ?? null;
      send({ type: 'hello', snapshot, running: s.running });
    })();
    return () => s.clients.delete(send);
  }

  stopAll() {
    for (const s of this.sessions.values()) s.orchestrator?.stop();
  }
}
