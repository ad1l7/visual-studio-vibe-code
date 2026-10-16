import { useEffect, useState } from 'react';
import { api, type EngineChoice, type EngineInfo, type ProjectSummary } from './api.ts';
import { MODELS, RUN_STATUS } from './labels.ts';
import { FilesTab } from './tabs/FilesTab.tsx';
import { PlanTab } from './tabs/PlanTab.tsx';
import { RunTab } from './tabs/RunTab.tsx';
import { SpecTab } from './tabs/SpecTab.tsx';
import { useProject } from './useProject.ts';

type Tab = 'spec' | 'plan' | 'run' | 'files';

// В демо-версии (страница внутри чужого окна) не трогаем адресную строку.
const HASH_ROUTING = !__VIBE_DEMO__;

function readHash(): { project?: string; tab: Tab } {
  const [project, tab] = decodeURIComponent(location.hash.slice(1)).split('/');
  return { project: project || undefined, tab: (['spec', 'plan', 'run', 'files'] as Tab[]).includes(tab as Tab) ? (tab as Tab) : 'spec' };
}

export function App() {
  const [route, setRoute] = useState<{ project?: string; tab: Tab }>(() => (HASH_ROUTING ? readHash() : { tab: 'spec' }));
  const [engines, setEngines] = useState<EngineInfo[]>([]);
  const [choice, setChoice] = useState<EngineChoice>(() => {
    try {
      return JSON.parse(localStorage.getItem('vibe.engine') ?? '') as EngineChoice;
    } catch {
      return { engine: 'claude-code', model: '' };
    }
  });

  useEffect(() => {
    if (!HASH_ROUTING) return;
    const onHash = () => setRoute(readHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    api<EngineInfo[]>('/api/engines').then((list) => {
      setEngines(list);
      // Если Claude Code не установлен — по умолчанию демо-режим.
      setChoice((c) => (list.find((e) => e.id === c.engine)?.available ? c : { ...c, engine: list.find((e) => e.available)?.id ?? c.engine }));
    }, () => {});
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('vibe.engine', JSON.stringify(choice));
    } catch {
      // приватный режим браузера — не страшно
    }
  }, [choice]);

  const go = (project?: string, tab: Tab = 'spec') => {
    if (!HASH_ROUTING) return setRoute({ project, tab });
    location.hash = project ? `${encodeURIComponent(project)}/${tab}` : '';
  };

  return (
    <div className="app">
      <header className="topbar">
        <button className="logo" onClick={() => go()}>
          <span className="logo-mark">V</span> Vibe Studio
        </button>
        {route.project && <span className="crumb">/ {route.project}</span>}
        <div className="spacer" />
        <EnginePicker engines={engines} choice={choice} onChange={setChoice} />
      </header>
      {__VIBE_DEMO__ && (
        <div className="demo-banner">
          <strong>Демо-версия.</strong> Планировщик и агенты здесь имитируются в браузере, код не пишется. Настоящих агентов Claude Code студия запускает у вас на компьютере: <code>pnpm studio</code>.
        </div>
      )}
      {route.project ? (
        <ProjectView key={route.project} name={route.project} tab={route.tab} go={(t) => go(route.project, t)} choice={choice} />
      ) : (
        <ProjectsScreen open={(p) => go(p)} />
      )}
    </div>
  );
}

function EnginePicker({ engines, choice, onChange }: { engines: EngineInfo[]; choice: EngineChoice; onChange: (c: EngineChoice) => void }) {
  const current = engines.find((e) => e.id === choice.engine);
  return (
    <div className="engine-picker" title={current?.available ? current.version : current?.hint}>
      <span className={`dot ${current?.available ? 'ok' : 'bad'}`} />
      <select aria-label="Движок агентов" value={choice.engine} onChange={(e) => onChange({ ...choice, engine: e.target.value as EngineChoice['engine'] })}>
        {engines.map((e) => (
          <option key={e.id} value={e.id} disabled={!e.available}>
            {e.name}
            {e.available ? '' : ' — не установлен'}
          </option>
        ))}
      </select>
      {choice.engine === 'claude-code' && (
        <select value={choice.model} onChange={(e) => onChange({ ...choice, model: e.target.value })} aria-label="Модель">
          {MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

function ProjectsScreen({ open }: { open: (name: string) => void }) {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<ProjectSummary[]>('/api/projects').then(setProjects, (e: Error) => setError(e.message));
  }, []);

  const create = async () => {
    setError(null);
    try {
      await api('/api/projects', { body: { name: name.trim() } });
      open(name.trim());
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <main className="projects">
      <section className="hero">
        <h1>Опишите идею — команда ИИ-агентов её построит</h1>
        <p>Vibe Studio подберёт архитектуру, соберёт команду (бэкенд, фронтенд, база данных, DevOps, тесты) и покажет, кто из агентов что делает.</p>
        <form
          className="new-project"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Название папки проекта, например my-shop" aria-label="Название проекта" />
          <button className="primary" disabled={!name.trim()}>
            Создать проект
          </button>
        </form>
        {error && <div className="error">{error}</div>}
      </section>
      <section>
        <h2>Проекты</h2>
        {projects === null ? (
          <p className="muted">Загрузка…</p>
        ) : projects.length === 0 ? (
          <p className="muted">Пока пусто — создайте первый проект.</p>
        ) : (
          <div className="project-grid">
            {projects.map((p) => (
              <button key={p.name} className="project-card" onClick={() => open(p.name)}>
                <strong>{p.title}</strong>
                <span className="muted mono">{p.name}</span>
                <span className={`badge ${p.running ? 'running' : p.lastRun?.status ?? 'idle'}`}>
                  {p.running ? 'Агенты работают' : p.lastRun ? RUN_STATUS[p.lastRun.status] : p.hasPlan ? 'План готов' : 'Черновик'}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function ProjectView({ name, tab, go, choice }: { name: string; tab: Tab; go: (t: Tab) => void; choice: EngineChoice }) {
  const project = useProject(name);
  const { details, snapshot, running } = project;
  if (project.error) return <main className="page"><div className="error">{project.error}</div></main>;
  if (!details) return <main className="page muted">Загрузка…</main>;

  const tabs: [Tab, string, string?][] = [
    ['spec', '1. ТЗ'],
    ['plan', '2. Команда и план', details.plan ? `${details.plan.agents.length}` : undefined],
    ['run', '3. Запуск', running ? '●' : undefined],
    ['files', 'Файлы'],
  ];

  return (
    <>
      <nav className="tabs">
        {tabs.map(([id, label, extra]) => (
          <button key={id} className={tab === id ? 'active' : ''} onClick={() => go(id)}>
            {label}
            {extra && <span className={`tab-extra ${extra === '●' ? 'live' : ''}`}>{extra}</span>}
          </button>
        ))}
        <div className="spacer" />
        <span className="muted mono path" title={details.path}>{details.path}</span>
      </nav>
      <main className="page">
        {tab === 'spec' && <SpecTab project={project} choice={choice} onPlanned={() => go('plan')} />}
        {tab === 'plan' && <PlanTab project={project} choice={choice} onStarted={() => go('run')} goSpec={() => go('spec')} />}
        {tab === 'run' && <RunTab project={project} choice={choice} goPlan={() => go('plan')} />}
        {tab === 'files' && <FilesTab name={name} refreshKey={snapshot ? Object.values(snapshot.tasks).filter((t) => t.status === 'done').length : 0} />}
      </main>
    </>
  );
}

export type ProjectHook = ReturnType<typeof useProject>;
