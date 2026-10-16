import type { RunSnapshot, TaskState, TaskStatus } from '@vibe/core/shared';
import { ArrowRight, CircleCheck, CircleStop, FileText, MessageSquareText, PanelRightOpen, Pencil, RotateCcw, Rocket, Square, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { api, projectUrl, type EngineChoice } from '../api.ts';
import type { ProjectHook } from '../App.tsx';
import { ACTIVE_TASK, agentColor, AGENT_STATUS, describeRun, filesWord, formatDuration, formatDurationShort, RUN_STATUS_META, shortRole, TASK_STATUS_META, tasksWord } from '../labels.ts';
import { useHotkey } from '../lib/hotkeys.ts';
import { usePhone, useWide } from '../lib/media.ts';
import { runBody, useLocalSetting, useRunSettings } from '../lib/storage.ts';
import { ActionBar, type Action } from '../shell/ActionBar.tsx';
import { Button } from '../ui/Button.tsx';
import { AgentAvatar, EmptyState, ProgressBar, StatusPill } from '../ui/display.tsx';
import { Segmented } from '../ui/form.tsx';
import { ConfirmPopover, Drawer, type ConfirmSpec } from '../ui/overlay.tsx';
import { useToast } from '../ui/toast.tsx';
import { FeedPanel } from './RunFeed.tsx';
import { useNow } from './SpecTab.tsx';
import { TaskPanel } from './TaskPanel.tsx';

type ColumnId = 'pending' | 'active' | 'done' | 'problems';
const COLUMNS: { id: ColumnId; title: string; statuses: TaskStatus[] }[] = [
  { id: 'pending', title: 'Ждут', statuses: ['pending'] },
  { id: 'active', title: 'В работе', statuses: ['running', 'checking', 'merging'] },
  { id: 'done', title: 'Готово', statuses: ['done'] },
  { id: 'problems', title: 'Проблемы', statuses: ['failed', 'blocked', 'cancelled'] },
];

export const STOP_CONFIRM: ConfirmSpec = { title: 'Остановить агентов?', text: 'Готовые задачи сохранятся. Текущие прервутся — их можно будет запустить заново', confirmLabel: 'Остановить', cancelLabel: 'Продолжить работу', tone: 'danger' };
export const RESTART_CONFIRM: ConfirmSpec = { title: 'Запустить все задачи заново?', text: 'Агенты начнут с начала по текущему плану. Уже созданные файлы останутся в папке проекта', confirmLabel: 'Запустить' };

/** Порядок задач на доске: по колонкам слева направо, сверху вниз. */
export function boardOrder(s: RunSnapshot): string[] {
  const tasks = Object.values(s.tasks);
  return COLUMNS.flatMap((c) => tasks.filter((t) => c.statuses.includes(t.status)).map((t) => t.id));
}

export interface RunTabProps {
  project: ProjectHook;
  choice: EngineChoice;
  goPlan: () => void;
  goFiles: () => void;
  openTask: string | null;
  setOpenTask: (id: string | null) => void;
  openFile: (path: string) => void;
  openInPlan: (taskId: string) => void;
}

export function RunTab({ project, choice, goPlan, goFiles, openTask, setOpenTask, openFile, openInPlan }: RunTabProps) {
  const { snapshot: s, running, details } = project;
  const wide = useWide();
  const phone = usePhone();
  const toast = useToast();
  const [settings] = useRunSettings();
  const [agentFilter, setAgentFilter] = useState<string | null>(null);
  const [feedDock, setFeedDock] = useLocalSetting<'open' | 'closed'>('vibe.feed', 'open');
  const [feedOverlay, setFeedOverlay] = useState(false);
  const [seenFeed, setSeenFeed] = useState(0);
  const [showProblems, setShowProblems] = useState(0);
  const now = useNow(running);

  const feedVisible = wide ? feedDock === 'open' : feedOverlay;
  const toggleFeed = () => (wide ? setFeedDock(feedDock === 'open' ? 'closed' : 'open') : setFeedOverlay(!feedOverlay));
  useHotkey('l', (e) => {
    e.preventDefault();
    toggleFeed();
  });
  const feedLen = s?.feed.length ?? 0;
  useEffect(() => {
    if (feedVisible) setSeenFeed(feedLen);
  }, [feedVisible, feedLen]);

  if (!s) {
    return (
      <div className="page">
        <EmptyState icon={Rocket} title="Агенты ещё не запускались" text="Проверьте команду и план, затем нажмите «Запустить агентов»" action={{ label: 'К плану', onClick: goPlan }} />
      </div>
    );
  }

  const tasks = Object.values(s.tasks);
  const total = tasks.length;
  const done = tasks.filter((t) => t.status === 'done').length;
  const failed = tasks.filter((t) => t.status === 'failed' || t.status === 'blocked');
  const elapsed = (s.finishedAt ?? now) - s.startedAt;
  const order = boardOrder(s);
  const task = openTask ? s.tasks[openTask] : undefined;
  const unread = Math.max(0, feedLen - seenFeed);

  const stop = () =>
    api(projectUrl(details!.name, '/stop'), { body: {} }).then(
      () => toast({ tone: 'info', title: 'Запуск остановлен' }),
      (e: Error) => toast({ tone: 'error', title: 'Не получилось остановить', text: e.message }),
    );
  const restart = () =>
    api(projectUrl(details!.name, '/run'), { body: { engine: choice.engine, model: choice.model, ...runBody(settings) } }).then(
      () => toast({ tone: 'info', title: `Агенты запущены · ${tasksWord(total)}` }),
      (e: Error) => toast({ tone: 'error', title: 'Не получилось запустить', text: e.message }),
    );

  const feedButton: Action = { label: unread && !feedVisible ? `Лента · ${unread}` : 'Лента', icon: MessageSquareText, onClick: toggleFeed, tip: 'Лента событий (L)' };
  let bar: { hint: string; hintTone?: 'ok' | 'bad' | 'warn'; secondary?: Action[]; primary?: Action };
  if (running) {
    bar = { hint: describeRun(s), secondary: wide ? [] : [feedButton], primary: { label: 'Остановить', icon: Square, iconFill: true, tone: 'danger', onClick: () => void stop(), confirm: STOP_CONFIRM } };
  } else if (s.status === 'done') {
    bar = { hint: `Готово за ${formatDurationShort(elapsed)} · ${done} из ${tasksWord(total)}`, hintTone: 'ok', secondary: [{ label: 'Запустить заново', icon: RotateCcw, onClick: () => void restart(), confirm: RESTART_CONFIRM }], primary: { label: 'Открыть результат', iconRight: ArrowRight, onClick: goFiles, hotkey: 'mod+enter' } };
  } else if (s.status === 'failed') {
    bar = {
      hint: `Не получилось ${tasksWord(failed.length)} из ${total} — откройте их, чтобы увидеть причину`,
      hintTone: 'bad',
      secondary: [{ label: 'Показать проблемы', icon: TriangleAlert, onClick: () => setShowProblems((n) => n + 1) }],
      primary: { label: 'Исправить план', iconRight: ArrowRight, onClick: goPlan, hotkey: 'mod+enter' },
    };
  } else {
    bar = { hint: describeRun(s), hintTone: 'warn', secondary: [{ label: 'К плану', icon: Pencil, onClick: goPlan }], primary: { label: 'Запустить заново', icon: RotateCcw, onClick: () => void restart(), confirm: RESTART_CONFIRM, hotkey: 'mod+enter' } };
  }

  const feedPanel = (headless = false) => <FeedPanel snapshot={s} agentFilter={agentFilter} onClearAgent={() => setAgentFilter(null)} onClose={toggleFeed} onOpenTask={(id) => setOpenTask(id)} headless={headless} />;

  return (
    <div className={`page run-screen ${wide && feedVisible ? 'run-screen--feed' : ''}`}>
      <div className="run-main">
        <StatusRow snapshot={s} running={running} elapsed={elapsed} done={done} total={total} wide={wide} feedVisible={feedVisible} unread={unread} onToggleFeed={toggleFeed} onStop={() => void stop()} />
        <AgentsStrip snapshot={s} filter={agentFilter} onFilter={(id) => setAgentFilter(agentFilter === id ? null : id)} phone={phone} />
        {!running && s.status !== 'idle' && <RunSummary snapshot={s} elapsed={elapsed} goFiles={goFiles} goPlan={goPlan} restart={() => void restart()} onOpenTask={setOpenTask} />}
        <Board snapshot={s} phone={phone} running={running} agentFilter={agentFilter} now={now} onOpen={setOpenTask} problemsTick={showProblems} />
      </div>
      {wide && feedVisible && <aside className="run-feed" aria-label="Лента событий">{feedPanel()}</aside>}
      {!wide && (
        <Drawer open={feedOverlay} onClose={() => setFeedOverlay(false)} modal={phone} label="Лента событий" title="Лента событий" width={380} className="feed-drawer">
          {feedPanel(true)}
        </Drawer>
      )}
      {task && (
        <TaskPanel
          task={task}
          snapshot={s}
          plan={details?.plan ?? null}
          order={order}
          modal={!wide}
          now={now}
          onClose={() => setOpenTask(null)}
          onSelect={setOpenTask}
          onOpenFile={openFile}
          onOpenInPlan={openInPlan}
        />
      )}
      <ActionBar {...bar} />
    </div>
  );
}

function StatusRow({ snapshot: s, running, elapsed, done, total, wide, feedVisible, unread, onToggleFeed, onStop }: { snapshot: RunSnapshot; running: boolean; elapsed: number; done: number; total: number; wide: boolean; feedVisible: boolean; unread: number; onToggleFeed: () => void; onStop: () => void }) {
  const meta = RUN_STATUS_META[s.status];
  const phrase = describeRun(s);
  const tasks = Object.values(s.tasks);
  const active = tasks.filter((t) => ACTIVE_TASK.includes(t.status)).length;
  const bad = tasks.filter((t) => t.status === 'failed').length;
  const warn = tasks.filter((t) => t.status === 'blocked').length;
  // Озвучиваем фразу не чаще раза в 10 секунд.
  const [spoken, setSpoken] = useState(phrase);
  const last = useRef(0);
  useEffect(() => {
    const wait = 10_000 - (Date.now() - last.current);
    const t = setTimeout(() => {
      last.current = Date.now();
      setSpoken(phrase);
    }, Math.max(0, wait));
    return () => clearTimeout(t);
  }, [phrase]);
  return (
    <section className="status-row" aria-label="Состояние запуска">
      <div className="status-row__line">
        <StatusPill tone={meta.tone} icon={meta.icon} pulse={s.status === 'running'} spin={s.status === 'idle'}>
          {meta.label}
        </StatusPill>
        <p className="status-row__phrase ellipsis" data-tip={phrase.length > 70 ? phrase : undefined}>
          {phrase}
        </p>
        <span className="sr-only" aria-live="polite">
          {spoken}
        </span>
        {wide && running && (
          <ConfirmPopover spec={STOP_CONFIRM} onConfirm={onStop} placement="bottom" align="end">
            {(t) => (
              <Button {...t} variant="danger-outline" icon={Square} iconFill size="md">
                Остановить
              </Button>
            )}
          </ConfirmPopover>
        )}
        {wide && !feedVisible && (
          <Button variant="secondary" icon={PanelRightOpen} onClick={onToggleFeed} tip="Лента событий (L)">
            Лента{unread > 0 && <span className="badge badge--accent">{unread}</span>}
          </Button>
        )}
      </div>
      <ProgressBar
        total={total}
        label="Выполнено задач"
        parts={[
          { value: done, tone: 'ok' },
          { value: active, tone: 'info', live: running },
          { value: bad, tone: 'bad' },
          { value: warn, tone: 'warn' },
        ]}
      />
      <div className="status-row__meta num">
        <span>
          {done} из {tasksWord(total)}
        </span>
        <span>· {formatDuration(elapsed)}</span>
        {s.costUsd > 0 && <span data-tip="Оценка стоимости по данным Claude Code; по подписке списывается из лимитов">· ≈ ${s.costUsd.toFixed(2)}</span>}
      </div>
    </section>
  );
}

function AgentsStrip({ snapshot: s, filter, onFilter, phone }: { snapshot: RunSnapshot; filter: string | null; onFilter: (id: string) => void; phone: boolean }) {
  const agents = Object.values(s.agents);
  const working = agents.filter((a) => a.status === 'working');
  const groups: [string, typeof agents][] = [
    ['Ждут:', agents.filter((a) => a.status === 'idle')],
    ['Готовы:', agents.filter((a) => a.status === 'done')],
    ['С ошибками:', agents.filter((a) => a.status === 'failed')],
  ];
  return (
    <div className={`agents-strip ${phone ? 'agents-strip--scroll' : ''}`} role="group" aria-label="Агенты">
      {working.length > 0 && <span className="agents-strip__label">Работают:</span>}
      {working.map((a) => {
        const current = a.currentTaskId ? s.tasks[a.currentTaskId] : undefined;
        return (
          <button key={a.id} type="button" className={`agent-chip ${filter === a.id ? 'agent-chip--on' : ''}`} aria-pressed={filter === a.id} onClick={() => onFilter(a.id)} data-tip="Показать только этого агента">
            <AgentAvatar agent={a} size={20} pulse />
            <span className="agent-chip__role">{shortRole(a.role)}</span>
            <span className="agent-chip__what ellipsis">· {a.lastAction ?? current?.title ?? 'работает'}</span>
          </button>
        );
      })}
      {groups.map(
        ([label, list]) =>
          list.length > 0 && (
            <span key={label} className="agents-strip__group">
              <span className="agents-strip__label">{label}</span>
              {list.map((a) => (
                <button key={a.id} type="button" className={`agent-dot ${filter === a.id ? 'agent-dot--on' : ''}`} aria-pressed={filter === a.id} onClick={() => onFilter(a.id)} aria-label={`${a.role} — ${AGENT_STATUS[a.status].toLowerCase()}. Показать только этого агента`} data-tip={`${a.role} — ${AGENT_STATUS[a.status].toLowerCase()}`}>
                  <AgentAvatar agent={a} size={24} alert={a.status === 'failed'} />
                </button>
              ))}
            </span>
          ),
      )}
    </div>
  );
}

function RunSummary({ snapshot: s, elapsed, goFiles, goPlan, restart, onOpenTask }: { snapshot: RunSnapshot; elapsed: number; goFiles: () => void; goPlan: () => void; restart: () => void; onOpenTask: (id: string) => void }) {
  const [list, setList] = useState(false);
  const tasks = Object.values(s.tasks);
  const done = tasks.filter((t) => t.status === 'done');
  const files = new Set(tasks.flatMap((t) => t.files.map((f) => f.path))).size;
  const failed = tasks.filter((t) => t.status === 'failed' || t.status === 'blocked');
  if (s.status === 'done') {
    return (
      <section className="summary-card summary-card--ok">
        <CircleCheck size={20} strokeWidth={1.75} className="summary-card__icon" aria-hidden />
        <div className="summary-card__main">
          <div className="summary-card__title">
            Готово! {done.length} из {tasksWord(tasks.length)} за {formatDurationShort(elapsed)}
          </div>
          <div className="summary-card__text num">Создано и изменено файлов: {files}</div>
          {list && (
            <ul className="summary-card__list">
              {done.map((t) => (
                <li key={t.id}>
                  <button type="button" className="link-btn" onClick={() => onOpenTask(t.id)}>
                    {t.title}
                  </button>
                  <span className="faint ellipsis">{t.summary?.split('\n')[0]}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="summary-card__actions">
          <Button variant="ghost" size="sm" icon={FileText} onClick={() => setList(!list)} aria-expanded={list}>
            {list ? 'Скрыть' : 'Что сделала каждая задача'}
          </Button>
          <Button variant="primary" size="sm" iconRight={ArrowRight} onClick={goFiles}>
            Открыть результат
          </Button>
        </div>
      </section>
    );
  }
  if (s.status === 'failed') {
    return (
      <section className="summary-card summary-card--bad">
        <TriangleAlert size={20} strokeWidth={1.75} className="summary-card__icon" aria-hidden />
        <div className="summary-card__main">
          <div className="summary-card__title">Не получилось {tasksWord(failed.length)}</div>
          <ul className="summary-card__links">
            {failed.map((t) => (
              <li key={t.id}>
                <button type="button" className="link-btn" onClick={() => onOpenTask(t.id)}>
                  {t.title}
                </button>
              </li>
            ))}
          </ul>
          <div className="summary-card__text">Частая причина — слишком общее описание задачи. Уточните её в плане и запустите заново.</div>
        </div>
        <div className="summary-card__actions">
          <Button variant="primary" size="sm" iconRight={ArrowRight} onClick={goPlan}>
            Исправить план
          </Button>
        </div>
      </section>
    );
  }
  if (s.status === 'stopped') {
    return (
      <section className="summary-card summary-card--warn">
        <CircleStop size={20} strokeWidth={1.75} className="summary-card__icon" aria-hidden />
        <div className="summary-card__main">
          <div className="summary-card__title">
            Вы остановили запуск. Готово {done.length} из {tasks.length}
          </div>
        </div>
        <div className="summary-card__actions">
          <ConfirmPopover spec={RESTART_CONFIRM} onConfirm={restart} placement="bottom" align="end">
            {(t) => (
              <Button {...t} size="sm" variant="secondary" icon={RotateCcw}>
                Запустить заново
              </Button>
            )}
          </ConfirmPopover>
        </div>
      </section>
    );
  }
  return null;
}

function Board({ snapshot: s, phone, running, agentFilter, now, onOpen, problemsTick }: { snapshot: RunSnapshot; phone: boolean; running: boolean; agentFilter: string | null; now: number; onOpen: (id: string) => void; problemsTick: number }) {
  const tasks = Object.values(s.tasks);
  const byCol = useMemo(() => Object.fromEntries(COLUMNS.map((c) => [c.id, tasks.filter((t) => c.statuses.includes(t.status))])) as Record<ColumnId, TaskState[]>, [tasks]);
  const [pick, setPick] = useState<ColumnId | null>(null);
  const [allDone, setAllDone] = useState(false);
  const problemsRef = useRef<HTMLDivElement>(null);
  const auto: ColumnId = !running && s.status === 'done' ? 'done' : byCol.active.length ? 'active' : byCol.problems.length ? 'problems' : byCol.pending.length ? 'pending' : 'done';
  const col = pick ?? auto;

  useEffect(() => {
    if (!problemsTick) return;
    if (phone) setPick('problems');
    else problemsRef.current?.scrollIntoView({ block: 'nearest' });
  }, [problemsTick, phone]);

  const card = (t: TaskState) => <RunTaskCard key={t.id} task={t} role={s.agents[t.agentId]?.role ?? t.agentId} now={now} dim={!!agentFilter && t.agentId !== agentFilter} onOpen={() => onOpen(t.id)} />;

  if (phone) {
    const list = byCol[col];
    return (
      <section className="board board--phone" aria-label="Задачи">
        <Segmented
          className="board__tabs"
          label="Какие задачи показать"
          value={col}
          onChange={(v) => setPick(v)}
          options={COLUMNS.map((c) => ({ value: c.id, label: c.id === 'problems' ? `! ${byCol[c.id].length}` : `${c.title} ${byCol[c.id].length}`, aria: `${c.title}: ${byCol[c.id].length}` }))}
        />
        <div className="board__list">{list.length ? list.map(card) : <div className="board__empty">Пусто</div>}</div>
      </section>
    );
  }

  const problemsEmpty = byCol.problems.length === 0;
  return (
    <section className={`board ${problemsEmpty ? 'board--no-problems' : ''}`} aria-label="Задачи">
      {COLUMNS.map((c) => {
        let items = byCol[c.id];
        const extra = c.id === 'done' && items.length > 6 && !allDone ? items.length - 5 : 0;
        if (extra) items = items.slice(-5);
        return (
          <div key={c.id} className={`board__col board__col--${c.id}`} ref={c.id === 'problems' ? problemsRef : undefined}>
            <div className={`board__head ${c.id === 'problems' && !problemsEmpty ? 'board__head--bad' : ''}`}>
              {c.title} <span className="num faint">{byCol[c.id].length}</span>
            </div>
            <div className="board__list">
              {items.length === 0 ? <div className="board__empty">Пусто</div> : items.map(card)}
              {extra > 0 && (
                <button type="button" className="board__more" onClick={() => setAllDone(true)}>
                  Показать все ({byCol.done.length})
                </button>
              )}
            </div>
          </div>
        );
      })}
    </section>
  );
}

function RunTaskCard({ task: t, role, now, dim, onOpen }: { task: TaskState; role: string; now: number; dim: boolean; onOpen: () => void }) {
  const meta = TASK_STATUS_META[t.status];
  const active = ACTIVE_TASK.includes(t.status);
  let metaText = '';
  if (t.status === 'running' && t.startedAt) metaText = formatDurationShort(now - t.startedAt).replace(/ \d+ с$/, '');
  else if (t.status === 'checking' || t.status === 'merging') metaText = meta.label;
  else if (t.status === 'done' && t.files.length) metaText = filesWord(t.files.length);
  return (
    <button type="button" className={`run-task run-task--${t.status} ${dim ? 'run-task--dim' : ''}`} style={{ '--agent': agentColor(t.agentId) } as CSSProperties} onClick={onOpen} aria-label={`${t.title}: ${meta.label}`}>
      <span className="run-task__line">
        <meta.icon size={14} strokeWidth={2} className={`run-task__icon tone-${meta.tone} ${t.status === 'running' ? 'spin' : ''}`} aria-hidden data-tip={meta.tip} />
        <span className="run-task__title ellipsis">{t.title}</span>
      </span>
      {t.error && (t.status === 'failed' || t.status === 'blocked') ? (
        <span className="run-task__error ellipsis">{t.error}</span>
      ) : (
        <span className="run-task__line run-task__sub">
          <span className="run-task__dot" aria-hidden />
          <span className="ellipsis grow">{shortRole(role)}</span>
          {t.attempts > 1 ? <span className="run-task__meta warn-text num">попытка {t.attempts}</span> : metaText && <span className="run-task__meta num">{metaText}</span>}
        </span>
      )}
      {active && t.lastAction && <span className="run-task__action mono ellipsis">{t.lastAction}</span>}
    </button>
  );
}
