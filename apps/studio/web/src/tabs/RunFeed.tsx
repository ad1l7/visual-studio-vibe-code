import type { FeedItem, RunSnapshot } from '@vibe/core/shared';
import { ArrowDown, CircleCheck, CircleX, Dot, Info, MessageSquareText, PanelRightClose, X } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import { formatHM, formatTime, shortRole } from '../labels.ts';
import { useLocalSetting } from '../lib/storage.ts';
import { IconButton } from '../ui/Button.tsx';
import { AgentAvatar, Chip } from '../ui/display.tsx';
import { Segmented } from '../ui/form.tsx';

const KIND_ICON = { info: Info, success: CircleCheck, error: CircleX, action: Dot, text: MessageSquareText } as const;
const MAIN_KINDS = new Set<FeedItem['kind']>(['info', 'success', 'error']);
const PAGE = 200;

/** Технические слова оркестратора — понятным языком. */
export function humanize(text: string): string {
  return text.replace(/(готово )?и влит[оы]? в main/g, (_m, g) => `${g ?? ''}и сохранено в проекте`).replace(/влит[оы]? в main/g, 'сохранено в проекте');
}

export function filterFeed(feed: FeedItem[], mode: 'main' | 'all', agent: string | null, task?: string) {
  return feed.filter((f) => (mode === 'all' || MAIN_KINDS.has(f.kind)) && (!agent || f.agentId === agent) && (!task || f.taskId === task));
}

export function FeedList({ items, snapshot, onOpenTask, autoScroll = true, compact }: { items: FeedItem[]; snapshot: RunSnapshot; onOpenTask?: (id: string) => void; autoScroll?: boolean; compact?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [limit, setLimit] = useState(PAGE);
  const [unseen, setUnseen] = useState(0);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const lastLen = useRef(items.length);
  const shown = items.slice(-limit);
  const hidden = items.length - shown.length;

  useLayoutEffect(() => {
    const el = ref.current;
    const added = items.length - lastLen.current;
    lastLen.current = items.length;
    if (!el || !autoScroll) return;
    if (stick.current) {
      el.scrollTop = el.scrollHeight;
      setUnseen(0);
    } else if (added > 0) setUnseen((u) => u + added);
  }, [items.length, autoScroll]);

  if (!items.length) return <div className="feed__empty">Событий пока нет</div>;

  return (
    <div className="feed__scroll-wrap">
      <div
        ref={ref}
        className={`feed__list ${compact ? 'feed__list--compact' : ''}`}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
          if (stick.current) setUnseen(0);
        }}
      >
        {hidden > 0 && (
          <button type="button" className="feed__more" onClick={() => setLimit((l) => l + PAGE)}>
            Показать раньше · {hidden}
          </button>
        )}
        {shown.map((f, i) => {
          const prev = shown[i - 1];
          const grouped = !!prev && prev.agentId === f.agentId && !!f.agentId;
          const Icon = KIND_ICON[f.kind];
          const agent = f.agentId ? snapshot.agents[f.agentId] : undefined;
          const idx = items.length - shown.length + i;
          const open = expanded.has(idx);
          const clickable = !!f.taskId && !!onOpenTask;
          return (
            <div key={idx} className={`feed-row feed-row--${f.kind} ${grouped ? 'feed-row--grouped' : ''} ${open ? 'feed-row--open' : ''}`}>
              <button
                type="button"
                className="feed-row__btn"
                onClick={() => {
                  if (clickable) onOpenTask!(f.taskId!);
                  else setExpanded((s) => new Set(s.has(idx) ? [...s].filter((x) => x !== idx) : [...s, idx]));
                }}
                title={f.text.length > 60 ? humanize(f.text) : undefined}
              >
                <Icon size={14} strokeWidth={f.kind === 'action' ? 3 : 1.75} className="feed-row__icon" aria-hidden />
                <span className="feed-row__avatar">{agent && !grouped && <AgentAvatar agent={agent} size={16} />}</span>
                <span className="feed-row__text">
                  {agent && !grouped && !f.text.startsWith(agent.role) && <span className="feed-row__who">{shortRole(agent.role)} </span>}
                  {humanize(f.text)}
                </span>
                <time className="feed-row__time num" dateTime={new Date(f.ts).toISOString()} data-tip={formatTime(f.ts)}>
                  {formatHM(f.ts)}
                </time>
              </button>
            </div>
          );
        })}
      </div>
      {unseen > 0 && (
        <button
          type="button"
          className="feed__new"
          onClick={() => {
            const el = ref.current;
            if (el) el.scrollTop = el.scrollHeight;
            stick.current = true;
            setUnseen(0);
          }}
        >
          <ArrowDown size={14} strokeWidth={1.75} aria-hidden /> Новые события · {unseen}
        </button>
      )}
    </div>
  );
}

export function useFeedMode() {
  return useLocalSetting<'main' | 'all'>('vibe.feedMode', 'main');
}

/** Панель «Лента событий»: заголовок с режимами и фильтром агента + список. */
export function FeedPanel({ snapshot, agentFilter, onClearAgent, onClose, onOpenTask, closeLabel = 'Свернуть ленту', headless }: { snapshot: RunSnapshot; agentFilter: string | null; onClearAgent: () => void; onClose?: () => void; onOpenTask: (id: string) => void; closeLabel?: string; headless?: boolean }) {
  const [mode, setMode] = useFeedMode();
  const items = filterFeed(snapshot.feed, mode, agentFilter);
  const agent = agentFilter ? snapshot.agents[agentFilter] : undefined;
  return (
    <div className="feed">
      <div className="feed__head">
        {!headless && <h3 className="feed__title">Лента событий</h3>}
        <Segmented
          size="sm"
          label="Какие события показывать"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'main', label: 'Главное', tip: 'Старты, завершения и ошибки' },
            { value: 'all', label: 'Всё', tip: 'Плюс каждое действие агентов' },
          ]}
        />
        <span className="grow" />
        {onClose && !headless && <IconButton icon={PanelRightClose} size="sm" label={closeLabel} onClick={onClose} />}
      </div>
      {agent && (
        <div className="feed__filter">
          <Chip selected onClick={onClearAgent} aria-label={`Снять фильтр: ${agent.role}`}>
            Только: {shortRole(agent.role)} <X size={12} strokeWidth={2} aria-hidden />
          </Chip>
        </div>
      )}
      <FeedList items={items} snapshot={snapshot} onOpenTask={onOpenTask} />
    </div>
  );
}
