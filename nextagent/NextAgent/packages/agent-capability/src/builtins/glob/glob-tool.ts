import { AgentError, brand, type JsonObject } from '@nextagent/agent-common';

import { defineTool } from '../../tools/tool-spi.js';
import { builtinToolPresentation } from '../presentation-names.js';
import { globInputSchema, globOutputSchema } from './glob-schemas.js';

export const globCapabilityId = brand<string, 'CapabilityId'>('Glob');

export const globToolDefinition = defineTool({
  name: globCapabilityId,
  ...builtinToolPresentation('Glob'),
  description:
    'Discover authorized workspace files when the exact path is unknown, using a bounded file-name or path glob pattern. Patterns support brace alternatives and character classes; for one file category with multiple extensions, prefer one covering pattern such as `**/*.{yaml,yml}` instead of separate calls. Usually pass only `pattern`; omitted `path` searches only authorized directories under `workspace/`. Optional `path` narrows the directory: a bare relative path aliases `workspace/...`, while another logical root such as `shared-data/...` must be explicit and separately authorized. It must not be a file or another glob pattern. Unknown input fields are rejected.\n\nDo not use Glob to confirm or read a known path, and do not use it for file-content search. Glob returns up to 500 root-qualified canonical filenames with `truncated`; it does not sort by modification time or identify the newest file. Use Bash with an appropriate governed command when metadata ordering is required.',
  inputSchema: globInputSchema,
  outputSchema: globOutputSchema,
  requiredDependencies: ['workspaceFiles'],
  replayPolicy: 'IDEMPOTENT',
  disclosurePolicy: { mode: 'EAGER' },
  async execute(input: JsonObject, options) {
    if (options?.deps?.workspaceFiles === undefined || options.context === undefined) {
      throw new AgentError({
        code: options?.deps?.workspaceFiles === undefined ? 'TOOL_DEPENDENCY_MISSING' : 'TOOL_CONTEXT_MISSING',
        message:
          options?.deps?.workspaceFiles === undefined
            ? 'Glob could not start because the governed workspace-file dependency is unavailable. Use another available discovery capability or stop and report the unavailable file boundary.'
            : 'Glob could not start because its trusted execution context is unavailable. Use another available discovery capability or stop and report the missing execution context.',
        category: options?.deps?.workspaceFiles === undefined ? 'UNAVAILABLE' : 'INTERNAL',
        retryable: false,
      });
    }
    return options.deps.workspaceFiles.globFiles(input, options.context, options.signal);
  },
});
