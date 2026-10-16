import { Check, FileText, Menu, PackageCheck, Rocket, Search, Users, type LucideIcon } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { STEP_LABELS, STEP_SHORT, type ProjectStep } from '../labels.ts';
import { useNarrow, useWide } from '../lib/media.ts';
import { IconButton } from '../ui/Button.tsx';
import { Keys } from '../ui/display.tsx';
import { useOpenPalette } from './commands.tsx';
import { DemoChip } from './DemoChip.tsx';
import { useLocalSetting } from '../lib/storage.ts';

export type StepState = 'todo' | 'done' | 'locked' | 'live' | 'error' | 'stopped';

export interface StepInfo {
  id: ProjectStep;
  state: StepState;
  tip?: string;
  /** «3/6» рядом с подписью у шага «Запуск». */
  meta?: string;
}

const ICONS: Record<ProjectStep, LucideIcon> = { spec: FileText, plan: Users, run: Rocket, files: PackageCheck };

export function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  return new Promise((resolve, reject) => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    if (ok) resolve();
    else reject(new Error('Не удалось скопировать'));
  });
}

export function Stepper({ steps, current, onGo, variant }: { steps: StepInfo[]; current: ProjectStep; onGo: (s: ProjectStep) => void; variant: 'full' | 'segments' }) {
  const wide = useWide();
  // Причина недоступности шага — подсказкой у самого шага, а не тостом в углу.
  const [bubble, setBubble] = useState<ProjectStep | null>(null);
  useEffect(() => {
    if (!bubble) return;
    const t = setTimeout(() => setBubble(null), 2800);
    return () => clearTimeout(t);
  }, [bubble]);
  return (
    <ol className={`stepper stepper--${variant}`} aria-label="Шаги проекта">
      {steps.map((s, i) => {
        const Icon = ICONS[s.id];
        const isCurrent = s.id === current;
        const locked = s.state === 'locked';
        const prevDone = i > 0 && steps[i - 1]!.state !== 'locked' && steps[i - 1]!.state !== 'todo';
        return (
          <li key={s.id} className="stepper__item">
            {bubble === s.id && s.tip && (
              <span className={`step-bubble ${i >= 2 ? 'step-bubble--end' : ''}`} role="status">
                {s.tip}
              </span>
            )}
            {variant === 'full' && i > 0 && <span className={`stepper__line ${prevDone && !locked ? 'stepper__line--done' : ''}`} aria-hidden />}
            <button
              type="button"
              className={`step step--${s.state} ${isCurrent ? 'step--current' : ''}`}
              aria-current={isCurrent ? 'step' : undefined}
              aria-disabled={locked || undefined}
              data-tip={s.tip}
              onClick={() => {
                if (locked) {
                  if (s.tip) setBubble(s.id);
                  return;
                }
                onGo(s.id);
              }}
            >
              {variant === 'full' ? (
                <span className="step__num" aria-hidden>
                  {s.state === 'done' && !isCurrent ? <Check size={12} strokeWidth={2.5} /> : i + 1}
                </span>
              ) : s.state === 'done' && !isCurrent ? (
                <Check size={16} strokeWidth={2} aria-hidden className="step__check" />
              ) : (
                <Icon size={16} strokeWidth={1.75} aria-hidden />
              )}
              <span className="step__label">{variant === 'full' && wide ? STEP_LABELS[s.id] : STEP_SHORT[s.id]}</span>
              {(s.state === 'live' || s.state === 'error' || s.state === 'stopped') && (
                <span className={`dot ${s.state === 'live' ? 'dot--running' : s.state === 'error' ? 'dot--failed' : 'dot--stopped'}`} aria-hidden />
              )}
              {s.meta && <span className="step__meta num">{s.meta}</span>}
              <span className="sr-only">
                {s.state === 'done' ? ' — готово' : s.state === 'locked' ? ' — пока недоступно' : s.state === 'live' ? ' — идёт работа' : s.state === 'error' ? ' — есть ошибки' : ''}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/** Шапка экрана: на телефоне 48 px с кнопкой меню, на десктопе 52 px. */
export function ScreenHeader({ title, sub, onMenu, children, right, onSearch }: { title: ReactNode; sub?: ReactNode; onMenu?: () => void; children?: ReactNode; right?: ReactNode; onSearch?: () => void }) {
  const narrow = useNarrow();
  const wide = useWide();
  const openPalette = useOpenPalette();
  const [sidebar] = useLocalSetting<'open' | 'rail'>('vibe.sidebar', 'open');
  // На десктопе с раскрытым сайдбаром чип «Демо» уже есть в сайдбаре.
  const headerChip = narrow || sidebar === 'rail';
  onSearch ??= openPalette;
  return (
    <header className="screen-header">
      {narrow && onMenu && <IconButton icon={Menu} label="Меню: проекты и настройки" onClick={onMenu} />}
      <div className="screen-header__title">
        <div className="screen-header__name ellipsis">{title}</div>
        {sub && <div className="screen-header__sub">{sub}</div>}
      </div>
      {children}
      <span className="grow" />
      {right}
      {headerChip && <DemoChip auto />}
      {onSearch &&
        (!wide ? (
          <IconButton icon={Search} label="Поиск и команды (Ctrl+K)" onClick={onSearch} />
        ) : (
          <button type="button" className="search-btn" onClick={onSearch} aria-label="Поиск и команды">
            <Search size={14} strokeWidth={1.75} aria-hidden />
            <span className="search-btn__text">Поиск</span>
            <Keys combo="mod+k" />
          </button>
        ))}
    </header>
  );
}
