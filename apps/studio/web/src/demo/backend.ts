// Демо-версия студии без сервера: планировщик и агенты имитируются в браузере.
// Интерфейс тот же, состояние собирается тем же редьюсером, что и в настоящем оркестраторе.
import {
  initialSnapshot,
  parsePlan,
  plural,
  reduce,
  renderAgentFile,
  renderAgentsMd,
  templateClarification,
  templatePlan,
  topoOrder,
  type AgentSpec,
  type EngineInfo,
  type Plan,
  type RunEvent,
  type RunSnapshot,
  type TaskSpec,
  type TaskState,
} from '@vibe/core/shared';
import type { LocalBackend, StreamMessage, TreeNode } from '../api.ts';

interface DemoProject {
  name: string;
  spec: string;
  plan: Plan | null;
  snapshot: RunSnapshot | null;
  running: boolean;
  files: Map<string, string>;
  listeners: Set<(m: StreamMessage) => void>;
  stop?: () => void;
  modifiedAt: number;
}

const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N}_-]{0,63}$/u;

export const DEMO_SPEC = `Хочу сайт для небольшой кофейни: меню с фото и ценами, онлайн-заказ с самовывозом ко времени, личный кабинет с историей заказов и бонусами. Админка для бариста: принимать заказы, менять меню. Оплата картой онлайн.`;

const ENGINES: EngineInfo[] = [
  { id: 'claude-code', name: 'Claude Code', available: false, hint: 'В демо-версии агенты имитируются. Настоящие агенты работают в студии, запущенной у вас: pnpm studio' },
  { id: 'mock', name: 'Демо-агенты', available: true, version: 'demo' },
];

export function createDemoBackend(): LocalBackend {
  const projects = new Map<string, DemoProject>();
  const ready = seed();

  function project(name: string): DemoProject {
    const p = projects.get(name);
    if (!p) throw new Error('Проект не найден');
    return p;
  }

  function broadcast(p: DemoProject, m: StreamMessage) {
    for (const fn of p.listeners) fn(m);
  }

  function newProject(name: string): DemoProject {
    const p: DemoProject = { name, spec: '', plan: null, snapshot: null, running: false, files: new Map(), listeners: new Set(), modifiedAt: Date.now() };
    projects.set(name, p);
    return p;
  }

  async function seed() {
    const p = newProject('coffee-shop');
    p.spec = DEMO_SPEC;
    p.plan = parsePlan(templatePlan(DEMO_SPEC));
    await simulate(p, { concurrency: 3, speed: 0 });
    // Пример прогоняется мгновенно; раскладываем время так, будто запуск шёл ~20 минут час назад.
    if (p.snapshot) {
      const start = Date.now() - 60 * 60_000;
      const order = topoOrder(p.plan);
      const tasks = Object.fromEntries(
        Object.entries(p.snapshot.tasks).map(([id, t]) => {
          const k = order.indexOf(id);
          return [id, { ...t, startedAt: start + k * 190_000, finishedAt: start + k * 190_000 + 170_000 + k * 7_000 }];
        }),
      );
      const step = (20 * 60_000) / Math.max(1, p.snapshot.feed.length);
      p.snapshot = {
        ...p.snapshot,
        startedAt: start,
        finishedAt: start + 20 * 60_000,
        tasks,
        feed: p.snapshot.feed.map((f, i) => ({ ...f, ts: start + i * step })),
      };
    }
  }

  async function plannerProgress(p: DemoProject, steps: string[]) {
    for (const text of steps) {
      broadcast(p, { type: 'planner', text });
      await sleep(650);
    }
  }

  async function simulate(p: DemoProject, opts: { concurrency: number; speed: number }) {
    const plan = p.plan!;
    const runId = `demo-${Date.now().toString(36)}`;
    let snap = initialSnapshot(runId, plan);
    let stopped = false;
    const wait = (ms: number) => (opts.speed ? sleep(ms * opts.speed) : Promise.resolve());
    const emit = (e: RunEvent) => {
      snap = reduce(snap, e);
      p.snapshot = snap;
      broadcast(p, { type: 'run-event', event: e });
    };
    const now = () => Date.now();
    p.running = true;
    p.snapshot = snap;
    broadcast(p, { type: 'hello', snapshot: snap, running: true });
    p.stop = () => {
      if (stopped) return;
      stopped = true;
      emit({ type: 'log', ts: now(), level: 'info', message: 'Остановка по запросу пользователя…' });
    };

    emit({ type: 'run', ts: now(), status: 'running', message: `Запуск: ${plural(plan.tasks.length, ['задача', 'задачи', 'задач'])}, ${plural(plan.agents.length, ['агент', 'агента', 'агентов'])}` });
    p.files.set('AGENTS.md', renderAgentsMd(plan));
    p.files.set('CLAUDE.md', '@AGENTS.md\n');
    p.files.set('.vibe/plan.json', `${JSON.stringify(plan, null, 2)}\n`);
    p.files.set('.vibe/spec.md', `${p.spec}\n`);
    for (const a of plan.agents) p.files.set(`.vibe/agents/${a.id}.md`, renderAgentFile(a));

    const agents = new Map(plan.agents.map((a) => [a.id, a]));
    const tasks = new Map(plan.tasks.map((t) => [t.id, t]));
    const order = topoOrder(plan);
    const running = new Map<string, Promise<void>>();

    const runTask = async (task: TaskSpec) => {
      const agent = agents.get(task.agentId)!;
      const patch = (patch: Partial<Omit<TaskState, 'id'>>) =>
        emit({ type: 'task', ts: now(), taskId: task.id, patch });
      const act = (summary: string, name = 'Write') =>
        emit({ type: 'agent', ts: now(), taskId: task.id, agentId: agent.id, event: { type: 'tool', toolUseId: `${task.id}-${summary}`, name, summary, input: {} } });

      patch({ status: 'running', attempts: 1, startedAt: now(), branch: `vibe/${runId}/${task.id}` });
      emit({ type: 'log', ts: now(), level: 'info', message: `${agent.role} начинает «${task.title}»`, taskId: task.id });
      await wait(500);
      act('Читает AGENTS.md', 'Read');
      if (task.dependsOn.length) {
        await wait(600);
        act('Читает contracts/openapi.yaml', 'Read');
      }
      const files = demoFiles(plan, agent, task);
      for (const path of Object.keys(files)) {
        if (stopped) break;
        await wait(900 + Math.random() * 900);
        act(`${p.files.has(path) ? 'Редактирует' : 'Создаёт'} ${path}`);
      }
      if (!stopped && agent.checkCommand) {
        patch({ status: 'checking', lastAction: `Проверка: ${agent.checkCommand}` });
        await wait(1200);
        emit({ type: 'log', ts: now(), level: 'success', message: `Проверка пройдена (${agent.checkCommand})`, taskId: task.id });
      }
      if (stopped) {
        patch({ status: 'cancelled', finishedAt: now() });
        return;
      }
      const text = `Сделано: ${Object.keys(files).join(', ')}.\nКритерии готовности:\n${task.acceptance.map((a) => `✓ ${a}`).join('\n') || '✓ выполнено'}`;
      emit({ type: 'agent', ts: now(), taskId: task.id, agentId: agent.id, event: { type: 'text', text: `Готово: ${task.title}` } });
      patch({ status: 'merging', summary: text });
      await wait(500);
      const changes = Object.entries(files).map(([path, content]) => {
        const status = p.files.has(path) ? ('modified' as const) : ('added' as const);
        p.files.set(path, content);
        return { path, status };
      });
      patch({ status: 'done', finishedAt: now(), files: changes });
      emit({ type: 'log', ts: now(), level: 'success', message: `«${task.title}» готово и влито в main (${plural(changes.length, ['файл', 'файла', 'файлов'])})`, taskId: task.id });
    };

    for (;;) {
      if (!stopped) {
        for (const id of order) {
          if (running.size >= opts.concurrency) break;
          const t = tasks.get(id)!;
          const ready = snap.tasks[id]!.status === 'pending' && t.dependsOn.every((d) => snap.tasks[d]?.status === 'done');
          if (!ready) continue;
          emit({ type: 'task', ts: now(), taskId: id, patch: { status: 'running' } });
          running.set(id, runTask(t).finally(() => running.delete(id)));
        }
      }
      if (!running.size) break;
      await Promise.race(running.values());
    }

    for (const t of Object.values(snap.tasks)) {
      if (t.status === 'pending') emit({ type: 'task', ts: now(), taskId: t.id, patch: { status: stopped ? 'cancelled' : 'blocked' } });
    }
    const all = Object.values(snap.tasks);
    const done = all.filter((t) => t.status === 'done').length;
    const status = stopped ? 'stopped' : done === all.length ? 'done' : 'failed';
    emit({
      type: 'run',
      ts: now(),
      status,
      message: status === 'done' ? `Готово: все задачи (${all.length}) выполнены и влиты в main` : `Остановлено: выполнено ${done} из ${all.length}`,
    });
    p.running = false;
    p.stop = undefined;
  }

  function tree(p: DemoProject): TreeNode[] {
    const root: TreeNode[] = [];
    for (const path of [...p.files.keys()].sort()) {
      const parts = path.split('/');
      let level = root;
      parts.forEach((name, i) => {
        const sub = parts.slice(0, i + 1).join('/');
        const isDir = i < parts.length - 1;
        let node = level.find((n) => n.name === name);
        if (!node) {
          node = { name, path: sub, dir: isDir, children: isDir ? [] : undefined };
          level.push(node);
        }
        if (isDir) level = node.children!;
      });
    }
    const sort = (nodes: TreeNode[]) => {
      nodes.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
      nodes.forEach((n) => n.children && sort(n.children));
      return nodes;
    };
    return sort(root);
  }

  const routes: [string, RegExp, (m: string[], body: any) => Promise<unknown> | unknown][] = [
    ['GET', /^\/api\/engines$/, () => ENGINES],
    [
      'GET',
      /^\/api\/projects$/,
      () =>
        [...projects.values()]
          .sort((a, b) => b.modifiedAt - a.modifiedAt)
          .map((p) => ({ name: p.name, title: p.plan?.project.name ?? p.name, hasPlan: !!p.plan, running: p.running, lastRun: p.snapshot ? { status: p.snapshot.status, startedAt: p.snapshot.startedAt } : null })),
    ],
    [
      'POST',
      /^\/api\/projects$/,
      (_m, b) => {
        const name = String(b?.name ?? '').trim();
        if (!NAME_RE.test(name)) throw new Error('Имя проекта: буквы, цифры, «-» и «_», без пробелов');
        if (projects.has(name)) throw new Error('Проект с таким именем уже есть');
        newProject(name);
        return { name };
      },
    ],
    ['GET', /^\/api\/projects\/([^/]+)$/, ([n]) => {
      const p = project(n!);
      return { name: p.name, path: `~/VibeProjects/${p.name}`, spec: p.spec, plan: p.plan, snapshot: p.snapshot, running: p.running };
    }],
    ['POST', /^\/api\/projects\/([^/]+)\/clarify$/, async ([n], b) => {
      const p = project(n!);
      if (!String(b.spec ?? '').trim()) throw new Error('ТЗ пустое');
      p.spec = b.spec;
      await plannerProgress(p, ['Читает ТЗ', 'Ищет пробелы, которые влияют на архитектуру', 'Формулирует вопросы']);
      return { questions: templateClarification().questions };
    }],
    ['POST', /^\/api\/projects\/([^/]+)\/plan$/, async ([n], b) => {
      const p = project(n!);
      if (!String(b.spec ?? '').trim()) throw new Error('ТЗ пустое');
      await plannerProgress(p, ['Выбирает стек', 'Собирает команду агентов', 'Делит работу на задачи', 'Расставляет зависимости между задачами']);
      const answered = (b.questions ?? []).filter((q: { id: string }) => b.answers?.[q.id]?.trim());
      p.spec = answered.length ? `${b.spec.trim()}\n\n## Уточнения\n${answered.map((q: { id: string; question: string }) => `- ${q.question} — ${b.answers[q.id]}`).join('\n')}` : b.spec;
      p.plan = parsePlan(templatePlan(b.spec));
      p.modifiedAt = Date.now();
      return { plan: p.plan };
    }],
    ['PUT', /^\/api\/projects\/([^/]+)\/plan$/, ([n], b) => {
      const p = project(n!);
      if (p.running) throw new Error('Нельзя менять план во время запуска');
      p.plan = parsePlan(b.plan);
      return { plan: p.plan };
    }],
    ['POST', /^\/api\/projects\/([^/]+)\/run$/, ([n], b) => {
      const p = project(n!);
      if (p.running) throw new Error('Агенты уже работают');
      if (!p.plan) throw new Error('Сначала составьте план');
      p.modifiedAt = Date.now();
      void simulate(p, { concurrency: Math.min(8, Math.max(1, Number(b.concurrency) || 3)), speed: 1 });
      return { runId: p.snapshot?.runId };
    }],
    ['POST', /^\/api\/projects\/([^/]+)\/stop$/, ([n]) => {
      project(n!).stop?.();
      return { ok: true };
    }],
    ['GET', /^\/api\/projects\/([^/]+)\/tree$/, ([n]) => tree(project(n!))],
    ['GET', /^\/api\/projects\/([^/]+)\/file$/, ([n], b) => {
      const content = project(n!).files.get(b.path);
      if (content === undefined) throw new Error('Файл не найден');
      return { path: b.path, content, truncated: false };
    }],
  ];

  return {
    async request(method, fullPath, body) {
      await ready;
      const url = new URL(fullPath, 'http://demo');
      const route = routes.find(([m, re]) => m === method && re.test(url.pathname));
      if (!route) throw new Error('Не найдено');
      const params = (url.pathname.match(route[1]) ?? []).slice(1).map(decodeURIComponent);
      const query = Object.fromEntries(url.searchParams);
      await sleep(120);
      // Отдаём копию, как это сделал бы настоящий сервер.
      return structuredClone(await route[2](params, method === 'GET' ? query : body));
    },
    subscribe(name, onMessage) {
      let p: DemoProject | undefined;
      void ready.then(() => {
        p = projects.get(name);
        if (!p) return;
        p.listeners.add(onMessage);
        onMessage({ type: 'hello', snapshot: p.snapshot ? structuredClone(p.snapshot) : null, running: p.running });
      });
      return () => p?.listeners.delete(onMessage);
    },
  };
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

/** Какие файлы «пишет» агент: правдоподобная структура по роли. */
function demoFiles(plan: Plan, agent: AgentSpec, task: TaskSpec): Record<string, string> {
  const header = (lang: 'md' | 'ts' | 'yaml' | 'prisma') => {
    const note = `Демо-файл: здесь агент «${agent.role}» пишет результат задачи «${task.title}».`;
    return lang === 'md' ? `<!-- ${note} -->\n` : lang === 'yaml' ? `# ${note}\n` : `// ${note}\n`;
  };
  const body = `${task.description}\n\nКритерии готовности:\n${task.acceptance.map((a) => `- ${a}`).join('\n') || '- (не заданы)'}\n`;
  const name = plan.project.name;
  switch (agent.id) {
    case 'architect':
      return {
        'docs/architecture.md': `${header('md')}# Архитектура: ${name}\n\n${body}`,
        'docs/data-model.md': `${header('md')}# Модель данных\n\n- User, Product, Order, OrderItem, BonusTransaction\n`,
        'contracts/openapi.yaml': `${header('yaml')}openapi: 3.1.0\ninfo:\n  title: ${name}\n  version: 0.1.0\npaths:\n  /api/products: {}\n  /api/orders: {}\n  /api/auth/login: {}\n`,
      };
    case 'database':
      return { 'backend/prisma/schema.prisma': `${header('prisma')}datasource db {\n  provider = "postgresql"\n  url      = env("DATABASE_URL")\n}\n\nmodel Product {\n  id    Int    @id @default(autoincrement())\n  title String\n  price Int\n}\n` };
    case 'backend':
      return {
        'backend/src/server.ts': `${header('ts')}import Fastify from 'fastify';\n\nconst app = Fastify();\napp.listen({ port: 3000 });\n`,
        'backend/src/routes/orders.ts': `${header('ts')}/* ${body.replace(/\*\//g, '')} */\n`,
        'backend/package.json': `{\n  "name": "backend",\n  "scripts": { "dev": "tsx watch src/server.ts", "test": "vitest run" }\n}\n`,
      };
    case 'frontend':
      return {
        'frontend/src/pages/Menu.tsx': `${header('ts')}export function Menu() {\n  return <h1>Меню</h1>;\n}\n`,
        'frontend/src/pages/Checkout.tsx': `${header('ts')}export function Checkout() {\n  return <h1>Оформление заказа</h1>;\n}\n`,
        'frontend/src/api.ts': `${header('ts')}// Клиент API по contracts/openapi.yaml\nexport const API_URL = '/api';\n`,
      };
    case 'devops':
      return {
        'docker-compose.yml': `${header('yaml')}services:\n  db:\n    image: postgres:16\n  backend:\n    build: ./backend\n  frontend:\n    build: ./frontend\n`,
        'docker/README.md': `${header('md')}# Запуск\n\n\`docker compose up\` поднимает фронтенд, бэкенд и базу данных.\n`,
      };
    case 'qa':
      return { 'tests/e2e/order.spec.ts': `${header('ts')}// Сценарий: выбрать напиток → оформить заказ → увидеть его в истории\n` };
    default: {
      const folder = agent.scope.find((s) => s.endsWith('/')) ?? 'notes/';
      return { [`${folder}${task.id}.md`]: `${header('md')}# ${task.title}\n\n${body}` };
    }
  }
}
