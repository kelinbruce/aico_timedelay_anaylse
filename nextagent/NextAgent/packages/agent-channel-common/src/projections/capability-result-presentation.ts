export type CapabilityResultPresentationLevel = 'STATUS_ONLY' | 'SUMMARY' | 'DETAIL';

export interface CapabilityResultPresentationPolicy {
  readonly defaultLevel: CapabilityResultPresentationLevel;
  readonly levelByCapabilityId: ReadonlyMap<string, CapabilityResultPresentationLevel>;
}
