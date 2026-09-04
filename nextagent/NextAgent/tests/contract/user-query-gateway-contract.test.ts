import { brand } from '@nextagent/agent-common';
import {
  userQueryRequestSchema,
  userQueryResultSchema,
  type GatewayBindings,
  type UserQueryGateway,
  type UserQueryRequest,
} from '@nextagent/agent-contracts/gateway';
import { Ajv } from 'ajv/dist/ajv.js';
import { describe, expect, it } from 'vitest';

const request = {
  tenantId: brand<string, 'TenantId'>('tenant-1'),
  subjectId: brand<string, 'SubjectId'>('caller-1'),
  targetSubjectIds: [brand<string, 'SubjectId'>('user-1'), brand<string, 'SubjectId'>('user-2')],
} satisfies UserQueryRequest;

const gateway = {
  async queryUsers() {
    return { users: [] };
  },
} satisfies UserQueryGateway;

describe('user query gateway contract', () => {
  const ajv = new Ajv({ allErrors: true });

  it('is exposed as an optional top-level gateway binding', () => {
    const configured = { userQuery: gateway } satisfies Pick<GatewayBindings, 'userQuery'>;
    const unconfigured = {} satisfies Pick<GatewayBindings, 'userQuery'>;

    expect(configured.userQuery).toBe(gateway);
    expect('userQuery' in unconfigured).toBe(false);
  });

  it('validates bounded unique requests and rejects unknown fields', () => {
    const validate = ajv.compile(userQueryRequestSchema);

    expect(validate(request)).toBe(true);
    expect(validate({ ...request, targetSubjectIds: ['user-1'] })).toBe(true);
    expect(validate({ ...request, targetSubjectIds: Array.from({ length: 10_000 }, (_, index) => `user-${index}`) })).toBe(true);

    for (const invalid of [
      { ...request, tenantId: '' },
      { ...request, subjectId: '' },
      { ...request, targetSubjectIds: [] },
      { ...request, targetSubjectIds: ['user-1', 'user-1'] },
      { ...request, targetSubjectIds: Array.from({ length: 10_001 }, (_, index) => `user-${index}`) },
      { ...request, targetSubjectIds: [''] },
      { ...request, targetSubjectIds: ['user-1'], displayName: 'not-allowed' },
    ]) {
      expect(validate(invalid), JSON.stringify(invalid).slice(0, 256)).toBe(false);
    }
  });

  it('validates the public result shape and username bounds', () => {
    const validate = ajv.compile(userQueryResultSchema);

    expect(validate({ users: [] })).toBe(true);
    expect(validate({ users: [{ subjectId: 'user-1', userName: '用户一' }] })).toBe(true);
    expect(validate({ users: [{ subjectId: 'user-1', userName: '😀'.repeat(256) }] })).toBe(true);

    for (const invalid of [
      {},
      { users: [{ subjectId: '', userName: 'name' }] },
      { users: [{ subjectId: 'user-1', userName: '' }] },
      { users: [{ subjectId: 'user-1', userName: '😀'.repeat(257) }] },
      { users: [{ subjectId: 'user-1', userName: 'name', email: 'private@example.invalid' }] },
      { users: [], rawProviderPayload: {} },
    ]) {
      expect(validate(invalid), JSON.stringify(invalid).slice(0, 256)).toBe(false);
    }
  });
});
