import type { AgentState, RunStatus, TaskStatus } from '@vibe/core/shared';

export const TASK_STATUS: Record<TaskStatus, string> = {
  pending: 'Ожидает',
  running: 'Работает',
  checking: 'Проверка',
  merging: 'Слияние',
  done: 'Готово',
  failed: 'Ошибка',
  blocked: 'Заблокирована',
  cancelled: 'Отменена',
};

export const AGENT_STATUS: Record<AgentState['status'], string> = {
  idle: 'Свободен',
  working: 'Работает',
  done: 'Всё сделал',
  failed: 'Есть ошибки',
};

export const RUN_STATUS: Record<RunStatus, string> = {
  idle: 'Подготовка',
  running: 'Идёт работа',
  done: 'Готово',
  failed: 'Завершено с ошибками',
  stopped: 'Остановлено',
};

export const STACK_LABELS: Record<string, string> = {
  frontend: 'Интерфейс',
  backend: 'Сервер',
  database: 'База данных',
  devops: 'Запуск и деплой',
  other: 'Другое',
};

export const MODELS = [
  { id: '', label: 'По умолчанию' },
  { id: 'sonnet', label: 'Sonnet — баланс' },
  { id: 'opus', label: 'Opus — максимум качества' },
  { id: 'haiku', label: 'Haiku — быстро и дёшево' },
];

const HUES = [262, 200, 150, 30, 330, 100, 0, 180];

export function agentColor(id: string): string {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `hsl(${HUES[h % HUES.length]} 70% 62%)`;
}

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h) return `${h} ч ${m % 60} мин`;
  if (m) return `${m} мин ${s % 60} с`;
  return `${s} с`;
}

export function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
