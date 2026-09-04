export type GovernedSystemEventType = 'DEGRADATION_NOTICE' | 'HOOK_DEGRADED' | 'CONTEXT_COMPACTED';

export interface SystemEventPresentation {
  readonly title: string;
  readonly summary: string;
  readonly severity: 'warning' | 'info';
  readonly technicalCode?: string;
}

export type SystemEventTranslate = (key: string) => string;

export function resolveSystemEventPresentation(
  eventType: GovernedSystemEventType,
  payload: Readonly<Record<string, unknown>>,
  t: SystemEventTranslate,
): SystemEventPresentation {
  switch (eventType) {
    case 'DEGRADATION_NOTICE': {
      const technicalCode = readExplicitCode(payload.code);
      return {
        title: t('turn.process.systemEvent.degradation.title'),
        summary: t('turn.process.systemEvent.degradation.summary'),
        severity: 'warning',
        ...(technicalCode === undefined ? {} : { technicalCode }),
      };
    }
    case 'HOOK_DEGRADED':
      return {
        title: t('turn.process.systemEvent.hookDegraded.title'),
        summary: t('turn.process.systemEvent.hookDegraded.summary'),
        severity: 'warning',
      };
    case 'CONTEXT_COMPACTED':
      return {
        title: t('turn.process.systemEvent.contextCompacted.title'),
        summary: t('turn.process.systemEvent.contextCompacted.summary'),
        severity: 'info',
      };
    default: {
      const exhaustive: never = eventType;
      throw new Error(`Unhandled case: ${String(exhaustive)}`);
    }
  }
}

function readExplicitCode(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const code = value.trim();
  return code.length > 0 ? code : undefined;
}
