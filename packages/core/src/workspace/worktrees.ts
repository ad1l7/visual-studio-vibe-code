import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { currentBranch, git, gitOk, isGitRepo } from './git.ts';

export interface TaskWorktree {
  path: string;
  branch: string;
  /** Коммит main, от которого создана ветка. */
  base: string;
}

export function defaultWorktreesRoot(projectDir: string): string {
  const abs = resolve(projectDir);
  const hash = createHash('sha1').update(abs).digest('hex').slice(0, 8);
  return join(homedir(), '.vibe-studio', 'worktrees', `${basename(abs)}-${hash}`);
}

/**
 * Изоляция агентов: у каждой задачи своя ветка и своя рабочая копия (git worktree),
 * поэтому параллельные агенты не перетирают файлы друг друга.
 */
export class Workspace {
  private constructor(
    readonly projectDir: string,
    readonly mainBranch: string,
    readonly worktreesRoot: string,
  ) {}

  static async open(projectDir: string, worktreesRoot?: string): Promise<Workspace> {
    const dir = resolve(projectDir);
    if (!(await isGitRepo(dir))) {
      await gitOk(dir, ['init', '-q', '-b', 'main']);
    }
    const hasCommits = (await git(dir, ['rev-parse', '--verify', 'HEAD'])).code === 0;
    if (!hasCommits) {
      await gitOk(dir, ['commit', '-q', '--allow-empty', '--no-verify', '-m', 'vibe: начало проекта']);
    }
    const branch = await currentBranch(dir);
    if (branch === 'HEAD') throw new Error('Репозиторий в состоянии detached HEAD — переключитесь на ветку (git switch main).');
    return new Workspace(dir, branch, worktreesRoot ?? defaultWorktreesRoot(dir));
  }

  async create(runId: string, taskId: string): Promise<TaskWorktree> {
    const path = join(this.worktreesRoot, `${runId}-${taskId}`);
    const branch = `vibe/${runId}/${taskId}`;
    await mkdir(this.worktreesRoot, { recursive: true });
    if (existsSync(path)) await this.removePath(path);
    const base = await gitOk(this.projectDir, ['rev-parse', this.mainBranch]);
    await gitOk(this.projectDir, ['worktree', 'add', '-q', '-B', branch, path, base]);
    return { path, branch, base };
  }

  /** Вливает свежий main в ветку задачи. Возвращает список файлов с конфликтами. */
  async mergeMainInto(wt: TaskWorktree): Promise<string[]> {
    const r = await git(wt.path, ['merge', '--no-edit', '--no-ff', '-q', this.mainBranch]);
    if (r.code === 0) return [];
    const conflicts = (await gitOk(wt.path, ['diff', '--name-only', '--diff-filter=U'])).split('\n').filter(Boolean);
    if (!conflicts.length) throw new Error(`git merge ${this.mainBranch} не удался: ${(r.stderr || r.stdout).trim()}`);
    return conflicts;
  }

  async abortMerge(wt: TaskWorktree): Promise<void> {
    await git(wt.path, ['merge', '--abort']);
  }

  async mainHead(): Promise<string> {
    return gitOk(this.projectDir, ['rev-parse', this.mainBranch]);
  }

  /** Перемотка main на ветку задачи. false — main успел уйти вперёд, нужно повторить слияние. */
  async fastForwardMain(wt: TaskWorktree): Promise<boolean> {
    const isAncestor = await git(this.projectDir, ['merge-base', '--is-ancestor', this.mainBranch, wt.branch]);
    if (isAncestor.code !== 0) return false;
    await gitOk(this.projectDir, ['merge', '--ff-only', '-q', wt.branch]);
    return true;
  }

  async remove(wt: TaskWorktree, deleteBranch: boolean): Promise<void> {
    await this.removePath(wt.path);
    if (deleteBranch) await git(this.projectDir, ['branch', '-D', wt.branch]);
  }

  private async removePath(path: string): Promise<void> {
    await git(this.projectDir, ['worktree', 'remove', '--force', path]);
    if (existsSync(path)) await rm(path, { recursive: true, force: true });
    await git(this.projectDir, ['worktree', 'prune']);
  }
}
