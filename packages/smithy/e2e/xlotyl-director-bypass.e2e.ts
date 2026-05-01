import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createPlan, PlanStatus, type EntityId, type Element } from '@stoneforge/core';
import { createStorageAsync, initializeSchema } from '@stoneforge/storage';
import {
  createQuarryAPI,
  OPERATOR_ENTITY_ID,
  XLOTYL_DIRECTOR_TASK_CREATE_REJECTION_CODE,
} from '@stoneforge/quarry';
import { createHandler, ExitCode } from '@stoneforge/quarry/cli';
import { createOrchestratorAPI } from '../src/api/orchestrator-api.js';

describe('XLOTYL Director bypass mutation guard', () => {
  it('rejects sf task create from a Director when an xlotyl_stoneforge plan exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'stoneforge-xlotyl-bypass-'));
    const db = join(root, '.stoneforge', 'stoneforge.db');
    try {
      await mkdir(join(root, '.stoneforge'), { recursive: true });
      const backend = await createStorageAsync({ path: db, create: true });
      initializeSchema(backend);
      const api = createQuarryAPI(backend);
      const orchestrator = createOrchestratorAPI(backend);
      const director = await orchestrator.registerDirector({
        name: 'director',
        createdBy: OPERATOR_ENTITY_ID as EntityId,
      });
      const plan = await createPlan({
        title: 'XLOTYL strict plan',
        status: PlanStatus.ACTIVE,
        createdBy: OPERATOR_ENTITY_ID as EntityId,
        metadata: {
          xlotyl: {
            schema_version: 1,
            run_id: 'run-xlotyl',
            execution_mode: 'xlotyl_stoneforge',
          },
        },
      }, api.getIdGeneratorConfig());
      await api.create(plan as unknown as Element & Record<string, unknown>);
      backend.close();

      const result = await createHandler(['task'], {
        db,
        actor: director.id,
        title: 'Director task',
        json: true,
        quiet: false,
        verbose: false,
        help: false,
        version: false,
      });

      expect(result.exitCode).toBe(ExitCode.PERMISSION);
      expect(result.error).toContain(XLOTYL_DIRECTOR_TASK_CREATE_REJECTION_CODE);

      const verifyBackend = await createStorageAsync({ path: db, create: true });
      initializeSchema(verifyBackend);
      const verifyApi = createQuarryAPI(verifyBackend);
      const tasks = await verifyApi.list({ type: 'task' });
      expect(tasks).toHaveLength(0);
      verifyBackend.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
