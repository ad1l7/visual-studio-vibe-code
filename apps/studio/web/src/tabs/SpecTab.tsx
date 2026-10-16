import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useState } from 'react';
import { api, projectUrl, type ClarifyQuestion, type EngineChoice, type Plan } from '../api.ts';
import type { ProjectHook } from '../App.tsx';
import { ActionBar } from '../shell/ActionBar.tsx';

const EXAMPLE = `Хочу сайт для небольшой кофейни: меню с фото и ценами, онлайн-заказ с самовывозом ко времени, личный кабинет с историей заказов и бонусами. Админка для бариста: принимать заказы, менять меню. Оплата картой онлайн.`;

export function SpecTab({ project, choice, onPlanned }: { project: ProjectHook; choice: EngineChoice; onPlanned: () => void }) {
  const { details, plannerLog, clearPlannerLog, setPlan, setSpec } = project;
  const [spec, setLocalSpec] = useState(details?.spec ?? '');
  const [questions, setQuestions] = useState<ClarifyQuestion[] | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<null | 'clarify' | 'plan'>(null);
  const [error, setError] = useState<string | null>(null);
  const name = details!.name;
  const body = { spec, engine: choice.engine, model: choice.model };

  const makePlan = async (qs: ClarifyQuestion[] = [], ans: Record<string, string> = {}) => {
    setBusy('plan');
    clearPlannerLog();
    try {
      const { plan } = await api<{ plan: Plan }>(projectUrl(name, '/plan'), { body: { ...body, questions: qs, answers: ans } });
      setPlan(plan);
      setSpec(spec);
      setQuestions(null);
      onPlanned();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const start = async () => {
    setError(null);
    setBusy('clarify');
    clearPlannerLog();
    try {
      const { questions: qs } = await api<{ questions: ClarifyQuestion[] }>(projectUrl(name, '/clarify'), { body });
      if (!qs.length) return void (await makePlan());
      setQuestions(qs);
      setAnswers({});
      setBusy(null);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  };

  return (
    <div className="spec">
      <div className="section-head">
        <h2>Что нужно сделать?</h2>
        <p className="muted">Пишите своими словами, как объясняли бы знакомому разработчику: для кого продукт, что в нём можно делать, что важно.</p>
      </div>
      <textarea
        className="spec-input"
        value={spec}
        onChange={(e) => setLocalSpec(e.target.value)}
        placeholder={EXAMPLE}
        disabled={!!busy || !!questions}
        aria-label="Техническое задание"
      />
      {!questions && !spec.trim() && (
        <div className="row">
          <button className="ghost" onClick={() => setLocalSpec(EXAMPLE)}>
            Вставить пример
          </button>
        </div>
      )}
      {questions ? (
        <ActionBar
          hint={busy ? 'Проектирую систему…' : `Отвечено ${questions.filter((q) => answers[q.id]?.trim()).length} из ${questions.length} · можно пропустить`}
          hintTone={busy ? 'busy' : undefined}
          secondary={[{ label: 'Пропустить вопросы', onClick: () => void makePlan(), disabled: !!busy }]}
          primary={{ label: 'Составить план', iconRight: ArrowRight, onClick: () => void makePlan(questions, answers), disabled: !!busy, hotkey: 'mod+enter' }}
        />
      ) : (
        <ActionBar
          hint={busy ? (busy === 'clarify' ? 'Изучаю ТЗ…' : 'Проектирую систему…') : details?.plan ? 'План уже составлен. Новый план заменит текущий' : 'Опишите идею своими словами или выберите шаблон'}
          hintTone={busy ? 'busy' : undefined}
          secondary={[{ label: 'Сразу составить план', onClick: () => void makePlan(), disabled: !spec.trim() || !!busy, tip: 'Студия сама примет решения по неясным местам' }]}
          primary={{ label: details?.plan ? 'Пересобрать план' : 'Подобрать команду', iconRight: ArrowRight, onClick: () => void start(), disabled: !spec.trim() || !!busy, disabledReason: busy ? undefined : 'Напишите хотя бы пару предложений', hotkey: 'mod+enter' }}
        />
      )}

      {questions && (
        <div className="questions">
          <h3>Пара уточнений — от них зависит архитектура</h3>
          {questions.map((q) => (
            <div key={q.id} className="question">
              <div className="q-title">{q.question}</div>
              {q.why && <div className="muted small">{q.why}</div>}
              <div className="chips">
                {q.options.map((o) => (
                  <button key={o} className={`chip ${answers[q.id] === o ? 'selected' : ''}`} onClick={() => setAnswers({ ...answers, [q.id]: o })} disabled={!!busy}>
                    {o}
                  </button>
                ))}
              </div>
              <input value={answers[q.id] ?? ''} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })} placeholder="Свой ответ" disabled={!!busy} />
            </div>
          ))}
          <div className="row">
            <button className="ghost" onClick={() => setQuestions(null)} disabled={!!busy}>
              <ArrowLeft size={16} aria-hidden /> Изменить ТЗ
            </button>
          </div>
        </div>
      )}

      {busy && (
        <div className="planner-working">
          <div className="spinner" />
          <div>
            <strong>{busy === 'clarify' ? 'Изучаю ТЗ…' : 'Проектирую систему и собираю команду агентов…'}</strong>
            <div className="muted small">Обычно это занимает от 30 секунд до пары минут.</div>
            {plannerLog.slice(-4).map((l, i) => (
              <div key={i} className="muted small mono">… {l}</div>
            ))}
          </div>
        </div>
      )}
      {error && <div className="error">{error}</div>}
    </div>
  );
}
