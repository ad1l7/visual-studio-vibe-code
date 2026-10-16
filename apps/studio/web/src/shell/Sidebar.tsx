import { Keyboard, PanelLeftClose, PanelLeftOpen, Plus, TriangleAlert } from 'lucide-react';
import type { ProjectSummary } from '../api.ts';
import { PROJECT_PILL, projectDot, smartStep } from '../labels.ts';
import { Button, IconButton } from '../ui/Button.tsx';
import { Dot } from '../ui/display.tsx';
import { useNav, useProjects } from './context.tsx';
import { DemoChip } from './DemoChip.tsx';
import { EngineButton } from './EnginePicker.tsx';
import { DensityMenu, ThemeMenu } from './settings.tsx';

export interface ActiveProgress {
  name: string;
  done: number;
  total: number;
  running: boolean;
  failed: boolean;
}

export function Sidebar({ rail, onToggleRail, active, onNavigate, onShortcuts, inDrawer }: { rail: boolean; onToggleRail?: () => void; active?: ActiveProgress; onNavigate?: () => void; onShortcuts: () => void; inDrawer?: boolean }) {
  const { projects } = useProjects();
  const nav = useNav();
  const current = nav.route.project;
  const open = (p: ProjectSummary) => {
    onNavigate?.();
    if (p.name !== current) nav.go(p.name, smartStep(p));
  };
  return (
    <nav className={`sidebar ${rail ? 'sidebar--rail' : ''} ${inDrawer ? 'sidebar--drawer' : ''}`} aria-label="Проекты и настройки">
      <div className="sidebar__top">
        <button
          type="button"
          className="logo"
          onClick={() => {
            onNavigate?.();
            nav.go();
          }}
          aria-label="Vibe Studio — на главную"
          data-tip={rail ? 'На главную' : undefined}
        >
          <span className="logo__mark" aria-hidden>
            V
          </span>
          {!rail && <span className="logo__text">Vibe Studio</span>}
        </button>
        {!rail && !inDrawer && <DemoChip auto />}
      </div>
      <div className="sidebar__new">
        {rail ? (
          <IconButton icon={Plus} label="Новый проект" variant="secondary" onClick={() => nav.go(undefined, 'spec', { newProject: true })} />
        ) : (
          <Button
            variant="secondary"
            size="md"
            icon={Plus}
            block
            onClick={() => {
              onNavigate?.();
              nav.go(undefined, 'spec', { newProject: true });
            }}
          >
            Новый проект
          </Button>
        )}
      </div>
      {!rail && (
        <div className="sidebar__heading">
          Проекты {projects && <span className="faint num">{projects.length}</span>}
        </div>
      )}
      <ul className="sidebar__list">
        {projects?.map((p) => {
          const isActive = p.name === current;
          const prog = isActive && active?.name === p.name ? active : undefined;
          const state = prog?.running ? 'running' : projectDot(p);
          return (
            <li key={p.name}>
              <button
                type="button"
                className={`side-project ${isActive ? 'side-project--active' : ''}`}
                aria-current={isActive ? 'page' : undefined}
                onClick={() => open(p)}
                data-tip={rail ? `${p.title} · ${PROJECT_PILL[state].label}` : undefined}
                aria-label={rail ? p.title : undefined}
              >
                {rail ? (
                  <span className="side-project__letter" aria-hidden>
                    {(p.title || p.name).charAt(0).toUpperCase()}
                    <Dot state={state} className="side-project__dot" />
                  </span>
                ) : (
                  <>
                    <Dot state={state} />
                    <span className="side-project__title ellipsis">{p.title}</span>
                    {prog?.running && prog.total > 0 ? (
                      <span className="side-project__meta num">
                        {prog.done}/{prog.total}
                      </span>
                    ) : (prog?.failed || (!prog && p.lastRun?.status === 'failed')) ? (
                      <TriangleAlert size={14} strokeWidth={1.75} className="side-project__alert" aria-label="Есть ошибки" />
                    ) : null}
                  </>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="sidebar__bottom">
        <EngineButton compact={rail} />
        <div className={`sidebar__tools ${rail ? 'sidebar__tools--rail' : ''}`}>
          <ThemeMenu />
          <DensityMenu />
          <IconButton icon={Keyboard} label="Горячие клавиши" onClick={onShortcuts} />
          {onToggleRail && (
            <>
              {!rail && <span className="grow" />}
              <IconButton icon={rail ? PanelLeftOpen : PanelLeftClose} label={rail ? 'Развернуть панель (Ctrl+B)' : 'Свернуть панель (Ctrl+B)'} onClick={onToggleRail} />
            </>
          )}
        </div>
      </div>
    </nav>
  );
}
