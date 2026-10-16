import type { RunSnapshot } from '@vibe/core/shared';
import { BookOpen, ChevronDown, ChevronLeft, ChevronRight, Copy, Ellipsis, File, FileBraces, FileCode, FileCog, FileText, Folder, FolderOpen, FolderSearch, RefreshCw, Search, TextWrap, X, type LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { api, projectUrl, type TreeNode } from '../api.ts';
import { filesWord, formatDurationShort, RUN_STATUS_META, tasksWord } from '../labels.ts';
import { usePhone } from '../lib/media.ts';
import { useLocalSetting } from '../lib/storage.ts';
import { ActionBar } from '../shell/ActionBar.tsx';
import { copyText } from '../shell/ProjectHeader.tsx';
import { Button, IconButton } from '../ui/Button.tsx';
import { Callout, EmptyState, Skeleton, StatusPill } from '../ui/display.tsx';
import { Segmented, Switch } from '../ui/form.tsx';
import { Markdown } from '../ui/markdown.tsx';
import { Menu, usePopover } from '../ui/overlay.tsx';
import { useToast } from '../ui/toast.tsx';

interface OpenFile {
  path: string;
  content: string;
  truncated: boolean;
}

interface Change {
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  who: string;
}

const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е');

export function fileIcon(name: string): LucideIcon {
  const n = name.toLowerCase();
  if (/\.(ts|tsx|js|jsx|mjs|cjs|css|scss|html|py|sh|prisma|sql|go|rs|java|rb|php|vue|svelte)$/.test(n)) return FileCode;
  if (/\.json$/.test(n)) return FileBraces;
  if (/(\.(ya?ml|toml|env|ini|conf)$)|^dockerfile|^docker-compose|^\.env|^\.gitignore$/.test(n)) return FileCog;
  if (/\.(md|txt|markdown|rst)$/.test(n)) return FileText;
  return File;
}

function changesOf(s: RunSnapshot | null): Map<string, Change> {
  const map = new Map<string, Change>();
  if (!s) return map;
  for (const t of Object.values(s.tasks)) {
    const role = s.agents[t.agentId]?.role ?? t.agentId;
    for (const f of t.files) {
      const verb = f.status === 'added' ? 'Создал' : f.status === 'deleted' ? 'Удалил' : 'Изменил';
      map.set(f.path, { status: f.status, who: `${verb} ${role} · «${t.title}»` });
    }
  }
  return map;
}

interface Row {
  node: TreeNode;
  depth: number;
  parent?: string;
}

export function FilesTab({ name, path: projectPath, snapshot, refreshKey, initialPath }: { name: string; path: string; snapshot: RunSnapshot | null; refreshKey: number; initialPath?: string | null }) {
  const toast = useToast();
  const phone = usePhone();
  const [tree, setTree] = useState<TreeNode[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [file, setFile] = useState<OpenFile | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [onlyChanged, setOnlyChanged] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);
  const [mode, setMode] = useLocalSetting<'read' | 'code'>('vibe.mdMode', 'read');
  const [wrap, setWrap] = useLocalSetting<boolean>('vibe.wrap', true);
  const [first] = useState(() => initialPath ?? null);
  const treeRef = useRef<HTMLDivElement>(null);
  const changes = useMemo(() => changesOf(snapshot), [snapshot]);

  const load = useCallback(() => {
    api<TreeNode[]>(projectUrl(name, '/tree')).then(
      (t) => {
        setTree(t);
        setError(null);
        setOpen((o) => (o.size ? o : new Set(t.filter((n) => n.dir && !n.name.startsWith('.')).map((n) => n.path))));
      },
      (e: Error) => setError(e.message),
    );
  }, [name]);
  useEffect(load, [load, refreshKey]);

  const expandTo = (p: string) => {
    const parts = p.split('/');
    setOpen((o) => new Set([...o, ...parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'))]));
  };

  const show = useCallback(
    (p: string) => {
      setLoading(p);
      setFocus(p);
      api<OpenFile>(projectUrl(name, `/file?path=${encodeURIComponent(p)}`)).then(
        (f) => {
          setFile(f);
          setLoading(null);
        },
        (e: Error) => {
          setLoading(null);
          toast({ tone: 'error', title: 'Не получилось открыть файл', text: e.message });
        },
      );
    },
    [name, toast],
  );

  useEffect(() => {
    if (!first) return;
    expandTo(first);
    show(first);
  }, [first, show]);

  const changedDirs = useMemo(() => {
    const set = new Set<string>();
    for (const p of changes.keys()) {
      const parts = p.split('/');
      for (let i = 1; i < parts.length; i++) set.add(parts.slice(0, i).join('/'));
    }
    return set;
  }, [changes]);

  // Видимые строки дерева с учётом поиска и фильтра.
  const rows = useMemo<Row[]>(() => {
    if (!tree) return [];
    const q = norm(query.trim());
    const keep = (n: TreeNode): boolean => {
      if (n.dir) return (n.children ?? []).some(keep);
      if (onlyChanged && !changes.has(n.path)) return false;
      return !q || norm(n.path).includes(q);
    };
    const filtering = !!q || onlyChanged;
    const out: Row[] = [];
    const walk = (nodes: TreeNode[], depth: number, parent?: string) => {
      for (const n of nodes) {
        if (filtering && !keep(n)) continue;
        out.push({ node: n, depth, parent });
        if (n.dir && (filtering || open.has(n.path))) walk(n.children ?? [], depth + 1, n.path);
      }
    };
    walk(tree, 0);
    return out;
  }, [tree, open, query, onlyChanged, changes]);

  const toggle = (p: string, force?: boolean) =>
    setOpen((o) => {
      const next = new Set(o);
      const on = force ?? !next.has(p);
      if (on) next.add(p);
      else next.delete(p);
      return next;
    });

  const focusRow = (p: string) => {
    setFocus(p);
    requestAnimationFrame(() => treeRef.current?.querySelector<HTMLElement>(`[data-path="${CSS.escape(p)}"]`)?.focus());
  };

  const onKey = (e: KeyboardEvent) => {
    const i = rows.findIndex((r) => r.node.path === focus);
    const row = rows[i];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = rows[Math.min(rows.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))];
      if (next) focusRow(next.node.path);
    } else if (e.key === 'ArrowRight' && row?.node.dir) {
      e.preventDefault();
      if (!open.has(row.node.path)) toggle(row.node.path, true);
      else if (rows[i + 1]?.parent === row.node.path) focusRow(rows[i + 1]!.node.path);
    } else if (e.key === 'ArrowLeft' && row) {
      e.preventDefault();
      if (row.node.dir && open.has(row.node.path)) toggle(row.node.path, false);
      else if (row.parent) focusRow(row.parent);
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      const r = e.key === 'Home' ? rows[0] : rows[rows.length - 1];
      if (r) focusRow(r.node.path);
    }
  };

  const readme = tree && (tree.find((n) => !n.dir && /^readme\.md$/i.test(n.name))?.path ?? tree.find((n) => n.dir && n.name === 'docker')?.children?.find((c) => /^readme\.md$/i.test(c.name))?.path);
  // На десктопе шаг сразу показывает инструкцию по запуску, если она есть.
  const autoOpened = useRef(false);
  useEffect(() => {
    if (autoOpened.current || first || phone || !readme) return;
    autoOpened.current = true;
    expandTo(readme);
    show(readme);
  }, [readme, first, phone, show]); // eslint-disable-line react-hooks/exhaustive-deps
  const tasks = snapshot ? Object.values(snapshot.tasks) : [];
  const done = tasks.filter((t) => t.status === 'done').length;
  const copyPath = () => copyText(projectPath).then(() => toast({ tone: 'success', title: 'Путь к папке скопирован', text: 'Вставьте его в проводник или Finder, чтобы открыть папку', duration: 4000 }), () => toast({ tone: 'error', title: 'Не получилось скопировать', text: projectPath }));
  const isMd = !!file && /\.(md|markdown)$/i.test(file.path);
  const fileOpenOnPhone = phone && (!!file || !!loading);
  const focusable = focus && rows.some((r) => r.node.path === focus) ? focus : rows[0]?.node.path;

  return (
    <div className="page files-screen">
      {snapshot && !fileOpenOnPhone && (
        <section className="result-strip" aria-label="Итог запуска">
          <StatusPill tone={RUN_STATUS_META[snapshot.status].tone} icon={RUN_STATUS_META[snapshot.status].icon} pulse={snapshot.status === 'running'}>
            {RUN_STATUS_META[snapshot.status].label}
          </StatusPill>
          <span className="result-strip__text num">
            {done} из {tasksWord(tasks.length)}
            {snapshot.finishedAt ? ` · ${formatDurationShort(snapshot.finishedAt - snapshot.startedAt)}` : ''} · файлов создано и изменено: {changes.size}
          </span>
          <span className="grow" />
          {readme && (
            <Button
              size="sm"
              variant="secondary"
              icon={BookOpen}
              onClick={() => {
                setMode('read');
                expandTo(readme);
                show(readme);
              }}
            >
              Как запустить проект
            </Button>
          )}
          {!phone && (
            <Button size="sm" variant="ghost" icon={Copy} onClick={() => void copyPath()}>
              Копировать путь к папке
            </Button>
          )}
        </section>
      )}

      <div className="files-layout">
        <aside className="files-tree card" hidden={fileOpenOnPhone} aria-label="Файлы проекта">
          <div className="files-tree__tools">
            <div className="search-field search-field--block">
              <Search size={14} strokeWidth={1.75} aria-hidden />
              <input className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Найти файл…" aria-label="Найти файл" />
              {query && <IconButton icon={X} size="sm" label="Очистить поиск" className="search-field__clear" onClick={() => setQuery('')} />}
            </div>
            <IconButton icon={RefreshCw} label="Обновить список файлов" onClick={load} />
          </div>
          {changes.size > 0 && <Switch size="sm" checked={onlyChanged} onChange={setOnlyChanged} label="Только изменённые" />}
          {error && <div className="field__error">{error}</div>}
          <div className="files-tree__scroll">
            {tree === null ? (
              <Skeleton lines={8} height={14} />
            ) : tree.length === 0 ? (
              <EmptyState compact icon={Folder} title="Файлов пока нет" text="Они появятся, когда агенты начнут работу" />
            ) : rows.length === 0 ? (
              <div className="faint small files-tree__none">Ничего не нашлось</div>
            ) : (
              <div ref={treeRef} role="tree" aria-label="Файлы проекта" className="tree" onKeyDown={onKey}>
                {rows.map(({ node: n, depth }) => {
                  const ch = changes.get(n.path);
                  const isOpen = n.dir && (open.has(n.path) || !!query.trim() || onlyChanged);
                  const Icon = n.dir ? (isOpen ? FolderOpen : Folder) : fileIcon(n.name);
                  const selected = file?.path === n.path;
                  return (
                    <button
                      key={n.path}
                      type="button"
                      role="treeitem"
                      data-path={n.path}
                      aria-level={depth + 1}
                      aria-expanded={n.dir ? isOpen : undefined}
                      aria-selected={selected}
                      tabIndex={n.path === focusable ? 0 : -1}
                      className={`tree-row ${selected ? 'tree-row--selected' : ''}`}
                      style={{ paddingLeft: 6 + depth * 14 }}
                      onFocus={() => setFocus(n.path)}
                      onClick={() => {
                        setFocus(n.path);
                        if (n.dir) toggle(n.path);
                        else show(n.path);
                      }}
                    >
                      <span className="tree-row__chevron" aria-hidden>
                        {n.dir && (isOpen ? <ChevronDown size={14} strokeWidth={1.75} /> : <ChevronRight size={14} strokeWidth={1.75} />)}
                      </span>
                      <Icon size={16} strokeWidth={1.75} className="tree-row__icon" aria-hidden />
                      <span className="tree-row__name ellipsis">{n.name}</span>
                      {ch ? (
                        <span className={`tree-row__mark tree-row__mark--${ch.status}`} data-tip={ch.who} aria-label={ch.who}>
                          {ch.status === 'added' ? '+' : ch.status === 'deleted' ? '−' : '~'}
                        </span>
                      ) : (
                        n.dir && changedDirs.has(n.path) && <span className="tree-row__dot" aria-label="Внутри есть изменения" />
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </aside>

        <section className="files-viewer card" hidden={phone && !fileOpenOnPhone} aria-label="Просмотр файла">
          {file ? (
            <>
              <div className="viewer-head">
                {phone && <IconButton icon={ChevronLeft} label="Назад к файлам" onClick={() => setFile(null)} />}
                <nav className="crumbs" aria-label="Путь к файлу">
                  {file.path.split('/').map((seg, i, all) => {
                    const p = all.slice(0, i + 1).join('/');
                    const last = i === all.length - 1;
                    return (
                      <span key={p} className="crumbs__item">
                        {i > 0 && <span className="crumbs__sep">/</span>}
                        {last ? (
                          <span className="crumbs__current" aria-current="page">
                            {seg}
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="crumbs__link"
                            onClick={() => {
                              expandTo(`${p}/x`);
                              if (phone) setFile(null);
                              focusRow(p);
                            }}
                          >
                            {seg}
                          </button>
                        )}
                      </span>
                    );
                  })}
                </nav>
                <span className="grow" />
                {phone ? (
                  <ViewerMenu isMd={isMd} mode={mode} setMode={setMode} wrap={wrap} setWrap={setWrap} onCopy={() => void copyText(file.content).then(() => toast({ tone: 'success', title: 'Содержимое скопировано', duration: 2000 }))} />
                ) : (
                  <>
                    {isMd && <Segmented size="sm" label="Как показывать" value={mode} onChange={setMode} options={[{ value: 'read', label: 'Читать' }, { value: 'code', label: 'Код' }]} />}
                    <IconButton icon={Copy} label="Копировать содержимое" onClick={() => void copyText(file.content).then(() => toast({ tone: 'success', title: 'Содержимое скопировано', duration: 2000 }))} />
                    {!(isMd && mode === 'read') && <IconButton icon={TextWrap} label={wrap ? 'Перенос строк: включён' : 'Перенос строк: выключен'} pressed={wrap} onClick={() => setWrap(!wrap)} />}
                  </>
                )}
              </div>
              {file.truncated && (
                <Callout tone="info" icon={FileText}>
                  Показано начало файла — он слишком большой
                </Callout>
              )}
              {isMd && mode === 'read' ? (
                <div className="viewer-body viewer-body--md">
                  <Markdown source={file.content} />
                </div>
              ) : (
                <CodeView content={file.content} wrap={wrap} />
              )}
            </>
          ) : loading ? (
            <Skeleton lines={10} height={14} />
          ) : (
            <EmptyState icon={FolderSearch} title="Выберите файл слева" text="Здесь можно посмотреть всё, что сделали агенты. Менять код не нужно — для правок есть план." />
          )}
        </section>
      </div>

      <ActionBar
        hint={changes.size ? `Создано и изменено ${filesWord(changes.size)}` : 'Файлы проекта'}
        secondary={[{ label: 'Открыть папку', icon: Folder, onClick: () => void copyPath(), tip: 'Скопирует путь к папке: вставьте его в проводник' }]}
      />
    </div>
  );
}

function CodeView({ content, wrap }: { content: string; wrap: boolean }) {
  const lines = useMemo(() => content.replace(/\n$/, '').split('\n'), [content]);
  return (
    <div className={`viewer-body code ${wrap ? 'code--wrap' : ''}`} tabIndex={0} aria-label="Содержимое файла">
      {lines.map((l, i) => (
        <div key={i} className="code__line">
          <span className="code__ln" aria-hidden>
            {i + 1}
          </span>
          <span className="code__text">{l || ' '}</span>
        </div>
      ))}
    </div>
  );
}

function ViewerMenu({ isMd, mode, setMode, wrap, setWrap, onCopy }: { isMd: boolean; mode: 'read' | 'code'; setMode: (m: 'read' | 'code') => void; wrap: boolean; setWrap: (w: boolean) => void; onCopy: () => void }) {
  const p = usePopover();
  return (
    <>
      <IconButton ref={p.ref} icon={Ellipsis} label="Действия с файлом" onClick={p.toggle} aria-haspopup="menu" aria-expanded={p.open} />
      <Menu
        open={p.open}
        onClose={p.close}
        anchor={p.anchor}
        items={[
          { label: 'Копировать', icon: Copy, onClick: onCopy },
          ...(isMd ? [{ label: mode === 'read' ? 'Показать код' : 'Читать', icon: mode === 'read' ? FileCode : BookOpen, onClick: () => setMode(mode === 'read' ? 'code' : 'read') }] : []),
          ...(!isMd || mode === 'code' ? [{ label: 'Перенос строк', icon: TextWrap, checked: wrap, onClick: () => setWrap(!wrap) }] : []),
        ]}
      />
    </>
  );
}
