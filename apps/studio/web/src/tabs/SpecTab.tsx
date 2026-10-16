import { ArrowRight, Check, ChevronDown, Circle, CircleCheck, CircleX, LoaderCircle, Pencil, Plus, Sparkles } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type Ref } from 'react';
import type { ClarifyQuestion } from '../api.ts';
import type { ProjectHook } from '../App.tsx';
import { formatClock } from '../labels.ts';
import { useNarrow } from '../lib/media.ts';
import { ActionBar, type Action } from '../shell/ActionBar.tsx';
import { useCommands } from '../shell/commands.tsx';
import { Button, IconButton } from '../ui/Button.tsx';
import { Callout, Chip } from '../ui/display.tsx';
import { Textarea } from '../ui/form.tsx';
import { ConfirmLayer, usePopover } from '../ui/overlay.tsx';
import { useToast } from '../ui/toast.tsx';
import { SPEC_CHECKS, SPEC_PLACEHOLDER, SPEC_TEMPLATES, specCompleteness, type SpecTemplate } from '../templates.ts';
import type { SpecFlow } from '../useSpecFlow.ts';

export function useNow(active: boolean, ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [active, ms]);
  return now;
}

const scrollOpts = (): ScrollIntoViewOptions => ({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });

export function SpecTab({ project, flow, goPlan }: { project: ProjectHook; flow: SpecFlow; goPlan: () => void }) {
  const { details, plannerLog } = project;
  const toast = useToast();
  const narrow = useNarrow();
  const { spec, setSpec, questions, busy } = flow;
  const textarea = useRef<HTMLTextAreaElement>(null);
  const plannerRef = useRef<HTMLDivElement>(null);
  const questionsRef = useRef<HTMLDivElement>(null);
  const hasPlan = !!details?.plan;
  const completeness = specCompleteness(spec);
  const now = useNow(!!busy);

  useEffect(() => {
    if (flow.takeRestoredNotice()) toast({ tone: 'info', title: 'Восстановлен черновик ТЗ' });
    if (!questions && !busy) textarea.current?.focus({ preventScroll: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Индикатор планировщика и вопросы всегда оказываются в поле зрения.
  useLayoutEffect(() => {
    if (busy) plannerRef.current?.scrollIntoView(scrollOpts());
  }, [busy]);
  useLayoutEffect(() => {
    if (!questions || busy) return;
    questionsRef.current?.scrollIntoView(scrollOpts());
    questionsRef.current?.querySelector<HTMLElement>('.chip')?.focus({ preventScroll: true });
  }, [questions, busy]);

  // Выделение после вставки ставим синхронно с новым текстом — до того, как пользователь начнёт печатать.
  const pendingSel = useRef<[number, number] | null>(null);
  useLayoutEffect(() => {
    const el = textarea.current;
    const sel = pendingSel.current;
    if (!el || !sel) return;
    pendingSel.current = null;
    el.focus();
    el.setSelectionRange(sel[0], sel[1]);
  }, [spec]);

  const insertTemplate = (t: SpecTemplate, mode: 'replace' | 'append') => {
    const next = mode === 'replace' ? t.text : `${spec.trimEnd()}\n\n${t.text}`;
    const offset = mode === 'replace' ? 0 : next.length - t.text.length;
    const m = t.text.match(/\[[^\]]+\]/);
    pendingSel.current = m && m.index !== undefined ? [offset + m.index, offset + m.index + m[0].length] : [next.length, next.length];
    setSpec(next);
  };

  const appendHint = (text: string) => {
    const next = `${spec.replace(/\s+$/, '')}${text}`;
    pendingSel.current = [next.length, next.length];
    setSpec(next);
  };

  const editing = !questions && !busy;
  useCommands(
    'spec',
    editing
      ? SPEC_TEMPLATES.map((t) => ({
          id: `spec:tpl:${t.id}`,
          group: 'Действия' as const,
          label: `Вставить шаблон: ${t.label}`,
          icon: Sparkles,
          keywords: ['шаблон', 'пример', 'template'],
          run: () => insertTemplate(t, spec.trim() ? 'append' : 'replace'),
        }))
      : [],
  );
  const answered = questions ? questions.filter((q) => flow.answers[q.id]?.trim()).length : 0;
  const empty = !spec.trim();

  // Панель действий
  let bar: { hint?: string; hintTone?: 'busy'; secondary?: Action[]; primary?: Action };
  if (busy) {
    bar = { hint: `${busy === 'clarify' ? 'Изучаю ТЗ…' : 'Проектирую систему…'} ${formatClock(now - flow.busyStartedAt)}`, hintTone: 'busy' };
  } else if (questions) {
    bar = {
      hint: `Отвечено ${answered} из ${questions.length} · можно пропустить`,
      secondary: [{ label: 'Пропустить вопросы', onClick: () => void flow.makePlan(false) }],
      primary: { label: 'Составить план', iconRight: ArrowRight, onClick: () => void flow.makePlan(true), hotkey: 'mod+enter' },
    };
  } else if (hasPlan) {
    bar = {
      hint: 'План уже составлен. Новый план заменит текущий',
      secondary: [{ label: 'К плану', onClick: goPlan }],
      primary: {
        label: 'Пересобрать план',
        onClick: () => void flow.clarify(),
        disabled: empty,
        disabledReason: 'Напишите хотя бы пару предложений',
        confirm: { title: 'Составить план заново?', text: 'Текущий план и ваши правки в нём будут заменены', confirmLabel: 'Пересобрать' },
        hotkey: 'mod+enter',
      },
    };
  } else {
    bar = {
      hint: empty ? undefined : `Подробность ТЗ: ${completeness.score} из 6 · студия задаст пару уточнений`,
      secondary: [{ label: 'Сразу составить план', onClick: () => void flow.makePlan(false), disabled: empty, tip: 'Студия сама примет решения по неясным местам' }],
      primary: { label: 'Подобрать команду', iconRight: ArrowRight, onClick: () => void flow.clarify(), disabled: empty, disabledReason: 'Опишите идею своими словами или выберите шаблон', hotkey: 'mod+enter' },
    };
  }

  return (
    <div className="page page--spec spec-screen">
      <header className="spec-head">
        <h1>Что нужно сделать?</h1>
        <p className="muted">Пишите своими словами — как объясняли бы знакомому.</p>
      </header>

      {editing ? (
        <>
          <TemplateChips hasText={!empty} onInsert={insertTemplate} />
          {narrow && <CompletenessInline spec={spec} onAppend={appendHint} />}
          <div className="spec-grid">
            <div className="spec-editor">
              <Textarea
                ref={textarea}
                className="spec-input"
                autoGrow
                minHeight={narrow ? 160 : 200}
                maxHeight={520}
                value={spec}
                onChange={(e) => setSpec(e.target.value)}
                placeholder={SPEC_PLACEHOLDER}
                aria-label="Техническое задание"
                aria-describedby="spec-counter"
              />
              <div className="spec-editor__foot">
                {flow.draftDiffers ? (
                  <button type="button" className="link-btn" onClick={flow.revertToSaved}>
                    Вернуть сохранённую версию
                  </button>
                ) : (
                  <span />
                )}
                <span id="spec-counter" className={`spec-counter num ${spec.trim() && spec.trim().length < 60 ? 'spec-counter--warn' : ''}`}>
                  {spec.trim() && spec.trim().length < 60 ? 'Коротко — студия задаст больше вопросов · ' : ''}
                  {spec.length} симв.
                </span>
              </div>
            </div>
            {!narrow && (
              <aside className="spec-aside card" aria-label="Что стоит указать">
                <div className="spec-aside__title">Что стоит указать</div>
                <Completeness spec={spec} onAppend={appendHint} />
                <p className="spec-aside__note">Не обязательно — студия уточнит недостающее вопросами.</p>
              </aside>
            )}
          </div>
        </>
      ) : (
        <div className="spec-summary card">
          <div className="spec-summary__head">
            <span className="spec-summary__title">Ваше ТЗ</span>
            <Button size="sm" variant="ghost" icon={Pencil} onClick={flow.editSpec} disabled={!!busy} tip={busy ? 'Дождитесь, пока студия закончит' : undefined}>
              Изменить
            </Button>
          </div>
          <p className="spec-summary__text clamp-2">{spec}</p>
        </div>
      )}

      {busy && <PlannerCard ref={plannerRef} busy={busy} startedAt={flow.busyStartedAt} now={now} log={plannerLog} />}

      {questions && !busy && (
        <Questions ref={questionsRef} questions={questions} answers={flow.answers} setAnswer={flow.setAnswer} answered={answered} />
      )}

      {flow.error && !busy && (
        <Callout tone="bad" icon={CircleX}>
          <strong>Не получилось.</strong> {flow.error}
        </Callout>
      )}

      <ActionBar {...bar} />
    </div>
  );
}

function TemplateChips({ hasText, onInsert }: { hasText: boolean; onInsert: (t: SpecTemplate, mode: 'replace' | 'append') => void }) {
  const p = usePopover();
  const [pending, setPending] = useState<SpecTemplate | null>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <div className="templates">
      <span className="templates__label">Начать с шаблона:</span>
      <div className="templates__scroll">
        {SPEC_TEMPLATES.map((t, i) => (
          <Chip
            key={t.id}
            icon={i === 0 ? Sparkles : undefined}
            onClick={(e) => {
              if (!hasText) return onInsert(t, 'replace');
              setPending(t);
              setAnchor(e.currentTarget);
              p.setOpen(true);
            }}
          >
            {t.label}
          </Chip>
        ))}
      </div>
      {pending && (
        <ConfirmLayer
          open={p.open}
          onClose={p.close}
          anchor={anchor}
          placement="bottom"
          align="start"
          spec={{ title: 'Заменить текст шаблоном?', text: 'Сейчас в поле есть ваш текст', confirmLabel: 'Заменить', extra: { label: 'Добавить в конец', onClick: () => onInsert(pending, 'append') } }}
          onConfirm={() => onInsert(pending, 'replace')}
        />
      )}
    </div>
  );
}

function Meter({ score }: { score: number }) {
  return (
    <span className="meter" aria-hidden>
      {Array.from({ length: 6 }, (_, i) => (
        <span key={i} className={`meter__seg ${i < score ? 'meter__seg--on' : ''}`} />
      ))}
    </span>
  );
}

function Completeness({ spec, onAppend, hideScore }: { spec: string; onAppend: (t: string) => void; hideScore?: boolean }) {
  const c = specCompleteness(spec);
  return (
    <>
      <div className="completeness__score" hidden={hideScore}>
        <Meter score={c.score} />
        <span className="num">
          {c.label}, {c.score} из 6
        </span>
      </div>
      <ul className="completeness">
        {SPEC_CHECKS.map((k) => {
          const ok = c.passed.has(k.id);
          return (
            <li key={k.id} className={`completeness__item ${ok ? 'completeness__item--ok' : ''}`}>
              {ok ? <Check size={16} strokeWidth={2} aria-hidden className="completeness__ok" /> : <Circle size={14} strokeWidth={1.75} aria-hidden className="completeness__todo" />}
              <span className="grow">{k.label}</span>
              {!ok && <IconButton icon={Plus} size="sm" label={`Дописать в ТЗ: ${k.label}`} onClick={() => onAppend(k.append)} className="completeness__add" />}
              <span className="sr-only">{ok ? ' — есть' : ' — не указано'}</span>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function CompletenessInline({ spec, onAppend }: { spec: string; onAppend: (t: string) => void }) {
  const [open, setOpen] = useState(false);
  const c = specCompleteness(spec);
  return (
    <div className={`completeness-inline ${open ? 'completeness-inline--open' : ''}`}>
      <button type="button" className="completeness-inline__toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Meter score={c.score} />
        <span className="num">
          <span className="sr-only">Подробность: </span>
          {c.score} из 6
        </span>
        <span className="grow" />
        <span className="ellipsis">Что стоит указать</span>
        <ChevronDown size={14} strokeWidth={1.75} aria-hidden className="completeness-inline__chevron" />
      </button>
      {open && (
        <div className="completeness-inline__body">
          <Completeness spec={spec} onAppend={onAppend} hideScore />
          <p className="spec-aside__note">Не обязательно — студия уточнит недостающее вопросами.</p>
        </div>
      )}
    </div>
  );
}

const PLANNER_STEPS = {
  clarify: { title: 'Изучаю ТЗ…', steps: ['Читаю ТЗ', 'Ищу неясные места', 'Формулирую вопросы'], at: [0, 4, 10] },
  plan: { title: 'Проектирую систему и собираю команду агентов…', steps: ['Изучаю ТЗ', 'Подбираю технологии и команду', 'Расставляю задачи по этапам'], at: [0, 10, 30] },
};

function PlannerCard({ busy, startedAt, now, log, ref }: { busy: 'clarify' | 'plan'; startedAt: number; now: number; log: string[]; ref: Ref<HTMLDivElement> }) {
  const cfg = PLANNER_STEPS[busy];
  const sec = (now - startedAt) / 1000;
  const active = cfg.at.filter((t) => sec >= t).length - 1;
  return (
    <div ref={ref} className="planner card" role="status">
      <div className="planner__head">
        <LoaderCircle size={20} strokeWidth={1.75} className="spin planner__spinner" aria-hidden />
        <div className="planner__title">{cfg.title}</div>
        <span className="planner__timer num" aria-label="Прошло времени">
          {formatClock(now - startedAt)}
        </span>
      </div>
      <p className="planner__note">
        Обычно это занимает от 30 секунд до 2 минут. Можно не ждать на этой странице — студия сообщит, когда {busy === 'plan' ? 'план будет готов' : 'вопросы будут готовы'}.
      </p>
      <ol className="planner__steps">
        {cfg.steps.map((s, i) => (
          <li key={s} className={`planner__step ${i < active ? 'planner__step--done' : i === active ? 'planner__step--active' : ''}`}>
            {i < active ? <CircleCheck size={16} strokeWidth={1.75} aria-hidden /> : i === active ? <LoaderCircle size={16} strokeWidth={1.75} className="spin" aria-hidden /> : <Circle size={16} strokeWidth={1.75} aria-hidden />}
            <span>{s}</span>
            {i === active && log.length > 0 && <span className="planner__log ellipsis">· {log[log.length - 1]}</span>}
          </li>
        ))}
      </ol>
      {log.length > 1 && (
        <ul className="planner__lines">
          {log.slice(-3).map((l, i) => (
            <li key={`${i}-${l}`}>{l.replace(/…$/, '')}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Questions({ questions, answers, setAnswer, answered, ref }: { questions: ClarifyQuestion[]; answers: Record<string, string>; setAnswer: (id: string, v: string) => void; answered: number; ref: Ref<HTMLDivElement> }) {
  const [custom, setCustom] = useState<Record<string, boolean>>({});
  const list = useRef<HTMLOListElement>(null);

  const focusNext = (fromIndex: number, current: Record<string, string>) => {
    const next = questions.findIndex((q, i) => i > fromIndex && !current[q.id]?.trim());
    if (next < 0) return;
    requestAnimationFrame(() => {
      const el = list.current?.children[next] as HTMLElement | undefined;
      if (!el) return;
      el.scrollIntoView({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      el.querySelector<HTMLElement>('.chip')?.focus({ preventScroll: true });
    });
  };

  return (
    <section ref={ref} className="questions" aria-labelledby="q-title">
      <div className="questions__head">
        <h2 id="q-title">Пара уточнений — от них зависит, как будет устроен проект</h2>
        <span className="questions__count num" aria-live="polite">
          {answered} из {questions.length}
        </span>
      </div>
      <ol ref={list} className="question-list card">
        {questions.map((q, i) => {
          const value = answers[q.id] ?? '';
          const isOption = q.options.includes(value);
          const showInput = custom[q.id] || !q.options.length || (!!value && !isOption);
          return (
            <li key={q.id} className="question">
              <span className={`question__num num ${value.trim() ? 'question__num--done' : ''}`} aria-hidden>
                {value.trim() ? <Check size={12} strokeWidth={2.5} /> : i + 1}
              </span>
              <div className="question__body">
                <div className="question__title">{q.question}</div>
                {q.why && <div className="question__why">{q.why}</div>}
                {q.options.length > 0 && (
                  <div className="question__chips" role="group" aria-label={q.question}>
                    {q.options.map((o) => (
                      <Chip
                        key={o}
                        selected={value === o}
                        icon={value === o ? Check : undefined}
                        onClick={() => {
                          setCustom({ ...custom, [q.id]: false });
                          setAnswer(q.id, o);
                          focusNext(i, { ...answers, [q.id]: o });
                        }}
                      >
                        {o}
                      </Chip>
                    ))}
                    <Chip selected={showInput && !!value && !isOption} icon={Pencil} onClick={() => setCustom({ ...custom, [q.id]: true })}>
                      Другое…
                    </Chip>
                  </div>
                )}
                {showInput && (
                  <input
                    className="input question__input"
                    autoFocus={!!custom[q.id]}
                    value={isOption ? '' : value}
                    placeholder="Свой вариант"
                    aria-label={`Свой вариант: ${q.question}`}
                    onChange={(e) => setAnswer(q.id, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
                        e.preventDefault();
                        focusNext(i, answers);
                      }
                    }}
                  />
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
