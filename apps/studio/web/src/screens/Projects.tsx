import { ArrowRight, FileText, FolderPlus, PackageCheck, Plus, Rocket, Search, Users } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.ts';
import { formatRelative, PROJECT_PILL, projectDot, smartStep, STEP_LABELS } from '../labels.ts';
import { usePhone } from '../lib/media.ts';
import { useNav, useProjects } from '../shell/context.tsx';
import { ScreenHeader } from '../shell/ProjectHeader.tsx';
import { Button, IconButton } from '../ui/Button.tsx';
import { Dot, EmptyState, Skeleton, StatusPill } from '../ui/display.tsx';
import { Field, Input } from '../ui/form.tsx';

const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N}_-]{0,63}$/u;

/** Имя папки по правилу сервера: «Мой магазин» → «мой-магазин». */
export function slugify(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}_-]/gu, '')
    .replace(/-+/g, '-')
    .replace(/^[-_]+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/, '');
}

const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е');

export function ProjectsScreen({ onSearch }: { onSearch?: () => void }) {
  const { projects, refresh, error: listError } = useProjects();
  const nav = useNav();
  const phone = usePhone();
  const [formOpen, setFormOpen] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (nav.newProjectTick) setFormOpen(true);
  }, [nav.newProjectTick]);
  useEffect(refresh, [refresh]);

  const empty = projects !== null && projects.length === 0;
  const showForm = formOpen || empty;
  const filtered = useMemo(() => {
    if (!projects) return null;
    const q = norm(query.trim());
    return q ? projects.filter((p) => norm(`${p.title} ${p.name}`).includes(q)) : projects;
  }, [projects, query]);

  return (
    <div className="screen">
      <ScreenHeader
        title={
          <>
            Ваши проекты {projects && projects.length > 0 && <span className="faint num">· {projects.length}</span>}
          </>
        }
        onMenu={nav.openMenu}
        onSearch={onSearch}
        right={
          phone ? (
            <IconButton icon={Plus} label="Новый проект" variant="secondary" onClick={() => setFormOpen(true)} />
          ) : (
            <>
              {projects && projects.length >= 6 && (
                <div className="search-field">
                  <Search size={14} strokeWidth={1.75} aria-hidden />
                  <input className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Найти проект…" aria-label="Найти проект" />
                </div>
              )}
              <Button variant="primary" icon={Plus} onClick={() => setFormOpen(true)}>
                Новый проект
              </Button>
            </>
          )
        }
      />
      <div className="content">
        <div className="page page--narrow projects">
          {showForm && <NewProjectForm canClose={!empty} onClose={() => setFormOpen(false)} focusTick={nav.newProjectTick} />}
          {listError && <div className="field__error">{listError}</div>}
          {phone && projects && projects.length >= 6 && (
            <div className="search-field search-field--block">
              <Search size={14} strokeWidth={1.75} aria-hidden />
              <input className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Найти проект…" aria-label="Найти проект" />
            </div>
          )}
          {filtered === null ? (
            <Skeleton lines={3} height={44} />
          ) : empty ? (
            <EmptyState icon={FolderPlus} title="Здесь появятся ваши проекты" text="Опишите идею — команда ИИ-агентов соберёт её за вас" />
          ) : filtered.length === 0 ? (
            <EmptyState compact icon={Search} title="Ничего не нашлось" text="Попробуйте другое название" />
          ) : (
            <ul className="project-list">
              {filtered.map((p) => {
                const state = projectDot(p);
                const pill = PROJECT_PILL[state];
                const step = smartStep(p);
                return (
                  <li key={p.name}>
                    <button type="button" className="project-row" onClick={() => nav.go(p.name, step)}>
                      <Dot state={state} />
                      <span className="project-row__main">
                        <span className="project-row__title ellipsis">{p.title}</span>
                        <span className="project-row__sub ellipsis">
                          {p.name} · {STEP_LABELS[step]}
                        </span>
                      </span>
                      <StatusPill tone={pill.tone} pulse={state === 'running'}>
                        {pill.label}
                      </StatusPill>
                      <span className="project-row__time num">{p.lastRun ? formatRelative(p.lastRun.startedAt) : ''}</span>
                      <ArrowRight size={16} strokeWidth={1.75} className="project-row__arrow" aria-hidden />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <HowItWorks />
        </div>
      </div>
    </div>
  );
}

function HowItWorks() {
  const steps = [
    { icon: FileText, text: 'Опишите идею' },
    { icon: Users, text: 'Проверьте команду' },
    { icon: Rocket, text: 'Запустите агентов' },
    { icon: PackageCheck, text: 'Заберите результат' },
  ];
  return (
    <div className="how">
      <span className="how__label">Как это работает:</span>
      {steps.map((s, i) => (
        <span key={s.text} className="how__step">
          <span className="how__num num">{i + 1}</span>
          <s.icon size={14} strokeWidth={1.75} aria-hidden />
          {s.text}
          {i < steps.length - 1 && <ArrowRight size={12} strokeWidth={1.75} className="how__arrow" aria-hidden />}
        </span>
      ))}
    </div>
  );
}

function NewProjectForm({ canClose, onClose, focusTick }: { canClose: boolean; onClose: () => void; focusTick: number }) {
  const nav = useNav();
  const { refresh } = useProjects();
  const [title, setTitle] = useState('');
  const [folder, setFolder] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const slug = folder ?? slugify(title);
  const valid = NAME_RE.test(slug);

  useEffect(() => input.current?.focus(), [focusTick]);

  const create = async () => {
    if (!valid || busy) return;
    setError(null);
    setBusy(true);
    try {
      await api('/api/projects', { body: { name: slug } });
      refresh();
      nav.go(slug, 'spec');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="new-project card"
      onSubmit={(e) => {
        e.preventDefault();
        void create();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && canClose) {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="new-project__row">
        <Field label="Как назовём?" htmlFor="np-title" className="grow">
          <Input
            ref={input}
            id="np-title"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              setError(null);
            }}
            placeholder="Например: Мой магазин"
            aria-label="Название проекта"
            autoComplete="off"
            invalid={!!error}
            aria-describedby="np-folder"
          />
        </Field>
        <Button type="submit" variant="primary" disabled={!valid} loading={busy} tip={!valid ? 'Введите название' : undefined} className="new-project__submit">
          Создать
        </Button>
      </div>
      {folder === null ? (
        <div className="new-project__folder" id="np-folder">
          Название папки проекта: <span className="mono">~/VibeProjects/{slug || '…'}</span>
          <button type="button" className="link-btn" onClick={() => setFolder(slug)}>
            изменить
          </button>
        </div>
      ) : (
        <Field label="Имя папки" htmlFor="np-folder-input" hint="Буквы, цифры, «-» и «_», без пробелов" error={folder && !valid ? 'Только буквы, цифры, «-» и «_», без пробелов' : null}>
          <Input id="np-folder-input" mono value={folder} onChange={(e) => setFolder(e.target.value)} invalid={!!folder && !valid} autoComplete="off" />
        </Field>
      )}
      {error && (
        <div className="field__error" role="alert">
          {error}
        </div>
      )}
    </form>
  );
}
