import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { homedir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { createRunners, detectEngines, EngineId, type PermissionMode, type RunSettings } from '@vibe/core';
import { HttpError, ProjectManager, type StreamMessage } from './projects.ts';

const { values } = parseArgs({
  options: {
    port: { type: 'string', default: process.env.VIBE_PORT ?? '4317' },
    projects: { type: 'string', default: process.env.VIBE_PROJECTS_DIR ?? join(homedir(), 'VibeProjects') },
    dev: { type: 'boolean', default: false },
  },
});

const PORT = Number(values.port);
const HOST = '127.0.0.1';
const WEB_ROOT = resolve(import.meta.dirname, '..', 'web');
const DIST = join(WEB_ROOT, 'dist');

const runners = createRunners({ mock: { delayMs: 700 } });
const projects = new ProjectManager(resolve(values.projects), runners);

type Handler = (req: IncomingMessage, res: ServerResponse, params: string[], body: any) => Promise<unknown> | unknown;
const routes: [method: string, pattern: RegExp, handler: Handler][] = [];
const route = (method: string, pattern: string, handler: Handler) =>
  routes.push([method, new RegExp(`^${pattern.replace(/:\w+/g, '([^/]+)')}$`), handler]);

route('GET', '/api/engines', () => detectEngines(runners));
route('GET', '/api/projects', () => projects.list());
route('POST', '/api/projects', (_q, _s, _p, b) => projects.create(String(b?.name ?? '').trim()));
route('GET', '/api/projects/:name', (_q, _s, [n]) => projects.details(n!));
route('POST', '/api/projects/:name/clarify', async (_q, _s, [n], b) => ({ questions: await projects.clarify(n!, { spec: b.spec, engine: EngineId.parse(b.engine), model: b.model || undefined }) }));
route('POST', '/api/projects/:name/plan', async (_q, _s, [n], b) => ({
  plan: await projects.plan(n!, { spec: b.spec, questions: b.questions, answers: b.answers, engine: EngineId.parse(b.engine), model: b.model || undefined }),
}));
route('PUT', '/api/projects/:name/plan', async (_q, _s, [n], b) => ({ plan: await projects.savePlan(n!, b.plan) }));
route('POST', '/api/projects/:name/run', (_q, _s, [n], b) => projects.run(n!, toSettings(b ?? {})));
route('POST', '/api/projects/:name/stop', (_q, _s, [n]) => projects.stop(n!));
route('GET', '/api/projects/:name/tree', (_q, _s, [n]) => projects.tree(n!));
route('GET', '/api/projects/:name/file', (req, _s, [n]) => projects.file(n!, new URL(req.url!, 'http://x').searchParams.get('path') ?? ''));
route('GET', '/api/projects/:name/events', (req, res, [n]) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  const send = (m: StreamMessage) => res.write(`data: ${JSON.stringify(m)}\n\n`);
  const unsubscribe = projects.subscribe(n!, send);
  const ping = setInterval(() => res.write(': ping\n\n'), 20_000);
  req.on('close', () => {
    clearInterval(ping);
    unsubscribe();
  });
  return STREAMING;
});

const STREAMING = Symbol('streaming');

function toSettings(b: Record<string, unknown>): Partial<RunSettings> {
  const num = (v: unknown, min: number, max: number) => (v === undefined || v === '' ? undefined : Math.min(max, Math.max(min, Math.round(Number(v)) || min)));
  const modes: PermissionMode[] = ['acceptEdits', 'bypassPermissions'];
  return {
    defaultEngine: EngineId.parse(b.engine ?? 'claude-code'),
    model: typeof b.model === 'string' && b.model ? b.model : undefined,
    concurrency: num(b.concurrency, 1, 8),
    maxAttempts: num(b.maxAttempts, 1, 5),
    permissionMode: modes.includes(b.permissionMode as PermissionMode) ? (b.permissionMode as PermissionMode) : undefined,
  };
}

/** Защита от запросов с чужих сайтов и DNS rebinding: сервер только для локального браузера. */
function checkOrigin(req: IncomingMessage): void {
  const host = req.headers.host ?? '';
  if (!/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host)) throw new HttpError(403, 'Недопустимый Host');
  const origin = req.headers.origin;
  if (origin && origin !== `http://${host}`) throw new HttpError(403, 'Недопустимый Origin');
  if (req.method !== 'GET' && !String(req.headers['content-type'] ?? '').startsWith('application/json')) {
    throw new HttpError(415, 'Нужен Content-Type: application/json');
  }
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  if (req.method === 'GET') return undefined;
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 2 * 1024 * 1024) throw new HttpError(413, 'Слишком большой запрос');
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'Некорректный JSON');
  }
}

async function handleApi(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
  try {
    checkOrigin(req);
    const match = routes.find(([m, re]) => m === req.method && re.test(pathname));
    if (!match) throw new HttpError(404, 'Не найдено');
    const params = (pathname.match(match[1]) ?? []).slice(1).map(decodeURIComponent);
    const result = await match[2](req, res, params, await readBody(req));
    if (result === STREAMING) return;
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(result ?? { ok: true }));
  } catch (err) {
    const status = err instanceof HttpError ? err.status : err instanceof Error && err.name === 'ZodError' ? 400 : 500;
    const message = err instanceof Error ? err.message : String(err);
    if (status === 500) console.error(err);
    if (!res.headersSent) res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: message }));
  }
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
};

async function serveStatic(res: ServerResponse, pathname: string): Promise<void> {
  const target = resolve(DIST, `.${decodeURIComponent(pathname)}`);
  const file = target.startsWith(DIST + sep) && existsSync(target) && extname(target) ? target : join(DIST, 'index.html');
  if (!existsSync(file)) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Интерфейс не собран. Выполните: pnpm studio');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
  res.end(await readFile(file));
}

async function main() {
  // В режиме разработки интерфейс отдаёт Vite с горячей перезагрузкой.
  const vite = values.dev
    ? await (await import('vite')).createServer({ configFile: resolve(WEB_ROOT, '..', 'vite.config.ts'), server: { middlewareMode: true }, appType: 'spa' })
    : undefined;

  const server = createServer((req, res) => {
    const { pathname } = new URL(req.url ?? '/', 'http://localhost');
    if (pathname.startsWith('/api/')) return void handleApi(req, res, pathname);
    if (vite) return vite.middlewares(req, res);
    void serveStatic(res, pathname);
  });

  server.listen(PORT, HOST, () => {
    console.log(`Vibe Studio: http://localhost:${PORT}`);
    console.log(`Папка проектов: ${projects.root}`);
  });

  const shutdown = () => {
    projects.stopAll();
    setTimeout(() => process.exit(0), 1500).unref();
    server.close();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

void main();
