// Панель действий внизу экрана: подсказка слева, до двух второстепенных кнопок и одна главная справа.
// Экран рендерит <ActionBar …/> где угодно — содержимое уходит порталом в слот оболочки.
import type { LucideIcon } from 'lucide-react';
import { Ellipsis, LoaderCircle } from 'lucide-react';
import { createContext, useContext, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useHotkey } from '../lib/hotkeys.ts';
import { usePhone } from '../lib/media.ts';
import { Button, IconButton } from '../ui/Button.tsx';
import { Keys } from '../ui/display.tsx';
import { ConfirmLayer, Menu, usePopover, type ConfirmSpec } from '../ui/overlay.tsx';

export interface Action {
  label: string;
  icon?: LucideIcon;
  iconRight?: LucideIcon;
  iconFill?: boolean;
  onClick: () => void;
  disabled?: boolean;
  disabledReason?: string;
  tone?: 'primary' | 'danger';
  confirm?: ConfirmSpec;
  tip?: string;
  loading?: boolean;
  /** Показывать сочетание клавиш рядом с подписью (только десктоп). */
  hotkey?: string;
}

export interface ActionBarProps {
  hint?: ReactNode;
  /** busy — спиннер слева; warn/bad — цветная точка. */
  hintTone?: 'busy' | 'warn' | 'bad' | 'ok';
  secondary?: Action[];
  primary?: Action;
}

export const ActionBarSlotContext = createContext<HTMLElement | null>(null);

export function ActionBar(props: ActionBarProps) {
  const slot = useContext(ActionBarSlotContext);
  if (!slot) return null;
  return createPortal(<ActionBarView {...props} />, slot);
}

function ActionBarView({ hint, hintTone, secondary = [], primary }: ActionBarProps) {
  const phone = usePhone();
  const primaryRef = useRef<HTMLButtonElement | null>(null);
  const reason = primary?.disabled && primary.disabledReason;
  const text = reason || hint;

  // Ctrl/⌘+Enter — главная кнопка (кроме «Остановить»), в том числе из полей ввода.
  useHotkey(
    'mod+enter',
    (e) => {
      if (!primary || primary.disabled || primary.loading || primary.tone === 'danger') return;
      e.preventDefault();
      primaryRef.current?.click();
    },
    { inInputs: true },
  );

  const inMenu = phone ? secondary.filter((a) => !a.icon) : [];
  const shown = phone ? secondary.filter((a) => a.icon) : secondary;

  return (
    <div className="actionbar" role="region" aria-label="Действия">
      <div className={`actionbar__hint ${hintTone ? `actionbar__hint--${hintTone}` : ''}`} aria-live="polite">
        {hintTone === 'busy' && <LoaderCircle size={16} strokeWidth={1.75} className="spin" aria-hidden />}
        {(hintTone === 'warn' || hintTone === 'bad' || hintTone === 'ok') && <span className={`dot dot--${hintTone === 'warn' ? 'stopped' : hintTone === 'bad' ? 'failed' : 'done'}`} aria-hidden />}
        {text && <span className="ellipsis" data-tip={typeof text === 'string' && text.length > 60 ? text : undefined}>{text}</span>}
      </div>
      <div className="actionbar__buttons">
        {inMenu.length > 0 && <MoreMenu actions={inMenu} />}
        {shown.map((a) => (
          <ActionButton key={a.label} action={a} iconOnly={phone} />
        ))}
        {primary && <ActionButton action={primary} main buttonRef={(el) => (primaryRef.current = el)} />}
      </div>
    </div>
  );
}

function ActionButton({ action: a, main, iconOnly, buttonRef }: { action: Action; main?: boolean; iconOnly?: boolean; buttonRef?: (el: HTMLButtonElement | null) => void }) {
  const p = usePopover();
  const setRef = (el: HTMLButtonElement | null) => {
    (p.ref as (el: HTMLButtonElement | null) => void)(el);
    buttonRef?.(el);
  };
  const onClick = () => (a.confirm ? p.toggle() : a.onClick());
  const tip = a.disabled ? a.disabledReason : a.tip;
  const variant = main ? (a.tone === 'danger' ? 'danger-outline' : 'primary') : a.tone === 'danger' ? 'danger-outline' : 'secondary';
  return (
    <>
      {iconOnly && a.icon && !main ? (
        <IconButton ref={setRef} icon={a.icon} label={a.label} size="lg" variant="secondary" disabled={a.disabled} onClick={onClick} aria-haspopup={a.confirm ? 'dialog' : undefined} />
      ) : (
        <Button
          ref={setRef}
          variant={variant}
          size={main ? 'lg' : 'md'}
          icon={a.icon}
          iconRight={a.iconRight}
          iconFill={a.iconFill}
          disabled={a.disabled}
          loading={a.loading}
          tip={tip}
          onClick={onClick}
          className={main ? 'actionbar__primary' : undefined}
          aria-haspopup={a.confirm ? 'dialog' : undefined}
          aria-expanded={a.confirm ? p.open : undefined}
        >
          {a.label}
          {main && a.hotkey && !a.disabled && (
            <span className="actionbar__kbd">
              <Keys combo={a.hotkey} />
            </span>
          )}
        </Button>
      )}
      {a.confirm && <ConfirmLayer spec={a.confirm} open={p.open} onClose={p.close} anchor={p.anchor} onConfirm={a.onClick} placement="top" align="end" />}
    </>
  );
}

function MoreMenu({ actions }: { actions: Action[] }) {
  const menu = usePopover();
  const [confirming, setConfirming] = useState<Action | null>(null);
  return (
    <>
      <IconButton ref={menu.ref} icon={Ellipsis} label="Ещё действия" size="lg" variant="secondary" onClick={menu.toggle} aria-haspopup="menu" aria-expanded={menu.open} />
      <Menu
        open={menu.open}
        onClose={menu.close}
        anchor={menu.anchor}
        placement="top"
        align="start"
        items={actions.map((a) => ({ label: a.label, icon: a.icon, disabled: a.disabled, hint: a.disabledReason, onClick: () => (a.confirm ? setConfirming(a) : a.onClick()) }))}
      />
      {confirming?.confirm && <ConfirmLayer spec={confirming.confirm} open onClose={() => setConfirming(null)} anchor={menu.anchor} onConfirm={confirming.onClick} placement="top" align="start" />}
    </>
  );
}
