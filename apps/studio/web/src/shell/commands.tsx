// Палитра команд (Ctrl/⌘+K): экраны регистрируют свои действия, оболочка — переходы и настройки.
import type { LucideIcon } from 'lucide-react';
import { CornerDownLeft, Search } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useHotkey } from '../lib/hotkeys.ts';
import { Keys } from '../ui/display.tsx';
import { trapTab, useLayer } from '../ui/layers.ts';

export type CommandGroup = 'Действия' | 'Перейти' | 'Настройки';
const GROUPS: CommandGroup[] = ['Действия', 'Перейти', 'Настройки'];

export interface Command {
  id: string;
  group: CommandGroup;
  label: string;
  icon?: LucideIcon;
  keywords?: string[];
  hotkey?: string;
  hint?: string;
  run: () => void;
}

interface Registry {
  set: (scope: string, cmds: Command[]) => void;
  remove: (scope: string) => void;
  all: () => Command[];
  open: () => void;
}

const CommandsContext = createContext<Registry | null>(null);

/** Регистрирует команды экрана, пока он на экране. Список обновляется на каждом рендере. */
export function useCommands(scope: string, cmds: Command[]) {
  const reg = useContext(CommandsContext);
  // Ключ с id экземпляра: размонтирование старого экрана не снимет команды нового.
  const key = `${scope}#${useId()}`;
  useLayoutEffect(() => {
    reg?.set(key, cmds);
  });
  useEffect(() => () => reg?.remove(key), [reg, key]);
}

export function useOpenPalette() {
  return useContext(CommandsContext)?.open ?? (() => {});
}

const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е');

export function rank(cmds: Command[], query: string): Command[] {
  const words = norm(query).split(/\s+/).filter(Boolean);
  if (!words.length) return cmds;
  const scored: [number, Command][] = [];
  for (const c of cmds) {
    const label = norm(c.label);
    const hay = norm([c.label, ...(c.keywords ?? [])].join(' '));
    let score = 0;
    let ok = true;
    for (const w of words) {
      const idx = hay.indexOf(w);
      if (idx < 0) {
        ok = false;
        break;
      }
      // Совпадение с начала слова — выше; совпадение в названии — выше, чем в синонимах.
      const wordStart = idx === 0 || /[\s«(:·/-]/.test(hay[idx - 1]!);
      score += (wordStart ? 0 : 1) + (label.includes(w) ? 0 : 0.5);
    }
    if (ok) scored.push([score, c]);
  }
  return scored.sort((a, b) => a[0] - b[0]).map(([, c]) => c);
}

export function CommandsProvider({ children }: { children: ReactNode }) {
  const map = useRef(new Map<string, Command[]>());
  const [open, setOpen] = useState(false);
  useHotkey(
    'mod+k',
    (e) => {
      e.preventDefault();
      setOpen((o) => !o);
    },
    { inInputs: true, overLayers: true },
  );
  const reg = useMemo<Registry>(
    () => ({
      set: (scope, cmds) => void map.current.set(scope, cmds),
      remove: (scope) => void map.current.delete(scope),
      all: () => [...map.current.values()].flat(),
      open: () => setOpen(true),
    }),
    [],
  );
  return (
    <CommandsContext.Provider value={reg}>
      {children}
      {open && <Palette commands={reg.all()} onClose={() => setOpen(false)} />}
    </CommandsContext.Provider>
  );
}

function Palette({ commands, onClose }: { commands: Command[]; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const prevFocus = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null);
  useLayer(true, onClose, true);

  // Уникальные по id, в порядке групп.
  const unique = useMemo(() => {
    const seen = new Set<string>();
    return commands.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
  }, [commands]);
  const results = useMemo(() => {
    const r = rank(unique, query);
    return query.trim() ? r : GROUPS.flatMap((g) => r.filter((c) => c.group === g));
  }, [unique, query]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    input.current?.focus();
    const prev = prevFocus.current;
    return () => {
      if (prev && document.contains(prev)) prev.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    box.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const exec = useCallback(
    (c: Command | undefined) => {
      if (!c) return;
      onClose();
      // Даём палитре закрыться и вернуть фокус, затем выполняем.
      requestAnimationFrame(() => c.run());
    },
    [onClose],
  );

  let lastGroup: string | null = null;
  return createPortal(
    <div className="palette-root">
      <div className="overlay" onClick={onClose} aria-hidden />
      <div
        ref={box}
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="Поиск и команды"
        onKeyDown={(e) => {
          trapTab(e, box.current);
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(results.length - 1, a + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            exec(results[active]);
          }
        }}
      >
        <div className="palette__search">
          <Search size={16} strokeWidth={1.75} aria-hidden />
          <input
            ref={input}
            className="palette__input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Что сделать? Например: запустить, тема, coffee-shop"
            aria-label="Что сделать?"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={results[active] ? `${listId}-${active}` : undefined}
            autoComplete="off"
          />
          <Keys combo="Esc" />
        </div>
        <div className="palette__list" role="listbox" id={listId} aria-label="Команды">
          {results.length === 0 && <div className="palette__empty">Ничего не нашлось</div>}
          {results.map((c, i) => {
            const header = !query.trim() && c.group !== lastGroup ? c.group : null;
            lastGroup = c.group;
            return (
              <div key={c.id}>
                {header && <div className="palette__group">{header}</div>}
                <div
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  data-index={i}
                  className={`palette__item ${i === active ? 'palette__item--active' : ''}`}
                  onMouseMove={() => setActive(i)}
                  onClick={() => exec(c)}
                >
                  {c.icon ? <c.icon size={16} strokeWidth={1.75} aria-hidden className="palette__icon" /> : <span className="palette__icon" />}
                  <span className="grow ellipsis">{c.label}</span>
                  {c.hint && <span className="palette__hint">{c.hint}</span>}
                  {c.hotkey ? <Keys combo={c.hotkey} /> : i === active && <CornerDownLeft size={14} strokeWidth={1.75} className="faint" aria-hidden />}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>,
    document.body,
  );
}
