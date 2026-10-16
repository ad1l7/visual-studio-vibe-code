import { reduce, type RunSnapshot } from '@vibe/core/shared';
import { useCallback, useEffect, useState } from 'react';
import { api, projectUrl, subscribeProject, type Plan, type ProjectDetails } from './api.ts';

/** Данные проекта + живые события запуска по SSE. */
export function useProject(name: string) {
  const [details, setDetails] = useState<ProjectDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<RunSnapshot | null>(null);
  const [running, setRunning] = useState(false);
  const [plannerLog, setPlannerLog] = useState<string[]>([]);

  const reload = useCallback(async () => {
    try {
      const d = await api<ProjectDetails>(projectUrl(name));
      setDetails(d);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [name]);

  useEffect(() => {
    void reload();
    return subscribeProject(name, (m) => {
      if (m.type === 'hello') {
        setSnapshot(m.snapshot);
        setRunning(m.running);
      } else if (m.type === 'run-event') {
        setSnapshot((s) => (s && s.runId ? reduce(s, m.event) : s));
        if (m.event.type === 'run') setRunning(m.event.status === 'running' || m.event.status === 'idle');
      } else if (m.type === 'planner') {
        setPlannerLog((l) => [...l.slice(-30), m.text]);
      }
    });
  }, [name, reload]);

  const setPlan = useCallback((plan: Plan | null) => setDetails((d) => (d ? { ...d, plan } : d)), []);
  const setSpec = useCallback((spec: string) => setDetails((d) => (d ? { ...d, spec } : d)), []);
  const clearPlannerLog = useCallback(() => setPlannerLog([]), []);

  return { details, error, snapshot, running, plannerLog, clearPlannerLog, setPlan, setSpec, reload };
}
