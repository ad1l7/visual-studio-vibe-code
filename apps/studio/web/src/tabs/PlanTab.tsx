import type { AgentSpec, TaskSpec } from '@vibe/core/shared';
import { ArrowRight, ChevronLeft, ChevronRight, Ellipsis, Info, Lightbulb, ListFilter, Pencil, Play, Plus, Settings, Trash, Users, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { api, projectUrl, type EngineChoice, type Plan } from '../api.ts';
import type { ProjectHook } from '../App.tsx';
import { agentColor, agentsWord, shortRole, STACK_LABELS, tasksWord } from '../labels.ts';
import { useHotkey } from '../lib/hotkeys.ts';
import { useHoverNone, useNarrow } from '../lib/media.ts';
import { ancestorsOf, descendantsOf, removeAgent, removeTask, uniqueId, waves } from '../lib/plan.ts';
import { runBody, useRunSettings } from '../lib/storage.ts';
import { ActionBar } from '../shell/ActionBar.tsx';
import { Button, IconButton } from '../ui/Button.tsx';
import { AgentAvatar, Badge, Callout, Chip, EmptyState, Tag } from '../ui/display.tsx';
import { ConfirmLayer, Menu, usePopover } from '../ui/overlay.tsx';
import { useToast } from '../ui/toast.tsx';
import type { PlanDraft } from '../usePlanDraft.ts';
import { AgentDrawer, RunSettingsPanel, runSettingsHint, TaskDrawer } from './PlanDrawers.tsx';

type Editing = { kind: 'agent'; agent: AgentSpec; isNew: boolean } | { kind: 'task'; task: TaskSpec; isNew: boolean } | null;

const stagesWord = (n: number) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'этап' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'этапа' : 'этапов'}`;

export function PlanTab({ project, draft: planDraft, choice, onStarted, goSpec, goRun }: { project: ProjectHook; draft: PlanDraft; choice: EngineChoice; onStarted: () => void; goSpec: () => void; goRun: () => void }) {
  const { details, running } = project;
  const { draft, dirty, update, save, reset, saving } = planDraft;
  const toast = useToast();
  const [settings] = useRunSettings();
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Editing>(null);
  const [hover, setHover] = useState<{ task?: string; agent?: string } | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const readOnly = running;

  useHotkey(
    'mod+s',
    (e) => {
      e.preventDefault();
      if (dirty && !readOnly) void save();
    },
    { inInputs: true, overLayers: true },
  );

  const columns = useMemo(() => (draft ? waves(draft) : []), [draft]);

  if (!draft) {
    return (
      <div className="page">
        <EmptyState icon={Users} title="Плана пока нет" text="Сначала опишите, что нужно сделать" action={{ label: 'Перейти к ТЗ', onClick: goSpec }} />
      </div>
    );
  }

  const launch = async () => {
    setBusy(true);
    try {
      if (dirty && !(await save({ quiet: true }))) return;
      await api(projectUrl(details!.name, '/run'), { body: { engine: choice.engine, model: choice.model, ...runBody(settings) } });
      toast({ tone: 'info', title: `Агенты запущены · ${tasksWord(draft.tasks.length)}` });
      onStarted();
    } catch (e) {
      toast({ tone: 'error', title: 'Не получилось запустить агентов', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const newAgent = (): AgentSpec => {
    const id = uniqueId('agent', draft.agents.map((a) => a.id));
    return { id, role: '', description: '', scope: [`${id}/`], instructions: '' };
  };
  const newTask = (dependsOn: string[] = []): TaskSpec => ({ id: uniqueId('task', draft.tasks.map((t) => t.id)), agentId: (pinned && draft.agents.some((a) => a.id === pinned) ? pinned : draft.agents[0]!.id), title: '', description: '', acceptance: [], dependsOn });

  const saveAgent = (a: AgentSpec, isNew: boolean) => {
    update({ ...draft, agents: isNew ? [...draft.agents, a] : draft.agents.map((x) => (x.id === a.id ? a : x)) });
    setEditing(null);
  };
  const saveTask = (t: TaskSpec, isNew: boolean) => {
    update({ ...draft, tasks: isNew ? [...draft.tasks, t] : draft.tasks.map((x) => (x.id === t.id ? t : x)) });
    setEditing(null);
  };

  // Подсветка связей
  const focusAgent = hover?.agent ?? pinned;
  const before = hover?.task ? ancestorsOf(draft, hover.task) : null;
  const after = hover?.task ? descendantsOf(draft, hover.task) : null;
  const taskState = (t: TaskSpec): string => {
    if (hover?.task) return t.id === hover.task ? 'focus' : before!.has(t.id) ? 'before' : after!.has(t.id) ? 'after' : 'dim';
    if (focusAgent) return t.agentId === focusAgent ? 'focus' : 'dim';
    return '';
  };

  const info = draft.project;
  const counts = new Map<string, number>();
  for (const t of draft.tasks) counts.set(t.agentId, (counts.get(t.agentId) ?? 0) + 1);
  const pinnedAgent = pinned ? draft.agents.find((a) => a.id === pinned) : undefined;

  const hint = dirty
    ? 'Есть несохранённые изменения'
    : `${agentsWord(draft.agents.length)} · ${tasksWord(draft.tasks.length)} · ${stagesWord(columns.length)} · ${runSettingsHint(settings)}`;

  return (
    <div className="page plan-screen">
      {readOnly && (
        <Callout
          tone="info"
          icon={Info}
          action={
            <button type="button" className="link-btn" onClick={goRun}>
              К запуску <ArrowRight size={14} aria-hidden />
            </button>
          }
        >
          Агенты работают по этому плану. Менять его можно после остановки.
        </Callout>
      )}

      <PlanSummary plan={draft} spec={details?.spec ?? ''} onEditSpec={goSpec} />

      <section className="plan-section" aria-labelledby="team-title">
        <div className="section-title">
          <h3 id="team-title">
            Команда <span className="faint num">· {draft.agents.length}</span>
          </h3>
          <span className="grow" />
          <Button size="sm" variant="secondary" icon={Plus} disabled={readOnly} tip={readOnly ? 'Менять план можно после остановки агентов' : undefined} onClick={() => setEditing({ kind: 'agent', agent: newAgent(), isNew: true })}>
            Агент
          </Button>
        </div>
        <div className="team-grid">
          {draft.agents.map((a) => (
            <AgentRow
              key={a.id}
              agent={a}
              tasks={counts.get(a.id) ?? 0}
              pinned={pinned === a.id}
              readOnly={readOnly}
              canDelete={draft.agents.length > 1}
              onOpen={() => setEditing({ kind: 'agent', agent: a, isNew: false })}
              onHover={(on) => setHover(on ? { agent: a.id } : null)}
              onPin={() => setPinned(pinned === a.id ? null : a.id)}
              onDelete={() => {
                update(removeAgent(draft, a.id));
                if (pinned === a.id) setPinned(null);
              }}
            />
          ))}
        </div>
      </section>

      <section className="plan-section" aria-labelledby="stages-title">
        <div className="section-title">
          <h3 id="stages-title">
            План работ <span className="faint num">· {tasksWord(draft.tasks.length)} · {stagesWord(columns.length)}</span>
          </h3>
          <span className="section-title__hint">Задачи одного этапа агенты делают одновременно</span>
          {pinnedAgent && (
            <Chip selected icon={ListFilter} onClick={() => setPinned(null)} aria-label={`Снять фильтр: ${pinnedAgent.role}`}>
              Только: {shortRole(pinnedAgent.role)} <X size={12} strokeWidth={2} aria-hidden />
            </Chip>
          )}
          <span className="grow" />
          <Button size="sm" variant="secondary" icon={Plus} disabled={readOnly} tip={readOnly ? 'Менять план можно после остановки агентов' : 'Задача без зависимостей — в первый этап'} onClick={() => setEditing({ kind: 'task', task: newTask(), isNew: true })}>
            Задача
          </Button>
        </div>
        <StageLane
          plan={draft}
          columns={columns}
          taskState={taskState}
          readOnly={readOnly}
          onHover={(id) => setHover(id ? { task: id } : null)}
          onOpen={(t) => setEditing({ kind: 'task', task: t, isNew: false })}
          onAdd={(i) => setEditing({ kind: 'task', task: newTask(i > 0 ? columns[i - 1]!.map((t) => t.id) : []), isNew: true })}
        />
      </section>

      <ActionBar
        hint={
          readOnly ? (
            'Агенты работают по этому плану'
          ) : (
            <>
              {hint}
              {settings.fullAccess && !dirty && <span className="warn-text"> · полный доступ</span>}
            </>
          )
        }
        hintTone={dirty ? 'warn' : undefined}
        secondary={
          readOnly
            ? []
            : dirty
              ? [
                  { label: 'Отменить правки', onClick: reset, confirm: { title: 'Отменить изменения?', text: 'План вернётся к последней сохранённой версии', confirmLabel: 'Отменить', cancelLabel: 'Нет', tone: 'danger' } },
                  { label: 'Сохранить', onClick: () => void save(), tip: 'Ctrl+S', loading: saving },
                ]
              : [{ label: 'Настройки запуска', icon: Settings, onClick: () => {}, popover: { label: 'Настройки запуска', content: <RunSettingsPanel />, width: 360 } }]
        }
        primary={
          readOnly
            ? { label: 'К запуску', iconRight: ArrowRight, onClick: goRun, hotkey: 'mod+enter' }
            : { label: dirty ? 'Сохранить и запустить' : 'Запустить агентов', icon: Play, onClick: () => void launch(), loading: busy, hotkey: 'mod+enter' }
        }
      />

      {editing?.kind === 'agent' && (
        <AgentDrawer
          agent={editing.agent}
          plan={draft}
          isNew={editing.isNew}
          readOnly={readOnly}
          onClose={() => setEditing(null)}
          onDone={(a) => saveAgent(a, editing.isNew)}
          onDelete={() => {
            update(removeAgent(draft, editing.agent.id));
            setEditing(null);
          }}
        />
      )}
      {editing?.kind === 'task' && (
        <TaskDrawer
          task={editing.task}
          plan={draft}
          isNew={editing.isNew}
          readOnly={readOnly}
          onClose={() => setEditing(null)}
          onDone={(t) => saveTask(t, editing.isNew)}
          onDelete={() => {
            update(removeTask(draft, editing.task.id));
            setEditing(null);
          }}
          onOpenTask={(id) => {
            const t = draft.tasks.find((x) => x.id === id);
            if (t) setEditing({ kind: 'task', task: t, isNew: false });
          }}
        />
      )}
    </div>
  );
}

function PlanSummary({ plan, spec, onEditSpec }: { plan: Plan; spec: string; onEditSpec: () => void }) {
  const [more, setMore] = useState(false);
  const [why, setWhy] = useState(false);
  const textRef = useRef<HTMLParagraphElement>(null);
  const [clamped, setClamped] = useState(false);
  const info = plan.project;
  // Описание без повтора заголовка (в шаблонном плане оно начинается с той же фразы).
  let text = info.summary.trim();
  const name = info.name.replace(/…$/, '');
  if (text.startsWith(name)) text = text.slice(name.length).replace(/^[\s:.,—-]+/, '');
  if (text) text = text.charAt(0).toUpperCase() + text.slice(1);
  if (!text) text = spec.split('\n')[0] ?? '';
  useEffect(() => {
    const el = textRef.current;
    if (el) setClamped(el.scrollHeight > el.clientHeight + 2);
  }, [text]);
  const stack = Object.entries(info.stack).filter(([, v]) => v);
  return (
    <section className="plan-summary" aria-label="О проекте">
      <div className="plan-summary__head">
        <h2>{info.name}</h2>
        <Button size="sm" variant="ghost" icon={Pencil} onClick={onEditSpec}>
          Изменить ТЗ
        </Button>
      </div>
      {text && (
        <p ref={textRef} className={`plan-summary__text ${more ? '' : 'clamp-2'}`}>
          {text}
        </p>
      )}
      {(clamped || more) && (
        <button type="button" className="link-btn plan-summary__more" onClick={() => setMore(!more)} aria-expanded={more}>
          {more ? 'свернуть' : 'ещё'}
        </button>
      )}
      {stack.length > 0 && (
        <div className="stack-chips" aria-label="Технологии">
          {stack.map(([k, v]) => (
            <Tag key={k}>
              <span className="faint small">{STACK_LABELS[k] ?? k}</span>
              <span>{v}</span>
            </Tag>
          ))}
        </div>
      )}
      {info.stackReasoning && (
        <div className="why">
          <button type="button" className="link-btn why__toggle" aria-expanded={why} onClick={() => setWhy(!why)}>
            <Lightbulb size={14} strokeWidth={1.75} aria-hidden /> Почему такой стек?
          </button>
          {why && <p className="why__text">{info.stackReasoning}</p>}
        </div>
      )}
    </section>
  );
}

function AgentRow({ agent: a, tasks, pinned, readOnly, canDelete, onOpen, onHover, onPin, onDelete }: { agent: AgentSpec; tasks: number; pinned: boolean; readOnly: boolean; canDelete: boolean; onOpen: () => void; onHover: (on: boolean) => void; onPin: () => void; onDelete: () => void }) {
  const menu = usePopover();
  const [confirm, setConfirm] = useState(false);
  return (
    <div className={`agent-row ${pinned ? 'agent-row--pinned' : ''}`} onMouseEnter={() => onHover(true)} onMouseLeave={() => onHover(false)} style={{ '--agent': agentColor(a.id) } as CSSProperties}>
      <button type="button" className="agent-row__main" onClick={onOpen} onFocus={() => onHover(true)} onBlur={() => onHover(false)} data-tip={a.description.length > 50 ? a.description : undefined}>
        <AgentAvatar agent={a} size={28} />
        <span className="agent-row__text">
          <span className="agent-row__role ellipsis">{a.role}</span>
          <span className="agent-row__desc ellipsis">{a.description}</span>
        </span>
      </button>
      <button type="button" className="agent-row__count" onClick={onPin} aria-pressed={pinned} aria-label={`${tasksWord(tasks)}: показать только задачи агента`} data-tip={`${tasksWord(tasks)} · показать только их`}>
        <Badge tone={pinned ? 'accent' : 'neutral'}>{tasks}</Badge>
      </button>
      <IconButton ref={menu.ref} icon={Ellipsis} size="sm" label={`Действия: ${a.role}`} onClick={menu.toggle} aria-haspopup="menu" aria-expanded={menu.open} />
      <Menu
        open={menu.open}
        onClose={menu.close}
        anchor={menu.anchor}
        label={a.role}
        items={[
          { label: readOnly ? 'Посмотреть' : 'Изменить', icon: Pencil, onClick: onOpen },
          { label: pinned ? 'Показать все задачи' : 'Показать задачи', icon: ListFilter, onClick: onPin },
          { label: 'Удалить…', icon: Trash, danger: true, disabled: readOnly || !canDelete, hint: readOnly ? 'Менять план можно после остановки агентов' : 'В команде должен остаться хотя бы один агент', onClick: () => setConfirm(true) },
        ]}
      />
      <ConfirmLayer
        open={confirm}
        onClose={() => setConfirm(false)}
        anchor={menu.anchor}
        placement="bottom"
        align="end"
        spec={{ title: `Удалить «${a.role}»?`, text: `Вместе с ним удалятся его задачи: ${tasks}`, confirmLabel: 'Удалить', tone: 'danger' }}
        onConfirm={onDelete}
      />
    </div>
  );
}

function StageLane({ plan, columns, taskState, readOnly, onHover, onOpen, onAdd }: { plan: Plan; columns: TaskSpec[][]; taskState: (t: TaskSpec) => string; readOnly: boolean; onHover: (id: string | null) => void; onOpen: (t: TaskSpec) => void; onAdd: (stage: number) => void }) {
  const narrow = useNarrow();
  const touch = useHoverNone();
  const lane = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const roles = new Map(plan.agents.map((a) => [a.id, a.role]));

  const measure = () => {
    const el = lane.current;
    if (!el || narrow) return setEdges({ left: false, right: false });
    setEdges({ left: el.scrollLeft > 4, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
  };
  useEffect(() => {
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const scrollBy = (dir: 1 | -1) => lane.current?.scrollBy({ left: dir * 280, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });

  return (
    <div className={`lane-wrap ${edges.left ? 'lane-wrap--left' : ''} ${edges.right ? 'lane-wrap--right' : ''}`}>
      {edges.left && <IconButton icon={ChevronLeft} size="sm" variant="secondary" label="Предыдущие этапы" className="lane-arrow lane-arrow--left" onClick={() => scrollBy(-1)} />}
      {edges.right && <IconButton icon={ChevronRight} size="sm" variant="secondary" label="Следующие этапы" className="lane-arrow lane-arrow--right" onClick={() => scrollBy(1)} />}
      <div ref={lane} className={`lane ${narrow ? 'lane--vertical' : ''}`} onScroll={measure} onMouseLeave={() => onHover(null)}>
        {columns.map((tasks, i) => (
          <div key={i} className="stage" role="group" aria-label={`Этап ${i + 1}`}>
            <div className="stage__head">
              {!narrow && i > 0 && <ArrowRight size={14} strokeWidth={1.75} className="stage__arrow" aria-hidden />}
              {narrow && <span className="stage__dot" aria-hidden />}
              <span className="stage__title">Этап {i + 1}</span>
              <span className="faint num">· {narrow ? tasksWord(tasks.length) : tasks.length}</span>
              {narrow && tasks.length > 1 && <span className="faint">· одновременно</span>}
            </div>
            <div className="stage__tasks">
              {tasks.map((t) => {
                const st = taskState(t);
                return (
                  <button
                    key={t.id}
                    type="button"
                    className={`plan-task ${st ? `plan-task--${st}` : ''}`}
                    style={{ '--agent': agentColor(t.agentId) } as CSSProperties}
                    onClick={() => onOpen(t)}
                    onMouseEnter={touch ? undefined : () => onHover(t.id)}
                    onFocus={touch ? undefined : () => onHover(t.id)}
                    onBlur={() => onHover(null)}
                  >
                    <span className="plan-task__title clamp-2">{t.title}</span>
                    <span className="plan-task__agent">
                      <span className="plan-task__dot" aria-hidden />
                      <span className="ellipsis">{shortRole(roles.get(t.agentId) ?? t.agentId)}</span>
                    </span>
                    {(st === 'before' || st === 'after') && <span className="plan-task__mark">{st === 'before' ? 'раньше' : 'потом'}</span>}
                  </button>
                );
              })}
              {!readOnly && (
                <button type="button" className="stage__add" onClick={() => onAdd(i)}>
                  <Plus size={14} strokeWidth={1.75} aria-hidden /> в этап
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
