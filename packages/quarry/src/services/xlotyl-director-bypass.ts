import type { Element, ElementId, EntityId, Plan } from '@stoneforge/core';
import type { QuarryAPI } from '../api/types.js';

export const XLOTYL_DIRECTOR_TASK_CREATE_REJECTION_CODE = 'XLOTYL_STONEFORGE_DIRECTOR_TASK_CREATE_FORBIDDEN';

export class XlotylDirectorTaskCreationError extends Error {
  readonly code = XLOTYL_DIRECTOR_TASK_CREATE_REJECTION_CODE;

  constructor() {
    super(
      'xlotyl_stoneforge mode forbids Stoneforge Director task creation; create or update task packets through XLOTYL import/replan instead.'
    );
    this.name = 'XlotylDirectorTaskCreationError';
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function agentRoleFromMetadata(metadata: unknown): string | undefined {
  const root = asRecord(metadata);
  const nested = asRecord(root?.agent);
  const nestedRole = nested?.agentRole;
  if (typeof nestedRole === 'string') {
    return nestedRole;
  }
  const flatRole = root?.agentRole;
  return typeof flatRole === 'string' ? flatRole : undefined;
}

function planHasStrictXlotylMode(plan: Plan): boolean {
  const metadata = asRecord(plan.metadata);
  const xlotyl = asRecord(metadata?.xlotyl);
  return xlotyl?.execution_mode === 'xlotyl_stoneforge';
}

async function isDirectorActor(api: QuarryAPI, actor: EntityId): Promise<boolean> {
  try {
    const element = await api.get<Element>(actor as unknown as ElementId);
    return agentRoleFromMetadata(element?.metadata) === 'director';
  } catch {
    return false;
  }
}

async function hasStrictXlotylStoneforgePlan(api: QuarryAPI): Promise<boolean> {
  const plans = await api.list<Plan>({ type: 'plan', limit: 10000 });
  return plans.some((plan) => {
    if (plan.type !== 'plan') {
      return false;
    }
    if (plan.status === 'completed' || plan.status === 'cancelled') {
      return false;
    }
    return planHasStrictXlotylMode(plan);
  });
}

export async function assertDirectorTaskCreationAllowedInXlotylMode(
  api: QuarryAPI,
  actor: EntityId
): Promise<void> {
  const actorIsDirector = await isDirectorActor(api, actor);
  if (!actorIsDirector) {
    return;
  }
  if (await hasStrictXlotylStoneforgePlan(api)) {
    throw new XlotylDirectorTaskCreationError();
  }
}

export function isXlotylDirectorTaskCreationError(error: unknown): error is XlotylDirectorTaskCreationError {
  return error instanceof XlotylDirectorTaskCreationError;
}
