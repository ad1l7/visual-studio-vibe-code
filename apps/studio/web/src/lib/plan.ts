// Чистые функции над планом: этапы, связи задач, новые id.
import { dependentsOf, type Plan, type TaskSpec } from '@vibe/core/shared';

/** Номер этапа для каждой задачи: задачи одного этапа агенты делают одновременно. */
export function levels(tasks: Pick<TaskSpec, 'id' | 'dependsOn'>[]): Map<string, number> {
  const level = new Map<string, number>();
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const get = (id: string, seen = new Set<string>()): number => {
    if (level.has(id)) return level.get(id)!;
    if (seen.has(id)) return 0;
    seen.add(id);
    const t = byId.get(id);
    const deps = t?.dependsOn.filter((d) => byId.has(d)) ?? [];
    const l = deps.length ? 1 + Math.max(...deps.map((d) => get(d, seen))) : 0;
    level.set(id, l);
    return l;
  };
  for (const t of tasks) get(t.id);
  return level;
}

export function waves(plan: Plan): TaskSpec[][] {
  const lv = levels(plan.tasks);
  const result: TaskSpec[][] = [];
  for (const t of plan.tasks) (result[lv.get(t.id)!] ??= []).push(t);
  return result.filter(Boolean);
}

/** Все предшественники задачи (прямые и косвенные). */
export function ancestorsOf(plan: Plan, taskId: string): Set<string> {
  const byId = new Map(plan.tasks.map((t) => [t.id, t]));
  const out = new Set<string>();
  const visit = (id: string) => {
    for (const d of byId.get(id)?.dependsOn ?? []) {
      if (!out.has(d)) {
        out.add(d);
        visit(d);
      }
    }
  };
  visit(taskId);
  return out;
}

export function descendantsOf(plan: Plan, taskId: string): Set<string> {
  return new Set(dependentsOf(plan, taskId));
}

export function uniqueId(base: string, taken: Iterable<string>): string {
  const set = new Set(taken);
  const clean = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'item';
  let id = clean;
  for (let i = 2; set.has(id); i++) id = `${clean}-${i}`;
  return id;
}

/** Удалить агента вместе с его задачами (и ссылками на них). */
export function removeAgent(plan: Plan, agentId: string): Plan {
  const removed = new Set(plan.tasks.filter((t) => t.agentId === agentId).map((t) => t.id));
  return {
    ...plan,
    agents: plan.agents.filter((a) => a.id !== agentId),
    tasks: plan.tasks.filter((t) => !removed.has(t.id)).map((t) => ({ ...t, dependsOn: t.dependsOn.filter((d) => !removed.has(d)) })),
  };
}

export function removeTask(plan: Plan, taskId: string): Plan {
  return { ...plan, tasks: plan.tasks.filter((t) => t.id !== taskId).map((t) => ({ ...t, dependsOn: t.dependsOn.filter((d) => d !== taskId) })) };
}
