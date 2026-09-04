import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { SystemIntegrationCaseId } from '../case-manifest.js';
import { scanExportedEvidence, type EvidenceCanary } from './evidence-safety.js';

type SafeObservationValue = boolean | number | string;

export async function writePassingCaseEvidence(input: {
  readonly evidenceRoot: string;
  readonly caseId: SystemIntegrationCaseId;
  readonly observations: Readonly<Record<string, SafeObservationValue>>;
  readonly canaries?: readonly EvidenceCanary[];
}): Promise<string> {
  const content = `${JSON.stringify(
    {
      schemaVersion: 1,
      caseId: input.caseId,
      result: 'PASSED',
      ...input.observations,
    },
    null,
    2,
  )}\n`;
  const scan = scanExportedEvidence({
    canaries: input.canaries ?? [],
    artifacts: [
      {
        caseId: input.caseId,
        surface: 'evidence',
        content,
      },
    ],
  });
  if (!scan.safe) {
    throw new Error('case-evidence-unsafe');
  }

  const relativeRef = `cases/${input.caseId}.json`;
  const target = path.join(input.evidenceRoot, ...relativeRef.split('/'));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, { encoding: 'utf8', flag: 'wx' });
  return relativeRef;
}
