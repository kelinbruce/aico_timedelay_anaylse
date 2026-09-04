import type { RequestContextId } from '@nextagent/agent-common';
import type {
  ForkProcessSnapshotStatusRecord,
  ForkSnapshotRunTimelineEventRecord,
  RunTimelineEventRecord,
  RuntimeRunTimelineEventRecord,
} from '@nextagent/agent-contracts/gateway';
import { describe, expectTypeOf, it } from 'vitest';

describe('fork process event gateway contracts', () => {
  it('keeps runtime request context required and fork snapshot context forbidden', () => {
    type RuntimeWithoutContext = Omit<RuntimeRunTimelineEventRecord, 'requestContextId'>;
    type SnapshotWithContext = Omit<ForkSnapshotRunTimelineEventRecord, 'requestContextId'> & {
      readonly requestContextId: RequestContextId;
    };

    expectTypeOf<RuntimeWithoutContext>().not.toMatchTypeOf<RunTimelineEventRecord>();
    expectTypeOf<SnapshotWithContext>().not.toMatchTypeOf<RunTimelineEventRecord>();
    expectTypeOf<ForkSnapshotRunTimelineEventRecord['recordOrigin']>().toEqualTypeOf<'FORK_SNAPSHOT'>();
    expectTypeOf<ForkSnapshotRunTimelineEventRecord['requestContextId']>().toEqualTypeOf<undefined>();
    expectTypeOf<ForkSnapshotRunTimelineEventRecord['contentRef']>().toEqualTypeOf<undefined>();
  });

  it('keeps snapshot drafts out of public append operations', () => {
    expectTypeOf<
      Parameters<import('@nextagent/agent-contracts/gateway').RunTimelineEventStoreGateway['appendEvent']>[0]
    >().toEqualTypeOf<RunTimelineEventRecord>();
  });

  it('keeps copied-run availability child-owned and lineage-free', () => {
    expectTypeOf<ForkProcessSnapshotStatusRecord['status']>().toEqualTypeOf<'AVAILABLE' | 'LEGACY_UNAVAILABLE'>();
    expectTypeOf<ForkProcessSnapshotStatusRecord>().not.toHaveProperty('sourceSessionId');
    expectTypeOf<ForkProcessSnapshotStatusRecord>().not.toHaveProperty('sourceRequestId');
    expectTypeOf<ForkProcessSnapshotStatusRecord>().not.toHaveProperty('sourceRunId');
  });
});
