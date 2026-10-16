import { spawn } from 'node:child_process';

export interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface ExecOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  input?: string;
  /** Запуск через системный shell (для пользовательских команд проверки). */
  shell?: boolean;
  signal?: AbortSignal;
}

/** Запускает процесс и собирает вывод. Отклоняется только если процесс не удалось запустить. */
export function execCapture(cmd: string, args: string[], opts: ExecOptions = {}): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      shell: opts.shell ?? false,
      stdio: ['pipe', 'pipe', 'pipe'],
      signal: opts.signal,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          stderr += `\n[таймаут ${opts.timeoutMs} мс]`;
          child.kill('SIGTERM');
        }, opts.timeoutMs)
      : undefined;
    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(opts.input ?? '');
  });
}
