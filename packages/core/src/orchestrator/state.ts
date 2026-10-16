// Состояние запуска и редьюсер событий. Модуль без Node-зависимостей:
// тот же код собирает состояние и в оркестраторе, и в браузере.
import type { Plan } from '../plan/schema.ts';
import type { AgentEvent } from '../runners/types.ts';

export type TaskStatus =
  | 'pending' // ждёт зависимостей
  | 'running' // агент работает
  | 'checking' // идёт проверка результата
  | 'merging' // вливается в main
  | 'done'
  | 'failed'
  | 'blocked' // не запускалась: упала зависимость
  | 'cancelled';

export type RunStatus = 'idle' | 'running' | 'done' | 'failed' | 'stopped';

export interface FileChangeInfo {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
}

export interface TaskState {
  id: string;
  agentId: string;
  title: string;
  status: TaskStatus;
  attempts: number;
  sessionId?: string;
  branch?: string;
  startedAt?: number;
  finishedAt?: number;
  costUsd: number;
  lastAction?: string;
  summary?: string;
  error?: string;
  files: FileChangeInfo[];
}

export interface AgentState {
  id: string;
  role: string;
  status: 'idle' | 'working' | 'done' | 'failed';
  currentTaskId?: string;
  lastAction?: string;
}

export interface FeedItem {
  ts: number;
  taskId?: string;
  agentId?: string;
  kind: 'action' | 'text' | 'error' | 'info' | 'success';
  text: string;
}

export interface RunSnapshot {
  runId: string;
  status: RunStatus;
  startedAt: number;
  finishedAt?: number;
  tasks: Record<string, TaskState>;
  agents: Record<string, AgentState>;
  feed: FeedItem[];
  costUsd: number;
}

export type RunEvent =
  | { type: 'run'; ts: number; status: RunStatus; message?: string }
  | { type: 'task'; ts: number; taskId: string; patch: Partial<Omit<TaskState, 'id'>> }
  | { type: 'agent'; ts: number; taskId: string; agentId: string; event: AgentEvent }
  | { type: 'log'; ts: number; level: 'info' | 'error' | 'success'; message: string; taskId?: string };

const FEED_LIMIT = 500;

export function initialSnapshot(runId: string, plan: Plan, ts = Date.now()): RunSnapshot {
  const tasks: Record<string, TaskState> = {};
  for (const t of plan.tasks) {
    tasks[t.id] = { id: t.id, agentId: t.agentId, title: t.title, status: 'pending', attempts: 0, costUsd: 0, files: [] };
  }
  const agents: Record<string, AgentState> = {};
  for (const a of plan.agents) agents[a.id] = { id: a.id, role: a.role, status: 'idle' };
  return { runId, status: 'idle', startedAt: ts, tasks, agents, feed: [], costUsd: 0 };
}

/** Чистая функция: новое состояние по событию (исходное не мутируется). */
export function reduce(s: RunSnapshot, e: RunEvent): RunSnapshot {
  switch (e.type) {
    case 'run': {
      const finished = e.status === 'done' || e.status === 'failed' || e.status === 'stopped';
      const feed = e.message ? pushFeed(s.feed, { ts: e.ts, kind: e.status === 'failed' ? 'error' : 'info', text: e.message }) : s.feed;
      return { ...s, status: e.status, finishedAt: finished ? e.ts : s.finishedAt, feed };
    }
    case 'task': {
      const prev = s.tasks[e.taskId];
      if (!prev) return s;
      const task = { ...prev, ...e.patch };
      const costUsd = s.costUsd + (task.costUsd - prev.costUsd);
      return { ...s, tasks: { ...s.tasks, [e.taskId]: task }, agents: updateAgent(s, task), costUsd };
    }
    case 'agent': {
      const ev = e.event;
      const feedItem = toFeed(e.ts, e.taskId, e.agentId, ev);
      const feed = feedItem ? pushFeed(s.feed, feedItem) : s.feed;
      if (ev.type !== 'tool' && ev.type !== 'status') return { ...s, feed };
      const action = ev.type === 'tool' ? ev.summary : ev.text;
      const prev = s.tasks[e.taskId];
      const agent = s.agents[e.agentId];
      return {
        ...s,
        feed,
        tasks: prev ? { ...s.tasks, [e.taskId]: { ...prev, lastAction: action } } : s.tasks,
        agents: agent ? { ...s.agents, [e.agentId]: { ...agent, lastAction: action } } : s.agents,
      };
    }
    case 'log':
      return {
        ...s,
        feed: pushFeed(s.feed, {
          ts: e.ts,
          taskId: e.taskId,
          agentId: e.taskId ? s.tasks[e.taskId]?.agentId : undefined,
          kind: e.level,
          text: e.message,
        }),
      };
  }
}

function updateAgent(s: RunSnapshot, task: TaskState): Record<string, AgentState> {
  const agent = s.agents[task.agentId];
  if (!agent) return s.agents;
  const active = ['running', 'checking', 'merging'].includes(task.status);
  let next: AgentState;
  if (active) {
    next = { ...agent, status: 'working', currentTaskId: task.id };
  } else if (agent.currentTaskId === task.id || !agent.currentTaskId) {
    // Агент освободился: смотрим, остались ли у него незавершённые задачи.
    const mine = Object.values({ ...s.tasks, [task.id]: task }).filter((t) => t.agentId === agent.id);
    const anyFailed = mine.some((t) => t.status === 'failed');
    const allDone = mine.every((t) => t.status === 'done');
    next = {
      ...agent,
      status: anyFailed ? 'failed' : allDone ? 'done' : 'idle',
      currentTaskId: undefined,
    };
  } else {
    return s.agents;
  }
  return { ...s.agents, [agent.id]: next };
}

function toFeed(ts: number, taskId: string, agentId: string, ev: AgentEvent): FeedItem | undefined {
  switch (ev.type) {
    case 'tool':
      return { ts, taskId, agentId, kind: 'action', text: ev.summary };
    case 'text':
      return { ts, taskId, agentId, kind: 'text', text: ev.text };
    case 'tool_result':
      return ev.isError ? { ts, taskId, agentId, kind: 'error', text: ev.output.slice(0, 300) } : undefined;
    case 'result':
      return ev.result.ok ? undefined : { ts, taskId, agentId, kind: 'error', text: ev.result.error ?? 'ошибка' };
    default:
      return undefined;
  }
}

function pushFeed(feed: FeedItem[], item: FeedItem): FeedItem[] {
  const next = feed.length >= FEED_LIMIT ? feed.slice(feed.length - FEED_LIMIT + 1) : feed.slice();
  next.push(item);
  return next;
}
