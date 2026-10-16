import type { LucideIcon } from 'lucide-react';
import { Check, X } from 'lucide-react';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type Ref } from 'react';
import { createPortal } from 'react-dom';
import { Button, IconButton } from './Button.tsx';
import { focusables, place, trapTab, useLayer, type Align, type Placement } from './layers.ts';

/* ───────────── Тултипы: один глобальный обработчик для всех [data-tip] ───────────── */

export function TooltipHost() {
  const [tip, setTip] = useState<{ text: string; rect: DOMRect } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const id = 'vs-tooltip';

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let current: HTMLElement | null = null;
    const hide = () => {
      clearTimeout(timer);
      if (current) current.removeAttribute('aria-describedby');
      current = null;
      setTip(null);
    };
    const show = (el: HTMLElement) => {
      const text = el.dataset.tip;
      if (!text) return;
      current = el;
      // Если подпись совпадает с aria-label, описание не дублируем.
      if (el.getAttribute('aria-label') !== text) el.setAttribute('aria-describedby', id);
      setTip({ text, rect: el.getBoundingClientRect() });
    };
    const onOver = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const el = (e.target as Element | null)?.closest?.('[data-tip]') as HTMLElement | null;
      if (el === current) return;
      hide();
      if (!el) return;
      timer = setTimeout(() => show(el), 400);
    };
    const onFocus = (e: FocusEvent) => {
      const el = (e.target as Element | null)?.closest?.('[data-tip]') as HTMLElement | null;
      hide();
      if (el && el.matches(':focus-visible')) show(el);
    };
    document.addEventListener('pointerover', onOver);
    document.addEventListener('focusin', onFocus);
    document.addEventListener('focusout', hide);
    document.addEventListener('pointerdown', hide);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('keydown', (e) => e.key === 'Escape' && hide());
    return () => {
      document.removeEventListener('pointerover', onOver);
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('focusout', hide);
      document.removeEventListener('pointerdown', hide);
      window.removeEventListener('scroll', hide, true);
    };
  }, []);

  useLayoutEffect(() => {
    if (!tip || !ref.current) return setPos(null);
    const r = ref.current.getBoundingClientRect();
    const p = place(tip.rect, { width: r.width, height: r.height }, 'top', 'center', 6);
    setPos({ top: p.top, left: p.left });
  }, [tip]);

  if (!tip) return null;
  return createPortal(
    <div ref={ref} id={id} role="tooltip" className="tooltip" style={pos ? { top: pos.top, left: pos.left } : { top: -999, left: -999, visibility: 'hidden' }}>
      {tip.text}
    </div>,
    document.body,
  );
}

/* ───────────── Поповер ───────────── */

export interface PopoverProps {
  open: boolean;
  onClose: () => void;
  anchor: HTMLElement | null;
  placement?: Placement;
  align?: Align;
  width?: number;
  className?: string;
  role?: 'dialog' | 'menu';
  label?: string;
  /** 'first' — фокус на первый элемент; 'none' — не трогать; иначе селектор. */
  initialFocus?: 'first' | 'none' | string;
  children: ReactNode;
}

export function Popover({ open, onClose, anchor, placement = 'bottom', align = 'start', width, className, role = 'dialog', label, initialFocus = 'first', children }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; side: Placement } | null>(null);
  useLayer(open, onClose);

  const update = useCallback(() => {
    if (!anchor || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPos(place(anchor.getBoundingClientRect(), { width: r.width, height: r.height }, placement, align));
  }, [anchor, placement, align]);

  useLayoutEffect(() => {
    if (!open) return setPos(null);
    update();
  }, [open, update]);

  useEffect(() => {
    if (!open) return;
    const ro = new ResizeObserver(update);
    if (ref.current) ro.observe(ref.current);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor?.contains(t)) return;
      // Клик внутри другого слоя поверх (например, вложенного поповера) не закрывает этот.
      if ((t as Element).closest?.('.popover, .tooltip')) return;
      onClose();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      document.removeEventListener('pointerdown', onDown, true);
    };
  }, [open, update, anchor, onClose]);

  // Фокус внутрь при открытии и обратно на якорь при закрытии.
  useEffect(() => {
    if (!open) return;
    const el = ref.current;
    if (el && initialFocus !== 'none') {
      const target = initialFocus === 'first' ? focusables(el)[0] : el.querySelector<HTMLElement>(initialFocus);
      (target ?? el).focus({ preventScroll: true });
    }
    return () => {
      if (anchor && document.activeElement && (el?.contains(document.activeElement) || document.activeElement === document.body)) anchor.focus({ preventScroll: true });
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;
  return createPortal(
    <div
      ref={ref}
      role={role}
      aria-label={label}
      tabIndex={-1}
      className={['popover', pos && `popover--${pos.side}`, className].filter(Boolean).join(' ')}
      style={{ width, top: pos?.top ?? -9999, left: pos?.left ?? -9999, visibility: pos ? undefined : 'hidden' } as CSSProperties}
    >
      {children}
    </div>,
    document.body,
  );
}

/** Состояние поповера, привязанного к кнопке. */
export function usePopover<T extends HTMLElement = HTMLButtonElement>() {
  const [anchor, setAnchor] = useState<T | null>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return { open, setOpen, close, anchor, ref: setAnchor as Ref<T>, toggle: () => setOpen((o) => !o) };
}

/* ───────────── Меню ───────────── */

export interface MenuItem {
  label: string;
  icon?: LucideIcon;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  hint?: string;
  /** Пункт-переключатель: показывает галочку. */
  checked?: boolean;
}

export function Menu({ items, open, onClose, anchor, placement = 'bottom', align = 'end', label }: { items: MenuItem[]; open: boolean; onClose: () => void; anchor: HTMLElement | null; placement?: Placement; align?: Align; label?: string }) {
  return (
    <Popover open={open} onClose={onClose} anchor={anchor} placement={placement} align={align} role="menu" label={label} className="menu">
      <div
        onKeyDown={(e) => {
          if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
          e.preventDefault();
          const list = [...e.currentTarget.querySelectorAll<HTMLElement>('[role^="menuitem"]')];
          const i = list.indexOf(document.activeElement as HTMLElement);
          list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]?.focus();
        }}
      >
        {items.map((it) => (
          <button
            key={it.label}
            type="button"
            role={it.checked === undefined ? 'menuitem' : 'menuitemradio'}
            aria-checked={it.checked}
            className={`menu__item ${it.danger ? 'menu__item--danger' : ''}`}
            aria-disabled={it.disabled || undefined}
            data-tip={it.disabled ? it.hint : undefined}
            onClick={() => {
              if (it.disabled) return;
              onClose();
              it.onClick();
            }}
          >
            {it.icon && <it.icon size={16} strokeWidth={1.75} aria-hidden />}
            <span className="grow">{it.label}</span>
            {it.checked && <Check size={16} strokeWidth={2} aria-hidden className="menu__check" />}
          </button>
        ))}
      </div>
    </Popover>
  );
}

/* ───────────── Подтверждение у кнопки ───────────── */

export interface ConfirmSpec {
  title: string;
  text?: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'primary' | 'danger';
  /** Дополнительная кнопка (например, «Добавить в конец»). */
  extra?: { label: string; onClick: () => void };
}

export function ConfirmLayer({ spec, open, onClose, anchor, onConfirm, placement = 'top', align = 'end' }: { spec: ConfirmSpec; open: boolean; onClose: () => void; anchor: HTMLElement | null; onConfirm: () => void; placement?: Placement; align?: Align }) {
  const titleId = useId();
  return (
    <Popover open={open} onClose={onClose} anchor={anchor} placement={placement} align={align} width={300} className="confirm" initialFocus="[data-safe]">
      <div role="alertdialog" aria-labelledby={titleId}>
        <div className="confirm__title" id={titleId}>{spec.title}</div>
        {spec.text && <p className="confirm__text">{spec.text}</p>}
        <div className="confirm__actions">
          {spec.extra && (
            <Button size="sm" variant="secondary" onClick={() => { onClose(); spec.extra!.onClick(); }}>
              {spec.extra.label}
            </Button>
          )}
          <Button size="sm" variant="ghost" data-safe onClick={onClose}>
            {spec.cancelLabel ?? 'Отмена'}
          </Button>
          <Button size="sm" variant={spec.tone === 'danger' ? 'danger' : 'primary'} onClick={() => { onClose(); onConfirm(); }}>
            {spec.confirmLabel}
          </Button>
        </div>
      </div>
    </Popover>
  );
}

export interface TriggerProps {
  ref: Ref<HTMLButtonElement>;
  onClick: () => void;
  'aria-haspopup': 'dialog';
  'aria-expanded': boolean;
}

/** Кнопка с подтверждением: <ConfirmPopover spec={…} onConfirm={…}>{(t) => <Button {...t}>Удалить</Button>}</ConfirmPopover> */
export function ConfirmPopover({ spec, onConfirm, children, placement, align, skip }: { spec: ConfirmSpec; onConfirm: () => void; children: (t: TriggerProps) => ReactNode; placement?: Placement; align?: Align; skip?: boolean }) {
  const p = usePopover();
  return (
    <>
      {children({ ref: p.ref as Ref<HTMLButtonElement>, onClick: () => (skip ? onConfirm() : p.toggle()), 'aria-haspopup': 'dialog', 'aria-expanded': p.open })}
      <ConfirmLayer spec={spec} open={p.open} onClose={p.close} anchor={p.anchor} onConfirm={onConfirm} placement={placement} align={align} />
    </>
  );
}

/* ───────────── Выезжающая панель ───────────── */

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  label: string;
  side?: 'right' | 'left' | 'bottom';
  /** С затемнением и удержанием фокуса (по умолчанию). */
  modal?: boolean;
  width?: number;
  title?: ReactNode;
  /** Своя шапка вместо заголовка. */
  header?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  /** Ctrl/⌘+Enter внутри панели. */
  onSubmit?: () => void;
  className?: string;
  /** Селектор элемента для фокуса при открытии. */
  initialFocus?: string;
  /** Не превращать в нижнюю шторку на телефоне. */
  keepSide?: boolean;
}

export function Drawer({ open, onClose, label, side = 'right', modal = true, width, title, header, footer, children, onSubmit, className, initialFocus, keepSide }: DrawerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useLayer(open, onClose, modal);

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const target = (initialFocus && el?.querySelector<HTMLElement>(initialFocus)) || el?.querySelector<HTMLElement>('[data-drawer-title]') || el;
    target?.focus({ preventScroll: true });
    return () => {
      if (prev && document.contains(prev)) prev.focus({ preventScroll: true });
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;
  const panel = (
    <div
      ref={ref}
      className={['drawer', `drawer--${side}`, keepSide && 'drawer--keep', !modal && 'drawer--inline', className].filter(Boolean).join(' ')}
      role={modal ? 'dialog' : 'complementary'}
      aria-modal={modal || undefined}
      aria-label={label}
      tabIndex={-1}
      style={width ? ({ '--drawer-w': `${width}px` } as CSSProperties) : undefined}
      onKeyDown={(e) => {
        if (modal) trapTab(e, ref.current);
        if (onSubmit && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          e.stopPropagation();
          onSubmit();
        }
      }}
    >
      <div className="drawer__handle" aria-hidden />
      {header ?? (
        <div className="drawer__head">
          <h2 className="drawer__title" id={titleId} tabIndex={-1} data-drawer-title>
            {title}
          </h2>
          <IconButton icon={X} label="Закрыть" onClick={onClose} />
        </div>
      )}
      <div className="drawer__body">{children}</div>
      {footer && <div className="drawer__foot">{footer}</div>}
    </div>
  );
  return createPortal(
    modal ? (
      <div className="drawer-root">
        <div className="overlay" onClick={onClose} aria-hidden />
        {panel}
      </div>
    ) : (
      panel
    ),
    document.body,
  );
}

/* ───────────── Диалог по центру ───────────── */

export function Dialog({ open, onClose, title, children, actions, width = 400 }: { open: boolean; onClose: () => void; title: string; children?: ReactNode; actions: ReactNode; width?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useLayer(open, onClose, true);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    (el?.querySelector<HTMLElement>('[data-autofocus]') ?? (el && focusables(el)[0]) ?? el)?.focus();
    return () => {
      if (prev && document.contains(prev)) prev.focus({ preventScroll: true });
    };
  }, [open]);
  if (!open) return null;
  return createPortal(
    <div className="dialog-root">
      <div className="overlay" onClick={onClose} aria-hidden />
      <div ref={ref} className="dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} style={{ width: `min(${width}px, calc(100vw - 32px))` }} tabIndex={-1} onKeyDown={(e) => trapTab(e, ref.current)}>
        <h2 className="dialog__title" id={titleId}>{title}</h2>
        {children && <div className="dialog__body">{children}</div>}
        <div className="dialog__actions">{actions}</div>
      </div>
    </div>,
    document.body,
  );
}
