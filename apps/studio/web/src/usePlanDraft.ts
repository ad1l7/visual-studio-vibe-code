// Черновик плана живёт на уровне проекта: правки переживают переключение шагов.
import { useCallback, useEffect, useState } from 'react';
import { api, projectUrl, type Plan } from './api.ts';
import type { ProjectHook } from './App.tsx';
import { useToast } from './ui/toast.tsx';

export interface PlanDraft {
  draft: Plan | null;
  dirty: boolean;
  saving: boolean;
  update: (p: Plan) => void;
  save: (opts?: { quiet?: boolean }) => Promise<boolean>;
  reset: () => void;
}

export function usePlanDraft(project: ProjectHook): PlanDraft {
  const { details, setPlan } = project;
  const saved = details?.plan ?? null;
  const [draft, setDraft] = useState<Plan | null>(saved);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  // Новый план с сервера (составлен заново или сохранён) — подхватываем, если нет своих правок.
  useEffect(() => {
    if (!dirty) setDraft(saved);
  }, [saved, dirty]);

  const update = useCallback((p: Plan) => {
    setDraft(p);
    setDirty(true);
  }, []);

  const save = useCallback(
    async ({ quiet = false } = {}) => {
      if (!details || !draft) return false;
      setSaving(true);
      try {
        const { plan } = await api<{ plan: Plan }>(projectUrl(details.name, '/plan'), { method: 'PUT', body: { plan: draft } });
        setPlan(plan);
        setDraft(plan);
        setDirty(false);
        if (!quiet) toast({ tone: 'success', title: 'План сохранён' });
        return true;
      } catch (e) {
        toast({ tone: 'error', title: 'Не получилось сохранить план', text: (e as Error).message });
        return false;
      } finally {
        setSaving(false);
      }
    },
    [details, draft, setPlan, toast],
  );

  const reset = useCallback(() => {
    setDraft(saved);
    setDirty(false);
  }, [saved]);

  return { draft, dirty, saving, update, save, reset };
}
