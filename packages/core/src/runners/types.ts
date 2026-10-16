import type { EngineId } from '../plan/schema.ts';

/** Нормализованное событие агента — одинаковое для любого CLI-движка. */
export type AgentEvent =
  | { type: 'session'; sessionId: string; model?: string }
  | { type: 'text'; text: string }
  | { type: 'status'; text: string }
  | { type: 'tool'; toolUseId: string; name: string; summary: string; input: unknown }
  | { type: 'tool_result'; toolUseId: string; isError: boolean; output: string }
  | { type: 'stderr'; text: string }
  | { type: 'result'; result: AgentResult };

export interface AgentResult {
  ok: boolean;
  text: string;
  structured?: unknown;
  sessionId?: string;
  costUsd?: number;
  durationMs?: number;
  turns?: number;
  error?: string;
}

export type RunPurpose = 'clarify' | 'plan' | 'task' | 'resolve-conflict';

export interface RunMeta {
  purpose: RunPurpose;
  taskId?: string;
  agentId?: string;
  scope?: string[];
}

export interface RunOptions {
  cwd: string;
  prompt: string;
  systemPrompt?: string;
  model?: string;
  /** Схема structured output (JSON Schema). Результат — в AgentResult.structured. */
  jsonSchema?: Record<string, unknown>;
  resumeSessionId?: string;
  permissionMode?: PermissionMode;
  allowedTools?: string[];
  disallowedTools?: string[];
  signal?: AbortSignal;
  /** Подсказка о назначении запуска: используется mock-движком и логами. */
  meta: RunMeta;
}

export type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';

export interface EngineInfo {
  id: EngineId;
  name: string;
  available: boolean;
  version?: string;
  hint?: string;
}

export interface AgentRunner {
  readonly id: EngineId;
  info(): Promise<EngineInfo>;
  /** Поток событий; последнее событие всегда `result`. */
  run(opts: RunOptions): AsyncIterable<AgentEvent>;
}

/** Прогоняет поток до конца и возвращает итог, по пути отдавая события в onEvent. */
export async function runToResult(
  runner: AgentRunner,
  opts: RunOptions,
  onEvent?: (e: AgentEvent) => void,
): Promise<AgentResult> {
  let result: AgentResult | undefined;
  for await (const e of runner.run(opts)) {
    onEvent?.(e);
    if (e.type === 'result') result = e.result;
  }
  return result ?? { ok: false, text: '', error: 'движок завершился без результата' };
}
