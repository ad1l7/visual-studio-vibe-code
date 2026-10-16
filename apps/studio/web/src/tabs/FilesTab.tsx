import { useCallback, useEffect, useState } from 'react';
import { api, projectUrl, type TreeNode } from '../api.ts';

export function FilesTab({ name, refreshKey }: { name: string; refreshKey: number }) {
  const [tree, setTree] = useState<TreeNode[] | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [file, setFile] = useState<{ path: string; content: string; truncated: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<TreeNode[]>(projectUrl(name, '/tree')).then(
      (t) => {
        setTree(t);
        setOpen((o) => (o.size ? o : new Set(t.filter((n) => n.dir && !n.name.startsWith('.')).map((n) => n.path))));
      },
      (e: Error) => setError(e.message),
    );
  }, [name]);

  useEffect(load, [load, refreshKey]);

  const show = (path: string) =>
    api<{ path: string; content: string; truncated: boolean }>(projectUrl(name, `/file?path=${encodeURIComponent(path)}`)).then(setFile, (e: Error) => setError(e.message));

  const toggle = (path: string) => setOpen((o) => {
    const next = new Set(o);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    return next;
  });

  const render = (nodes: TreeNode[], depth: number) =>
    nodes.map((n) => (
      <div key={n.path}>
        <button
          className={`tree-item ${file?.path === n.path ? 'selected' : ''}`}
          style={{ paddingLeft: 8 + depth * 14 }}
          onClick={() => (n.dir ? toggle(n.path) : void show(n.path))}
        >
          {n.dir ? (open.has(n.path) ? '▾ 📂' : '▸ 📁') : '  📄'} {n.name}
        </button>
        {n.dir && open.has(n.path) && n.children && render(n.children, depth + 1)}
      </div>
    ));

  return (
    <div className="files-tab">
      <aside className="tree card">
        <div className="row">
          <strong>Проект</strong>
          <div className="spacer" />
          <button className="link" onClick={load} title="Обновить">↻</button>
        </div>
        {error && <div className="error small">{error}</div>}
        {tree === null ? <div className="muted small">Загрузка…</div> : tree.length === 0 ? <div className="muted small">Пусто</div> : render(tree, 0)}
      </aside>
      <section className="viewer card">
        {file ? (
          <>
            <div className="mono small muted">{file.path}{file.truncated ? ' (показано начало файла)' : ''}</div>
            <pre className="code">{file.content}</pre>
          </>
        ) : (
          <div className="muted">Выберите файл слева. Здесь видно, что написали агенты — так же, как в проводнике VS Code.</div>
        )}
      </section>
    </div>
  );
}
