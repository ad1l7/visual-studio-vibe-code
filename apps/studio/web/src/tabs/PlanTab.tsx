import { plural, type AgentSpec, type TaskSpec } from '@vibe/core/shared';
import { useEffect, useMemo, useState } from 'react';
import { api, projectUrl, type EngineChoice, type Plan } from '../api.ts';
import type { ProjectHook } from '../App.tsx';
import { agentColor, STACK_LABELS } from '../labels.ts';

/** Номер «волны» задачи: задачи одной волны агенты делают параллельно. */
function waves(plan: Plan): TaskSpec[][] {
  const level = new Map<string, number>();
  const byId = new Map(plan.tasks.map((t) => [t.id, t]));
  const get = (id: string, seen = new Set<string>()): number => {
    if (level.has(id)) return level.get(id)!;
    if (seen.has(id)) return 0;
    seen.add(id);
    const t = byId.get(id);
    const l = t && t.dependsOn.length ? 1 + Math.max(...t.dependsOn.map((d) => get(d, seen))) : 0;
    level.set(id, l);
    return l;
  };
  const result: TaskSpec[][] = [];
  for (const t of plan.tasks) (result[get(t.id)] ??= []).push(t);
  return result.filter(Boolean);
}

function slug(s: string, taken: Set<string>): string {
  const base = s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'item';
  let id = base;
  for (let i = 2; taken.has(id); i++) id = `${base}-${i}`;
  return id;
}

export function PlanTab({ project, choice, onStarted, goSpec }: { project: ProjectHook; choice: EngineChoice; onStarted: () => void; goSpec: () => void }) {
  const { details, setPlan, running } = project;
  const [draft, setDraft] = useState<Plan | null>(details?.plan ?? null);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editAgent, setEditAgent] = useState<string | null>(null);
  const [editTask, setEditTask] = useState<string | null>(null);
  const [concurrency, setConcurrency] = useState(3);
  const [attempts, setAttempts] = useState(2);
  const [fullAccess, setFullAccess] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  useEffect(() => {
    if (!dirty) setDraft(details?.plan ?? null);
  }, [details?.plan, dirty]);

  const columns = useMemo(() => (draft ? waves(draft) : []), [draft]);
  if (!draft) {
    return (
      <div className="empty">
        <p>Плана пока нет.</p>
        <button className="primary" onClick={goSpec}>
          Описать ТЗ →
        </button>
      </div>
    );
  }

  const update = (p: Plan) => {
    setDraft(p);
    setDirty(true);
  };
  const agentById = new Map(draft.agents.map((a) => [a.id, a]));

  const save = async (): Promise<boolean> => {
    setError(null);
    try {
      const { plan } = await api<{ plan: Plan }>(projectUrl(details!.name, '/plan'), { method: 'PUT', body: { plan: draft } });
      setPlan(plan);
      setDraft(plan);
      setDirty(false);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  };

  const launch = async () => {
    setBusy(true);
    try {
      if (dirty && !(await save())) return;
      await api(projectUrl(details!.name, '/run'), {
        body: { engine: choice.engine, model: choice.model, concurrency, maxAttempts: attempts, permissionMode: fullAccess ? 'bypassPermissions' : 'acceptEdits' },
      });
      onStarted();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const removeAgent = (id: string) => {
    const tasks = draft.tasks.filter((t) => t.agentId === id);
    setConfirmDelete(null);
    const removed = new Set(tasks.map((t) => t.id));
    update({
      ...draft,
      agents: draft.agents.filter((a) => a.id !== id),
      tasks: draft.tasks.filter((t) => !removed.has(t.id)).map((t) => ({ ...t, dependsOn: t.dependsOn.filter((d) => !removed.has(d)) })),
    });
  };

  const addAgent = () => {
    const id = slug('agent', new Set(draft.agents.map((a) => a.id)));
    update({ ...draft, agents: [...draft.agents, { id, role: 'Новый агент', description: 'Опишите, за что он отвечает', scope: [`${id}/`], instructions: '' }] });
    setEditAgent(id);
  };

  const addTask = () => {
    const id = slug('task', new Set(draft.tasks.map((t) => t.id)));
    update({ ...draft, tasks: [...draft.tasks, { id, agentId: draft.agents[0]!.id, title: 'Новая задача', description: 'Что нужно сделать', acceptance: [], dependsOn: [] }] });
    setEditTask(id);
  };

  const removeTask = (id: string) =>
    update({ ...draft, tasks: draft.tasks.filter((t) => t.id !== id).map((t) => ({ ...t, dependsOn: t.dependsOn.filter((d) => d !== id) })) });

  const { project: info } = draft;
  return (
    <div className="plan">
      <section className="summary card">
        <h2>{info.name}</h2>
        <p>{info.summary}</p>
        <div className="stack">
          {Object.entries(info.stack)
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <div key={k} className="stack-item">
                <span className="muted small">{STACK_LABELS[k] ?? k}</span>
                <span>{v}</span>
              </div>
            ))}
        </div>
        {info.stackReasoning && <p className="muted small">💡 {info.stackReasoning}</p>}
      </section>

      <section>
        <div className="section-head row">
          <h2>Команда агентов · {draft.agents.length}</h2>
          <div className="spacer" />
          <button className="ghost" onClick={addAgent} disabled={running}>
            + Агент
          </button>
        </div>
        <div className="agent-grid">
          {draft.agents.map((a) =>
            editAgent === a.id ? (
              <AgentEditor
                key={a.id}
                agent={a}
                onDone={(next) => {
                  update({ ...draft, agents: draft.agents.map((x) => (x.id === a.id ? next : x)) });
                  setEditAgent(null);
                }}
                onCancel={() => setEditAgent(null)}
              />
            ) : (
              <div key={a.id} className="agent-card card">
                <div className="agent-head">
                  <span className="avatar" style={{ background: agentColor(a.id) }}>{a.role[0]}</span>
                  <div>
                    <strong>{a.role}</strong>
                    <div className="muted small mono">{a.id}</div>
                  </div>
                  <div className="spacer" />
                  <span className="muted small">{plural(draft.tasks.filter((t) => t.agentId === a.id).length, ['задача', 'задачи', 'задач'])}</span>
                </div>
                <p className="small">{a.description}</p>
                <div className="chips">
                  {a.scope.map((s) => (
                    <span key={s} className="chip mono small">📁 {s}</span>
                  ))}
                </div>
                {a.checkCommand && <div className="muted small mono">✓ {a.checkCommand}</div>}
                {!running && confirmDelete === a.id ? (
                  <div className="card-actions">
                    <span className="small grow">Удалить вместе с задачами ({draft.tasks.filter((t) => t.agentId === a.id).length})?</span>
                    <button className="link" onClick={() => setConfirmDelete(null)}>Нет</button>
                    <button className="link danger" onClick={() => removeAgent(a.id)}>Удалить</button>
                  </div>
                ) : (
                  !running && (
                    <div className="card-actions">
                      <button className="link" onClick={() => setEditAgent(a.id)}>Изменить</button>
                      <button className="link danger" onClick={() => setConfirmDelete(a.id)} disabled={draft.agents.length === 1}>Удалить</button>
                    </div>
                  )
                )}
              </div>
            ),
          )}
        </div>
      </section>

      <section>
        <div className="section-head row">
          <h2>План работ · {plural(draft.tasks.length, ['задача', 'задачи', 'задач'])}</h2>
          <span className="muted small">Задачи одного этапа агенты делают одновременно</span>
          <div className="spacer" />
          <button className="ghost" onClick={addTask} disabled={running}>
            + Задача
          </button>
        </div>
        <div className="waves">
          {columns.map((tasks, i) => (
            <div key={i} className="wave">
              <div className="wave-title">Этап {i + 1}</div>
              {tasks.map((t) =>
                editTask === t.id ? (
                  <TaskEditor
                    key={t.id}
                    task={t}
                    plan={draft}
                    onDone={(next) => {
                      update({ ...draft, tasks: draft.tasks.map((x) => (x.id === t.id ? next : x)) });
                      setEditTask(null);
                    }}
                    onCancel={() => setEditTask(null)}
                    onDelete={() => {
                      removeTask(t.id);
                      setEditTask(null);
                    }}
                  />
                ) : (
                  <button key={t.id} className="task-card card" onClick={() => !running && setEditTask(t.id)} style={{ borderLeftColor: agentColor(t.agentId) }}>
                    <strong>{t.title}</strong>
                    <span className="small" style={{ color: agentColor(t.agentId) }}>{agentById.get(t.agentId)?.role ?? t.agentId}</span>
                    <span className="muted small clamp">{t.description}</span>
                    {t.dependsOn.length > 0 && <span className="muted small">после: {t.dependsOn.map((d) => draft.tasks.find((x) => x.id === d)?.title ?? d).join(', ')}</span>}
                  </button>
                ),
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="launch card">
        <div className="settings">
          <label>
            Агентов одновременно
            <input type="number" min={1} max={8} value={concurrency} onChange={(e) => setConcurrency(Number(e.target.value))} />
          </label>
          <label>
            Попыток на задачу
            <input type="number" min={1} max={5} value={attempts} onChange={(e) => setAttempts(Number(e.target.value))} />
          </label>
          <label className="check">
            <input type="checkbox" checked={fullAccess} onChange={(e) => setFullAccess(e.target.checked)} />
            Полный доступ к командам <span className="muted small">(только в контейнере/виртуалке)</span>
          </label>
        </div>
        <div className="row">
          {error && <div className="error grow">{error}</div>}
          <div className="spacer" />
          {dirty && (
            <button className="ghost" onClick={() => void save()}>
              Сохранить план
            </button>
          )}
          <button className="primary big launch-btn" onClick={launch} disabled={busy || running}>
            {running ? 'Агенты уже работают' : '▶ Запустить агентов'}
          </button>
        </div>
      </section>
    </div>
  );
}

function AgentEditor({ agent, onDone, onCancel }: { agent: AgentSpec; onDone: (a: AgentSpec) => void; onCancel: () => void }) {
  const [a, setA] = useState(agent);
  const [scope, setScope] = useState(agent.scope.join(', '));
  return (
    <div className="agent-card card editing">
      <label>Роль<input value={a.role} onChange={(e) => setA({ ...a, role: e.target.value })} /></label>
      <label>За что отвечает<textarea value={a.description} onChange={(e) => setA({ ...a, description: e.target.value })} rows={3} /></label>
      <label>Папки (через запятую)<input className="mono" value={scope} onChange={(e) => setScope(e.target.value)} /></label>
      <label>Доп. правила<textarea value={a.instructions} onChange={(e) => setA({ ...a, instructions: e.target.value })} rows={2} /></label>
      <label>Команда проверки (необязательно)<input className="mono" value={a.checkCommand ?? ''} placeholder="npm --prefix backend test" onChange={(e) => setA({ ...a, checkCommand: e.target.value || undefined })} /></label>
      <div className="card-actions">
        <button className="link" onClick={onCancel}>Отмена</button>
        <button className="primary" onClick={() => onDone({ ...a, scope: scope.split(',').map((s) => s.trim()).filter(Boolean) })}>Готово</button>
      </div>
    </div>
  );
}

function TaskEditor({ task, plan, onDone, onCancel, onDelete }: { task: TaskSpec; plan: Plan; onDone: (t: TaskSpec) => void; onCancel: () => void; onDelete: () => void }) {
  const [t, setT] = useState(task);
  const [acceptance, setAcceptance] = useState(task.acceptance.join('\n'));
  return (
    <div className="task-card card editing">
      <label>Название<input value={t.title} onChange={(e) => setT({ ...t, title: e.target.value })} /></label>
      <label>
        Исполнитель
        <select value={t.agentId} onChange={(e) => setT({ ...t, agentId: e.target.value })}>
          {plan.agents.map((a) => <option key={a.id} value={a.id}>{a.role}</option>)}
        </select>
      </label>
      <label>Что сделать<textarea value={t.description} onChange={(e) => setT({ ...t, description: e.target.value })} rows={4} /></label>
      <label>Критерии готовности (по строке)<textarea value={acceptance} onChange={(e) => setAcceptance(e.target.value)} rows={3} /></label>
      <div className="small">После задач:</div>
      <div className="chips">
        {plan.tasks.filter((x) => x.id !== t.id).map((x) => (
          <button
            key={x.id}
            className={`chip small ${t.dependsOn.includes(x.id) ? 'selected' : ''}`}
            onClick={() => setT({ ...t, dependsOn: t.dependsOn.includes(x.id) ? t.dependsOn.filter((d) => d !== x.id) : [...t.dependsOn, x.id] })}
          >
            {x.title}
          </button>
        ))}
      </div>
      <div className="card-actions">
        <button className="link danger" onClick={onDelete}>Удалить</button>
        <div className="spacer" />
        <button className="link" onClick={onCancel}>Отмена</button>
        <button className="primary" onClick={() => onDone({ ...t, acceptance: acceptance.split('\n').map((s) => s.trim()).filter(Boolean) })}>Готово</button>
      </div>
    </div>
  );
}
