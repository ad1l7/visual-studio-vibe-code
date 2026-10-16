import { plural, type TaskState, type TaskStatus } from '@vibe/core/shared';
import { useEffect, useRef, useState } from 'react';
import { api, projectUrl, type EngineChoice } from '../api.ts';
import type { ProjectHook } from '../App.tsx';
import { RotateCcw, Square, Timer, X } from 'lucide-react';
import { AgentAvatar } from '../ui/display.tsx';
import { ActionBar } from '../shell/ActionBar.tsx';
import { runBody, useRunSettings } from '../lib/storage.ts';
import { describeRun, formatDurationShort } from '../labels.ts';
import { useToast } from '../ui/toast.tsx';
import { AGENT_STATUS, agentColor, formatDuration, formatTime, RUN_STATUS, TASK_STATUS } from '../labels.ts';

const COLUMNS: { title: string; statuses: TaskStatus[] }[] = [
  { title: 'Ожидают', statuses: ['pending'] },
  { title: 'В работе', statuses: ['running', 'checking', 'merging'] },
  { title: 'Готово', statuses: ['done'] },
  { title: 'Проблемы', statuses: ['failed', 'blocked', 'cancelled'] },
];

function useNow(active: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

export function RunTab({ project, choice, goPlan, goFiles }: { project: ProjectHook; choice: EngineChoice; goPlan: () => void; goFiles: () => void }) {
  const { snapshot: s, running, details } = project;
  const [agentFilter, setAgentFilter] = useState<string | null>(null);
  const [openTask, setOpenTask] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const now = useNow(running);
  const [settings] = useRunSettings();
  const toast = useToast();
  const feedRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    const el = feedRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [s?.feed.length]);

  if (!s) {
    return (
      <div className="empty">
        <p>Агентов ещё не запускали.</p>
        <button className="primary" onClick={goPlan}>К плану →</button>
      </div>
    );
  }

  const tasks = Object.values(s.tasks);
  const done = tasks.filter((t) => t.status === 'done').length;
  const elapsed = (s.finishedAt ?? now) - s.startedAt;
  const feed = agentFilter ? s.feed.filter((f) => f.agentId === agentFilter) : s.feed;
  const task = openTask ? s.tasks[openTask] : undefined;

  const stop = () =>
    api(projectUrl(details!.name, '/stop'), { body: {} }).then(
      () => toast({ tone: 'info', title: 'Запуск остановлен' }),
      (e: Error) => setError(e.message),
    );
  const restart = () =>
    api(projectUrl(details!.name, '/run'), { body: { engine: choice.engine, model: choice.model, ...runBody(settings) } }).then(
      () => toast({ tone: 'info', title: `Агенты запущены · ${tasks.length} задач` }),
      (e: Error) => setError(e.message),
    );

  return (
    <div className="run">
      <section className="run-head card">
        <span className={`badge ${s.status}`}>{RUN_STATUS[s.status]}</span>
        <div className="progress-old">
          <div className="progress-bar" style={{ width: `${(done / Math.max(1, tasks.length)) * 100}%` }} />
        </div>
        <span>
          <strong>{done}</strong> из {plural(tasks.length, ['задача', 'задачи', 'задач'])}
        </span>
        <span className="muted"><Timer size={14} aria-hidden /> {formatDuration(elapsed)}</span>
        <span className="muted" title="Оценка стоимости по данным CLI (при подписке списывается из лимитов)">≈ ${s.costUsd.toFixed(2)}</span>
      </section>
      {running ? (
        <ActionBar
          hint={describeRun(s)}
          primary={{ label: 'Остановить', icon: Square, iconFill: true, tone: 'danger', onClick: () => void stop(), confirm: { title: 'Остановить агентов?', text: 'Готовые задачи сохранятся. Текущие прервутся — их можно будет запустить заново', confirmLabel: 'Остановить', cancelLabel: 'Продолжить работу', tone: 'danger' } }}
        />
      ) : (
        <ActionBar
          hint={s.status === 'done' ? `Готово за ${formatDurationShort(elapsed)} · ${done} из ${tasks.length} задач` : describeRun(s)}
          hintTone={s.status === 'done' ? 'ok' : s.status === 'failed' ? 'bad' : s.status === 'stopped' ? 'warn' : undefined}
          secondary={[{ label: 'Запустить заново', icon: RotateCcw, onClick: () => void restart(), confirm: { title: 'Запустить все задачи заново?', text: 'Агенты начнут с начала по текущему плану. Уже созданные файлы останутся в папке проекта', confirmLabel: 'Запустить' } }]}
          primary={s.status === 'done' ? { label: 'Открыть результат', onClick: goFiles, hotkey: 'mod+enter' } : { label: 'Исправить план', onClick: goPlan, hotkey: 'mod+enter' }}
        />
      )}
      {error && <div className="error">{error}</div>}

      <section className="agents-live">
        {Object.values(s.agents).map((a) => {
          const current = a.currentTaskId ? s.tasks[a.currentTaskId] : undefined;
          return (
            <button
              key={a.id}
              className={`live-agent card ${a.status} ${agentFilter === a.id ? 'selected' : ''}`}
              onClick={() => setAgentFilter(agentFilter === a.id ? null : a.id)}
              title="Показать только события этого агента"
            >
              <div className="agent-head">
                <AgentAvatar agent={a} size={28} pulse={a.status === 'working'} />
                <div>
                  <strong>{a.role}</strong>
                  <div className={`small status-${a.status}`}>{AGENT_STATUS[a.status]}</div>
                </div>
              </div>
              {current && <div className="small">{current.title}</div>}
              {a.status === 'working' && a.lastAction && <div className="muted small mono clamp">{a.lastAction}</div>}
            </button>
          );
        })}
      </section>

      <div className="run-body">
        <section className="board">
          {COLUMNS.map((col) => {
            const items = tasks.filter((t) => col.statuses.includes(t.status));
            return (
              <div key={col.title} className="column">
                <div className="column-title">
                  {col.title} <span className="muted">{items.length}</span>
                </div>
                {items.map((t) => (
                  <TaskCard key={t.id} task={t} role={s.agents[t.agentId]?.role ?? t.agentId} onClick={() => setOpenTask(t.id)} />
                ))}
              </div>
            );
          })}
        </section>

        <section className="feed card">
          <div className="feed-title">
            Лента событий {agentFilter && <button className="chip small selected" onClick={() => setAgentFilter(null)}>{s.agents[agentFilter]?.role} <X size={12} aria-hidden /></button>}
          </div>
          <div
            className="feed-list"
            ref={feedRef}
            onScroll={(e) => {
              const el = e.currentTarget;
              stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
            }}
          >
            {feed.map((f, i) => (
              <div key={i} className={`feed-item ${f.kind}`}>
                <span className="muted mono small">{formatTime(f.ts)}</span>
                {f.agentId && <span className="feed-agent small" style={{ color: agentColor(f.agentId) }}>{s.agents[f.agentId]?.role}</span>}
                <span className="feed-text">{f.text}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      {task && <TaskDetails task={task} role={s.agents[task.agentId]?.role ?? task.agentId} onClose={() => setOpenTask(null)} />}
    </div>
  );
}

function TaskCard({ task: t, role, onClick }: { task: TaskState; role: string; onClick: () => void }) {
  return (
    <button className={`task-card card ${t.status}`} onClick={onClick} style={{ borderLeftColor: agentColor(t.agentId) }}>
      <strong>{t.title}</strong>
      <span className="small" style={{ color: agentColor(t.agentId) }}>{role}</span>
      <span className={`small status-${t.status}`}>
        {TASK_STATUS[t.status]}
        {t.attempts > 1 ? ` · попытка ${t.attempts}` : ''}
      </span>
      {['running', 'checking', 'merging'].includes(t.status) && t.lastAction && <span className="muted small mono clamp">{t.lastAction}</span>}
      {t.status === 'done' && t.files.length > 0 && <span className="muted small">{plural(t.files.length, ['файл', 'файла', 'файлов'])}</span>}
      {t.error && <span className="small status-failed clamp">{t.error}</span>}
    </button>
  );
}

function TaskDetails({ task: t, role, onClose }: { task: TaskState; role: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal card" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={t.title}>
        <div className="row">
          <h3>{t.title}</h3>
          <div className="spacer" />
          <button className="link" onClick={onClose} aria-label="Закрыть"><X size={16} aria-hidden /></button>
        </div>
        <div className="muted small">
          {role} · {TASK_STATUS[t.status]} · попыток: {t.attempts}
          {t.costUsd ? ` · ≈ $${t.costUsd.toFixed(3)}` : ''}
          {t.startedAt && t.finishedAt ? ` · ${formatDuration(t.finishedAt - t.startedAt)}` : ''}
        </div>
        {t.branch && <div className="muted small mono">ветка: {t.branch}</div>}
        {t.summary && (
          <>
            <h4>Отчёт агента</h4>
            <pre className="report">{t.summary}</pre>
          </>
        )}
        {t.error && (
          <>
            <h4>Ошибка</h4>
            <pre className="report error-text">{t.error}</pre>
          </>
        )}
        {t.files.length > 0 && (
          <>
            <h4>Изменённые файлы</h4>
            <ul className="files">
              {t.files.map((f) => (
                <li key={f.path} className="mono small">
                  <span className={`file-${f.status}`}>{f.status === 'added' ? '+' : f.status === 'deleted' ? '−' : '~'}</span> {f.path}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
