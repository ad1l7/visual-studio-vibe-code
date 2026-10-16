import { existsSync } from 'node:fs';
import { appendFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Plan } from './plan/schema.ts';
import { parsePlan } from './plan/validate.ts';
import type { RunEvent, RunSnapshot } from './orchestrator/state.ts';

/**
 * Всё состояние проекта лежит в папке `.vibe/` внутри него:
 *   spec.md, plan.json — коммитятся в git (видны и в обычном VS Code);
 *   runs/<runId>/events.jsonl, snapshot.json — история запусков (в .gitignore).
 */
export class ProjectStore {
  constructor(readonly projectDir: string) {}

  get vibeDir() {
    return join(this.projectDir, '.vibe');
  }

  private path(...p: string[]) {
    return join(this.vibeDir, ...p);
  }

  async ensure(): Promise<void> {
    await mkdir(this.path('runs'), { recursive: true });
    const ignore = this.path('.gitignore');
    if (!existsSync(ignore)) await writeFile(ignore, 'runs/\n');
  }

  async saveSpec(spec: string): Promise<void> {
    await this.ensure();
    await writeFile(this.path('spec.md'), spec.endsWith('\n') ? spec : `${spec}\n`);
  }

  async loadSpec(): Promise<string | undefined> {
    const p = this.path('spec.md');
    return existsSync(p) ? (await readFile(p, 'utf8')).trimEnd() : undefined;
  }

  async savePlan(plan: Plan): Promise<void> {
    await this.ensure();
    await writeFile(this.path('plan.json'), `${JSON.stringify(plan, null, 2)}\n`);
  }

  async loadPlan(): Promise<Plan | undefined> {
    const p = this.path('plan.json');
    return existsSync(p) ? parsePlan(JSON.parse(await readFile(p, 'utf8'))) : undefined;
  }

  async appendEvent(runId: string, event: RunEvent): Promise<void> {
    await appendFile(this.path('runs', runId, 'events.jsonl'), `${JSON.stringify(event)}\n`);
  }

  async createRun(runId: string): Promise<void> {
    await this.ensure();
    await mkdir(this.path('runs', runId), { recursive: true });
  }

  async saveSnapshot(snapshot: RunSnapshot): Promise<void> {
    await writeFile(this.path('runs', snapshot.runId, 'snapshot.json'), JSON.stringify(snapshot));
  }

  async latestSnapshot(): Promise<RunSnapshot | undefined> {
    const dir = this.path('runs');
    if (!existsSync(dir)) return undefined;
    const runs = (await readdir(dir)).sort();
    for (const id of runs.reverse()) {
      const p = this.path('runs', id, 'snapshot.json');
      if (existsSync(p)) return JSON.parse(await readFile(p, 'utf8')) as RunSnapshot;
    }
    return undefined;
  }
}

/** Идентификатор запуска, сортируемый по времени: 20261016-120501-ab12. */
export function newRunId(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${stamp}-${Math.random().toString(36).slice(2, 6)}`;
}
