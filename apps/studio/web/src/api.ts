import type { ClarifyQuestion, EngineInfo, Plan, RunEvent, RunSnapshot } from '@vibe/core/shared';

export type StreamMessage =
  | { type: 'hello'; snapshot: RunSnapshot | null; running: boolean }
  | { type: 'run-event'; event: RunEvent }
  | { type: 'planner'; text: string };

/** Бэкенд внутри браузера (демо-версия без сервера). */
export interface LocalBackend {
  request(method: string, path: string, body: unknown): Promise<unknown>;
  subscribe(project: string, onMessage: (m: StreamMessage) => void): () => void;
}

let local: LocalBackend | null = null;

export function setLocalBackend(backend: LocalBackend) {
  local = backend;
}

export async function api<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = opts.method ?? (opts.body !== undefined ? 'POST' : 'GET');
  if (local) return (await local.request(method, path, opts.body ?? {})) as T;
  const res = await fetch(path, {
    method,
    headers: method === 'GET' ? undefined : { 'Content-Type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(opts.body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `${res.status} ${res.statusText}`);
  return data as T;
}

export function subscribeProject(name: string, onMessage: (m: StreamMessage) => void): () => void {
  if (local) return local.subscribe(name, onMessage);
  const es = new EventSource(projectUrl(name, '/events'));
  es.onmessage = (msg) => onMessage(JSON.parse(msg.data) as StreamMessage);
  return () => es.close();
}

export const projectUrl = (name: string, sub = '') => `/api/projects/${encodeURIComponent(name)}${sub}`;

export interface ProjectSummary {
  name: string;
  title: string;
  hasPlan: boolean;
  running: boolean;
  lastRun: { status: RunSnapshot['status']; startedAt: number } | null;
}

export interface ProjectDetails {
  name: string;
  path: string;
  spec: string;
  plan: Plan | null;
  snapshot: RunSnapshot | null;
  running: boolean;
}

export interface TreeNode {
  name: string;
  path: string;
  dir: boolean;
  children?: TreeNode[];
}

export interface EngineChoice {
  engine: EngineInfo['id'];
  model: string;
}

export type { ClarifyQuestion, EngineInfo, Plan, RunSnapshot };
