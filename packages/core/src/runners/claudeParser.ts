import { relative, isAbsolute } from 'node:path';
import type { AgentEvent, AgentResult } from './types.ts';

type Json = Record<string, any>;

/**
 * Превращает одну строку `claude -p --output-format stream-json --verbose`
 * в ноль или несколько нормализованных событий.
 */
export function parseClaudeLine(line: string, cwd: string): AgentEvent[] {
  const trimmed = line.trim();
  if (!trimmed) return [];
  let e: Json;
  try {
    e = JSON.parse(trimmed);
  } catch {
    return [{ type: 'stderr', text: trimmed }];
  }

  if (e.type === 'system' && e.subtype === 'init') {
    return [{ type: 'session', sessionId: String(e.session_id ?? ''), model: e.model }];
  }
  if (e.type === 'system' && e.subtype === 'task_summary' && typeof e.detail === 'string' && e.detail) {
    return [{ type: 'status', text: e.detail }];
  }
  if (e.type === 'assistant' && Array.isArray(e.message?.content)) {
    const out: AgentEvent[] = [];
    for (const c of e.message.content as Json[]) {
      if (c.type === 'text' && c.text?.trim()) out.push({ type: 'text', text: c.text });
      if (c.type === 'tool_use' && c.name !== 'StructuredOutput') {
        out.push({ type: 'tool', toolUseId: c.id, name: c.name, input: c.input, summary: describeTool(c.name, c.input, cwd) });
      }
    }
    return out;
  }
  if (e.type === 'user' && Array.isArray(e.message?.content)) {
    const out: AgentEvent[] = [];
    for (const c of e.message.content as Json[]) {
      if (c.type === 'tool_result') {
        out.push({ type: 'tool_result', toolUseId: c.tool_use_id, isError: !!c.is_error, output: truncate(stringifyContent(c.content), 2000) });
      }
    }
    return out;
  }
  if (e.type === 'result' || (e.total_cost_usd !== undefined && e.subtype !== undefined)) {
    return [{ type: 'result', result: toResult(e) }];
  }
  return [];
}

function toResult(e: Json): AgentResult {
  const ok = e.subtype === 'success' && !e.is_error;
  return {
    ok,
    text: typeof e.result === 'string' ? e.result : '',
    structured: e.structured_output,
    sessionId: e.session_id,
    costUsd: e.total_cost_usd,
    durationMs: e.duration_ms ?? e.duration_api_ms,
    turns: e.num_turns,
    error: ok ? undefined : describeError(e),
  };
}

function describeError(e: Json): string {
  if (typeof e.result === 'string' && e.result) return e.result;
  if (Array.isArray(e.errors) && e.errors.length) return e.errors.join('; ');
  return `ошибка агента (${e.subtype ?? 'unknown'})`;
}

function rel(path: unknown, cwd: string): string {
  if (typeof path !== 'string') return '?';
  return isAbsolute(path) ? relative(cwd, path) || '.' : path;
}

/** Человекочитаемое описание действия агента для дашборда. */
export function describeTool(name: string, input: Json | undefined, cwd: string): string {
  const i = input ?? {};
  switch (name) {
    case 'Write':
      return `Создаёт ${rel(i.file_path, cwd)}`;
    case 'Edit':
    case 'MultiEdit':
      return `Редактирует ${rel(i.file_path, cwd)}`;
    case 'Read':
      return `Читает ${rel(i.file_path, cwd)}`;
    case 'NotebookEdit':
      return `Редактирует ${rel(i.notebook_path, cwd)}`;
    case 'Glob':
      return `Ищет файлы ${i.pattern ?? ''}`.trim();
    case 'Grep':
      return `Ищет в коде «${truncate(String(i.pattern ?? ''), 60)}»`;
    case 'Bash':
      return `Выполняет: ${truncate(String(i.description || i.command || ''), 120)}`;
    case 'WebFetch':
    case 'WebSearch':
      return `Ищет в интернете ${truncate(String(i.query ?? i.url ?? ''), 80)}`;
    case 'TodoWrite':
    case 'TaskCreate':
    case 'TaskUpdate':
      return 'Обновляет список подзадач';
    case 'Task':
    case 'Agent':
      return `Запускает помощника: ${truncate(String(i.description ?? ''), 80)}`;
    default:
      return `Инструмент ${name}`;
  }
}

function stringifyContent(c: unknown): string {
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((x: Json) => (typeof x?.text === 'string' ? x.text : '')).join('\n');
  return c == null ? '' : JSON.stringify(c);
}

export function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
