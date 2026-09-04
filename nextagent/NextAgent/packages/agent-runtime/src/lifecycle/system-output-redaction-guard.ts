import type { JsonObject } from '@nextagent/agent-common';
import type { HookInput, HookResult, LifecycleHook } from '@nextagent/agent-contracts/runtime';
import { defineLifecycleHook } from './lifecycle-hook-validation.js';

export const systemOutputRedactionGuardHook: LifecycleHook<readonly ['BEFORE_AGENT_TERMINAL']> = defineLifecycleHook(
  Object.freeze({
    hookId: 'system.output-redaction-guard',
    kind: 'SYSTEM',
    supportedStages: Object.freeze(['BEFORE_AGENT_TERMINAL'] as const),
    effects: Object.freeze(['TRANSFORM', 'CONTROL'] as const),
    failureMode: 'FAIL',
    order: Object.freeze({ priority: 0 }),
    timeoutMs: 100,
    configSchema: Object.freeze({
      type: 'object',
      additionalProperties: false,
      properties: {
        redactionToken: { type: 'string' },
        blockPrivateKeys: { type: 'boolean' },
      },
    }),
    configure(config: JsonObject) {
      const redactionToken =
        typeof config['redactionToken'] === 'string' && config['redactionToken'].length > 0 ? config['redactionToken'] : 'REDACTED';
      const blockPrivateKeys = config['blockPrivateKeys'] !== false;
      return {
        execute(input: HookInput<'BEFORE_AGENT_TERMINAL'>): HookResult<'BEFORE_AGENT_TERMINAL'> {
          return outputRedactionGuard(input, { redactionToken, blockPrivateKeys });
        },
      };
    },
    execute(input: HookInput<'BEFORE_AGENT_TERMINAL'>): HookResult<'BEFORE_AGENT_TERMINAL'> {
      return outputRedactionGuard(input, { redactionToken: 'REDACTED', blockPrivateKeys: true });
    },
  }),
);

function outputRedactionGuard(
  input: HookInput<'BEFORE_AGENT_TERMINAL'>,
  policy: { readonly redactionToken: string; readonly blockPrivateKeys: boolean },
): HookResult<'BEFORE_AGENT_TERMINAL'> {
  const finalContent = input.boundary.finalContent;
  if (typeof finalContent !== 'string' || finalContent.length === 0) {
    return { outcome: 'PASS' };
  }
  if (policy.blockPrivateKeys && /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----/iu.test(finalContent)) {
    return { outcome: 'BLOCK', safeReason: 'OUTPUT_REDACTION_GUARD_HIGH_RISK_SECRET' };
  }
  const replacements: Array<{ readonly pattern: RegExp; readonly token: string }> = [
    { pattern: /\b(?:password|credential|secret|api[-_]?key|access[-_]?token)\s*[:=]\s*[^\s,;]+/giu, token: `[${policy.redactionToken}_SECRET]` },
    { pattern: /\bBearer\s+[A-Za-z0-9._\-~+/=]+/gu, token: `Bearer [${policy.redactionToken}_TOKEN]` },
    { pattern: /\bsk-[A-Za-z0-9._-]{10,}\b/gu, token: `[${policy.redactionToken}_TOKEN]` },
    { pattern: /\b1[3-9]\d{9}\b/gu, token: `[${policy.redactionToken}_PHONE]` },
  ];
  let redacted = finalContent;
  let changed = false;
  for (const replacement of replacements) {
    const next = redacted.replace(replacement.pattern, replacement.token);
    if (next !== redacted) {
      changed = true;
      redacted = next;
    }
  }
  if (!changed) {
    return { outcome: 'PASS' };
  }
  return {
    outcome: 'PASS',
    mutation: { finalContent: redacted },
    safeReason: 'OUTPUT_REDACTION_GUARD_REDACTED',
  };
}
