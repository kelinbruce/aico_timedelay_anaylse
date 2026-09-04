import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const HOST_OWNED_SOURCES = [
  'src/entries/local.tsx',
  'src/entries/immersive.tsx',
  'src/entries/collaborative.ts',
  'src/entries/piu.tsx',
  'src/piu/AIAgentPiuRuntime.tsx',
  'src/piu/registerAIAgentPIU.tsx',
  'src/piu/runtimeStore.ts',
] as const;

const FORBIDDEN_PROCESS_HISTORY_MARKERS = [
  /\/api\/v1\/sessions\/.+\/runs\/.+\/events/,
  /\bloadRunEvents\b/,
  /\bloadCompleteRunProcessHistory\b/,
  /\bcreateProcessHistoryScheduler\b/,
  /\buseConversationTurnVisibility\b/,
  /\bprocessHistoryByRun\b/,
  /\bprocessHistoryStateByRun\b/,
  /\bprocessHistoryCache\b/,
  /\bprocessHistoryVisibilityObserver\b/,
  /\buseProcessEntryDisclosure\b/,
  /\bENTRY_SETTLE_DELAY_MS\b/,
  /\buseChatViewportController\b/,
  /\bonRequestAnchorCompensation\b/,
  /\bonRequestScrollToBottom\b/,
  /\breadIsViewportFollowingBottom\b/,
  /\bprocessPanelHeight\b/,
] as const;

function assertHostOwnsNoProcessHistory(sourcePath: string, source: string): void {
  for (const marker of FORBIDDEN_PROCESS_HISTORY_MARKERS) {
    if (marker.test(source)) {
      throw new Error(`${sourcePath} contains host-owned process history behavior matching ${marker.source}`);
    }
  }
}

describe('process history host ownership', () => {
  it('keeps run event loading, process caches, and entry disclosure out of every host shell and PIU adapter', () => {
    for (const sourcePath of HOST_OWNED_SOURCES) {
      const source = readFileSync(path.resolve(process.cwd(), sourcePath), 'utf8');
      expect(() => assertHostOwnsNoProcessHistory(sourcePath, source)).not.toThrow();
    }
  });

  it.each([
    ['direct run event query', 'fetch("/api/v1/sessions/session-1/runs/run-1/events")'],
    ['host-owned scheduler', 'const scheduler = createProcessHistoryScheduler({});'],
    ['parallel process cache', 'const processHistoryByRun = new Map();'],
    ['host-owned visibility observer', 'const processHistoryVisibilityObserver = new IntersectionObserver(() => {});'],
    ['host-specific entry timer', 'const ENTRY_SETTLE_DELAY_MS = 800;'],
    ['host-owned chat viewport controller', 'useChatViewportController({});'],
    ['host-owned process anchor compensation', 'onRequestAnchorCompensation(24);'],
    ['host-owned process scroll-to-bottom callback', 'onRequestScrollToBottom();'],
    ['host-owned viewport-follow read', 'readIsViewportFollowingBottom();'],
    ['host-owned process panel height', 'const processPanelHeight = 24;'],
  ])('rejects a forbidden %s fixture', (_label, source) => {
    expect(() => assertHostOwnsNoProcessHistory('forbidden-host-fixture.ts', source)).toThrow(/host-owned process history behavior/);
  });
});
