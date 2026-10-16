import { plural, type AgentState, type RunSnapshot, type RunStatus, type TaskStatus } from '@vibe/core/shared';
import {
  Ban,
  Bot,
  CircleCheck,
  CircleDashed,
  CircleMinus,
  CircleStop,
  CircleX,
  Container,
  Database,
  DraftingCompass,
  FlaskConical,
  LoaderCircle,
  PackagePlus,
  PanelsTopLeft,
  ScanSearch,
  Server,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import type { ProjectSummary } from './api.ts';

export type Tone = 'ok' | 'info' | 'warn' | 'bad' | 'neutral' | 'accent';

export interface StatusMeta {
  label: string;
  tone: Tone;
  icon: LucideIcon;
  tip?: string;
}

export const TASK_STATUS_META: Record<TaskStatus, StatusMeta> = {
  pending: { label: 'Ждёт', tone: 'neutral', icon: CircleDashed },
  running: { label: 'Работает', tone: 'info', icon: LoaderCircle },
  checking: { label: 'Проверяется', tone: 'info', icon: ScanSearch },
  merging: { label: 'Сохраняется', tone: 'info', icon: PackagePlus },
  done: { label: 'Готово', tone: 'ok', icon: CircleCheck },
  failed: { label: 'Не получилось', tone: 'bad', icon: CircleX },
  blocked: { label: 'Пропущена', tone: 'warn', icon: Ban, tip: 'Не запускалась: не получилась предыдущая задача' },
  cancelled: { label: 'Отменена', tone: 'neutral', icon: CircleMinus },
};

export const TASK_STATUS: Record<TaskStatus, string> = Object.fromEntries(Object.entries(TASK_STATUS_META).map(([k, v]) => [k, v.label])) as Record<TaskStatus, string>;

export const ACTIVE_TASK: TaskStatus[] = ['running', 'checking', 'merging'];

export const AGENT_STATUS: Record<AgentState['status'], string> = {
  idle: 'Ждёт задачу',
  working: 'Работает',
  done: 'Всё сделал',
  failed: 'Есть ошибки',
};

export const AGENT_STATUS_TONE: Record<AgentState['status'], Tone> = { idle: 'neutral', working: 'info', done: 'ok', failed: 'bad' };

export const RUN_STATUS_META: Record<RunStatus, StatusMeta> = {
  idle: { label: 'Подготовка', tone: 'neutral', icon: LoaderCircle },
  running: { label: 'Идёт работа', tone: 'info', icon: LoaderCircle },
  done: { label: 'Готово', tone: 'ok', icon: CircleCheck },
  failed: { label: 'Есть ошибки', tone: 'bad', icon: TriangleAlert },
  stopped: { label: 'Остановлено', tone: 'warn', icon: CircleStop },
};

export const RUN_STATUS: Record<RunStatus, string> = Object.fromEntries(Object.entries(RUN_STATUS_META).map(([k, v]) => [k, v.label])) as Record<RunStatus, string>;

export const STACK_LABELS: Record<string, string> = {
  frontend: 'Интерфейс',
  backend: 'Сервер',
  database: 'База',
  devops: 'Запуск',
  other: 'Другое',
};

export const MODELS = [
  { id: '', label: 'По умолчанию', hint: 'как настроено в Claude Code' },
  { id: 'sonnet', label: 'Sonnet', hint: 'баланс' },
  { id: 'opus', label: 'Opus', hint: 'максимум качества' },
  { id: 'haiku', label: 'Haiku', hint: 'быстро и дёшево' },
];

export const AGENT_COLORS = 8;

/** Номер цвета агента (0…7), тот же хеш для одного id. */
export function agentIndex(id: string): number {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % AGENT_COLORS;
}

/** Цвет агента как CSS-переменная (подходит для color, background, border). */
export function agentColor(id: string): string {
  return `var(--agent-${agentIndex(id)})`;
}

export function agentBg(id: string): string {
  return `var(--agent-${agentIndex(id)}-bg)`;
}

const ROLE_ICONS: [RegExp, LucideIcon][] = [
  [/architect|архитект/, DraftingCompass],
  [/database|\bdb\b|баз/, Database],
  [/backend|сервер|бэк/, Server],
  [/frontend|интерфейс|фронт|\bui\b/, PanelsTopLeft],
  [/devops|deploy|деплой|docker/, Container],
  [/\bqa\b|test|тест/, FlaskConical],
];

export function agentIcon(agent: { id: string; role?: string }): LucideIcon {
  const s = `${agent.id} ${agent.role ?? ''}`.toLowerCase();
  return ROLE_ICONS.find(([re]) => re.test(s))?.[1] ?? Bot;
}

/** Короткая роль для плотных мест: «Backend-разработчик» → «Backend». */
export function shortRole(role: string): string {
  const m = role.match(/^(Frontend|Backend|DevOps)-/i);
  if (m) return m[1]!;
  return role.replace(/^Инженер базы данных$/, 'Инженер БД');
}

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h) return `${h} ч ${m % 60} мин`;
  if (m) return `${m} мин ${s % 60} с`;
  return `${s} с`;
}

/** Короче: «20 мин», «4 мин 12 с», «1 ч 5 мин». */
export function formatDurationShort(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  if (m >= 10 && m < 60) return `${m} мин`;
  return formatDuration(ms);
}

/** Таймер «0:42». */
export function formatClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function formatHM(ts: number): string {
  return new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

const rtf = typeof Intl !== 'undefined' && 'RelativeTimeFormat' in Intl ? new Intl.RelativeTimeFormat('ru', { numeric: 'auto' }) : null;

/** «час назад», «5 минут назад», «вчера». */
export function formatRelative(ts: number, now = Date.now()): string {
  const diff = (ts - now) / 1000;
  const abs = Math.abs(diff);
  if (abs < 45) return 'сейчас';
  if (!rtf) return new Date(ts).toLocaleString('ru-RU');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day');
  return new Date(ts).toLocaleDateString('ru-RU');
}

export const tasksWord = (n: number) => plural(n, ['задача', 'задачи', 'задач']);
export const agentsWord = (n: number) => plural(n, ['агент', 'агента', 'агентов']);
export const filesWord = (n: number) => plural(n, ['файл', 'файла', 'файлов']);

const lcFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** Одна фраза «что сейчас происходит» для дашборда и панели действий. */
export function describeRun(s: RunSnapshot): string {
  const tasks = Object.values(s.tasks);
  const n = tasks.length;
  const done = tasks.filter((t) => t.status === 'done').length;
  switch (s.status) {
    case 'idle':
      return 'Готовим рабочее место для агентов…';
    case 'running': {
      const working = Object.values(s.agents).filter((a) => a.status === 'working');
      if (working.length === 1) {
        const a = working[0]!;
        const task = a.currentTaskId ? s.tasks[a.currentTaskId] : undefined;
        return `Сейчас: ${a.role} ${a.lastAction ? lcFirst(a.lastAction) : `работает над «${task?.title ?? 'задачей'}»`}`;
      }
      if (working.length > 1) {
        const names = working.slice(0, 2).map((a) => a.role).join(', ');
        const more = working.length > 2 ? ` и ещё ${working.length - 2}` : '';
        return `Работают ${plural(working.length, ['агент', 'агента', 'агентов'])}: ${names}${more}`;
      }
      if (tasks.some((t) => t.status === 'pending')) return 'Ждём, пока закончатся задачи предыдущего этапа';
      return 'Агенты завершают работу…';
    }
    case 'done':
      return `Готово! Все ${tasksWord(n)} ${n === 1 ? 'выполнена' : 'выполнены'} за ${formatDurationShort((s.finishedAt ?? Date.now()) - s.startedAt)}`;
    case 'failed':
      return `Завершено с ошибками: не получилось ${n - done} из ${n}. Откройте задачу, чтобы увидеть причину`;
    case 'stopped':
      return `Остановлено. Готово ${done} из ${n}`;
  }
}

export type ProjectStep = 'spec' | 'plan' | 'run' | 'files';

/** На каком шаге открыть проект из списка. */
export function smartStep(p: ProjectSummary): ProjectStep {
  if (p.running) return 'run';
  if (p.lastRun) return p.lastRun.status === 'done' ? 'files' : 'run';
  if (p.hasPlan) return 'plan';
  return 'spec';
}

export const STEP_LABELS: Record<ProjectStep, string> = { spec: 'ТЗ', plan: 'Команда и план', run: 'Запуск', files: 'Результат' };
export const STEP_SHORT: Record<ProjectStep, string> = { spec: 'ТЗ', plan: 'Команда', run: 'Запуск', files: 'Итог' };

export type DotState = 'running' | 'done' | 'failed' | 'stopped' | 'plan' | 'draft';

export function projectDot(p: ProjectSummary): DotState {
  if (p.running) return 'running';
  if (p.lastRun?.status === 'done') return 'done';
  if (p.lastRun?.status === 'failed') return 'failed';
  if (p.lastRun?.status === 'stopped') return 'stopped';
  if (p.hasPlan) return 'plan';
  return 'draft';
}

export const PROJECT_PILL: Record<DotState, { label: string; tone: Tone }> = {
  running: { label: 'Идёт работа', tone: 'info' },
  done: { label: 'Готово', tone: 'ok' },
  failed: { label: 'Завершено с ошибками', tone: 'bad' },
  stopped: { label: 'Остановлено', tone: 'warn' },
  plan: { label: 'План готов', tone: 'accent' },
  draft: { label: 'Черновик', tone: 'neutral' },
};
