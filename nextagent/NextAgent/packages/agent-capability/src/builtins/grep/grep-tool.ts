import { AgentError, brand, type JsonObject } from '@nextagent/agent-common';

import { defineTool } from '../../tools/tool-spi.js';
import { builtinToolPresentation } from '../presentation-names.js';
import { grepInputSchema, grepOutputSchema } from './grep-schemas.js';

export const grepCapabilityId = brand<string, 'CapabilityId'>('Grep');

export const grepToolDefinition = defineTool({
  name: grepCapabilityId,
  ...builtinToolPresentation('Grep'),
  description:
    'Search authorized workspace text-file contents with a bounded ECMAScript regular expression. Use Grep when the target content may span unknown or multiple files; use Read for a known file and Glob for file-name/path discovery. Omitted `path` searches only authorized directories under `workspace/`. Optional `path` narrows the search: a bare relative path aliases `workspace/...`, while another logical root must be explicit and separately authorized.\n\n`output_mode: "files_with_matches"` returns root-qualified canonical filenames; `output_mode: "content"` also returns matching lines, canonical file paths, and line numbers. Use only the schema fields and ECMAScript regex syntax described here. `truncated=true` means the cap was reached and the result is incomplete.',
  inputSchema: grepInputSchema,
  outputSchema: grepOutputSchema,
  requiredDependencies: ['workspaceFiles'],
  replayPolicy: 'IDEMPOTENT',
  disclosurePolicy: { mode: 'EAGER' },
  async execute(input: JsonObject, options) {
    if (options?.deps?.workspaceFiles === undefined || options.context === undefined) {
      throw new AgentError({
        code: options?.deps?.workspaceFiles === undefined ? 'TOOL_DEPENDENCY_MISSING' : 'TOOL_CONTEXT_MISSING',
        message:
          options?.deps?.workspaceFiles === undefined
            ? 'Grep could not start because the governed workspace-file dependency is unavailable. Use another available search capability or stop and report the unavailable file boundary.'
            : 'Grep could not start because its trusted execution context is unavailable. Use another available search capability or stop and report the missing execution context.',
        category: options?.deps?.workspaceFiles === undefined ? 'UNAVAILABLE' : 'INTERNAL',
        retryable: false,
      });
    }
    return options.deps.workspaceFiles.grepFiles(input, options.context, options.signal);
  },
});
