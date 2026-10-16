// Глобальные горячие клавиши. Комбинация: 'mod+k', 'mod+enter', 'alt+1', 'j', '?', 'shift+/'.
import { useEffect, useRef } from 'react';
import { hasModalLayer } from '../ui/layers.ts';

export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable;
}

export function matches(e: KeyboardEvent, combo: string): boolean {
  const parts = combo.toLowerCase().split('+');
  const key = parts.pop()!;
  const mod = parts.includes('mod');
  const alt = parts.includes('alt');
  const shift = parts.includes('shift');
  if (mod !== (e.ctrlKey || e.metaKey)) return false;
  if (alt !== e.altKey) return false;
  if (shift && !e.shiftKey) return false;
  const k = e.key.toLowerCase();
  if (key === 'enter') return k === 'enter';
  if (/^[0-9]$/.test(key)) return e.code === `Digit${key}` || k === key;
  if (key.length === 1 && /[a-z]/.test(key)) return e.code === `Key${key.toUpperCase()}` || k === key;
  return k === key;
}

interface Options {
  /** Срабатывать и в полях ввода (для сочетаний с Ctrl/Alt). */
  inInputs?: boolean;
  enabled?: boolean;
  /** Срабатывать, даже когда открыт модальный слой (палитра, диалог). */
  overLayers?: boolean;
}

/** Подписка на сочетание; обработчик всегда актуальный. */
export function useHotkey(combo: string | string[], handler: (e: KeyboardEvent) => void, { inInputs = false, enabled = true, overLayers = false }: Options = {}) {
  const ref = useRef(handler);
  ref.current = handler;
  const key = Array.isArray(combo) ? combo.join('|') : combo;
  useEffect(() => {
    if (!enabled) return;
    const combos = key.split('|');
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      if (!inInputs && isTyping(e.target)) return;
      if (!overLayers && hasModalLayer()) return;
      if (!combos.some((c) => matches(e, c))) return;
      ref.current(e);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [key, inInputs, enabled, overLayers]);
}
