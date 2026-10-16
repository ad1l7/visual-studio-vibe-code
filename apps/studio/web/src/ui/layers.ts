// Стек открытых слоёв (палитра, поповер, шторка, диалог): Esc закрывает верхний.
import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';

interface Layer {
  id: number;
  close: () => void;
  modal: boolean;
}

const stack: Layer[] = [];
let seq = 0;
let installed = false;

function install() {
  if (installed) return;
  installed = true;
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Escape' || !stack.length) return;
      e.preventDefault();
      e.stopPropagation();
      stack[stack.length - 1]!.close();
    },
    true,
  );
}

/** Регистрирует слой, пока он открыт. */
export function useLayer(open: boolean, onClose: () => void, modal = false) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    install();
    const layer: Layer = { id: ++seq, close: () => close.current(), modal };
    stack.push(layer);
    return () => {
      const i = stack.findIndex((l) => l.id === layer.id);
      if (i >= 0) stack.splice(i, 1);
    };
  }, [open, modal]);
}

export const hasOpenLayer = () => stack.length > 0;
export const hasModalLayer = () => stack.some((l) => l.modal);

const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null);
}

/** Удерживает Tab внутри элемента. */
export function trapTab(e: KeyboardEvent | ReactKeyboardEvent, root: HTMLElement | null) {
  if (e.key !== 'Tab' || !root) return;
  const list = focusables(root);
  if (!list.length) return;
  const first = list[0]!;
  const last = list[list.length - 1]!;
  const active = document.activeElement;
  if (e.shiftKey && (active === first || !root.contains(active))) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
}

export type Placement = 'top' | 'bottom' | 'left' | 'right';
export type Align = 'start' | 'center' | 'end';

/** Позиция плавающего элемента у якоря: с переворотом и прижатием к краям окна. */
export function place(anchor: DOMRect, pop: { width: number; height: number }, placement: Placement, align: Align = 'start', gap = 6) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const m = 8;
  let side = placement;
  if (side === 'bottom' && anchor.bottom + gap + pop.height > vh - m && anchor.top - gap - pop.height > m) side = 'top';
  else if (side === 'top' && anchor.top - gap - pop.height < m && anchor.bottom + gap + pop.height < vh - m) side = 'bottom';
  else if (side === 'right' && anchor.right + gap + pop.width > vw - m) side = 'left';
  else if (side === 'left' && anchor.left - gap - pop.width < m) side = 'right';
  let top: number;
  let left: number;
  if (side === 'top' || side === 'bottom') {
    top = side === 'bottom' ? anchor.bottom + gap : anchor.top - gap - pop.height;
    left = align === 'start' ? anchor.left : align === 'end' ? anchor.right - pop.width : anchor.left + anchor.width / 2 - pop.width / 2;
  } else {
    left = side === 'right' ? anchor.right + gap : anchor.left - gap - pop.width;
    top = align === 'start' ? anchor.top : align === 'end' ? anchor.bottom - pop.height : anchor.top + anchor.height / 2 - pop.height / 2;
  }
  left = Math.min(Math.max(m, left), Math.max(m, vw - m - pop.width));
  top = Math.min(Math.max(m, top), Math.max(m, vh - m - pop.height));
  return { top, left, side };
}
