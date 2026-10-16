import type { EngineId } from '../plan/schema.ts';
import { ClaudeCodeRunner } from './claude.ts';
import { MockRunner, type MockRunnerOptions } from './mock.ts';
import type { AgentRunner, EngineInfo } from './types.ts';

export type RunnerRegistry = Partial<Record<EngineId, AgentRunner>>;

export function createRunners(opts: { mock?: MockRunnerOptions } = {}): RunnerRegistry {
  return {
    'claude-code': new ClaudeCodeRunner(),
    mock: new MockRunner(opts.mock ?? { delayMs: 400 }),
  };
}

export async function detectEngines(runners: RunnerRegistry): Promise<EngineInfo[]> {
  return Promise.all(Object.values(runners).map((r) => r!.info()));
}
