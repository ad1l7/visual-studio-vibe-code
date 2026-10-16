import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MockRunner, plural } from '@vibe/core';
import { ProjectManager, type StreamMessage } from '../server/projects.ts';

const dirs: string[] = [];
afterEach(async () => Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true }))));

async function manager() {
  const root = await mkdtemp(join(tmpdir(), 'vibe-studio-'));
  dirs.push(root);
  return new ProjectManager(root, { mock: new MockRunner() });
}

describe('ProjectManager', () => {
  it('ТЗ → вопросы → план → запуск → готово, с событиями по SSE', async () => {
    const pm = await manager();
    await pm.create('shop');
    const questions = await pm.clarify('shop', { spec: 'Магазин носков', engine: 'mock' });
    expect(questions.length).toBeGreaterThan(0);
    const plan = await pm.plan('shop', { spec: 'Магазин носков', questions, answers: { [questions[0]!.id]: 'Да' }, engine: 'mock' });
    expect(plan.agents.length).toBeGreaterThan(2);

    const messages: StreamMessage[] = [];
    pm.subscribe('shop', (m) => messages.push(m));
    await pm.run('shop', { defaultEngine: 'mock', worktreesRoot: join(pm.root, '.wt') });
    await expect(pm.run('shop', { defaultEngine: 'mock' })).rejects.toThrow(/уже работают/);

    for (let i = 0; i < 100 && (await pm.details('shop')).running; i++) await new Promise((r) => setTimeout(r, 100));
    const details = await pm.details('shop');
    expect(details.snapshot?.status).toBe('done');
    expect(details.spec).toContain('Уточнения');
    expect(messages.some((m) => m.type === 'run-event' && m.event.type === 'run' && m.event.status === 'done')).toBe(true);

    const tree = await pm.tree('shop');
    expect(tree.map((n) => n.name)).toContain('AGENTS.md');
    expect(JSON.stringify(tree)).not.toContain('"runs"');
    expect((await pm.file('shop', 'AGENTS.md')).content).toContain('Команда агентов');
    expect(existsSync(join(pm.root, 'shop', '.vibe', 'plan.json'))).toBe(true);
  });

  it('не выпускает за пределы папки проекта и проверяет имена', async () => {
    const pm = await manager();
    await pm.create('demo');
    await expect(pm.file('demo', '../../etc/passwd')).rejects.toThrow(/вне проекта/);
    await expect(pm.file('demo', '.git/config')).rejects.toThrow(/Недоступно/);
    await expect(pm.create('../evil')).rejects.toThrow(/Имя проекта/);
    await expect(pm.create('demo')).rejects.toThrow(/уже есть/);
    await expect(pm.savePlan('demo', { project: {} })).rejects.toThrow(/План некорректен/);
  });
});

describe('plural', () => {
  it('склоняет', () => {
    expect([1, 2, 5, 11, 21, 22, 112].map((n) => plural(n, ['задача', 'задачи', 'задач']))).toEqual([
      '1 задача', '2 задачи', '5 задач', '11 задач', '21 задача', '22 задачи', '112 задач',
    ]);
  });
});
