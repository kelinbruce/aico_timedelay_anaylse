import type {
  HookInput,
  HookResult,
  LifecycleHookDefinition,
  LifecycleHookInvocationCoordinates,
  ModelInvokeBoundary,
} from '@nextagent/agent-contracts/runtime';
import { AgentError, type JsonObject, type SubjectId, type TenantId } from '@nextagent/agent-common';

export interface RegisteredLifecycleHookHandlers {
  readonly [hookId: string]: (input: HookInput, signal: AbortSignal) => Promise<HookResult>;
}

export interface RuntimeLifecycleHookExecutor {
  invoke: (input: HookInput, signal?: AbortSignal) => Promise<HookResult>;
}

export interface TrustedTerminalLifecycleHookInput {
  readonly hookId: string;
  readonly coordinates: LifecycleHookInvocationCoordinates;
  readonly ownerScope: { readonly tenantId: TenantId; readonly subjectId: SubjectId };
  readonly boundary: ModelInvokeBoundary;
}

export interface TrustedTerminalLifecycleHookDiagnostic {
  readonly diagnosticCode: string;
  readonly candidateCount?: number;
  readonly detailCount?: number;
  readonly contextDisposition?: 'L2_CONTEXT' | 'L1_CONTEXT' | 'NO_CONTEXT';
}

export type TrustedTerminalLifecycleHookResult =
  | {
      readonly outcome: 'PASS';
      readonly mutation?: { readonly messages: readonly JsonObject[] };
      readonly diagnostic?: TrustedTerminalLifecycleHookDiagnostic;
    }
  | { readonly outcome: 'SKIP'; readonly diagnostic?: TrustedTerminalLifecycleHookDiagnostic };

export interface TrustedTerminalLifecycleHookExecutor {
  isRegistered: (hookId: string) => boolean;
  invoke: (input: TrustedTerminalLifecycleHookInput, signal: AbortSignal) => Promise<TrustedTerminalLifecycleHookResult>;
}

export type TrustedTerminalLifecycleHookHandler = (
  input: TrustedTerminalLifecycleHookInput,
  signal: AbortSignal,
) => Promise<TrustedTerminalLifecycleHookResult>;

export class RegisteredTrustedTerminalLifecycleHookExecutor implements TrustedTerminalLifecycleHookExecutor {
  private readonly handlers: ReadonlyMap<string, TrustedTerminalLifecycleHookHandler>;

  constructor(handlers: Readonly<Record<string, TrustedTerminalLifecycleHookHandler>>) {
    this.handlers = new Map(Object.entries(handlers));
  }

  isRegistered(hookId: string): boolean {
    return this.handlers.has(hookId);
  }

  async invoke(input: TrustedTerminalLifecycleHookInput, signal: AbortSignal): Promise<TrustedTerminalLifecycleHookResult> {
    const handler = this.handlers.get(input.hookId);
    if (handler === undefined) {
      throw new AgentError({
        code: 'LIFECYCLE_HOOK_UNAVAILABLE',
        message: `Trusted terminal lifecycle hook "${input.hookId}" is not registered.`,
        category: 'UNAVAILABLE',
        retryable: false,
      });
    }
    return handler(input, signal);
  }
}

export class RegisteredLifecycleHookExecutor implements RuntimeLifecycleHookExecutor {
  private readonly handlers: ReadonlyMap<string, RegisteredLifecycleHookHandlers[string]>;

  constructor(handlers: RegisteredLifecycleHookHandlers) {
    this.handlers = new Map(Object.entries(handlers));
  }

  async invoke(input: HookInput, signal?: AbortSignal): Promise<HookResult> {
    const handler = this.handlers.get(input.hookId);
    if (handler === undefined) {
      throw new AgentError({
        code: 'LIFECYCLE_HOOK_UNAVAILABLE',
        message: `Lifecycle hook "${input.hookId}" is not registered.`,
        category: 'UNAVAILABLE',
        retryable: false,
      });
    }
    return handler(input, signal ?? AbortSignal.timeout(30_000));
  }
}
