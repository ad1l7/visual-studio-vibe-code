import { CircleCheck, CircleX, Info, TriangleAlert, X } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export type ToastTone = 'success' | 'info' | 'error' | 'warn';

export interface ToastInput {
  tone?: ToastTone;
  title: string;
  text?: string;
  action?: { label: string; onClick: () => void };
  /** мс; по умолчанию 4 с, для ошибок 8 с. */
  duration?: number;
}

interface ToastItem extends ToastInput {
  id: number;
}

const ToastContext = createContext<(t: ToastInput) => void>(() => {});

export const useToast = () => useContext(ToastContext);

const ICONS = { success: CircleCheck, info: Info, error: CircleX, warn: TriangleAlert } as const;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const push = useCallback((t: ToastInput) => {
    const id = ++seq.current;
    setItems((list) => [...list.filter((x) => x.title !== t.title || x.text !== t.text), { ...t, id }].slice(-3));
  }, []);
  const remove = useCallback((id: number) => setItems((list) => list.filter((t) => t.id !== id)), []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      {createPortal(
        <div className="toasts" aria-live="polite">
          {items.map((t) => (
            <Toast key={t.id} toast={t} onClose={() => remove(t.id)} />
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

function Toast({ toast: t, onClose }: { toast: ToastItem; onClose: () => void }) {
  const tone = t.tone ?? 'info';
  const Icon = ICONS[tone];
  const [paused, setPaused] = useState(false);
  const left = useRef(t.duration ?? (tone === 'error' ? 8000 : 4000));
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (paused) return;
    const started = Date.now();
    const timer = setTimeout(() => close.current(), left.current);
    return () => {
      clearTimeout(timer);
      left.current -= Date.now() - started;
    };
  }, [paused]);
  const body = useMemo(
    () => (
      <>
        <Icon size={16} strokeWidth={1.75} className={`toast__icon toast__icon--${tone}`} aria-hidden />
        <div className="toast__main">
          <div className="toast__title">{t.title}</div>
          {t.text && <div className="toast__text">{t.text}</div>}
          {t.action && (
            <button
              type="button"
              className="toast__action"
              onClick={() => {
                t.action!.onClick();
                onClose();
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      </>
    ),
    [t, tone, Icon, onClose],
  );
  return (
    <div className={`toast toast--${tone}`} role={tone === 'error' ? 'alert' : 'status'} onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
      {body}
      <button type="button" className="toast__close" aria-label="Закрыть уведомление" onClick={onClose}>
        <X size={14} strokeWidth={1.75} aria-hidden />
      </button>
    </div>
  );
}
