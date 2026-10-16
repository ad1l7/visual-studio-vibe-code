#!/usr/bin/env -S npx tsx
import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import {
  clarify,
  createRunners,
  detectEngines,
  EngineId,
  generatePlan,
  Orchestrator,
  ProjectStore,
  scaffoldProject,
  topoOrder,
  type AgentEvent,
  type EngineInfo,
  type Answers,
  type Plan,
  type RunEvent,
  type RunSnapshot,
} from '@vibe/core';

const c = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
};

const HELP = `Vibe Studio CLI — команда ИИ-агентов по вашему ТЗ

Команды:
  vibe engines                     какие движки агентов установлены
  vibe plan <папка> [опции]        ТЗ → уточняющие вопросы → план и команда агентов
      --spec "текст" | --spec-file файл.md
      --no-clarify                 без уточняющих вопросов
  vibe run <папка> [опции]         запустить агентов по плану из <папка>/.vibe/plan.json
      --concurrency N              агентов одновременно (по умолчанию 3)
      --attempts N                 попыток на задачу (по умолчанию 2)
  vibe status <папка>              состояние последнего запуска

Общие опции:
  --engine claude-code|mock        движок (по умолчанию claude-code; mock — демо без ИИ)
  --model <имя>                    модель движка, например sonnet или opus
`;

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      spec: { type: 'string' },
      'spec-file': { type: 'string' },
      'no-clarify': { type: 'boolean' },
      engine: { type: 'string', default: 'claude-code' },
      model: { type: 'string' },
      concurrency: { type: 'string' },
      attempts: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const [command, dirArg] = positionals;
  if (!command || values.help) return void console.log(HELP);

  const engine = EngineId.parse(values.engine);
  const runners = createRunners({ mock: { delayMs: 300 } });

  if (command === 'engines') {
    for (const e of await detectEngines(runners)) {
      console.log(`${e.available ? c.green('●') : c.red('○')} ${c.bold(e.name)} (${e.id}) ${c.dim(e.version ?? e.hint ?? '')}`);
    }
    return;
  }

  if (!dirArg) throw new Error('Укажите папку проекта, например: vibe plan ./my-app');
  const dir = resolve(dirArg);
  const store = new ProjectStore(dir);

  if (command === 'plan') {
    await mkdir(dir, { recursive: true });
    const runner = runners[engine]!;
    await ensureAvailable(runner.info());
    const rl = new Prompter();
    try {
      const spec = values.spec ?? (values['spec-file'] ? await readFile(values['spec-file'], 'utf8') : await askSpec(rl));
      if (!spec.trim()) throw new Error('ТЗ пустое');
      const progress = (e: AgentEvent) => {
        if (e.type === 'status') console.log(c.dim(`  … ${e.text}`));
        if (e.type === 'tool') console.log(c.dim(`  … ${e.summary}`));
      };
      let answers: Answers = {};
      let questions: Awaited<ReturnType<typeof clarify>> = [];
      if (!values['no-clarify']) {
        console.log(c.cyan('\nАнализирую ТЗ…'));
        questions = await clarify(spec, { runner, cwd: dir, model: values.model, onEvent: progress });
        if (questions.length) console.log(c.bold('\nНесколько уточнений (Enter — пропустить):'));
        for (const q of questions) {
          console.log(`\n${c.bold(q.question)}${q.why ? `\n${c.dim(q.why)}` : ''}`);
          q.options.forEach((o, i) => console.log(`  ${i + 1}) ${o}`));
          const a = (await rl.question('> ')).trim();
          answers[q.id] = /^\d+$/.test(a) && q.options[Number(a) - 1] ? q.options[Number(a) - 1]! : a;
        }
      }
      console.log(c.cyan('\nПроектирую систему и подбираю команду агентов…'));
      const plan = await generatePlan({ spec, questions, answers }, { runner, cwd: dir, model: values.model, onEvent: progress });
      const fullSpec = questions.length ? `${spec.trim()}\n\n## Уточнения\n${questions.filter((q) => answers[q.id]).map((q) => `- ${q.question} — ${answers[q.id]}`).join('\n')}` : spec;
      await scaffoldProject(dir, plan, fullSpec);
      printPlan(plan);
      console.log(`\nПлан сохранён в ${c.bold('.vibe/plan.json')} (его можно поправить вручную).`);
      console.log(`Запуск: ${c.bold(`vibe run ${dirArg}${engine !== 'claude-code' ? ` --engine ${engine}` : ''}`)}`);
    } finally {
      rl.close();
    }
    return;
  }

  if (command === 'run') {
    const plan = await store.loadPlan();
    if (!plan) throw new Error(`В ${dir} нет плана. Сначала: vibe plan ${dirArg}`);
    await ensureAvailable(runners[engine]!.info());
    const orch = new Orchestrator({
      projectDir: dir,
      plan,
      runners,
      settings: {
        defaultEngine: engine,
        model: values.model,
        concurrency: values.concurrency ? Number(values.concurrency) : undefined,
        maxAttempts: values.attempts ? Number(values.attempts) : undefined,
      },
    });
    orch.subscribe(printEvent(plan));
    process.once('SIGINT', () => orch.stop());
    const snap = await orch.start();
    printSummary(snap);
    process.exitCode = snap.status === 'done' ? 0 : 1;
    return;
  }

  if (command === 'status') {
    const snap = await store.latestSnapshot();
    if (!snap) return void console.log('Запусков ещё не было.');
    printSummary(snap);
    return;
  }

  throw new Error(`Неизвестная команда «${command}». vibe --help`);
}

async function askSpec(rl: Prompter): Promise<string> {
  console.log(c.bold('Опишите, что нужно сделать, своими словами.') + c.dim(' Пустая строка — конец ввода.'));
  const lines: string[] = [];
  for (;;) {
    const line = await rl.question(lines.length ? '  ' : '> ');
    if (!line.trim()) break;
    lines.push(line);
  }
  return lines.join('\n');
}

/** Построчный ввод, который корректно работает и с терминалом, и с перенаправленным stdin. */
class Prompter {
  private readonly rl = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
  private readonly lines: string[] = [];
  private waiter?: (line: string) => void;
  private closed = false;

  constructor() {
    this.rl.on('line', (line) => (this.waiter ? (this.waiter(line), (this.waiter = undefined)) : this.lines.push(line)));
    this.rl.on('close', () => {
      this.closed = true;
      this.waiter?.('');
    });
  }

  question(prompt: string): Promise<string> {
    process.stdout.write(prompt);
    if (this.lines.length) return Promise.resolve(this.lines.shift()!);
    if (this.closed) return Promise.resolve('');
    return new Promise((r) => (this.waiter = r));
  }

  close() {
    this.rl.close();
  }
}

async function ensureAvailable(info: Promise<EngineInfo>) {
  const i = await info;
  if (!i.available) throw new Error(`Движок «${i.name}» недоступен. ${i.hint ?? ''}`);
}

function printPlan(plan: Plan) {
  const { project } = plan;
  console.log(`\n${c.bold(project.name)}\n${project.summary}`);
  const stack = Object.entries(project.stack).filter(([, v]) => v);
  if (stack.length) console.log(`\n${c.bold('Стек:')} ${stack.map(([k, v]) => `${k}: ${v}`).join(' · ')}`);
  console.log(`\n${c.bold('Команда агентов:')}`);
  for (const a of plan.agents) console.log(`  ${c.cyan(a.role)} ${c.dim(`[${a.scope.join(', ')}]`)}\n    ${a.description}`);
  console.log(`\n${c.bold('Задачи (в порядке выполнения):')}`);
  const byId = new Map(plan.tasks.map((t) => [t.id, t]));
  for (const id of topoOrder(plan)) {
    const t = byId.get(id)!;
    console.log(`  ${c.bold(t.id)} — ${t.title} ${c.dim(`(${t.agentId}${t.dependsOn.length ? `, после: ${t.dependsOn.join(', ')}` : ''})`)}`);
  }
}

function printEvent(plan: Plan) {
  const role = new Map(plan.agents.map((a) => [a.id, a.role]));
  const time = (ts: number) => c.dim(new Date(ts).toLocaleTimeString('ru-RU'));
  return (e: RunEvent, s: RunSnapshot) => {
    if (e.type === 'log') {
      const color = e.level === 'error' ? c.red : e.level === 'success' ? c.green : (x: string) => x;
      console.log(`${time(e.ts)} ${color(e.message)}`);
    } else if (e.type === 'agent' && e.event.type === 'tool') {
      console.log(`${time(e.ts)} ${c.cyan(`[${role.get(e.agentId)}]`)} ${e.event.summary}`);
    } else if (e.type === 'run' && e.message) {
      console.log(`${time(e.ts)} ${c.bold(e.message)}`);
    } else if (e.type === 'task' && e.patch.status === 'checking') {
      console.log(`${time(e.ts)} ${c.yellow(`[${role.get(s.tasks[e.taskId]!.agentId)}] проверка результата`)}`);
    }
  };
}

function printSummary(s: RunSnapshot) {
  const icon: Record<string, string> = { done: c.green('✔'), failed: c.red('✘'), blocked: c.yellow('⏸'), cancelled: c.dim('■'), pending: c.dim('·') };
  console.log(`\n${c.bold(`Запуск ${s.runId}: ${s.status}`)}  стоимость ≈ $${s.costUsd.toFixed(2)}`);
  for (const t of Object.values(s.tasks)) {
    console.log(`  ${icon[t.status] ?? c.cyan('▶')} ${t.title} ${c.dim(`(${t.agentId}, попыток: ${t.attempts})`)}${t.error ? `\n      ${c.red(t.error.split('\n')[0]!)}` : ''}`);
  }
}

main().catch((err) => {
  console.error(c.red(`Ошибка: ${err instanceof Error ? err.message : String(err)}`));
  process.exitCode = 1;
});
