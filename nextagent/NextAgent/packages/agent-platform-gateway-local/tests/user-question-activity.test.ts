import { createSqliteGatewayStores } from '@nextagent/agent-platform-gateway-local';
import { brand, type AgentId, type EpochMillis, type SubjectId, type TenantId } from '@nextagent/agent-common';
import type { UserQuestionActivityRecord } from '@nextagent/agent-contracts/gateway';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

function computeHash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function makeActivityRecord(overrides: Partial<UserQuestionActivityRecord> = {}): UserQuestionActivityRecord {
  const now = brand<number, 'EpochMillis'>(Date.now());
  return {
    tenantId: 'T1' as TenantId,
    subjectId: 'U1' as SubjectId,
    agentId: 'A1' as AgentId,
    questionHash: '',
    questionText: '',
    locale: 'zh-CN',
    isPinned: false,
    pinnedAt: null,
    askFrequency: 0,
    lastAskedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('UserQuestionActivityStoreGateway', () => {
  let dir: string;
  let store: ReturnType<typeof createSqliteGatewayStores>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'uaq-test-'));
    store = createSqliteGatewayStores({ sqliteFile: join(dir, 'test.db') });
  });

  afterEach(() => {
    store.close?.();
    rmSync(dir, { recursive: true, force: true });
  });

  describe('upsertActivity', () => {
    it('inserts new question with frequency 1', async () => {
      const record = makeActivityRecord({
        questionHash: computeHash('test question'),
        questionText: 'test question',
      });
      const result = await store.userQuestionActivity.upsertActivity(record);
      expect('askFrequency' in result && result.askFrequency).toBe(1);
    });

    it('increments frequency on duplicate question', async () => {
      const record = makeActivityRecord({
        questionHash: computeHash('test question'),
        questionText: 'test question',
      });
      await store.userQuestionActivity.upsertActivity(record);
      const result = await store.userQuestionActivity.upsertActivity(record);
      expect('askFrequency' in result && result.askFrequency).toBe(2);
    });
  });

  describe('listHighFrequency', () => {
    it('returns questions above threshold', async () => {
      const record = makeActivityRecord({
        questionHash: computeHash('frequent q'),
        questionText: 'frequent q',
      });
      for (let i = 0; i < 5; i++) {
        await store.userQuestionActivity.upsertActivity(record);
      }
      const result = await store.userQuestionActivity.listHighFrequency({
        tenantId: 'T1' as TenantId,
        subjectId: 'U1' as SubjectId,
        agentId: 'A1' as AgentId,
        threshold: 3,
      });
      expect(Array.isArray(result)).toBe(true);
      const items = result as readonly UserQuestionActivityRecord[];
      expect(items.length).toBe(1);
      expect(items[0]!.questionText).toBe('frequent q');
      expect(items[0]!.askFrequency).toBe(5);
    });
  });
});
