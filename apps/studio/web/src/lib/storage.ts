// Удобства одного пользователя в localStorage: каждое чтение и запись — в try/catch.
import { useCallback, useEffect, useState } from 'react';

export function readLS<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeLS(key: string, value: unknown) {
  try {
    if (value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // приватный режим или запрет хранилища — работаем с умолчаниями
  }
}

export function removeLS(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    // ничего
  }
}

const listeners = new Map<string, Set<(v: unknown) => void>>();

/** Значение из localStorage, общее для всех компонентов с тем же ключом. */
export function useLocalSetting<T>(key: string, fallback: T): [T, (v: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => readLS(key, fallback));
  useEffect(() => {
    const set = listeners.get(key) ?? new Set();
    listeners.set(key, set);
    const fn = (v: unknown) => setValue(v as T);
    set.add(fn);
    return () => void set.delete(fn);
  }, [key]);
  const update = useCallback(
    (v: T | ((prev: T) => T)) => {
      const next = typeof v === 'function' ? (v as (p: T) => T)(readLS(key, fallback)) : v;
      writeLS(key, next);
      for (const fn of listeners.get(key) ?? []) fn(next);
    },
    [key], // eslint-disable-line react-hooks/exhaustive-deps
  );
  return [value, update];
}

/** Название проекта, пока у него нет плана: то, что пользователь ввёл при создании. */
export function projectTitle(name: string, planName?: string | null): string {
  return planName || readLS<string | null>(`vibe.title.${name}`, null) || name;
}

export type ThemeSetting = 'system' | 'dark' | 'light';
export type DensitySetting = 'normal' | 'compact';

export function applyTheme(t: ThemeSetting) {
  const el = document.documentElement;
  if (t === 'system') delete el.dataset.theme;
  else el.dataset.theme = t;
}

export function applyDensity(d: DensitySetting) {
  const el = document.documentElement;
  if (d === 'compact') el.dataset.density = 'compact';
  else delete el.dataset.density;
}

export interface RunSettings {
  concurrency: number;
  maxAttempts: number;
  fullAccess: boolean;
}

export const DEFAULT_RUN_SETTINGS: RunSettings = { concurrency: 3, maxAttempts: 2, fullAccess: false };

export function useRunSettings() {
  const [s, set] = useLocalSetting<RunSettings>('vibe.runSettings', DEFAULT_RUN_SETTINGS);
  return [{ ...DEFAULT_RUN_SETTINGS, ...s }, set] as const;
}

export function runBody(s: RunSettings) {
  return { concurrency: s.concurrency, maxAttempts: s.maxAttempts, permissionMode: s.fullAccess ? 'bypassPermissions' : 'acceptEdits' };
}
