import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { templateClarification, templatePlan } from '../planner/template.ts';
import { git } from '../workspace/git.ts';
import type { AgentEvent, AgentRunner, EngineInfo, RunMeta, RunOptions } from './types.ts';

export interface MockRunnerOptions {
  /** Пауза между событиями, мс (для наглядного демо). */
  delayMs?: number;
  /** Какие файлы создаёт задача. По умолчанию — `<первая папка>/<taskId>.md`. */
  taskFiles?: (meta: RunMeta, opts: RunOptions) => Record<string, string>;
  /** Вернуть текст ошибки, чтобы «провалить» запуск. */
  fail?: (meta: RunMeta, opts: RunOptions) => string | undefined;
}

/**
 * Демо-движок без ИИ: пишет заглушки и генерирует типовой план.
 * Нужен для тестов и чтобы посмотреть интерфейс без установленного CLI.
 */
export class MockRunner implements AgentRunner {
  readonly id = 'mock' as const;
  constructor(private readonly options: MockRunnerOptions = {}) {}

  async info(): Promise<EngineInfo> {
    return { id: this.id, name: 'Демо (без ИИ)', available: true, version: 'mock' };
  }

  async *run(opts: RunOptions): AsyncIterable<AgentEvent> {
    const { meta } = opts;
    const sessionId = `mock-${meta.purpose}-${meta.taskId ?? 'x'}-${Date.now()}`;
    yield { type: 'session', sessionId, model: 'mock' };
    await this.pause(opts);

    const failure = this.options.fail?.(meta, opts);
    if (failure) {
      yield { type: 'text', text: `Не получилось: ${failure}` };
      yield { type: 'result', result: { ok: false, text: '', error: failure, sessionId } };
      return;
    }

    if (opts.signal?.aborted) {
      yield { type: 'result', result: { ok: false, text: '', error: 'остановлено пользователем', sessionId } };
      return;
    }

    if (meta.purpose === 'clarify' || meta.purpose === 'plan') {
      yield { type: 'status', text: meta.purpose === 'plan' ? 'Составляю план' : 'Формулирую вопросы' };
      const structured = meta.purpose === 'plan' ? templatePlan(opts.prompt.split('ТЗ:\n')[1] ?? opts.prompt) : templateClarification();
      yield { type: 'result', result: { ok: true, text: 'готово', structured, sessionId, costUsd: 0 } };
      return;
    }

    if (meta.purpose === 'resolve-conflict') {
      const files = await resolveConflictsKeepingBoth(opts.cwd);
      for (const f of files) yield { type: 'tool', toolUseId: `t-${f}`, name: 'Edit', summary: `Редактирует ${f}`, input: { file_path: f } };
      yield { type: 'result', result: { ok: true, text: `Конфликты устранены: ${files.join(', ')}`, sessionId, costUsd: 0 } };
      return;
    }

    const files = this.options.taskFiles?.(meta, opts) ?? defaultFiles(meta);
    let i = 0;
    for (const [path, content] of Object.entries(files)) {
      const toolUseId = `t-${i++}`;
      yield { type: 'tool', toolUseId, name: 'Write', summary: `Создаёт ${path}`, input: { file_path: path } };
      await mkdir(dirname(join(opts.cwd, path)), { recursive: true });
      await writeFile(join(opts.cwd, path), content);
      await this.pause(opts);
      yield { type: 'tool_result', toolUseId, isError: false, output: 'ok' };
    }
    yield { type: 'text', text: `Готово: ${Object.keys(files).join(', ')}` };
    yield { type: 'result', result: { ok: true, text: `Сделано: ${Object.keys(files).join(', ')}`, sessionId, costUsd: 0, turns: 1 } };
  }

  private pause(opts: RunOptions) {
    const ms = this.options.delayMs ?? 0;
    if (!ms || opts.signal?.aborted) return Promise.resolve();
    return new Promise<void>((r) => {
      const t = setTimeout(r, ms);
      opts.signal?.addEventListener('abort', () => (clearTimeout(t), r()), { once: true });
    });
  }
}

function defaultFiles(meta: RunMeta): Record<string, string> {
  const first = meta.scope?.find((s) => s.endsWith('/')) ?? 'notes/';
  return { [`${first}${meta.taskId ?? 'task'}.md`]: `# ${meta.taskId}\n\nСоздано демо-агентом «${meta.agentId}».\n` };
}

async function resolveConflictsKeepingBoth(cwd: string): Promise<string[]> {
  const { stdout } = await git(cwd, ['diff', '--name-only', '--diff-filter=U']);
  const files = stdout.split('\n').filter(Boolean);
  for (const f of files) {
    const text = await readFile(join(cwd, f), 'utf8');
    const resolved = text.replace(/^<<<<<<< .*\n([\s\S]*?)^=======\n([\s\S]*?)^>>>>>>> .*\n/gm, '$1$2');
    await writeFile(join(cwd, f), resolved);
  }
  return files;
}
