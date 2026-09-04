import { brand, type JsonObject } from '@nextagent/agent-common';
import type { CapabilityDescriptor } from '@nextagent/agent-contracts/capability';
import { describe, expect, it } from 'vitest';
import { projectWorkflowDeltaSafeFields } from '../src/tools/workflow-result-safe-projection.js';

const workflowDescriptor: CapabilityDescriptor = {
  capabilityId: brand<string, 'CapabilityId'>('Workflow'),
  kind: 'TOOL',
  provider: { providerKind: 'BUILTIN', providerType: 'builtin' },
  displayName: 'Workflow',
  description: 'Execute a registered workflow recipe',
  availabilityStatus: 'AVAILABLE',
} as unknown as CapabilityDescriptor;

const bashDescriptor: CapabilityDescriptor = {
  capabilityId: brand<string, 'CapabilityId'>('Bash'),
  kind: 'TOOL',
  provider: { providerKind: 'BUILTIN', providerType: 'builtin' },
  displayName: 'Bash',
  description: 'Execute shell command',
  availabilityStatus: 'AVAILABLE',
} as unknown as CapabilityDescriptor;

describe('projectWorkflowDeltaSafeFields', () => {
  it('projects CONTENT channel delta as safeDetailText', () => {
    const result: JsonObject = {
      workflowDelta: { channel: 'CONTENT', content: 'The root cause is a fiber cut at sector 3.' },
    };
    const projection = projectWorkflowDeltaSafeFields(workflowDescriptor, result);

    expect(projection.safeSummary).toBe('Workflow is generating output.');
    expect(projection.safeDetailText).toBe('The root cause is a fiber cut at sector 3.');
    expect(projection.safeResult).toEqual({
      kind: 'workflowDelta',
      channel: 'CONTENT',
      truncated: false,
    });
  });

  it('projects a recipe-backed WORKFLOW descriptor', () => {
    const descriptor = {
      ...workflowDescriptor,
      capabilityId: brand<string, 'CapabilityId'>('alarm-diagnosis'),
      kind: 'WORKFLOW' as const,
    };
    const projection = projectWorkflowDeltaSafeFields(descriptor, {
      workflowDelta: { channel: 'CONTENT', content: 'Workflow result' },
    });

    expect(projection.safeDetailText).toBe('Workflow result');
  });

  it('projects THINKING channel delta with reasoning summary', () => {
    const result: JsonObject = {
      workflowDelta: { channel: 'THINKING', content: 'Analyzing alarm patterns...' },
    };
    const projection = projectWorkflowDeltaSafeFields(workflowDescriptor, result);

    expect(projection.safeSummary).toBe('Workflow is generating reasoning.');
    expect(projection.safeDetailText).toBe('Analyzing alarm patterns...');
    expect(projection.safeResult).toEqual({
      kind: 'workflowDelta',
      channel: 'THINKING',
      truncated: false,
    });
  });

  it('truncates content exceeding the preview limit', () => {
    const longContent = 'y'.repeat(5000);
    const result: JsonObject = {
      workflowDelta: { channel: 'CONTENT', content: longContent },
    };
    const projection = projectWorkflowDeltaSafeFields(workflowDescriptor, result);

    const detailText = projection.safeDetailText as string;
    expect(detailText.length).toBeLessThan(longContent.length);
    expect(detailText).toContain('...');
    expect((projection.safeResult as JsonObject).truncated).toBe(true);
  });

  it('returns empty object for non-Workflow descriptor', () => {
    const result: JsonObject = {
      workflowDelta: { channel: 'CONTENT', content: 'should not match' },
    };
    expect(projectWorkflowDeltaSafeFields(bashDescriptor, result)).toEqual({});
  });

  it('returns empty object when workflowDelta is absent (final result)', () => {
    const result: JsonObject = {
      recipeName: 'alarm-localization',
      status: 'succeeded',
      outputVariables: { rootCause: 'fiber cut' },
    };
    expect(projectWorkflowDeltaSafeFields(workflowDescriptor, result)).toEqual({});
  });

  it('returns empty object when content is missing', () => {
    const result: JsonObject = {
      workflowDelta: { channel: 'CONTENT' },
    };
    expect(projectWorkflowDeltaSafeFields(workflowDescriptor, result)).toEqual({});
  });
});
