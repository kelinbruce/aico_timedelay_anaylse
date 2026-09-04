import { AgentError, brand, type JsonObject } from '@nextagent/agent-common';

import { defineTool, type TodoStateItem } from '../../tools/tool-spi.js';
import { builtinToolPresentation } from '../presentation-names.js';
import { todoWriteInputSchema, todoWriteOutputSchema } from './todo-write-schemas.js';

export const todoWriteCapabilityId = brand<string, 'CapabilityId'>('TodoWrite');

export const todoWriteToolDefinition = defineTool({
  name: todoWriteCapabilityId,
  ...builtinToolPresentation('TodoWrite'),
  description:
    'Set the current scoped progress todo list to the full ordered list for this request context. ' +
    'To add a new item, include all existing unfinished items plus the new item in the submitted list. ' +
    'Use TodoWrite for multi-step telecom diagnostics, configuration checks, change analysis, or report generation progress. ' +
    'Do not use TodoWrite to create background tasks, workflow jobs, approvals, pending input, tickets, or cross-session project records.',
  inputSchema: todoWriteInputSchema,
  outputSchema: todoWriteOutputSchema,
  requiredDependencies: ['todoState'],
  replayPolicy: 'IDEMPOTENT',
  async execute(args, options) {
    if (options?.deps?.todoState === undefined || options.context === undefined) {
      throw new AgentError({
        code: options?.deps?.todoState === undefined ? 'TOOL_DEPENDENCY_MISSING' : 'TOOL_CONTEXT_MISSING',
        message:
          'TodoWrite could not update the scoped progress list because its required state dependency or trusted execution context is unavailable. Stop this progress update and report the unavailable boundary.',
        category: options?.deps?.todoState === undefined ? 'UNAVAILABLE' : 'INTERNAL',
        retryable: false,
      });
    }
    const inputTodos = readTodos(args.todos);
    const todos = inputTodos.length > 0 && inputTodos.every((todo) => todo.status === 'completed') ? [] : inputTodos;
    const result = await options.deps.todoState.replaceTodos({ todos }, options.context, options.signal);
    return {
      oldTodos: result.oldTodos.map(todoJson),
      newTodos: result.newTodos.map(todoJson),
    };
  },
});

function readTodos(value: unknown): readonly TodoStateItem[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => {
    const record = item as Record<string, unknown>;
    return {
      content: String(record['content']),
      activeForm: String(record['activeForm']),
      status: record['status'] as TodoStateItem['status'],
    };
  });
}

function todoJson(todo: TodoStateItem): JsonObject {
  return {
    content: todo.content,
    activeForm: todo.activeForm,
    status: todo.status,
  };
}
