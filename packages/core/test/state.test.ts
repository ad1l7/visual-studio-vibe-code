import { describe, expect, it } from 'vitest';
import { initialSnapshot, reduce } from '../src/orchestrator/state.ts';
import { makePlan } from './helpers.ts';

describe('редьюсер состояния', () => {
  const plan = makePlan([
    { id: 'a', agentId: 'backend', title: 'A', description: 'd' },
    { id: 'b', agentId: 'backend', title: 'B', description: 'd' },
  ]);

  it('ведёт статусы агента, текущее действие и стоимость', () => {
    let s = initialSnapshot('r', plan, 0);
    s = reduce(s, { type: 'task', ts: 1, taskId: 'a', patch: { status: 'running' } });
    expect(s.agents.backend).toMatchObject({ status: 'working', currentTaskId: 'a' });
    s = reduce(s, { type: 'agent', ts: 2, taskId: 'a', agentId: 'backend', event: { type: 'tool', toolUseId: '1', name: 'Write', summary: 'Создаёт x.ts', input: {} } });
    expect(s.agents.backend!.lastAction).toBe('Создаёт x.ts');
    expect(s.feed.at(-1)).toMatchObject({ kind: 'action', text: 'Создаёт x.ts' });
    s = reduce(s, { type: 'task', ts: 3, taskId: 'a', patch: { status: 'done', costUsd: 0.5 } });
    expect(s.costUsd).toBe(0.5);
    expect(s.agents.backend!.status).toBe('idle'); // осталась задача b
    s = reduce(s, { type: 'task', ts: 4, taskId: 'b', patch: { status: 'done', costUsd: 0.25 } });
    expect(s.agents.backend!.status).toBe('done');
    expect(s.costUsd).toBe(0.75);
  });
});
