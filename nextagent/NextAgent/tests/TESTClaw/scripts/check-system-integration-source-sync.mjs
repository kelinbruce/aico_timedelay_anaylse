import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifySystemIntegrationSourceSync } from '../tests/suites/add-ts-system-integration-validation-gate/helpers/source-sync.ts';

const testclawRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(testclawRoot, '../..');

try {
  const result = await verifySystemIntegrationSourceSync(repositoryRoot);
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch {
  process.stdout.write(
    `${JSON.stringify({
      status: 'FAILED',
      reason: 'system-integration-source-drift',
    })}\n`,
  );
  process.exitCode = 1;
}
