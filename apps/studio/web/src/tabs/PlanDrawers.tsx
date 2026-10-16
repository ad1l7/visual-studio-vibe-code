import { type AgentSpec, type TaskSpec } from '@vibe/core/shared';
import { ChevronRight, ShieldAlert, Trash } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Plan } from '../api.ts';
import { agentColor, MODELS, tasksWord } from '../labels.ts';
import { descendantsOf, levels } from '../lib/plan.ts';
import { useRunSettings } from '../lib/storage.ts';
import { useEngine, useNav } from '../shell/context.tsx';
import { engineLabel } from '../shell/EnginePicker.tsx';
import { Button } from '../ui/Button.tsx';
import { AgentAvatar, Callout } from '../ui/display.tsx';
import { Checkbox, Field, Input, ListEditor, Segmented, Select, Switch, Textarea } from '../ui/form.tsx';
import { ConfirmPopover, Drawer } from '../ui/overlay.tsx';

function Disclosure({ title, children, defaultOpen = false, forceOpen }: { title: string; children: ReactNode; defaultOpen?: boolean; forceOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const shown = open || forceOpen;
  return (
    <div className={`disclosure ${shown ? 'disclosure--open' : ''}`}>
      <button type="button" className="disclosure__toggle" aria-expanded={shown} onClick={() => setOpen(!shown)}>
        <ChevronRight size={14} strokeWidth={1.75} aria-hidden className="disclosure__chevron" />
        {title}
      </button>
      {shown && <div className="disclosure__body">{children}</div>}
    </div>
  );
}

export { Disclosure };

/* ───────────── Агент ───────────── */

export function AgentDrawer({ agent, plan, isNew, readOnly, onClose, onDone, onDelete }: { agent: AgentSpec; plan: Plan; isNew: boolean; readOnly: boolean; onClose: () => void; onDone: (a: AgentSpec) => void; onDelete: () => void }) {
  const [a, setA] = useState(agent);
  const [tried, setTried] = useState(false);
  useEffect(() => setA(agent), [agent]);
  const taskCount = plan.tasks.filter((t) => t.agentId === agent.id).length;
  const errors = { role: !a.role.trim(), description: !a.description.trim(), scope: a.scope.length === 0 };
  const invalid = errors.role || errors.description || errors.scope;
  const done = () => {
    if (readOnly) return;
    setTried(true);
    if (invalid) return;
    onDone({ ...a, role: a.role.trim(), description: a.description.trim(), checkCommand: a.checkCommand?.trim() || undefined });
  };
  return (
    <Drawer
      open
      onClose={onClose}
      label={`Агент: ${agent.role}`}
      title={
        <span className="drawer-title-row">
          <AgentAvatar agent={a} size={24} />
          <span className="ellipsis">{isNew ? 'Новый агент' : a.role || 'Агент'}</span>
        </span>
      }
      width={440}
      onSubmit={done}
      initialFocus={isNew ? '#agent-role' : undefined}
      footer={
        <>
          {!isNew && (
            <ConfirmPopover spec={{ title: `Удалить «${agent.role}»?`, text: `Вместе с ним удалятся его задачи: ${taskCount}`, confirmLabel: 'Удалить', tone: 'danger' }} onConfirm={onDelete} placement="top" align="start">
              {(t) => (
                <Button {...t} variant="danger-ghost" size="md" icon={Trash} disabled={readOnly || plan.agents.length === 1} tip={plan.agents.length === 1 ? 'В команде должен остаться хотя бы один агент' : undefined}>
                  Удалить агента
                </Button>
              )}
            </ConfirmPopover>
          )}
          <span className="grow" />
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" onClick={done} disabled={readOnly} tip={readOnly ? 'Менять план можно после остановки агентов' : 'Ctrl+Enter'}>
            Готово
          </Button>
        </>
      }
    >
      <Field label="Название роли" htmlFor="agent-role" error={tried && errors.role ? 'Назовите роль' : null}>
        <Input id="agent-role" value={a.role} readOnly={readOnly} onChange={(e) => setA({ ...a, role: e.target.value })} placeholder="Например: Дизайнер интерфейса" invalid={tried && errors.role} />
      </Field>
      <Field label="За что отвечает" htmlFor="agent-desc" hint="Простыми словами — это увидят другие агенты" error={tried && errors.description ? 'Опишите, за что отвечает агент' : null}>
        <Textarea id="agent-desc" rows={3} value={a.description} readOnly={readOnly} onChange={(e) => setA({ ...a, description: e.target.value })} />
      </Field>
      <Field label="Особые правила" htmlFor="agent-rules">
        <Textarea id="agent-rules" rows={2} value={a.instructions} readOnly={readOnly} onChange={(e) => setA({ ...a, instructions: e.target.value })} placeholder="Например: пиши комментарии по-русски, не используй платные сервисы" />
      </Field>
      <Disclosure title="Для опытных" forceOpen={tried && errors.scope}>
        <Field label="Папки, которые агент может менять" hint="Enter — добавить папку" error={tried && errors.scope ? 'Нужна хотя бы одна папка' : null}>
          <ListEditor items={a.scope} onChange={(scope) => setA({ ...a, scope })} placeholder="например, backend/" addLabel="Добавить папку" mono chips label="Папки агента" disabled={readOnly} />
        </Field>
        <Field label="Команда проверки" htmlFor="agent-check" hint="Запускается после задачи: тесты или линтер. Можно оставить пустой">
          <Input id="agent-check" mono value={a.checkCommand ?? ''} readOnly={readOnly} placeholder="npm --prefix backend test" onChange={(e) => setA({ ...a, checkCommand: e.target.value })} />
        </Field>
        <Field label="Внутреннее имя" htmlFor="agent-id">
          <Input id="agent-id" mono value={a.id} readOnly />
        </Field>
      </Disclosure>
    </Drawer>
  );
}

/* ───────────── Задача ───────────── */

export function TaskDrawer({ task, plan, isNew, readOnly, onClose, onDone, onDelete, onOpenTask }: { task: TaskSpec; plan: Plan; isNew: boolean; readOnly: boolean; onClose: () => void; onDone: (t: TaskSpec) => void; onDelete: () => void; onOpenTask: (id: string) => void }) {
  const [t, setT] = useState(task);
  const [tried, setTried] = useState(false);
  useEffect(() => setT(task), [task]);
  // Нельзя выбрать задачи, которые сами ждут эту — так не получится цикл.
  const blocked = useMemo(() => descendantsOf(plan, task.id), [plan, task.id]);
  const candidates = plan.tasks.filter((x) => x.id !== task.id && !blocked.has(x.id));
  const waiting = plan.tasks.filter((x) => x.dependsOn.includes(task.id));
  const stage = useMemo(() => {
    const all = plan.tasks.some((x) => x.id === t.id) ? plan.tasks.map((x) => (x.id === t.id ? t : x)) : [...plan.tasks, t];
    return (levels(all).get(t.id) ?? 0) + 1;
  }, [plan, t]);
  const errors = { title: !t.title.trim(), description: !t.description.trim() };
  const done = () => {
    if (readOnly) return;
    setTried(true);
    if (errors.title || errors.description) return;
    onDone({ ...t, title: t.title.trim(), description: t.description.trim() });
  };
  const agent = plan.agents.find((a) => a.id === t.agentId);
  return (
    <Drawer
      open
      onClose={onClose}
      label={`Задача: ${task.title}`}
      title={isNew ? 'Новая задача' : t.title || 'Задача'}
      width={480}
      onSubmit={done}
      initialFocus={isNew ? '#task-title' : undefined}
      footer={
        <>
          {!isNew && (
            <ConfirmPopover spec={{ title: 'Удалить задачу?', text: 'Задачи, которые ждали её, начнутся раньше', confirmLabel: 'Удалить', tone: 'danger' }} onConfirm={onDelete} placement="top" align="start">
              {(tp) => (
                <Button {...tp} variant="danger-ghost" icon={Trash} disabled={readOnly || plan.tasks.length === 1} tip={plan.tasks.length === 1 ? 'В плане должна остаться хотя бы одна задача' : undefined}>
                  Удалить задачу
                </Button>
              )}
            </ConfirmPopover>
          )}
          <span className="grow" />
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" onClick={done} disabled={readOnly} tip={readOnly ? 'Менять план можно после остановки агентов' : 'Ctrl+Enter'}>
            Готово
          </Button>
        </>
      }
    >
      <Field label="Название" htmlFor="task-title" error={tried && errors.title ? 'Назовите задачу' : null}>
        <Input id="task-title" value={t.title} readOnly={readOnly} onChange={(e) => setT({ ...t, title: e.target.value })} invalid={tried && errors.title} />
      </Field>
      <Field label="Кто делает" htmlFor="task-agent">
        <div className="select-with-dot">
          <span className="select-with-dot__dot" style={{ background: agent ? agentColor(agent.id) : undefined }} aria-hidden />
          <Select id="task-agent" value={t.agentId} disabled={readOnly} onChange={(e) => setT({ ...t, agentId: e.target.value })}>
            {plan.agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.role}
              </option>
            ))}
          </Select>
        </div>
      </Field>
      <Field label="Что нужно сделать" htmlFor="task-desc" error={tried && errors.description ? 'Опишите, что нужно сделать' : null}>
        <Textarea id="task-desc" rows={4} value={t.description} readOnly={readOnly} onChange={(e) => setT({ ...t, description: e.target.value })} />
      </Field>
      <Field label="Как понять, что готово">
        <ListEditor items={t.acceptance} onChange={(acceptance) => setT({ ...t, acceptance })} placeholder="Добавить критерий" addLabel="Добавить критерий готовности" label="Критерии готовности" disabled={readOnly} />
      </Field>
      <fieldset className="fieldset">
        <legend className="field__label">Начать после</legend>
        <p className="field__hint">Задача начнётся, когда будут готовы отмеченные. Ничего не отмечено — начнётся сразу.</p>
        <div className="dep-list">
          {candidates.length === 0 && <div className="faint small">Других задач пока нет</div>}
          {candidates.map((x) => (
            <Checkbox
              key={x.id}
              disabled={readOnly}
              checked={t.dependsOn.includes(x.id)}
              onChange={(on) => setT({ ...t, dependsOn: on ? [...t.dependsOn, x.id] : t.dependsOn.filter((d) => d !== x.id) })}
              label={
                <span className="dep-label">
                  <span className="dep-label__dot" style={{ background: agentColor(x.agentId) }} aria-hidden />
                  {x.title}
                </span>
              }
            />
          ))}
        </div>
        <p className="field__hint num">Сейчас это Этап {stage}</p>
      </fieldset>
      {waiting.length > 0 && (
        <div className="field">
          <div className="field__label">Ждут эту задачу</div>
          <ul className="link-list">
            {waiting.map((x) => (
              <li key={x.id}>
                <button type="button" className="link-btn" onClick={() => onOpenTask(x.id)}>
                  {x.title}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Drawer>
  );
}

/* ───────────── Настройки запуска ───────────── */

export function RunSettingsPanel() {
  const [s, set] = useRunSettings();
  const { choice, current } = useEngine();
  const nav = useNav();
  const model = choice.engine === 'claude-code' ? (MODELS.find((m) => m.id === choice.model)?.label ?? 'По умолчанию') : null;
  return (
    <div className="run-settings">
      <div className="run-settings__group">
        <div className="field__label">Сколько агентов работают одновременно</div>
        <Segmented label="Сколько агентов работают одновременно" value={s.concurrency} onChange={(v) => set({ ...s, concurrency: v })} options={[1, 2, 3, 4, 6, 8].map((n) => ({ value: n, label: String(n) }))} />
        <div className="field__hint">Больше — быстрее, но выше нагрузка и расход лимитов</div>
      </div>
      <div className="run-settings__group">
        <div className="field__label">Повторов, если задача не получилась</div>
        <Segmented label="Повторов, если задача не получилась" value={s.maxAttempts} onChange={(v) => set({ ...s, maxAttempts: v })} options={[1, 2, 3, 5].map((n) => ({ value: n, label: String(n) }))} />
        <div className="field__hint">Агент попробует ещё раз с учётом ошибки</div>
      </div>
      <div className="run-settings__group">
        <Switch checked={s.fullAccess} onChange={(v) => set({ ...s, fullAccess: v })} label="Полный доступ к командам" />
        {s.fullAccess && (
          <Callout tone="warn" icon={ShieldAlert}>
            Агенты смогут выполнять любые команды на компьютере без вопросов. Включайте только в контейнере или виртуальной машине.
          </Callout>
        )}
      </div>
      <div className="run-settings__engine">
        <span className="ellipsis">
          <span className="faint">Движок:</span> {engineLabel(choice.engine, current?.name)}
          {choice.engine === 'claude-code' ? (model && model !== 'По умолчанию' ? ` · ${model}` : ' · модель по умолчанию') : ''}
        </span>
        <button type="button" className="link-btn" onClick={nav.openEngineDialog}>
          Изменить
        </button>
      </div>
    </div>
  );
}

export function runSettingsHint(s: { concurrency: number; fullAccess: boolean }) {
  return `${s.concurrency} ${s.concurrency === 1 ? 'агент' : s.concurrency < 5 ? 'агента' : 'агентов'} одновременно`;
}

export { tasksWord };
