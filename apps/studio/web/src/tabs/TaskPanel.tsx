import type { RunSnapshot, TaskState } from '@vibe/core/shared';
import { Check, ChevronLeft, ChevronRight, Circle, LoaderCircle, Pencil, TriangleAlert, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Plan } from '../api.ts';
import { ACTIVE_TASK, formatDuration, formatTime, TASK_STATUS_META } from '../labels.ts';
import { useHotkey } from '../lib/hotkeys.ts';
import { Button, IconButton } from '../ui/Button.tsx';
import { AgentAvatar, Callout, StatusPill } from '../ui/display.tsx';
import { Drawer } from '../ui/overlay.tsx';
import { Disclosure } from './PlanDrawers.tsx';
import { FeedList } from './RunFeed.tsx';

const attemptsWord = (n: number) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'попытку' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'попытки' : 'попыток'}`;
const eventsWord = (n: number) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'событие' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'события' : 'событий'}`;

function Section({ title, children, extra }: { title: string; children: ReactNode; extra?: ReactNode }) {
  return (
    <section className="tp-section">
      <h3 className="tp-section__title">
        {title}
        {extra}
      </h3>
      {children}
    </section>
  );
}

export function TaskPanel({ task: t, snapshot, plan, order, modal, now, onClose, onSelect, onOpenFile, onOpenInPlan }: { task: TaskState; snapshot: RunSnapshot; plan: Plan | null; order: string[]; modal: boolean; now: number; onClose: () => void; onSelect: (id: string) => void; onOpenFile: (path: string) => void; onOpenInPlan: (id: string) => void }) {
  const spec = plan?.tasks.find((x) => x.id === t.id);
  const agent = snapshot.agents[t.agentId];
  const meta = TASK_STATUS_META[t.status];
  const index = order.indexOf(t.id);
  const go = (d: 1 | -1) => {
    const next = order[(index + d + order.length) % order.length];
    if (next) onSelect(next);
  };
  useHotkey(['j', 'arrowdown'], (e) => {
    e.preventDefault();
    go(1);
  }, { overLayers: true });
  useHotkey(['k', 'arrowup'], (e) => {
    e.preventDefault();
    go(-1);
  }, { overLayers: true });

  const events = snapshot.feed.filter((f) => f.taskId === t.id);
  const active = ACTIVE_TASK.includes(t.status);
  const duration = t.startedAt ? (t.finishedAt ?? (active ? now : t.startedAt)) - t.startedAt : 0;
  const deps = spec?.dependsOn.map((d) => snapshot.tasks[d]).filter(Boolean) as TaskState[] | undefined;
  const failedDep = t.status === 'blocked' ? deps?.find((d) => d.status === 'failed' || d.status === 'blocked') : undefined;
  const headRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headRef.current?.focus({ preventScroll: true }), [t.id]);

  const description = spec && (
    <Section title="Что нужно сделать">
      <p className="tp-text">{spec.description}</p>
    </Section>
  );
  const acceptance = spec && spec.acceptance.length > 0 && (
    <Section title="Как понять, что готово">
      <ul className="tp-checklist">
        {spec.acceptance.map((a) => (
          <li key={a}>
            {t.status === 'done' ? <Check size={14} strokeWidth={2} className="tp-ok" aria-hidden /> : <Circle size={12} strokeWidth={1.75} className="faint" aria-hidden />}
            <span>{a}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
  const activity = (open: boolean) =>
    events.length > 0 && (
      <ActivitySection key={`${t.id}-${open}`} defaultOpen={open} count={events.length}>
        <FeedList items={events.slice(-20)} snapshot={snapshot} compact />
      </ActivitySection>
    );

  const files = t.files.length > 0 && (
    <Section title={`Изменённые файлы · ${t.files.length}`}>
      <ul className="tp-files">
        {t.files.map((f) => (
          <li key={f.path}>
            <button type="button" className="tp-file" onClick={() => f.status !== 'deleted' && onOpenFile(f.path)} disabled={f.status === 'deleted'}>
              <span className={`tp-file__mark tp-file__mark--${f.status}`} aria-label={f.status === 'added' ? 'создан' : f.status === 'deleted' ? 'удалён' : 'изменён'}>
                {f.status === 'added' ? '+' : f.status === 'deleted' ? '−' : '~'}
              </span>
              <span className="tp-file__path mono ellipsis">{f.path}</span>
              {f.status !== 'deleted' && (
                <span className="tp-file__open">
                  Открыть <ChevronRight size={14} strokeWidth={1.75} aria-hidden />
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </Section>
  );

  let body: ReactNode;
  if (t.status === 'pending' || t.status === 'blocked') {
    body = (
      <>
        {failedDep && (
          <Callout tone="warn" icon={TriangleAlert}>
            Не запускалась: не получилась задача «{failedDep.title}», от которой она зависит
          </Callout>
        )}
        {description}
        {acceptance}
        {deps && deps.length > 0 && (
          <Section title="Начнётся после">
            <ul className="tp-deps">
              {deps.map((d) => {
                const m = TASK_STATUS_META[d.status];
                return (
                  <li key={d.id}>
                    <button type="button" className="link-btn" onClick={() => onSelect(d.id)}>
                      {d.title}
                    </button>
                    <StatusPill tone={m.tone} icon={m.icon} size="sm" spin={d.status === 'running'}>
                      {m.label}
                    </StatusPill>
                  </li>
                );
              })}
            </ul>
          </Section>
        )}
      </>
    );
  } else if (active) {
    body = (
      <>
        <div className="tp-now">
          <LoaderCircle size={16} strokeWidth={1.75} className="spin" aria-hidden />
          <span>
            <span className="faint">Сейчас: </span>
            {t.lastAction ?? meta.label}
          </span>
        </div>
        {activity(true)}
        {description}
        {acceptance}
      </>
    );
  } else if (t.status === 'failed') {
    body = (
      <>
        <Callout tone="bad" icon={TriangleAlert}>
          <strong>Не получилось за {attemptsWord(Math.max(1, t.attempts))}</strong>
          {t.error && <ErrorText text={t.error} />}
        </Callout>
        <div className="tp-fix">
          <p>Что можно сделать: уточнить описание задачи в плане и запустить заново.</p>
          {spec && (
            <Button size="sm" variant="secondary" icon={Pencil} onClick={() => onOpenInPlan(t.id)}>
              Открыть в плане
            </Button>
          )}
        </div>
        {activity(false)}
        {description}
        {acceptance}
      </>
    );
  } else {
    body = (
      <>
        {t.summary && (
          <Section title="Отчёт агента">
            <p className="tp-text tp-report">{t.summary}</p>
          </Section>
        )}
        {files}
        {description}
        {acceptance}
        {activity(false)}
      </>
    );
  }

  const header = (
    <div className="drawer__head tp-head">
      <IconButton icon={ChevronLeft} size="sm" label="Предыдущая задача (K)" onClick={() => go(-1)} />
      <IconButton icon={ChevronRight} size="sm" label="Следующая задача (J)" onClick={() => go(1)} />
      <span className="tp-head__count num">
        Задача {index + 1} из {order.length}
      </span>
      <span className="grow" />
      <IconButton icon={X} label="Закрыть" onClick={onClose} />
    </div>
  );

  return (
    <Drawer open onClose={onClose} modal={modal} label={`Задача: ${t.title}`} header={header} width={480} className="task-panel">
      <div className="tp-top">
        <StatusPill tone={meta.tone} icon={meta.icon} spin={t.status === 'running'} tip={meta.tip}>
          {meta.label}
        </StatusPill>
        <h2 className="tp-title" ref={headRef} tabIndex={-1} data-drawer-title>
          {t.title}
        </h2>
        <div className="tp-agent">
          {agent && <AgentAvatar agent={agent} size={20} />}
          <span>{agent?.role ?? t.agentId}</span>
          {duration > 0 && <span className="faint num">· {formatDuration(duration)}</span>}
          {t.attempts > 1 && <span className="warn-text num">· попытка {t.attempts}</span>}
        </div>
      </div>
      {body}
      <Disclosure title="Подробности">
        <dl className="tp-details">
          {t.branch && (
            <>
              <dt>Ветка</dt>
              <dd className="mono">{t.branch}</dd>
            </>
          )}
          <dt>Попыток</dt>
          <dd className="mono">{t.attempts}</dd>
          {t.startedAt && (
            <>
              <dt>Время</dt>
              <dd className="mono">
                {formatTime(t.startedAt)}
                {t.finishedAt ? ` – ${formatTime(t.finishedAt)} (${formatDuration(t.finishedAt - t.startedAt)})` : ''}
              </dd>
            </>
          )}
          {t.costUsd > 0 && (
            <>
              <dt>Стоимость</dt>
              <dd className="mono">≈ ${t.costUsd.toFixed(3)}</dd>
            </>
          )}
          <dt>Внутреннее имя</dt>
          <dd className="mono">{t.id}</dd>
        </dl>
      </Disclosure>
    </Drawer>
  );
}

function ActivitySection({ count, defaultOpen, children }: { count: number; defaultOpen: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="tp-section">
      <button type="button" className="disclosure__toggle tp-activity" aria-expanded={open} onClick={() => setOpen(!open)}>
        <ChevronRight size={14} strokeWidth={1.75} aria-hidden className="disclosure__chevron" style={{ transform: open ? 'rotate(90deg)' : undefined }} />
        Что делал агент <span className="faint num">· {eventsWord(count)}</span>
      </button>
      {open && <div className="tp-activity__list">{children}</div>}
    </section>
  );
}

function ErrorText({ text }: { text: string }) {
  const [full, setFull] = useState(false);
  const long = text.split('\n').length > 6 || text.length > 480;
  return (
    <>
      <p className={`tp-error ${long && !full ? 'tp-error--clamp' : ''}`}>{text}</p>
      {long && (
        <button type="button" className="link-btn" onClick={() => setFull(!full)}>
          {full ? 'Свернуть' : 'Показать полностью'}
        </button>
      )}
    </>
  );
}

