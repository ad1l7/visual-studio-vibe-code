import { Plan } from './schema.ts';

export class PlanError extends Error {
  constructor(public readonly problems: string[]) {
    super(`План некорректен:\n- ${problems.join('\n- ')}`);
    this.name = 'PlanError';
  }
}

/** Парсит и проверяет план: схема, ссылки между задачами и агентами, отсутствие циклов. */
export function parsePlan(input: unknown): Plan {
  const parsed = Plan.safeParse(input);
  if (!parsed.success) {
    throw new PlanError(parsed.error.issues.map((i) => `${i.path.join('.') || '(корень)'}: ${i.message}`));
  }
  const plan = parsed.data;
  const problems = checkReferences(plan);
  if (problems.length) throw new PlanError(problems);
  topoOrder(plan);
  return plan;
}

function checkReferences(plan: Plan): string[] {
  const problems: string[] = [];
  const agentIds = new Set<string>();
  for (const a of plan.agents) {
    if (agentIds.has(a.id)) problems.push(`агент "${a.id}" объявлен дважды`);
    agentIds.add(a.id);
  }
  const taskIds = new Set<string>();
  for (const t of plan.tasks) {
    if (taskIds.has(t.id)) problems.push(`задача "${t.id}" объявлена дважды`);
    taskIds.add(t.id);
  }
  for (const t of plan.tasks) {
    if (!agentIds.has(t.agentId)) problems.push(`задача "${t.id}" ссылается на неизвестного агента "${t.agentId}"`);
    for (const d of t.dependsOn) {
      if (d === t.id) problems.push(`задача "${t.id}" зависит сама от себя`);
      else if (!taskIds.has(d)) problems.push(`задача "${t.id}" зависит от неизвестной задачи "${d}"`);
    }
  }
  for (const a of plan.agents) {
    for (const s of a.scope) {
      if (s.startsWith('/') || s.split(/[\\/]/).includes('..')) {
        problems.push(`агент "${a.id}": папка "${s}" должна быть относительной и внутри проекта`);
      }
    }
  }
  return problems;
}

/** Топологический порядок задач (Kahn). Бросает PlanError при цикле. */
export function topoOrder(plan: Plan): string[] {
  const indegree = new Map<string, number>();
  const children = new Map<string, string[]>();
  for (const t of plan.tasks) {
    indegree.set(t.id, t.dependsOn.length);
    for (const d of t.dependsOn) children.set(d, [...(children.get(d) ?? []), t.id]);
  }
  const queue = plan.tasks.filter((t) => t.dependsOn.length === 0).map((t) => t.id);
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const c of children.get(id) ?? []) {
      const n = indegree.get(c)! - 1;
      indegree.set(c, n);
      if (n === 0) queue.push(c);
    }
  }
  if (order.length !== plan.tasks.length) {
    const cyclic = plan.tasks.filter((t) => !order.includes(t.id)).map((t) => t.id);
    throw new PlanError([`циклическая зависимость между задачами: ${cyclic.join(', ')}`]);
  }
  return order;
}

/** Все задачи, которые прямо или косвенно зависят от taskId. */
export function dependentsOf(plan: Plan, taskId: string): string[] {
  const result = new Set<string>();
  const visit = (id: string) => {
    for (const t of plan.tasks) {
      if (t.dependsOn.includes(id) && !result.has(t.id)) {
        result.add(t.id);
        visit(t.id);
      }
    }
  };
  visit(taskId);
  return [...result];
}
