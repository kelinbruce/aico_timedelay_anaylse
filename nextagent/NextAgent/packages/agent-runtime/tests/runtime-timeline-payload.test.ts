import { brand } from '@nextagent/agent-common';
import type { RequestContext } from '@nextagent/agent-contracts/runtime';
import { describe, expect, it } from 'vitest';

import { runtimeTimelinePayload } from '../src/timeline/runtime-payload.js';

describe('runtime timeline payload', () => {
  it('replaces reserved trace and eventId values with the trusted runtime eventId', () => {
    expect(
      runtimeTimelinePayload(
        {
          nodeId: 'node-1',
          trace: { traceId: 'untrusted' },
          attributes: {
            eventId: 'untrusted',
            businessTag: 'kept',
          },
        },
        context('task-event-1'),
      ),
    ).toEqual({
      nodeId: 'node-1',
      attributes: {
        businessTag: 'kept',
        eventId: 'task-event-1',
      },
    });
  });

  it('omits reserved namespaces when no trusted task event id exists', () => {
    expect(
      runtimeTimelinePayload(
        {
          trace: { traceId: 'untrusted' },
          attributes: { eventId: 'untrusted' },
        },
        context(),
      ),
    ).toEqual({});
  });
});

function context(taskEventId?: string): Pick<RequestContext, 'propagationAttributes'> {
  return taskEventId === undefined
    ? {}
    : {
        propagationAttributes: {
          taskEventId: brand<string, 'TaskEventId'>(taskEventId),
        },
      };
}
