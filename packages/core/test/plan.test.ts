import { describe, expect, it } from 'vitest';
import { templatePlan } from '../src/planner/template.ts';
import { Plan, toAgentJsonSchema } from '../src/plan/schema.ts';
import { dependentsOf, parsePlan, PlanError, topoOrder } from '../src/plan/validate.ts';
import { makePlan } from './helpers.ts';

describe('план', () => {
  it('типовой шаблон проходит проверку и упорядочивается', () => {
    const plan = parsePlan(templatePlan('Интернет-магазин цветов'));
    const order = topoOrder(plan);
    expect(order[0]).toBe('architecture');
    expect(order.indexOf('api')).toBeGreaterThan(order.indexOf('db-schema'));
  });

  it('ловит неизвестного агента и неизвестную зависимость', () => {
    expect(() =>
      makePlan([{ id: 'a', agentId: 'ghost', title: 't', description: 'd', dependsOn: ['nope'] }]),
    ).toThrow(PlanError);
    try {
      makePlan([{ id: 'a', agentId: 'ghost', title: 't', description: 'd', dependsOn: ['nope'] }]);
    } catch (e) {
      expect((e as PlanError).problems).toHaveLength(2);
    }
  });

  it('ловит цикл', () => {
    expect(() =>
      makePlan([
        { id: 'a', agentId: 'backend', title: 't', description: 'd', dependsOn: ['b'] },
        { id: 'b', agentId: 'backend', title: 't', description: 'd', dependsOn: ['a'] },
      ]),
    ).toThrow(/циклическая/);
  });

  it('запрещает папки вне проекта', () => {
    expect(() =>
      makePlan([{ id: 'a', agentId: 'x', title: 't', description: 'd' }], [
        { id: 'x', role: 'X', description: 'd', scope: ['../etc/'] },
      ]),
    ).toThrow(/внутри проекта/);
  });

  it('находит транзитивно зависимые задачи', () => {
    const plan = makePlan([
      { id: 'a', agentId: 'architect', title: 't', description: 'd' },
      { id: 'b', agentId: 'backend', title: 't', description: 'd', dependsOn: ['a'] },
      { id: 'c', agentId: 'frontend', title: 't', description: 'd', dependsOn: ['b'] },
    ]);
    expect(dependentsOf(plan, 'a').sort()).toEqual(['b', 'c']);
  });

  it('JSON Schema для structured output без $schema', () => {
    const schema = toAgentJsonSchema(Plan);
    expect(schema.$schema).toBeUndefined();
    expect(schema.type).toBe('object');
    expect((schema.required as string[]).sort()).toEqual(['agents', 'project', 'tasks']);
  });
});
