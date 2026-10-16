// Состояние шага «ТЗ» на уровне проекта: текст, вопросы и работа планировщика
// переживают переключение шагов. Черновик текста — в localStorage.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, projectUrl, type ClarifyQuestion, type EngineChoice, type Plan } from './api.ts';
import type { ProjectHook } from './App.tsx';
import { readLS, removeLS, writeLS } from './lib/storage.ts';
import { useToast } from './ui/toast.tsx';

export type PlannerBusy = null | 'clarify' | 'plan';

export interface SpecFlow {
  spec: string;
  setSpec: (v: string) => void;
  /** Черновик отличается от сохранённой на сервере версии. */
  draftDiffers: boolean;
  revertToSaved: () => void;
  /** Нужно показать тост «Восстановлен черновик ТЗ» (один раз). */
  takeRestoredNotice: () => boolean;
  questions: ClarifyQuestion[] | null;
  answers: Record<string, string>;
  setAnswer: (id: string, value: string) => void;
  editSpec: () => void;
  busy: PlannerBusy;
  busyStartedAt: number;
  error: string | null;
  clarify: () => Promise<void>;
  makePlan: (withAnswers: boolean) => Promise<void>;
}

const key = (name: string) => `vibe.spec.${name}`;

export function useSpecFlow(project: ProjectHook, { name, choice, isOnSpec, onPlanned, openPlan }: { name: string; choice: EngineChoice; isOnSpec: () => boolean; onPlanned: () => void; openPlan: () => void }): SpecFlow {
  const { details, setPlan, setSpec: setServerSpec, clearPlannerLog } = project;
  const toast = useToast();
  const [spec, setSpecState] = useState('');
  const [inited, setInited] = useState(false);
  const [draftDiffers, setDraftDiffers] = useState(false);
  const restored = useRef(false);
  const [questions, setQuestions] = useState<ClarifyQuestion[] | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<PlannerBusy>(null);
  const [busyStartedAt, setBusyStartedAt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => () => void (alive.current = false), []);

  // Первичная загрузка: черновик из localStorage важнее, если он есть.
  useEffect(() => {
    if (!details || inited) return;
    const draft = readLS<string | null>(key(name), null);
    const saved = details.spec ?? '';
    if (draft && !saved.trim()) {
      setSpecState(draft);
      restored.current = true;
    } else if (draft && draft !== saved) {
      setSpecState(draft);
      setDraftDiffers(true);
      restored.current = true;
    } else {
      setSpecState(saved);
    }
    setInited(true);
  }, [details, inited, name]);

  // Черновик пишем с задержкой 500 мс.
  useEffect(() => {
    if (!inited) return;
    const t = setTimeout(() => {
      const saved = details?.spec ?? '';
      if (spec === saved || !spec.trim()) removeLS(key(name));
      else writeLS(key(name), spec);
    }, 500);
    return () => clearTimeout(t);
  }, [spec, inited, name, details?.spec]);

  const setSpec = useCallback((v: string) => {
    setSpecState(v);
    setDraftDiffers(false);
  }, []);

  const revertToSaved = useCallback(() => {
    setSpecState(details?.spec ?? '');
    setDraftDiffers(false);
    removeLS(key(name));
  }, [details?.spec, name]);

  const body = () => ({ spec, engine: choice.engine, model: choice.model });

  const makePlan = async (withAnswers: boolean) => {
    const qs = withAnswers ? (questions ?? []) : [];
    const ans = withAnswers ? answers : {};
    setError(null);
    setBusy('plan');
    setBusyStartedAt(Date.now());
    clearPlannerLog();
    try {
      const { plan } = await api<{ plan: Plan }>(projectUrl(name, '/plan'), { body: { ...body(), questions: qs, answers: ans } });
      setPlan(plan);
      setServerSpec(spec);
      removeLS(key(name));
      setQuestions(null);
      setAnswers({});
      if (alive.current && isOnSpec()) onPlanned();
      else toast({ tone: 'success', title: 'План готов', text: `Команда: ${plan.agents.length} · задач: ${plan.tasks.length}`, action: { label: 'Открыть', onClick: openPlan } });
    } catch (e) {
      setError((e as Error).message);
      if (!isOnSpec()) toast({ tone: 'error', title: 'Не получилось составить план', text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const clarify = async () => {
    setError(null);
    setBusy('clarify');
    setBusyStartedAt(Date.now());
    clearPlannerLog();
    try {
      const { questions: qs } = await api<{ questions: ClarifyQuestion[] }>(projectUrl(name, '/clarify'), { body: body() });
      setServerSpec(spec);
      if (!qs.length) {
        setBusy(null);
        return void (await makePlan(false));
      }
      setQuestions(qs);
      setAnswers({});
      setBusy(null);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  };

  return {
    spec,
    setSpec,
    draftDiffers,
    revertToSaved,
    takeRestoredNotice: () => {
      const r = restored.current;
      restored.current = false;
      return r;
    },
    questions,
    answers,
    setAnswer: (id, value) => setAnswers((a) => ({ ...a, [id]: value })),
    editSpec: () => setQuestions(null),
    busy,
    busyStartedAt,
    error,
    clarify,
    makePlan,
  };
}
