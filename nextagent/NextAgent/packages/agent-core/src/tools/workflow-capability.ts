import type { CapabilityDescriptor } from '@nextagent/agent-contracts/capability';

export function isWorkflowCapability(descriptor: CapabilityDescriptor): boolean {
  return descriptor.kind === 'WORKFLOW' || (descriptor.kind === 'TOOL' && descriptor.capabilityId === 'Workflow');
}
