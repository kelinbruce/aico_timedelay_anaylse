import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Absolute path of the package-owned builtin prompt template root. Kept in a
 * standalone module (no prompt-shaping imports) so the variable resolver can
 * locate the builtin skill disclosure body markdown files without creating a
 * circular import with the registry/compiler modules.
 */
export function defaultBuiltinPromptRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return basename(dirname(here)) === 'dist'
    ? resolve(here, '..', 'prompt-templates', 'builtin')
    : resolve(here, '..', '..', 'prompt-templates', 'builtin');
}
