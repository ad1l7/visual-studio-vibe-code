import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Orchestrator } from '../src/orchestrator/orchestrator.ts';
import { MockRunner, type MockRunnerOptions } from '../src/runners/mock.ts';
import { ProjectStore } from '../src/storage.ts';
import { gitOk } from '../src/workspace/git.ts';
import { makePlan, tempDir } from './helpers.ts';

async function setup(tasks: Parameters<typeof makePlan>[0], mock: MockRunnerOptions = {}, settings = {}, agents?: Parameters<typeof makePlan>[1]) {
  const projectDir = await tempDir('vibe-proj-');
  const worktreesRoot = await tempDir('vibe-wt-');
  const plan = makePlan(tasks, agents);
  const orch = new Orchestrator({
    projectDir,
    plan,
    runners: { mock: new MockRunner(mock) },
    settings: { defaultEngine: 'mock', worktreesRoot, concurrency: 3, ...settings },
  });
  return { projectDir, orch, plan };
}

const chain = [
  { id: 'arch', agentId: 'architect', title: 'Архитектура', description: 'd' },
  { id: 'api', agentId: 'backend', title: 'API', description: 'd', dependsOn: ['arch'] },
  { id: 'ui', agentId: 'frontend', title: 'UI', description: 'd', dependsOn: ['arch'] },
];

describe('Orchestrator', () => {
  it('выполняет граф задач и вливает всё в main', async () => {
    const { projectDir, orch } = await setup(chain, { delayMs: 30 });
    let maxParallel = 0;
    orch.subscribe((_, s) => {
      const n = Object.values(s.tasks).filter((t) => t.status === 'running').length;
      maxParallel = Math.max(maxParallel, n);
    });
    const snap = await orch.start();

    expect(snap.status).toBe('done');
    expect(Object.values(snap.tasks).every((t) => t.status === 'done')).toBe(true);
    expect(maxParallel).toBe(2); // api и ui идут параллельно после arch
    for (const f of ['docs/arch.md', 'backend/api.md', 'frontend/ui.md', 'AGENTS.md', 'CLAUDE.md', '.vibe/plan.json']) {
      expect(existsSync(join(projectDir, f)), f).toBe(true);
    }
    expect(snap.tasks.api!.files).toEqual([{ path: 'backend/api.md', status: 'added' }]);
    expect(await gitOk(projectDir, ['status', '--porcelain'])).toBe('');
    // временные ветки удалены, worktree убраны
    expect(await gitOk(projectDir, ['branch', '--list', 'vibe/*'])).toBe('');
    expect((await gitOk(projectDir, ['worktree', 'list'])).split('\n')).toHaveLength(1);
    // история запуска сохранена
    const saved = await new ProjectStore(projectDir).latestSnapshot();
    expect(saved?.status).toBe('done');
  });

  it('ошибка задачи блокирует зависимые, но не мешает независимым', async () => {
    const { orch } = await setup(chain, { fail: (m) => (m.taskId === 'arch' ? 'сломалось' : undefined) });
    const snap = await orch.start();
    expect(snap.status).toBe('failed');
    expect(snap.tasks.arch!.status).toBe('failed');
    expect(snap.tasks.arch!.attempts).toBe(2);
    expect(snap.tasks.api!.status).toBe('blocked');
    expect(snap.tasks.ui!.status).toBe('blocked');
  });

  it('повторяет задачу и передаёт агенту причину неудачи', async () => {
    const prompts: string[] = [];
    let calls = 0;
    const { orch } = await setup([chain[0]!], {
      fail: (m, o) => {
        if (m.purpose !== 'task') return undefined;
        prompts.push(o.prompt);
        return ++calls === 1 ? 'тест упал' : undefined;
      },
    });
    const snap = await orch.start();
    expect(snap.status).toBe('done');
    expect(snap.tasks.arch!.attempts).toBe(2);
    expect(prompts[1]).toContain('тест упал');
  });

  it('проваленная проверка (checkCommand) отправляет задачу на доработку', async () => {
    const { orch } = await setup(
      [{ id: 'api', agentId: 'backend', title: 'API', description: 'd' }],
      {
        // На второй попытке агент «чинит» код — появляется файл, который ищет проверка.
        taskFiles: (_m, o): Record<string, string> => (o.prompt.includes('не прошла проверку') ? { 'backend/fixed.txt': 'ok' } : { 'backend/draft.txt': 'x' }),
      },
      {},
      [{ id: 'backend', role: 'Backend', description: 'd', scope: ['backend/'], checkCommand: 'test -f backend/fixed.txt' }],
    );
    const snap = await orch.start();
    expect(snap.status).toBe('done');
    expect(snap.tasks.api!.attempts).toBe(2);
  });

  it('разрешает конфликт, когда два агента параллельно меняют один файл', async () => {
    const { projectDir, orch } = await setup(
      [
        { id: 'one', agentId: 'backend', title: 'Один', description: 'd' },
        { id: 'two', agentId: 'frontend', title: 'Два', description: 'd' },
      ],
      { delayMs: 20, taskFiles: (m) => ({ 'shared/README.md': `строка от ${m.agentId}\n` }) },
    );
    const snap = await orch.start();
    expect(snap.status).toBe('done');
    const text = readFileSync(join(projectDir, 'shared/README.md'), 'utf8');
    expect(text).toContain('строка от backend');
    expect(text).toContain('строка от frontend');
    expect(text).not.toMatch(/<{7}|>{7}/);
    expect(snap.feed.some((f) => f.text.includes('Конфликт'))).toBe(true);
  });

  it('останавливается по запросу и отменяет оставшиеся задачи', async () => {
    const { orch } = await setup(chain, { delayMs: 200 });
    const done = orch.start();
    setTimeout(() => orch.stop(), 100);
    const snap = await done;
    expect(snap.status).toBe('stopped');
    expect(snap.tasks.arch!.status).toBe('cancelled');
    expect(snap.tasks.api!.status).toBe('cancelled');
  });

  it('сообщает, если движок не подключён', async () => {
    const projectDir = await tempDir();
    const orch = new Orchestrator({
      projectDir,
      plan: makePlan([chain[0]!]),
      runners: {},
      settings: { defaultEngine: 'claude-code', worktreesRoot: await tempDir() },
    });
    const snap = await orch.start();
    expect(snap.tasks.arch!.error).toContain('не подключён');
  });
});
