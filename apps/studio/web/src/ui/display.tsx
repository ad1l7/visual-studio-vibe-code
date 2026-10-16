import type { LucideIcon } from 'lucide-react';
import type { ButtonHTMLAttributes, CSSProperties, ReactNode, Ref } from 'react';
import { agentBg, agentColor, agentIcon, type Tone } from '../labels.ts';
import { Button } from './Button.tsx';

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
export const MOD = isMac ? '⌘' : 'Ctrl';

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

/** Сочетание клавиш: keys('mod+k') → Ctrl K / ⌘ K. */
export function Keys({ combo }: { combo: string }) {
  return (
    <span className="keys" aria-hidden>
      {combo.split('+').map((k) => (
        <Kbd key={k}>{k === 'mod' ? MOD : k === 'enter' ? '↵' : k === 'alt' ? (isMac ? '⌥' : 'Alt') : k.length === 1 ? k.toUpperCase() : k}</Kbd>
      ))}
    </span>
  );
}

export function Chip({ selected, icon: Icon, children, className, ref, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean; icon?: LucideIcon; ref?: Ref<HTMLButtonElement> }) {
  return (
    <button ref={ref} type="button" className={['chip', selected && 'chip--selected', className].filter(Boolean).join(' ')} aria-pressed={selected} {...rest}>
      {Icon && <Icon size={14} strokeWidth={1.75} aria-hidden />}
      {children}
    </button>
  );
}

export function Tag({ children, className, style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <span className={['tag', className].filter(Boolean).join(' ')} style={style}>
      {children}
    </span>
  );
}

export function StatusPill({ tone, icon: Icon, spin, pulse, children, tip, size = 'md' }: { tone: Tone; icon?: LucideIcon; spin?: boolean; pulse?: boolean; children: ReactNode; tip?: string; size?: 'sm' | 'md' }) {
  return (
    <span className={`pill pill--${tone} pill--${size}`} data-tip={tip}>
      {pulse ? <span className="pill__dot pulse" aria-hidden /> : Icon && <Icon size={size === 'sm' ? 12 : 14} strokeWidth={2} aria-hidden className={spin ? 'spin' : undefined} />}
      {children}
    </span>
  );
}

export function Badge({ children, tone = 'neutral', tip }: { children: ReactNode; tone?: Tone; tip?: string }) {
  return (
    <span className={`badge badge--${tone}`} data-tip={tip}>
      {children}
    </span>
  );
}

export function Dot({ state, className, tip }: { state: string; className?: string; tip?: string }) {
  return <span className={['dot', `dot--${state}`, className].filter(Boolean).join(' ')} data-tip={tip} aria-hidden={!tip} />;
}

export function AgentAvatar({ agent, size = 28, pulse, alert, tip }: { agent: { id: string; role?: string }; size?: 20 | 24 | 28 | 16 | 32; pulse?: boolean; alert?: boolean; tip?: string }) {
  const Icon = agentIcon(agent);
  const icon = size <= 20 ? 12 : size <= 24 ? 14 : 16;
  return (
    <span
      className={`avatar ${pulse ? 'avatar--pulse' : ''}`}
      style={{ width: size, height: size, background: agentBg(agent.id), color: agentColor(agent.id) }}
      data-tip={tip}
      aria-hidden={!tip}
      aria-label={tip}
      role={tip ? 'img' : undefined}
    >
      <Icon size={icon} strokeWidth={1.75} aria-hidden />
      {alert && <span className="avatar__alert" />}
    </span>
  );
}

export function EmptyState({ icon: Icon, title, text, action, compact }: { icon: LucideIcon; title: string; text?: ReactNode; action?: { label: string; onClick: () => void; icon?: LucideIcon }; compact?: boolean }) {
  return (
    <div className={`empty ${compact ? 'empty--compact' : ''}`}>
      <span className="empty__icon" aria-hidden>
        <Icon size={compact ? 20 : 32} strokeWidth={1.5} />
      </span>
      <div className="empty__title">{title}</div>
      {text && <div className="empty__text">{text}</div>}
      {action && (
        <Button variant="primary" icon={action.icon} onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}

export interface ProgressPart {
  value: number;
  tone: 'ok' | 'info' | 'bad' | 'warn';
  live?: boolean;
}

/** Сегментный прогресс: готово / в работе / проблемы / остальное. */
export function ProgressBar({ total, parts, label }: { total: number; parts: ProgressPart[]; label: string }) {
  const done = parts.find((p) => p.tone === 'ok')?.value ?? 0;
  return (
    <div className="progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
      {parts
        .filter((p) => p.value > 0)
        .map((p, i) => (
          <span key={i} className={`progress__seg progress__seg--${p.tone} ${p.live ? 'progress__seg--live' : ''}`} style={{ width: `${(p.value / Math.max(1, total)) * 100}%` }} />
        ))}
    </div>
  );
}

export function Skeleton({ lines = 3, height = 16 }: { lines?: number; height?: number }) {
  return (
    <div className="skeleton" aria-busy="true" aria-label="Загрузка">
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} className="skeleton__line" style={{ height, width: `${92 - ((i * 17) % 40)}%` }} />
      ))}
    </div>
  );
}

export function Callout({ tone = 'info', icon: Icon, children, action }: { tone?: 'info' | 'warn' | 'bad' | 'ok'; icon: LucideIcon; children: ReactNode; action?: ReactNode }) {
  return (
    <div className={`callout callout--${tone}`}>
      <Icon size={16} strokeWidth={1.75} aria-hidden className="callout__icon" />
      <div className="callout__body">{children}</div>
      {action}
    </div>
  );
}
