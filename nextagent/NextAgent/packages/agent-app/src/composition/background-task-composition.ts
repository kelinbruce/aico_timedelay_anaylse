import type { SessionTimelineEventInput } from '@nextagent/agent-contracts/runtime';
import type { BackgroundCompletionPayload, BackgroundTaskRecord, BackgroundTaskStoreGatewayPort } from '@nextagent/agent-contracts/gateway';
import { buildBackgroundCompletionCallback, emitBackgroundTaskStarted } from './background-completion.js';

export type BackgroundTaskComposition =
  | { readonly enabled: false }
  | {
      readonly enabled: true;
      readonly store: BackgroundTaskStoreGatewayPort;
      readonly onStart: (record: BackgroundTaskRecord) => Promise<void>;
      readonly onComplete: (payload: BackgroundCompletionPayload) => Promise<void>;
    };

export function composeBackgroundTaskLayer(input: {
  readonly storeFactory?: () => BackgroundTaskStoreGatewayPort;
  readonly runtimeTimeline: {
    emitSessionTimelineEvent: (input: SessionTimelineEventInput) => Promise<void>;
  };
}): BackgroundTaskComposition {
  if (input.storeFactory === undefined) {
    return { enabled: false };
  }
  const store = input.storeFactory();
  const dependencies = {
    backgroundTaskStore: store,
    emitSessionTimelineEvent: input.runtimeTimeline.emitSessionTimelineEvent,
  };
  return {
    enabled: true,
    store,
    onStart: (record) => emitBackgroundTaskStarted(record, dependencies),
    onComplete: async (payload) => {
      await buildBackgroundCompletionCallback(dependencies)(payload);
    },
  };
}
