import { describe, expect, it } from 'vitest';
import { clarify, generatePlan } from '../src/planner/planner.ts';
import { templatePlan } from '../src/planner/template.ts';
import { MockRunner } from '../src/runners/mock.ts';
import type { AgentEvent, AgentRunner, RunOptions } from '../src/runners/types.ts';

function scripted(outputs: unknown[]): AgentRunner & { calls: RunOptions[] } {
  const calls: RunOptions[] = [];
  return {
    id: 'mock',
    calls,
    async info() {
      return { id: 'mock', name: 'scripted', available: true };
    },
    async *run(opts): AsyncIterable<AgentEvent> {
      calls.push(opts);
      yield { type: 'result', result: { ok: true, text: '', structured: outputs[calls.length - 1] } };
    },
  };
}

describe('планировщик', () => {
  it('генерирует план и запрещает агенту менять файлы', async () => {
    const runner = scripted([templatePlan('Сервис записи к врачу')]);
    const plan = await generatePlan({ spec: 'Сервис записи к врачу', questions: [{ id: 'q', question: 'Вход?', why: '', options: [] }], answers: { q: 'по SMS' } }, { runner, cwd: '/' });
    expect(plan.agents.length).toBeGreaterThan(2);
    const call = runner.calls[0]!;
    expect(call.prompt).toContain('Сервис записи к врачу');
    expect(call.prompt).toContain('по SMS');
    expect(call.jsonSchema).toBeDefined();
    expect(call.disallowedTools).toContain('Write');
  });

  it('переспрашивает, если план не прошёл проверку', async () => {
    const broken = templatePlan('x');
    broken.tasks[1]!.dependsOn = ['missing-task'];
    const runner = scripted([broken, templatePlan('x')]);
    const plan = await generatePlan({ spec: 'x' }, { runner, cwd: '/' });
    expect(plan.tasks).toHaveLength(6);
    expect(runner.calls[1]!.prompt).toContain('missing-task');
  });

  it('сдаётся после исчерпания попыток', async () => {
    const broken = templatePlan('x');
    broken.tasks[0]!.agentId = 'ghost';
    const runner = scripted([broken, broken]);
    await expect(generatePlan({ spec: 'x', maxRetries: 1 }, { runner, cwd: '/' })).rejects.toThrow(/ghost/);
  });

  it('демо-движок отдаёт вопросы и план', async () => {
    const runner = new MockRunner();
    const questions = await clarify('Магазин', { runner, cwd: '/' });
    expect(questions.length).toBeGreaterThan(0);
    const plan = await generatePlan({ spec: 'Магазин носков' }, { runner, cwd: '/' });
    expect(plan.project.name).toContain('Магазин носков');
  });
});
