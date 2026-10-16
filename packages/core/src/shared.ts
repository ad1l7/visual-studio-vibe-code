// Браузеро-безопасная часть ядра: схемы, типы и редьюсер состояния.
export * from './plan/schema.ts';
export { parsePlan, topoOrder, dependentsOf, PlanError } from './plan/validate.ts';
export * from './orchestrator/state.ts';
export type { AgentEvent, AgentResult, EngineInfo, PermissionMode } from './runners/types.ts';
