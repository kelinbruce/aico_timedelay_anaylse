import type { WireTimestamp } from '../state/contracts.ts';

export function toTimestampMillis(value?: WireTimestamp | null): number {
  if (value === null || value === undefined) {
    return Number.NaN;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : Number.NaN;
  }
  return Date.parse(value);
}

export function toWireDate(value?: WireTimestamp | null): Date | null {
  const timestamp = toTimestampMillis(value);
  return Number.isNaN(timestamp) ? null : new Date(timestamp);
}
