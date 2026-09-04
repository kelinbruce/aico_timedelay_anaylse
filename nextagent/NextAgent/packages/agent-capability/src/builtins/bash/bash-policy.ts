import { AgentError } from '@nextagent/agent-common';

export interface ParsedBashCommand {
  readonly executable: string;
  readonly args: readonly string[];
}

export function parseBashCommand(command: string): ParsedBashCommand {
  const tokens = tokenize(command);
  const executable = tokens[0];
  if (executable === undefined) {
    throw commandParseError();
  }
  return { executable, args: tokens.slice(1) };
}

const DOUBLE_QUOTE_ESCAPES = new Set(['"', '\\', '$', '`']);
const SHELL_BOUNDARY_CHARS = /[\s|&;()<>'"]/u;

function tokenize(command: string): readonly string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: "'" | '"' | undefined;
  const source = command.trim();
  for (let index = 0; index < source.length; index++) {
    const character = source[index] ?? '';
    if (quote === '"') {
      const result = processDoubleQuoteChar(character, source, index);
      current += result.append;
      if (result.close) {
        quote = undefined;
      }
      index = result.nextIndex;
      continue;
    }
    if (quote === "'") {
      const result = processSingleQuoteChar(character, source, index);
      current += result.append;
      if (result.close) {
        quote = undefined;
      }
      index = result.nextIndex;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
    } else if (/\s/u.test(character)) {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
    } else {
      current += character;
    }
  }
  if (quote !== undefined) {
    throw commandParseError();
  }
  if (current.length > 0) {
    tokens.push(current);
  }
  if (tokens.length === 0) {
    throw commandParseError();
  }
  return tokens;
}

function processDoubleQuoteChar(character: string, source: string, index: number): { append: string; close: boolean; nextIndex: number } {
  if (character === '\\') {
    const next = source[index + 1];
    if (next !== undefined && DOUBLE_QUOTE_ESCAPES.has(next)) {
      return { append: next, close: false, nextIndex: index + 1 };
    }
    if (next === '\n') {
      return { append: '', close: false, nextIndex: index + 1 };
    }
    return { append: character, close: false, nextIndex: index };
  }
  if (character === '"') {
    return { append: '', close: true, nextIndex: index };
  }
  return { append: character, close: false, nextIndex: index };
}

function processSingleQuoteChar(character: string, source: string, index: number): { append: string; close: boolean; nextIndex: number } {
  if (character === "'") {
    const next = source[index + 1];
    if (next !== undefined && !SHELL_BOUNDARY_CHARS.test(next)) {
      return { append: character, close: false, nextIndex: index };
    }
    return { append: '', close: true, nextIndex: index };
  }
  return { append: character, close: false, nextIndex: index };
}

function commandParseError(): AgentError {
  return new AgentError({
    code: 'COMMAND_NOT_ALLOWED',
    message:
      'The sandbox policy could not authorize the Bash command because it was not safely tokenizable. Choose an already allowed alternative capability or stop and report that the command cannot run in the governed sandbox.',
    category: 'AUTHORIZATION',
    retryable: false,
  });
}
