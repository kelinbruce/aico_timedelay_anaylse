import { AgentError, brand, type JsonObject } from '@nextagent/agent-common';

import { defineTool } from '../../tools/tool-spi.js';
import { builtinToolPresentation } from '../presentation-names.js';
import { writeInputSchema, writeOutputSchema } from './write-schemas.js';

export const writeCapabilityId = brand<string, 'CapabilityId'>('Write');

export const writeToolDefinition = defineTool({
  name: writeCapabilityId,
  ...builtinToolPresentation('Write'),
  description:
    'Create or completely rewrite one authorized execution text file using its exact path and complete UTF-8 content. Use Edit for a targeted replacement in an existing file. Unqualified relative paths resolve under `workspace/`; use `workspace/...` for durable files and `temp/...` for current-run files. Verified Skill resources under `.nextagent/skills/...` are read-only.\n\nCreating a new file does not require a prior Read. Overwriting an existing file requires a full Read snapshot from offset 0 with no truncation. If the tool reports that the snapshot is missing or the target changed, fully Read the same canonical path again, incorporate the current content, then retry. Returns `type: "create"` or `type: "update"` with a root-qualified canonical `file_path`.',
  inputSchema: writeInputSchema,
  outputSchema: writeOutputSchema,
  requiredDependencies: ['workspaceFiles'],
  replayPolicy: 'NON_IDEMPOTENT',
  disclosurePolicy: { mode: 'EAGER' },
  async execute(input: JsonObject, options) {
    if (options?.deps?.workspaceFiles === undefined || options.context === undefined) {
      throw new AgentError({
        code: options?.deps?.workspaceFiles === undefined ? 'TOOL_DEPENDENCY_MISSING' : 'TOOL_CONTEXT_MISSING',
        message:
          options?.deps?.workspaceFiles === undefined
            ? 'Write could not start because the governed workspace-file dependency is unavailable. Preserve the intended content, use another available capability, or stop and report the unavailable file boundary.'
            : 'Write could not start because its trusted execution context is unavailable. Preserve the intended content, use another available capability, or stop and report the missing execution context.',
        category: options?.deps?.workspaceFiles === undefined ? 'UNAVAILABLE' : 'INTERNAL',
        retryable: false,
      });
    }
    return options.deps.workspaceFiles.writeText(input, options.context, options.signal);
  },
});
