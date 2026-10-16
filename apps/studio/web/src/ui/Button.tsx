import type { LucideIcon } from 'lucide-react';
import { LoaderCircle } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-outline';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'disabled'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  iconRight?: LucideIcon;
  /** Иконка с заливкой (например, «Остановить» — квадрат). */
  iconFill?: boolean;
  /** Кнопка остаётся фокусируемой (aria-disabled), клик игнорируется. */
  disabled?: boolean;
  loading?: boolean;
  /** Текст тултипа (и причина блокировки). */
  tip?: string;
  block?: boolean;
  ref?: Ref<HTMLButtonElement>;
  children?: ReactNode;
}

const ICON = { sm: 14, md: 16, lg: 16 } as const;

export function Button({ variant = 'secondary', size = 'md', icon: Icon, iconRight: IconRight, iconFill, disabled, loading, tip, block, className, onClick, children, type = 'button', ref, ...rest }: ButtonProps) {
  const off = disabled || loading;
  return (
    <button
      ref={ref}
      type={type}
      className={['btn', `btn--${variant}`, `btn--${size}`, block && 'btn--block', className].filter(Boolean).join(' ')}
      aria-disabled={off || undefined}
      data-tip={tip}
      onClick={(e) => {
        if (off) {
          e.preventDefault();
          return;
        }
        onClick?.(e);
      }}
      {...rest}
    >
      {loading ? (
        <LoaderCircle size={ICON[size]} strokeWidth={1.75} className="spin" aria-hidden />
      ) : (
        Icon && <Icon size={ICON[size]} strokeWidth={1.75} aria-hidden fill={iconFill ? 'currentColor' : 'none'} />
      )}
      {children !== undefined && children !== null && children !== false && <span className="btn__label">{children}</span>}
      {IconRight && <IconRight size={ICON[size]} strokeWidth={1.75} aria-hidden />}
    </button>
  );
}

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'disabled' | 'children'> {
  icon: LucideIcon;
  /** Обязательная подпись: и aria-label, и тултип. */
  label: string;
  size?: ButtonSize;
  variant?: 'ghost' | 'secondary' | 'danger-ghost';
  disabled?: boolean;
  /** Не показывать тултип (например, если подпись видна рядом). */
  noTip?: boolean;
  pressed?: boolean;
  iconSize?: number;
  ref?: Ref<HTMLButtonElement>;
  children?: ReactNode;
}

export function IconButton({ icon: Icon, label, size = 'md', variant = 'ghost', disabled, noTip, pressed, iconSize, className, onClick, type = 'button', ref, children, ...rest }: IconButtonProps) {
  return (
    <button
      ref={ref}
      type={type}
      className={['icon-btn', `icon-btn--${size}`, `icon-btn--${variant}`, className].filter(Boolean).join(' ')}
      aria-label={label}
      aria-disabled={disabled || undefined}
      aria-pressed={pressed}
      data-tip={noTip ? undefined : label}
      onClick={(e) => {
        if (disabled) {
          e.preventDefault();
          return;
        }
        onClick?.(e);
      }}
      {...rest}
    >
      <Icon size={iconSize ?? (size === 'sm' ? 14 : 16)} strokeWidth={1.75} aria-hidden />
      {children}
    </button>
  );
}
