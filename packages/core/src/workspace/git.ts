import { execCapture, type ExecResult } from '../util/process.ts';

export class GitError extends Error {
  constructor(
    public readonly args: string[],
    public readonly result: ExecResult,
  ) {
    super(`git ${args.join(' ')} → код ${result.code}: ${(result.stderr || result.stdout).trim()}`);
    this.name = 'GitError';
  }
}

// Если у пользователя не настроены имя/почта в git, коммиты от имени студии.
const FALLBACK_IDENTITY = {
  GIT_AUTHOR_NAME: 'Vibe Studio',
  GIT_AUTHOR_EMAIL: 'vibe-studio@localhost',
  GIT_COMMITTER_NAME: 'Vibe Studio',
  GIT_COMMITTER_EMAIL: 'vibe-studio@localhost',
};

const identityCache = new Map<string, NodeJS.ProcessEnv>();

async function envFor(cwd: string): Promise<NodeJS.ProcessEnv> {
  const cached = identityCache.get(cwd);
  if (cached) return cached;
  const name = await execCapture('git', ['config', 'user.name'], { cwd });
  const email = await execCapture('git', ['config', 'user.email'], { cwd });
  const hasIdentity = name.stdout.trim() && email.stdout.trim();
  const env = hasIdentity ? process.env : { ...process.env, ...FALLBACK_IDENTITY };
  identityCache.set(cwd, env);
  return env;
}

/** git без исключений на ненулевой код. */
export async function git(cwd: string, args: string[]): Promise<ExecResult> {
  return execCapture('git', args, { cwd, env: await envFor(cwd) });
}

/** git с исключением на ненулевой код. */
export async function gitOk(cwd: string, args: string[]): Promise<string> {
  const r = await git(cwd, args);
  if (r.code !== 0) throw new GitError(args, r);
  return r.stdout.trim();
}

export async function isGitRepo(dir: string): Promise<boolean> {
  const r = await execCapture('git', ['rev-parse', '--show-toplevel'], { cwd: dir }).catch(() => null);
  return !!r && r.code === 0;
}

export async function currentBranch(dir: string): Promise<string> {
  return gitOk(dir, ['rev-parse', '--abbrev-ref', 'HEAD']);
}

export async function isDirty(dir: string): Promise<boolean> {
  return (await gitOk(dir, ['status', '--porcelain'])).length > 0;
}

/** Коммитит все изменения, если они есть. Возвращает true, если коммит создан. */
export async function commitAll(dir: string, message: string): Promise<boolean> {
  await gitOk(dir, ['add', '-A']);
  const staged = await git(dir, ['diff', '--cached', '--quiet']);
  if (staged.code === 0) return false;
  await gitOk(dir, ['commit', '-q', '--no-verify', '-m', message]);
  return true;
}

export interface FileChange {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
}

export async function changedFiles(dir: string, from: string, to: string): Promise<FileChange[]> {
  const out = await gitOk(dir, ['diff', '--name-status', '--no-renames', `${from}..${to}`]);
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [code, ...rest] = line.split('\t');
      const status = code === 'A' ? 'added' : code === 'D' ? 'deleted' : code?.startsWith('R') ? 'renamed' : 'modified';
      return { path: rest.join('\t'), status };
    });
}
