import type { JsonObject } from '@nextagent/agent-common';

const MAX_TOTAL_ITERATIONS = 10;

type TokenKind = 'TEXT' | 'FOR_OPEN' | 'FOR_CLOSE' | 'IF_OPEN' | 'IF_CLOSE' | 'VARIABLE';

interface Token {
  kind: TokenKind;
  raw: string;
  loopVar?: string;
  iterablePath?: string;
  conditionPath?: string;
}

const TAG_PATTERN = /(\{%\s*(?:for\s+\w+\s+in\s+[.\w]+|endfor|if\s+[.\w]+|endif|.+?)\s*%\})|(\$\{[^}]+\})|(\{\{\s*[^}]+\s*\}\})/gu;

function tokenize(template: string): Token[] {
  const tokens: Token[] = [];
  let lastIndex = 0;

  for (const match of template.matchAll(TAG_PATTERN)) {
    const fullMatch = match[0]!;
    const offset = match.index!;

    if (offset > lastIndex) {
      tokens.push({ kind: 'TEXT', raw: template.slice(lastIndex, offset) });
    }
    lastIndex = offset + fullMatch.length;

    if (fullMatch.startsWith('{%')) {
      const inner = fullMatch.slice(2, -2).trim();

      const forOpenMatch = /^for\s+(\w+)\s+in\s+([.\w]+)$/u.exec(inner);
      if (forOpenMatch !== null) {
        tokens.push({ kind: 'FOR_OPEN', raw: fullMatch, loopVar: forOpenMatch[1]!, iterablePath: forOpenMatch[2]! });
        continue;
      }

      if (inner === 'endfor') {
        tokens.push({ kind: 'FOR_CLOSE', raw: fullMatch });
        continue;
      }

      const ifMatch = /^if\s+([.\w]+)$/u.exec(inner);
      if (ifMatch !== null) {
        tokens.push({ kind: 'IF_OPEN', raw: fullMatch, conditionPath: ifMatch[1]! });
        continue;
      }

      if (inner === 'endif') {
        tokens.push({ kind: 'IF_CLOSE', raw: fullMatch });
        continue;
      }

      throw templateError('TEMPLATE_SYNTAX_ERROR', `Unsupported template tag: ${inner}`);
    }

    tokens.push({ kind: 'VARIABLE', raw: fullMatch });
  }

  if (lastIndex < template.length) {
    tokens.push({ kind: 'TEXT', raw: template.slice(lastIndex) });
  }

  return tokens;
}

export function renderTemplate(template: string, scope: JsonObject): string {
  const tokens = tokenize(template);
  let totalIterations = 0;
  return renderTokens(tokens, 0, scope, tokens.length, {
    totalIterations: () => totalIterations,
    addIterations(n: number) {
      totalIterations += n;
      if (totalIterations > MAX_TOTAL_ITERATIONS) {
        throw templateError('TEMPLATE_LOOP_LIMIT_EXCEEDED', 'Template loop iteration limit exceeded.');
      }
    },
  });
}

interface IterationGuard {
  totalIterations: () => number;
  addIterations: (n: number) => void;
}

function renderTokens(tokens: Token[], start: number, scope: JsonObject, end: number, guard: IterationGuard): string {
  const parts: string[] = [];
  let i = start;

  while (i < end) {
    const token = tokens[i]!;

    switch (token.kind) {
      case 'TEXT':
        parts.push(token.raw);
        i += 1;
        break;

      case 'VARIABLE':
        parts.push(resolveVariable(token.raw, scope));
        i += 1;
        break;

      case 'FOR_OPEN': {
        const closeIndex = findMatchingClose(tokens, i + 1, 'FOR_OPEN', 'FOR_CLOSE');
        if (closeIndex === -1) {
          throw templateError('TEMPLATE_UNCLOSED_BLOCK', `Unclosed {% for %} block starting at: ${token.raw}`);
        }
        const iterable = resolveVariablePath(scope, token.iterablePath!);
        if (Array.isArray(iterable)) {
          for (const element of iterable) {
            guard.addIterations(1);
            const loopScope = { ...scope, [token.loopVar!]: element } as JsonObject;
            parts.push(renderTokens(tokens, i + 1, loopScope, closeIndex, guard));
          }
        }
        i = closeIndex + 1;
        break;
      }

      case 'IF_OPEN': {
        const closeIndex = findMatchingClose(tokens, i + 1, 'IF_OPEN', 'IF_CLOSE');
        if (closeIndex === -1) {
          throw templateError('TEMPLATE_UNCLOSED_BLOCK', `Unclosed {% if %} block starting at: ${token.raw}`);
        }
        const conditionValue = resolveVariablePath(scope, token.conditionPath!);
        if (isTruthy(conditionValue)) {
          parts.push(renderTokens(tokens, i + 1, scope, closeIndex, guard));
        }
        i = closeIndex + 1;
        break;
      }

      case 'FOR_CLOSE':
      case 'IF_CLOSE':
        i += 1;
        break;
    }
  }

  return parts.join('');
}

function findMatchingClose(tokens: Token[], start: number, openKind: TokenKind, closeKind: TokenKind): number {
  let depth = 1;
  for (let i = start; i < tokens.length; i += 1) {
    const token = tokens[i]!;
    if (token.kind === openKind) {
      depth += 1;
    } else if (token.kind === closeKind) {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
  }
  return -1;
}

function resolveVariable(raw: string, scope: JsonObject): string {
  const dollarMatch = /^\$\{([^}]+)\}$/u.exec(raw.trim());
  if (dollarMatch !== null) {
    const value = resolveVariablePath(scope, dollarMatch[1]!.trim());
    return value === undefined ? '' : stringifyValue(value);
  }

  const mustacheMatch = /^\{\{\s*([^}]+?)\s*\}\}$/u.exec(raw.trim());
  if (mustacheMatch !== null) {
    const value = resolveVariablePath(scope, mustacheMatch[1]!.trim());
    return value === undefined ? '' : stringifyValue(value);
  }

  return raw;
}

function resolveVariablePath(root: JsonObject, path: string): unknown {
  let current: unknown = root;
  for (const segment of path.split('.')) {
    if (current === undefined || current === null) {
      return undefined;
    }
    if (typeof current === 'object' && !Array.isArray(current)) {
      current = (current as Record<string, unknown>)[segment];
    } else {
      return undefined;
    }
  }
  return current;
}

function isTruthy(value: unknown): boolean {
  if (value === undefined || value === null || value === false) {
    return false;
  }
  if (typeof value === 'string' && value.length === 0) {
    return false;
  }
  if (typeof value === 'number' && value === 0) {
    return false;
  }
  if (Array.isArray(value) && value.length === 0) {
    return false;
  }
  if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value as object).length === 0) {
    return false;
  }
  return true;
}

function stringifyValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value);
}

function templateError(code: string, message: string): Error {
  const error = new Error(message);
  error.name = code;
  return error;
}
