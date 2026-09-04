/**
 * Frontend mirror of the backend capability directive parser
 * (packages/agent-core/src/routing/capability-directive-parser.ts).
 *
 * Used for submit-time preflight checks and optimistic envelope projection so
 * the UI can reject / preview pure `$skill:` / `$workflow:` directives before
 * the request reaches the runtime, matching the backend stripping semantics.
 */

const DIRECTIVE_PATTERN = /\$(skill|workflow):(\S*)/gu;
const SAFE_DIRECTIVE_NAME_PATTERN = /^[A-Za-z0-9._-]+$/u;

export interface ParsedCapabilityDirective {
  readonly kind: 'skill' | 'workflow';
  readonly name: string;
}

/**
 * Strip every recognized `$skill:<name>` / `$workflow:<name>` token from the
 * raw input and trim the remainder, yielding the effective user question.
 * Mirrors `normalizeCapabilityDirectiveInput` minus the routing-constraint
 * projection (the backend owns the authoritative projection).
 */
export function stripDirectives(raw: string): string {
  return raw.replace(DIRECTIVE_PATTERN, '').trim();
}

/**
 * Parse the first valid, unambiguous capability directive in the raw input.
 * Returns the first directive when all directives agree on kind+name; returns
 * undefined when there is no directive, the name is unsafe, or directives
 * conflict (mirrors backend `parseCapabilityDirective` fail-closed semantics).
 */
export function parseDirectiveTarget(raw: string): ParsedCapabilityDirective | undefined {
  const matches = [...raw.matchAll(DIRECTIVE_PATTERN)];
  if (matches.length === 0) {
    return undefined;
  }
  const first = matches[0];
  if (first === undefined) {
    return undefined;
  }
  const firstKind = first[1] === 'skill' ? 'skill' : 'workflow';
  const firstName = first[2] ?? '';
  if (!SAFE_DIRECTIVE_NAME_PATTERN.test(firstName)) {
    return undefined;
  }
  if (matches.some((match) => match[1] !== firstKind || (match[2] ?? '') !== firstName)) {
    return undefined;
  }
  return { kind: firstKind, name: firstName };
}
