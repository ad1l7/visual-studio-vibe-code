import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, type EngineChoice, type EngineInfo, type ProjectSummary } from '../api.ts';
import { readLS, writeLS } from '../lib/storage.ts';
import type { ProjectStep } from '../labels.ts';

/* ── Список проектов: при старте, при возврате на вкладку и каждые 15 с, пока кто-то работает ── */

interface ProjectsValue {
  projects: ProjectSummary[] | null;
  error: string | null;
  refresh: () => void;
}

const ProjectsContext = createContext<ProjectsValue>({ projects: null, error: null, refresh: () => {} });
export const useProjects = () => useContext(ProjectsContext);

export function ProjectsProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(() => {
    api<ProjectSummary[]>('/api/projects').then(
      (list) => {
        setProjects(list);
        setError(null);
      },
      (e: Error) => setError(e.message),
    );
  }, []);
  useEffect(() => {
    refresh();
    const onVis = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [refresh]);
  const anyRunning = !!projects?.some((p) => p.running);
  useEffect(() => {
    if (!anyRunning) return;
    const t = setInterval(refresh, 15_000);
    return () => clearInterval(t);
  }, [anyRunning, refresh]);
  return <ProjectsContext.Provider value={{ projects, error, refresh }}>{children}</ProjectsContext.Provider>;
}

/* ── Движок и модель ── */

interface EngineValue {
  engines: EngineInfo[];
  choice: EngineChoice;
  setChoice: (c: EngineChoice) => void;
  current?: EngineInfo;
}

const EngineContext = createContext<EngineValue>({ engines: [], choice: { engine: 'claude-code', model: '' }, setChoice: () => {} });
export const useEngine = () => useContext(EngineContext);

export function EngineProvider({ children }: { children: ReactNode }) {
  const [engines, setEngines] = useState<EngineInfo[]>([]);
  const [choice, setChoiceState] = useState<EngineChoice>(() => {
    const c = readLS<EngineChoice | null>('vibe.engine', null);
    return c && typeof c.engine === 'string' ? { engine: c.engine, model: c.model ?? '' } : { engine: 'claude-code', model: '' };
  });
  useEffect(() => {
    api<EngineInfo[]>('/api/engines').then(
      (list) => {
        setEngines(list);
        // Если Claude Code не установлен — по умолчанию демо-режим.
        setChoiceState((c) => (list.find((e) => e.id === c.engine)?.available ? c : { ...c, engine: list.find((e) => e.available)?.id ?? c.engine }));
      },
      () => {},
    );
  }, []);
  useEffect(() => writeLS('vibe.engine', choice), [choice]);
  return <EngineContext.Provider value={{ engines, choice, setChoice: setChoiceState, current: engines.find((e) => e.id === choice.engine) }}>{children}</EngineContext.Provider>;
}

/* ── Навигация ── */

export interface Route {
  project?: string;
  tab: ProjectStep;
}

export interface NavValue {
  route: Route;
  /** Перейти (с проверкой несохранённых правок). file — открыть файл на шаге «Результат». */
  go: (project?: string, tab?: ProjectStep, opts?: { file?: string; newProject?: boolean }) => void;
  /** Запрошенный файл для шага «Результат» (одноразово). */
  pendingFile: string | null;
  takePendingFile: () => string | null;
  newProjectTick: number;
  openMenu: () => void;
  openEngineDialog: () => void;
  setGuard: (g: Guard | null) => void;
}

export const NavContext = createContext<NavValue | null>(null);
export function useNav(): NavValue {
  const v = useContext(NavContext);
  if (!v) throw new Error('NavContext');
  return v;
}

/** Проверка ухода со страницы: экран регистрирует функцию, которая может придержать переход. */
export type Guard = (next: Route, proceed: () => void) => boolean;
