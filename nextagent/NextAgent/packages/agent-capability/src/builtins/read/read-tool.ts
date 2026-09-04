import { AgentError, brand, type JsonObject } from '@nextagent/agent-common';

import { defineTool } from '../../tools/tool-spi.js';
import { builtinToolPresentation } from '../presentation-names.js';
import { readInputSchema, readOutputSchema } from './read-schemas.js';

export const readCapabilityId = brand<string, 'CapabilityId'>('Read');

export const readToolDefinition = defineTool({
  name: readCapabilityId,
  ...builtinToolPresentation('Read'),
  description:
    'Read a bounded slice from one authorized execution text file at a known file path.\n\nUse the exact path provided by the user or returned by an earlier file tool. Unqualified relative paths resolve under `workspace/`; use `workspace/...` for durable files and `temp/...` for current-run files. Verified Skill resources are read explicitly through `.nextagent/skills/...` and remain read-only. Read does not enumerate directories or search by name/content: use Glob for an unknown path pattern and Grep for cross-file content search.\n\nReturns `content`, a root-qualified canonical `file_path`, `offset`, `limit`, and truncation facts. Continue with `nextOffset` when more content is required. A full read from offset 0 with no truncation establishes the snapshot required to overwrite or edit an existing file. If the result reports paging required or file unavailable, follow that structured result rather than retrying the same input unchanged. When a slice exceeds the read budget the failure carries a `suggestedLimit` (in `safeError.safeDetails`); reuse the same `offset` with that `limit` on the next Read instead of guessing a smaller value.',
  inputSchema: readInputSchema,
  outputSchema: readOutputSchema,
  requiredDependencies: ['workspaceFiles'],
  replayPolicy: 'IDEMPOTENT',
  disclosurePolicy: { mode: 'EAGER' },
  async execute(input: JsonObject, options) {
    if (options?.deps?.workspaceFiles === undefined || options.context === undefined) {
      throw new AgentError({
        code: options?.deps?.workspaceFiles === undefined ? 'TOOL_DEPENDENCY_MISSING' : 'TOOL_CONTEXT_MISSING',
        message:
          options?.deps?.workspaceFiles === undefined
            ? 'Read could not start because the governed workspace-file dependency is unavailable. Use another available capability or stop and report the unavailable file boundary.'
            : 'Read could not start because its trusted execution context is unavailable. Use another available capability or stop and report the missing execution context.',
        category: options?.deps?.workspaceFiles === undefined ? 'UNAVAILABLE' : 'INTERNAL',
        retryable: false,
      });
    }
    return options.deps.workspaceFiles.readText(input, options.context, options.signal);
  },
});
