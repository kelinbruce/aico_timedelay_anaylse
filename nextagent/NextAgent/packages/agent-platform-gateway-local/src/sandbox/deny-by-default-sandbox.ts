import type { SafeError } from '@nextagent/agent-common';
import type { BackgroundStartResult, SandboxExecutionRequest, SandboxExecutionResult, SandboxGatewayPort } from '@nextagent/agent-contracts/gateway';

export type DenyByDefaultSandboxReason = 'disabled' | 'unconfigured' | 'unsupported-platform' | 'remote-unavailable' | 'prerequisite-missing';

export interface DenyByDefaultSandboxOptions {
  readonly reason: DenyByDefaultSandboxReason;
}

export type DenyByDefaultSandboxGatewayPort = SandboxGatewayPort;

const safeErrors: Readonly<Record<DenyByDefaultSandboxReason, SafeError>> = {
  disabled: {
    code: 'SANDBOX_DISABLED',
    message: 'Sandbox execution is disabled.',
    category: 'UNAVAILABLE',
    retryable: false,
    safeDetails: { reason: 'disabled' },
  },
  unconfigured: {
    code: 'SANDBOX_UNCONFIGURED',
    message: 'Sandbox execution is not configured.',
    category: 'UNAVAILABLE',
    retryable: false,
    safeDetails: { reason: 'unconfigured' },
  },
  'unsupported-platform': {
    code: 'SANDBOX_UNSUPPORTED_PLATFORM',
    message: 'Sandbox execution is not supported on this platform.',
    category: 'UNAVAILABLE',
    retryable: false,
    safeDetails: { reason: 'unsupported-platform' },
  },
  'remote-unavailable': {
    code: 'SANDBOX_REMOTE_UNAVAILABLE',
    message: 'Remote sandbox execution is unavailable.',
    category: 'UNAVAILABLE',
    retryable: true,
    safeDetails: { reason: 'remote-unavailable' },
  },
  'prerequisite-missing': {
    code: 'SANDBOX_PREREQUISITE_MISSING',
    message: 'Sandbox execution prerequisite is missing.',
    category: 'UNAVAILABLE',
    retryable: false,
    safeDetails: { reason: 'prerequisite-missing' },
  },
};

export function createDenyByDefaultSandboxGateway(options: DenyByDefaultSandboxOptions): DenyByDefaultSandboxGatewayPort {
  return new DenyByDefaultSandboxGateway(options);
}

class DenyByDefaultSandboxGateway implements DenyByDefaultSandboxGatewayPort {
  constructor(private readonly options: DenyByDefaultSandboxOptions) {}

  async execute(request: SandboxExecutionRequest, signal?: AbortSignal): Promise<SandboxExecutionResult> {
    const startedAt = Date.now();
    return {
      executionId: request.executionId,
      stdout: '',
      stderr: '',
      stdoutTruncated: false,
      stderrTruncated: false,
      timedOut: false,
      durationMs: Date.now() - startedAt,
      safeError: signal?.aborted === true ? canceledSafeError() : safeErrors[this.options.reason],
    };
  }

  async startBackground(_request: SandboxExecutionRequest): Promise<BackgroundStartResult | SafeError> {
    return {
      code: 'SANDBOX_BACKGROUND_UNAVAILABLE',
      message: 'Background sandbox execution is unavailable in this deployment.',
      category: 'UNAVAILABLE',
      retryable: false,
      safeDetails: { reason: this.options.reason },
    };
  }
}

function canceledSafeError(): SafeError {
  return {
    code: 'SANDBOX_EXECUTION_CANCELED',
    message: 'Sandbox execution was canceled before submission.',
    category: 'CANCELED',
    retryable: false,
  };
}
