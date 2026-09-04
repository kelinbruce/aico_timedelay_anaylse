import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const agentAppCompositionDir = join(root, 'packages', 'agent-app', 'src', 'composition');
const observabilitySrc = join(root, 'packages', 'agent-observability', 'src');

function sourceFiles(dir: string): readonly string[] {
  return require('node:fs')
    .readdirSync(dir)
    .flatMap((entry: string) => {
      const path = join(dir, entry);
      const stat = require('node:fs').statSync(path);
      return stat.isDirectory() ? sourceFiles(path) : path.endsWith('.ts') ? [path] : [];
    });
}

/**
 * AI log compliance audit reporting must NOT go through any observability
 * projection path. It must use an independent OperationLogGatewayPort.writeAiLog
 * channel. This test guards the architectural boundary required by the
 * `CloudSop 审计通道是受控脱敏例外` requirement.
 */
describe('AI log reporting boundary', () => {
  const source = readFileSync(join(agentAppCompositionDir, 'request-runtime-composition.ts'), 'utf8');

  // Extract the reportAiLog function body to check it does not touch observability.
  const reportStart = source.indexOf('async function reportAiLog');
  const reportEnd = source.indexOf('await port.writeAiLog(entry);', reportStart);
  const reportAiLogBody = reportStart >= 0 ? source.slice(reportStart, reportEnd + 'await port.writeAiLog(entry);'.length) : '';

  it('reportAiLog writes only through OperationLogGatewayPort.writeAiLog', () => {
    expect(reportAiLogBody).toContain('port.writeAiLog(entry)');
  });

  it('reportAiLog does not call observability projectors', () => {
    expect(reportAiLogBody).not.toMatch(/projectorHost|acceptObservation|ObservabilityProjectorHost|StructuredLogProjector|AuditProjector/u);
  });

  it('observability package does not reference AI log helpers', () => {
    for (const file of sourceFiles(observabilitySrc)) {
      const obsSource = readFileSync(file, 'utf8');
      expect(obsSource).not.toMatch(/reportAiLog|buildResourceName|formatAiLogDetail|resolveAuditLocale/u);
    }
  });
});
