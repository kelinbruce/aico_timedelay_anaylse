import { AgentError, brand, type JsonObject } from '@nextagent/agent-common';

import { defineTool } from '../../tools/tool-spi.js';
import { builtinToolPresentation } from '../presentation-names.js';
import { editInputSchema, editOutputSchema } from './edit-schemas.js';

export const editCapabilityId = brand<string, 'CapabilityId'>('Edit');

const editToolDescription = [
  'Replace exact text in one authorized existing execution file.',
  '',
  'Path roots:',
  '- Unqualified relative paths resolve under `workspace/`.',
  '- Use `workspace/...` for files that should persist across runs.',
  '- Use `temp/...` for files needed only by the current run.',
  '- Successful results return a root-qualified canonical `file_path`.',
  '',
  'Usage:',
  '- Use the exact path returned by Read. The same file must have a full Read snapshot from offset 0 with no truncation before Edit.',
  '- When editing text from Read tool output, ensure you preserve the exact indentation (tabs/spaces) as it appears in the content.',
  '- Use Edit for a targeted change; use Write to create a file or intentionally replace its complete content.',
  '- Edit can modify authorized execution files. Loaded Skill resources under `.nextagent/skills/...` are read-only projections; if a Skill script needs repair, output a patch/diff. To validate a repair, copy the script and required dependency files into `workspace/` while preserving their relative layout, then run the workspace copy instead of editing `.nextagent`.',
  '- Use the smallest old_string that is clearly unique; 2-4 adjacent lines is usually enough context.',
  '- If the target changed after Read, fully Read the same path again before editing. If old_string is absent or non-unique, use the latest content to correct it, add surrounding context, or set replace_all only when every occurrence should change.',
  '- Use replace_all to rename a string across the whole file (e.g., renaming a variable).',
].join('\n');

export const editToolDefinition = defineTool({
  name: editCapabilityId,
  ...builtinToolPresentation('Edit'),
  description: editToolDescription,
  inputSchema: editInputSchema,
  outputSchema: editOutputSchema,
  requiredDependencies: ['workspaceFiles'],
  replayPolicy: 'NON_IDEMPOTENT',
  disclosurePolicy: { mode: 'EAGER' },
  async execute(input: JsonObject, options) {
    if (options?.deps?.workspaceFiles === undefined || options.context === undefined) {
      throw new AgentError({
        code: options?.deps?.workspaceFiles === undefined ? 'TOOL_DEPENDENCY_MISSING' : 'TOOL_CONTEXT_MISSING',
        message:
          options?.deps?.workspaceFiles === undefined
            ? 'Edit could not start because the governed workspace-file dependency is unavailable. Preserve the intended change, use another available capability, or stop and report the unavailable file boundary.'
            : 'Edit could not start because its trusted execution context is unavailable. Preserve the intended change, use another available capability, or stop and report the missing execution context.',
        category: options?.deps?.workspaceFiles === undefined ? 'UNAVAILABLE' : 'INTERNAL',
        retryable: false,
      });
    }
    return options.deps.workspaceFiles.editText(input, options.context, options.signal);
  },
});
