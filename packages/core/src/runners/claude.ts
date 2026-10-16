import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { execCapture } from '../util/process.ts';
import { parseClaudeLine, truncate } from './claudeParser.ts';
import type { AgentEvent, AgentRunner, EngineInfo, RunOptions } from './types.ts';

export interface ClaudeRunnerOptions {
  /** Путь к исполняемому файлу CLI (по умолчанию `claude` из PATH или $VIBE_CLAUDE_BIN). */
  command?: string;
  /** Аргументы, добавляемые перед остальными (нужно для тестов с фейковым CLI). */
  baseArgs?: string[];
}

/**
 * Движок Claude Code: запускает установленный у пользователя `claude` в headless-режиме.
 * Авторизация — через логин пользователя в самом CLI, API-ключ не нужен.
 */
export class ClaudeCodeRunner implements AgentRunner {
  readonly id = 'claude-code' as const;
  private readonly command: string;
  private readonly baseArgs: string[];

  constructor(opts: ClaudeRunnerOptions = {}) {
    this.command = opts.command ?? process.env.VIBE_CLAUDE_BIN ?? 'claude';
    this.baseArgs = opts.baseArgs ?? [];
  }

  async info(): Promise<EngineInfo> {
    const base = { id: this.id, name: 'Claude Code' };
    try {
      const { stdout, code } = await execCapture(this.command, [...this.baseArgs, '--version'], { timeoutMs: 15_000 });
      if (code !== 0) return { ...base, available: false, hint: 'claude --version завершился с ошибкой' };
      return { ...base, available: true, version: stdout.trim() };
    } catch {
      return { ...base, available: false, hint: 'Установите Claude Code: npm i -g @anthropic-ai/claude-code, затем выполните claude и войдите' };
    }
  }

  buildArgs(opts: RunOptions): string[] {
    const args = [...this.baseArgs, '-p', '--output-format', 'stream-json', '--verbose'];
    if (opts.model) args.push('--model', opts.model);
    if (opts.systemPrompt) args.push('--append-system-prompt', opts.systemPrompt);
    if (opts.permissionMode) args.push('--permission-mode', opts.permissionMode);
    if (opts.allowedTools?.length) args.push('--allowedTools', ...opts.allowedTools);
    if (opts.disallowedTools?.length) args.push('--disallowedTools', ...opts.disallowedTools);
    if (opts.jsonSchema) args.push('--json-schema', JSON.stringify(opts.jsonSchema));
    if (opts.resumeSessionId) args.push('--resume', opts.resumeSessionId);
    return args;
  }

  async *run(opts: RunOptions): AsyncIterable<AgentEvent> {
    const child = spawn(this.command, this.buildArgs(opts), {
      cwd: opts.cwd,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let spawnError: Error | undefined;
    child.on('error', (err) => (spawnError = err));
    const onAbort = () => child.kill('SIGTERM');
    opts.signal?.addEventListener('abort', onAbort, { once: true });

    // Промпт передаём через stdin: так нет ограничений на длину командной строки (Windows).
    child.stdin.on('error', () => {});
    child.stdin.end(opts.prompt);

    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d: string) => (stderr = (stderr + d).slice(-8000)));

    const exited = new Promise<number | null>((resolve) => child.on('close', (code) => resolve(code)));

    let gotResult = false;
    try {
      const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
      for await (const line of rl) {
        for (const ev of parseClaudeLine(line, opts.cwd)) {
          if (ev.type === 'result') gotResult = true;
          yield ev;
        }
      }
      const code = await exited;
      if (!gotResult) {
        const reason = opts.signal?.aborted
          ? 'остановлено пользователем'
          : spawnError
            ? `не удалось запустить "${this.command}": ${spawnError.message}`
            : `claude завершился с кодом ${code}${stderr ? `: ${truncate(stderr.trim(), 1500)}` : ''}`;
        yield { type: 'result', result: { ok: false, text: '', error: reason } };
      }
    } finally {
      opts.signal?.removeEventListener('abort', onAbort);
      if (child.exitCode === null && !child.killed) child.kill('SIGTERM');
    }
  }
}
