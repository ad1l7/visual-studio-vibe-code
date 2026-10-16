import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ACTIVE_TASK, agentsWord, type ProjectStep } from './labels.ts';
import { useHotkey } from './lib/hotkeys.ts';
import { useNarrow, usePhone } from './lib/media.ts';
import { useLocalSetting } from './lib/storage.ts';
import { ProjectsScreen } from './screens/Projects.tsx';
import { ActionBarSlotContext } from './shell/ActionBar.tsx';
import { EngineProvider, NavContext, ProjectsProvider, useEngine, useNav, useProjects, type Guard, type NavValue, type Route } from './shell/context.tsx';
import { EngineDialog } from './shell/EnginePicker.tsx';
import { copyText, ScreenHeader, Stepper, type StepInfo } from './shell/ProjectHeader.tsx';
import { ShortcutsDrawer } from './shell/Shortcuts.tsx';
import { Sidebar, type ActiveProgress } from './shell/Sidebar.tsx';
import { FilesTab } from './tabs/FilesTab.tsx';
import { PlanTab } from './tabs/PlanTab.tsx';
import { RunTab } from './tabs/RunTab.tsx';
import { SpecTab } from './tabs/SpecTab.tsx';
import { Button } from './ui/Button.tsx';
import { EmptyState, Skeleton } from './ui/display.tsx';
import { Dialog, Drawer } from './ui/overlay.tsx';
import { useToast } from './ui/toast.tsx';
import { usePlanDraft, type PlanDraft } from './usePlanDraft.ts';
import { useSpecFlow, type SpecFlow } from './useSpecFlow.ts';
import { useProject } from './useProject.ts';
import { TriangleAlert } from 'lucide-react';

type Tab = ProjectStep;
const TABS: Tab[] = ['spec', 'plan', 'run', 'files'];

// В демо-версии (страница внутри чужого окна) не трогаем адресную строку.
const HASH_ROUTING = !__VIBE_DEMO__;

function readHash(): Route {
  const [project, tab] = decodeURIComponent(location.hash.slice(1)).split('/');
  return { project: project || undefined, tab: TABS.includes(tab as Tab) ? (tab as Tab) : 'spec' };
}

const hashOf = (r: Route) => (r.project ? `#${encodeURIComponent(r.project)}/${r.tab}` : '#');

export function App() {
  return (
    <ProjectsProvider>
      <EngineProvider>
        <Shell />
      </EngineProvider>
    </ProjectsProvider>
  );
}

function Shell() {
  const [route, setRoute] = useState<Route>(() => (HASH_ROUTING ? readHash() : { tab: 'spec' }));
  const routeRef = useRef(route);
  routeRef.current = route;
  const guard = useRef<Guard | null>(null);
  const bypass = useRef(false);
  const pendingFile = useRef<string | null>(null);
  const [newProjectTick, setNewProjectTick] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [engineOpen, setEngineOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [sidebar, setSidebar] = useLocalSetting<'open' | 'rail'>('vibe.sidebar', 'open');
  const [active, setActive] = useState<ActiveProgress | undefined>();
  const narrow = useNarrow();

  useEffect(() => {
    if (!HASH_ROUTING) return;
    const onHash = () => {
      const next = readHash();
      if (bypass.current) {
        bypass.current = false;
        return setRoute(next);
      }
      const proceed = () => {
        bypass.current = true;
        location.hash = hashOf(next);
        setRoute(next);
      };
      if (guard.current && !guard.current(next, proceed)) {
        // Возвращаем адрес, пока пользователь решает, что делать с правками.
        history.replaceState(null, '', hashOf(routeRef.current));
        return;
      }
      setRoute(next);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const navigate = useCallback((next: Route) => {
    if (!HASH_ROUTING) return setRoute(next);
    const h = hashOf(next);
    if (location.hash === h || (h === '#' && !location.hash)) return setRoute(next);
    bypass.current = true;
    location.hash = h;
    setRoute(next);
  }, []);

  const go = useCallback<NavValue['go']>(
    (project, tab = 'spec', opts) => {
      const next = { project, tab };
      if (opts?.file) pendingFile.current = opts.file;
      if (opts?.newProject) setNewProjectTick((t) => t + 1);
      const proceed = () => navigate(next);
      if (guard.current && !guard.current(next, proceed)) return;
      proceed();
    },
    [navigate],
  );

  const nav = useMemo<NavValue>(
    () => ({
      route,
      go,
      pendingFile: pendingFile.current,
      takePendingFile: () => {
        const f = pendingFile.current;
        pendingFile.current = null;
        return f;
      },
      newProjectTick,
      openMenu: () => setMenuOpen(true),
      openEngineDialog: () => setEngineOpen(true),
      setGuard: (g) => (guard.current = g),
    }),
    [route, go, newProjectTick],
  );

  useHotkey('mod+b', (e) => {
    e.preventDefault();
    setSidebar((s) => (s === 'rail' ? 'open' : 'rail'));
  }, { inInputs: true });
  useHotkey('shift+?', () => setShortcutsOpen(true));

  const rail = sidebar === 'rail';
  return (
    <NavContext.Provider value={nav}>
      <div className={`shell ${rail ? 'shell--rail' : ''}`}>
        {!narrow && <Sidebar rail={rail} onToggleRail={() => setSidebar(rail ? 'open' : 'rail')} active={active} onShortcuts={() => setShortcutsOpen(true)} />}
        <div className="shell__main">
          {route.project ? (
            <ProjectView key={route.project} name={route.project} tab={route.tab} onProgress={setActive} />
          ) : (
            <ProjectsScreen />
          )}
        </div>
      </div>
      {narrow && (
        <Drawer open={menuOpen} onClose={() => setMenuOpen(false)} side="left" keepSide label="Проекты и настройки" width={300} header={<span />} className="drawer--menu">
          <Sidebar rail={false} active={active} onNavigate={() => setMenuOpen(false)} onShortcuts={() => setShortcutsOpen(true)} inDrawer />
        </Drawer>
      )}
      <EngineDialog open={engineOpen} onClose={() => setEngineOpen(false)} />
      <ShortcutsDrawer open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </NavContext.Provider>
  );
}

function ProjectView({ name, tab, onProgress }: { name: string; tab: Tab; onProgress: (p: ActiveProgress | undefined) => void }) {
  const project = useProject(name);
  const draft = usePlanDraft(project);
  const nav = useNav();
  const { refresh } = useProjects();
  const { choice } = useEngine();
  const toast = useToast();
  const { details, snapshot, running } = project;
  const contentRef = useRef<HTMLDivElement>(null);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [leave, setLeave] = useState<null | (() => void)>(null);
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const flow = useSpecFlow(project, { name, choice, isOnSpec: () => tabRef.current === 'spec', onPlanned: () => nav.go(name, 'plan'), openPlan: () => nav.go(name, 'plan') });

  // S1: новый шаг всегда открывается с начала.
  useLayoutEffect(() => {
    contentRef.current?.scrollTo({ top: 0 });
  }, [tab]);

  // Несохранённые правки плана: спрашиваем при уходе из проекта или на шаг «ТЗ».
  useEffect(() => {
    nav.setGuard((next, proceed) => {
      if (!draft.dirty) return true;
      if (next.project === name && next.tab !== 'spec') return true;
      setLeave(() => proceed);
      return false;
    });
    return () => nav.setGuard(null);
  }, [nav, draft.dirty, name]);

  const tasks = snapshot ? Object.values(snapshot.tasks) : [];
  const done = tasks.filter((t) => t.status === 'done').length;
  const status = snapshot?.status;

  // Прогресс открытого проекта — в сайдбар.
  useEffect(() => {
    onProgress(snapshot ? { name, done, total: tasks.length, running, failed: status === 'failed' } : undefined);
  }, [name, done, tasks.length, running, status, onProgress, snapshot]);
  useEffect(() => () => onProgress(undefined), [onProgress]);

  // Список проектов обновляем, когда меняется состояние этого проекта.
  const hasPlan = !!details?.plan;
  useEffect(() => {
    if (details) refresh();
  }, [hasPlan, running, status, refresh]); // eslint-disable-line react-hooks/exhaustive-deps

  // Заголовок вкладки браузера.
  const title = details?.plan?.project.name ?? name;
  const [seenDone, setSeenDone] = useState(false);
  useEffect(() => {
    if (tab === 'run' || tab === 'files') setSeenDone(true);
  }, [tab, status]);
  useEffect(() => {
    if (status !== 'done') setSeenDone(false);
  }, [status]);
  useEffect(() => {
    let prefix = '';
    if (running && tasks.length) prefix = `▶ ${done}/${tasks.length} · `;
    else if (status === 'done' && !seenDone) prefix = '✓ ';
    else if (status === 'failed') prefix = '! ';
    document.title = `${prefix}${name} — Vibe Studio`;
    return () => void (document.title = 'Vibe Studio');
  }, [running, done, tasks.length, status, seenDone, name]);

  if (project.error && !details) {
    return (
      <div className="screen">
        <ScreenHeader title={name} onMenu={nav.openMenu} />
        <div className="content">
          <EmptyState icon={TriangleAlert} title="Не получилось открыть проект" text={project.error} action={{ label: 'К списку проектов', onClick: () => nav.go() }} />
        </div>
      </div>
    );
  }

  const steps: StepInfo[] = [
    { id: 'spec', state: details?.plan ? 'done' : 'todo' },
    details?.plan
      ? { id: 'plan', state: snapshot ? 'done' : 'todo', tip: `${agentsWord(details.plan.agents.length)} · ${details.plan.tasks.length} задач в плане` }
      : { id: 'plan', state: 'locked', tip: 'Сначала опишите задачу на шаге ТЗ' },
    !details?.plan && !snapshot
      ? { id: 'run', state: 'locked', tip: 'Сначала опишите задачу на шаге ТЗ' }
      : {
          id: 'run',
          state: running ? 'live' : status === 'done' ? 'done' : status === 'failed' ? 'error' : status === 'stopped' ? 'stopped' : 'todo',
          meta: running && tasks.length ? `${done}/${tasks.length}` : undefined,
        },
    snapshot ? { id: 'files', state: 'todo' } : { id: 'files', state: 'locked', tip: 'Появится после первого запуска' },
  ];

  const goTab = (t: Tab) => nav.go(name, t);
  const activeTasks = tasks.filter((t) => ACTIVE_TASK.includes(t.status)).length;

  return (
    <ActionBarSlotContext.Provider value={slot}>
      <div className="screen">
        <ProjectHeaderBar
          title={title}
          path={details?.path}
          steps={steps}
          tab={tab}
          onGo={goTab}
          onCopyPath={() => details && copyText(details.path).then(() => toast({ tone: 'success', title: 'Путь к папке скопирован', duration: 2000 }), () => {})}
        />
        <div className="content" ref={contentRef} id="content">
          {!details ? (
            <div className="page">
              <Skeleton lines={5} height={20} />
            </div>
          ) : (
            <TabContent tab={tab} project={project} draft={draft} flow={flow} name={name} goTab={goTab} choice={choice} />
          )}
        </div>
        <div className="actionbar-slot" ref={setSlot} data-active={activeTasks || undefined} />
      </div>
      <Dialog
        open={!!leave}
        onClose={() => setLeave(null)}
        title="Сохранить изменения плана?"
        actions={
          <>
            <Button variant="ghost" onClick={() => setLeave(null)}>
              Отмена
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                const proceed = leave;
                setLeave(null);
                draft.reset();
                nav.setGuard(null);
                proceed?.();
              }}
            >
              Не сохранять
            </Button>
            <Button
              variant="primary"
              data-autofocus
              onClick={async () => {
                const proceed = leave;
                setLeave(null);
                if (await draft.save()) {
                  nav.setGuard(null);
                  proceed?.();
                }
              }}
            >
              Сохранить
            </Button>
          </>
        }
      >
        В плане есть правки, которые ещё не сохранены.
      </Dialog>
    </ActionBarSlotContext.Provider>
  );
}

function ProjectHeaderBar({ title, path, steps, tab, onGo, onCopyPath }: { title: string; path?: string; steps: StepInfo[]; tab: Tab; onGo: (t: Tab) => void; onCopyPath: () => void }) {
  const nav = useNav();
  const narrow = useNarrow();
  const phoneSteps = usePhone();
  useHotkey(['alt+1', 'alt+2', 'alt+3', 'alt+4'], (e) => {
    const i = Number(e.code.replace('Digit', '')) - 1;
    const s = steps[i];
    if (!s) return;
    e.preventDefault();
    if (s.state !== 'locked') onGo(s.id);
  }, { inInputs: true });
  return (
    <>
      <ScreenHeader
        title={title}
        sub={
          path && !narrow ? (
            <button type="button" className="path-btn mono" onClick={onCopyPath} data-tip="Скопировать путь к папке">
              {path}
            </button>
          ) : undefined
        }
        onMenu={nav.openMenu}
      >
        {!phoneSteps && <Stepper steps={steps} current={tab} onGo={onGo} variant="full" />}
      </ScreenHeader>
      {phoneSteps && (
        <div className="stepper-bar">
          <Stepper steps={steps} current={tab} onGo={onGo} variant="segments" />
        </div>
      )}
    </>
  );
}

function TabContent({ tab, project, draft, flow, name, goTab, choice }: { tab: Tab; project: ProjectHook; draft: PlanDraft; flow: SpecFlow; name: string; goTab: (t: Tab) => void; choice: ReturnType<typeof useEngine>['choice'] }) {
  const { snapshot } = project;
  if (tab === 'spec') return <SpecTab project={project} flow={flow} goPlan={() => goTab('plan')} />;
  return (
    <div className="page">
      {tab === 'plan' && <PlanTab project={project} draft={draft} choice={choice} onStarted={() => goTab('run')} goSpec={() => goTab('spec')} />}
      {tab === 'run' && <RunTab project={project} choice={choice} goPlan={() => goTab('plan')} goFiles={() => goTab('files')} />}
      {tab === 'files' && <FilesTab name={name} refreshKey={snapshot ? Object.values(snapshot.tasks).filter((t) => t.status === 'done').length : 0} />}
    </div>
  );
}

export type ProjectHook = ReturnType<typeof useProject>;
