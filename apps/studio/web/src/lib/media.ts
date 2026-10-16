import { useSyncExternalStore } from 'react';

/** Совпадение медиа-запроса, с подпиской на изменения. */
export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(query);
      m.addEventListener('change', cb);
      return () => m.removeEventListener('change', cb);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

export const usePhone = () => useMedia('(max-width: 767px)');
/** < 1024: сайдбар становится выезжающей панелью. */
export const useNarrow = () => useMedia('(max-width: 1023px)');
/** ≥ 1280: широкий десктоп. */
export const useWide = () => useMedia('(min-width: 1280px)');
export const useHoverNone = () => useMedia('(hover: none)');
export const useReducedMotion = () => useMedia('(prefers-reduced-motion: reduce)');
