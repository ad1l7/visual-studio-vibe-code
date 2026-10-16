import { CircleX, Plus, X } from 'lucide-react';
import { useId, useLayoutEffect, useRef, useState, type InputHTMLAttributes, type ReactNode, type Ref, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

export function Field({ label, hint, error, children, htmlFor, className }: { label?: ReactNode; hint?: ReactNode; error?: string | null; children: ReactNode; htmlFor?: string; className?: string }) {
  return (
    <div className={['field', className].filter(Boolean).join(' ')}>
      {label && (
        <label className="field__label" htmlFor={htmlFor}>
          {label}
        </label>
      )}
      {children}
      {error ? (
        <div className="field__error" id={htmlFor ? `${htmlFor}-err` : undefined}>
          <CircleX size={14} strokeWidth={1.75} aria-hidden /> {error}
        </div>
      ) : (
        hint && <div className="field__hint">{hint}</div>
      )}
    </div>
  );
}

export function Input({ className, invalid, mono, ref, ...rest }: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean; mono?: boolean; ref?: Ref<HTMLInputElement> }) {
  return <input ref={ref} className={['input', mono && 'mono', invalid && 'input--invalid', className].filter(Boolean).join(' ')} aria-invalid={invalid || undefined} {...rest} />;
}

export function Textarea({ className, autoGrow, minHeight = 0, maxHeight = 520, ref, value, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { autoGrow?: boolean; minHeight?: number; maxHeight?: number; ref?: Ref<HTMLTextAreaElement> }) {
  const inner = useRef<HTMLTextAreaElement | null>(null);
  useLayoutEffect(() => {
    const el = inner.current;
    if (!autoGrow || !el) return;
    el.style.height = 'auto';
    const h = Math.min(maxHeight, Math.max(minHeight, el.scrollHeight + 2));
    el.style.height = `${h}px`;
    el.style.overflowY = el.scrollHeight + 2 > maxHeight ? 'auto' : 'hidden';
  }, [value, autoGrow, minHeight, maxHeight]);
  return (
    <textarea
      ref={(el) => {
        inner.current = el;
        if (typeof ref === 'function') ref(el);
        else if (ref) (ref as { current: HTMLTextAreaElement | null }).current = el;
      }}
      className={['input', 'textarea', className].filter(Boolean).join(' ')}
      value={value}
      {...rest}
    />
  );
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={['input', 'select', className].filter(Boolean).join(' ')} {...rest}>
      {children}
    </select>
  );
}

export function Checkbox({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode; disabled?: boolean }) {
  return (
    <label className={`checkbox ${disabled ? 'checkbox--disabled' : ''}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="checkbox__box" aria-hidden />
      <span className="checkbox__text">
        {label}
        {hint && <span className="checkbox__hint">{hint}</span>}
      </span>
    </label>
  );
}

export function Switch({ checked, onChange, label, size = 'md', disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; size?: 'sm' | 'md'; disabled?: boolean }) {
  return (
    <label className={`switch switch--${size} ${disabled ? 'switch--disabled' : ''}`}>
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch__track" aria-hidden>
        <span className="switch__thumb" />
      </span>
      <span className="switch__label">{label}</span>
    </label>
  );
}

export interface SegmentOption<T extends string | number> {
  value: T;
  label: ReactNode;
  tip?: string;
  /** Подпись для скринридера, если label — иконка. */
  aria?: string;
}

export function Segmented<T extends string | number>({ value, onChange, options, label, size = 'md', className }: { value: T; onChange: (v: T) => void; options: SegmentOption<T>[]; label: string; size?: 'sm' | 'md'; className?: string }) {
  return (
    <div
      className={['segmented', `segmented--${size}`, className].filter(Boolean).join(' ')}
      role="radiogroup"
      aria-label={label}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        e.preventDefault();
        const i = options.findIndex((o) => o.value === value);
        const next = options[(i + (e.key === 'ArrowRight' ? 1 : -1) + options.length) % options.length]!;
        onChange(next.value);
        requestAnimationFrame(() => (e.currentTarget.querySelector('[aria-checked="true"]') as HTMLElement | null)?.focus());
      }}
    >
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          aria-label={o.aria}
          tabIndex={o.value === value ? 0 : -1}
          className="segmented__item"
          data-tip={o.tip}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Список строк с добавлением и удалением (критерии готовности, папки). */
export function ListEditor({ items, onChange, placeholder, addLabel, mono, chips, label, disabled }: { items: string[]; onChange: (v: string[]) => void; placeholder: string; addLabel: string; mono?: boolean; chips?: boolean; label: string; disabled?: boolean }) {
  const [text, setText] = useState('');
  const id = useId();
  const add = () => {
    const v = text.trim();
    if (!v) return;
    onChange([...items, v]);
    setText('');
  };
  return (
    <div className={`list-editor ${chips ? 'list-editor--chips' : ''}`} role="group" aria-label={label}>
      {items.length > 0 && (
        <ul className="list-editor__items">
          {items.map((it, i) => (
            <li key={`${i}-${it}`} className={`list-editor__item ${mono ? 'mono' : ''}`}>
              <span className="list-editor__text">{it}</span>
              {!disabled && (
                <button type="button" className="list-editor__remove" aria-label={`Удалить: ${it}`} data-tip="Удалить" onClick={() => onChange(items.filter((_, j) => j !== i))}>
                  <X size={14} strokeWidth={1.75} aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!disabled && (
        <div className="list-editor__add">
          <Plus size={14} strokeWidth={1.75} aria-hidden className="list-editor__plus" />
          <input
            id={id}
            className={`input input--bare ${mono ? 'mono' : ''}`}
            value={text}
            placeholder={placeholder}
            aria-label={addLabel}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
                e.preventDefault();
                add();
              } else if (e.key === 'Backspace' && !text && items.length && chips) {
                onChange(items.slice(0, -1));
              }
            }}
            onBlur={add}
          />
        </div>
      )}
    </div>
  );
}
