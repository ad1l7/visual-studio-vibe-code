import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach } from 'vitest';
import type { PlanInput } from '../src/plan/schema.ts';
import { parsePlan } from '../src/plan/validate.ts';

const dirs: string[] = [];

export async function tempDir(prefix = 'vibe-test-'): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

export function makePlan(tasks: PlanInput['tasks'], agents?: PlanInput['agents']) {
  return parsePlan({
    project: { name: 'test', summary: 'test project', stack: {} },
    agents: agents ?? [
      { id: 'architect', role: 'Архитектор', description: 'd', scope: ['docs/'] },
      { id: 'backend', role: 'Backend', description: 'd', scope: ['backend/'] },
      { id: 'frontend', role: 'Frontend', description: 'd', scope: ['frontend/'] },
    ],
    tasks,
  });
}
