import { AgentError } from '@nextagent/agent-common';
import type { CredentialResolver } from '@nextagent/agent-model';
import { readFileSync } from 'node:fs';

export type SecretReferenceKind = 'env' | 'file' | 'unsupported';

export interface SecretReferenceValidation {
  readonly valid: boolean;
  readonly referenceKind: SecretReferenceKind;
  readonly issueCode?: 'APP_CONFIG_SECRET_REF_INVALID' | 'APP_CONFIG_SECRET_REF_UNAVAILABLE';
}

export interface AppCredentialResolver extends CredentialResolver {
  validate: (ref: string) => SecretReferenceValidation;
  resolveEnv?: (name: string) => string | undefined;
}

export function createAppCredentialResolver(env: NodeJS.ProcessEnv = process.env): AppCredentialResolver {
  const resolveEnv = (name: string): string | undefined => env[name];
  const validate = (ref: string): SecretReferenceValidation => {
    const parsed = parseReference(ref);
    if (parsed === undefined) {
      return { valid: false, referenceKind: 'unsupported', issueCode: 'APP_CONFIG_SECRET_REF_INVALID' };
    }
    try {
      const value = parsed.kind === 'env' ? env[parsed.target] : readFileSync(parsed.target, 'utf8');
      return value !== undefined && value.length > 0
        ? { valid: true, referenceKind: parsed.kind }
        : { valid: false, referenceKind: parsed.kind, issueCode: 'APP_CONFIG_SECRET_REF_UNAVAILABLE' };
    } catch {
      return { valid: false, referenceKind: parsed.kind, issueCode: 'APP_CONFIG_SECRET_REF_UNAVAILABLE' };
    }
  };
  const resolver = async (ref: string): Promise<string> => {
    const result = validate(ref);
    if (!result.valid) {
      throw new AgentError({
        code: result.issueCode ?? 'APP_CONFIG_SECRET_REF_UNAVAILABLE',
        message: 'Configured credential is unavailable.',
        category: 'UNAVAILABLE',
        retryable: false,
      });
    }
    const parsed = parseReference(ref);
    if (parsed === undefined) {
      throw new AgentError({
        code: 'APP_CONFIG_SECRET_REF_INVALID',
        message: 'Configured credential is unavailable.',
        category: 'VALIDATION',
        retryable: false,
      });
    }
    return parsed.kind === 'env' ? (env[parsed.target] as string) : readFileSync(parsed.target, 'utf8').trim();
  };
  return Object.assign(resolver, { validate, resolveEnv });
}

function parseReference(ref: string): { readonly kind: 'env' | 'file'; readonly target: string } | undefined {
  const match = /^(env|file):(.+)$/u.exec(ref);
  if (match?.[1] !== 'env' && match?.[1] !== 'file') {
    return undefined;
  }
  const target = match[2];
  return target === undefined || target.length === 0 ? undefined : { kind: match[1], target };
}
