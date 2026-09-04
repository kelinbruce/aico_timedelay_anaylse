import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function builtinAgentsRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), 'builtin-agents');
}
