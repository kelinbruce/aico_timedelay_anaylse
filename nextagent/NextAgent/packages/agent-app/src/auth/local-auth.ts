import { brand, type IdentityContext } from '@nextagent/agent-common';

export function defaultIdentity(): IdentityContext {
  return {
    tenantId: brand<string, 'TenantId'>('tenant-1'),
    subjectId: brand<string, 'SubjectId'>('subject-1'),
    displayName: 'Local operator',
  };
}
