import type {
  CapabilityCurrentDiscoveryCriteria,
  CapabilityDescriptor,
  CapabilityDiscovery,
  CapabilityExecutor,
  CapabilityProviderIdentity,
  CapabilityProvider,
  ToolExecutableDiscovery,
} from '@nextagent/agent-contracts/capability';
import { capabilityDescriptorSchema } from '@nextagent/agent-contracts/capability';
import { Ajv } from 'ajv/dist/ajv.js';

import { BuiltinToolsExecutor, type ProviderBoundCapabilityExecutor } from './execution/executor.js';
import { CapabilityConfigurationError } from './provider-config.js';
import type { SkillSourceDiscovery } from './skills/skill-source-discovery.js';

const pluginToolProviderType = 'nextagent-plugin-tool';
const discoveryTimeoutMs = 60_000;
const ajv = new Ajv({ strict: false, allErrors: true });
const validateCapabilityDescriptor = ajv.compile(capabilityDescriptorSchema);

export type ExtensionRegistrationDiagnosticReasonCode =
  | 'DUPLICATE_PROVIDER'
  | 'DISCOVERY_UNAVAILABLE'
  | 'DISCOVERY_PROVIDER_MISMATCH'
  | 'DISCOVERY_FAILED'
  | 'DISCOVERY_TIMED_OUT'
  | 'DISCOVERY_CANCELED'
  | 'EXECUTOR_UNAVAILABLE'
  | 'TOOL_CONFIG_INVALID'
  | 'TOOL_DEPENDENCY_MISSING'
  | 'PLUGIN_PROVIDER_DESCRIPTOR_KIND_UNSUPPORTED'
  | 'DESCRIPTOR_PROVIDER_MISMATCH';

export interface ExtensionRegistrationDiagnostic {
  readonly severity: 'ERROR' | 'WARNING';
  readonly reasonCode: ExtensionRegistrationDiagnosticReasonCode;
  readonly providerId: string;
  readonly capabilityId?: string;
  readonly summary: string;
}

export interface FrozenCapabilityProviderSnapshot {
  readonly providers: readonly CapabilityProvider[];
  readonly eagerDiscoveries: readonly CapabilityDiscovery[];
  readonly searchDiscoveries: readonly CapabilityDiscovery[];
  readonly executors: readonly ProviderBoundCapabilityExecutor[];
  readonly diagnostics: readonly ExtensionRegistrationDiagnostic[];
  validateStartupRegistration: (signal: AbortSignal) => Promise<readonly ExtensionRegistrationDiagnostic[]>;
}

export function assembleCapabilityProviders(providers: readonly CapabilityProvider[]): FrozenCapabilityProviderSnapshot {
  const diagnostics = new ExtensionRegistrationDiagnostics();
  const providerIds = new Set<string>();
  const eagerGuards: ProviderDiscoveryGuard[] = [];
  const eagerDiscoveries: CapabilityDiscovery[] = [];
  const searchDiscoveries: CapabilityDiscovery[] = [];
  const executors: ProviderBoundCapabilityExecutor[] = [];

  for (const provider of providers) {
    const providerId = provider.identity.providerId;
    if (providerIds.has(providerId)) {
      diagnostics.record('ERROR', 'DUPLICATE_PROVIDER', provider.identity, 'Duplicate capability provider.');
      throw new CapabilityConfigurationError('Duplicate capability provider.');
    }
    providerIds.add(providerId);
    if (!isCapabilityDiscovery(provider.discovery)) {
      diagnostics.record('ERROR', 'DISCOVERY_UNAVAILABLE', provider.identity, 'Capability discovery is unavailable.');
      throw new CapabilityConfigurationError('Capability provider discovery support is unavailable.');
    }
    if (!sameProvider(provider.identity, provider.discovery.provider)) {
      diagnostics.record('ERROR', 'DISCOVERY_PROVIDER_MISMATCH', provider.identity, 'Provider discovery identity mismatch.');
      throw new CapabilityConfigurationError('Capability provider discovery identity mismatch.');
    }

    const executor = provider.executor ?? deriveDefaultExecutor(provider);
    const discovery = new ProviderDiscoveryGuard(provider.identity, provider.discovery, executor !== undefined, diagnostics);
    if (discovery.discoveryMode === 'EAGER') {
      eagerGuards.push(discovery);
      eagerDiscoveries.push(discovery);
    } else {
      searchDiscoveries.push(discovery);
    }
    if (executor !== undefined) {
      executors.push({ provider: provider.identity, executor });
    }
  }

  return deepFreeze({
    providers: providers.map((provider) => Object.freeze({ ...provider })),
    eagerDiscoveries,
    searchDiscoveries,
    executors,
    get diagnostics() {
      return diagnostics.snapshot();
    },
    async validateStartupRegistration(signal: AbortSignal): Promise<readonly ExtensionRegistrationDiagnostic[]> {
      for (const discovery of eagerGuards) {
        await discovery.prepareStartup(signal);
      }
      return diagnostics.snapshot();
    },
  });
}

function deriveDefaultExecutor(provider: CapabilityProvider): CapabilityExecutor | undefined {
  if (!isToolExecutableDiscovery(provider.discovery)) {
    return undefined;
  }
  return new BuiltinToolsExecutor(provider.discovery);
}

function isToolExecutableDiscovery(discovery: CapabilityDiscovery): discovery is ToolExecutableDiscovery {
  return (
    discovery.discoveryMode === 'EAGER' &&
    typeof discovery.listAll === 'function' &&
    'resolveExecutable' in discovery &&
    typeof discovery.resolveExecutable === 'function'
  );
}

function isCapabilityDiscovery(value: unknown): value is CapabilityDiscovery {
  return value !== null && typeof value === 'object' && 'provider' in value && 'discoveryMode' in value;
}

class ProviderDiscoveryGuard implements CapabilityDiscovery {
  readonly provider: CapabilityProviderIdentity;
  readonly discoveryMode: CapabilityDiscovery['discoveryMode'];
  readonly listAll?: (signal: AbortSignal) => Promise<readonly CapabilityDescriptor[]>;
  readonly resolve?: (capabilityId: CapabilityDescriptor['capabilityId'], signal: AbortSignal) => Promise<CapabilityDescriptor | undefined>;
  readonly search?: (
    criteria: Parameters<NonNullable<CapabilityDiscovery['search']>>[0],
    signal: AbortSignal,
  ) => Promise<readonly CapabilityDescriptor[]>;
  readonly listCurrent?: (criteria: CapabilityCurrentDiscoveryCriteria, signal: AbortSignal) => Promise<readonly CapabilityDescriptor[]>;
  readonly loadCanonicalBodyView?: SkillSourceDiscovery['loadCanonicalBodyView'];
  readonly listSkillResources?: SkillSourceDiscovery['listSkillResources'];
  readonly readSkillResource?: SkillSourceDiscovery['readSkillResource'];
  private startupDescriptors?: readonly CapabilityDescriptor[];

  constructor(
    provider: CapabilityProviderIdentity,
    private readonly inner: CapabilityDiscovery,
    private readonly hasExecutor: boolean,
    private readonly diagnostics: ExtensionRegistrationDiagnostics,
  ) {
    this.provider = provider;
    this.discoveryMode = inner.discoveryMode;
    if (inner.listAll !== undefined) {
      this.listAll = async (signal) => {
        if (this.startupDescriptors !== undefined) {
          return this.startupDescriptors;
        }
        const descriptors = await this.invokeDiscovery((guardedSignal) => inner.listAll!(guardedSignal), [], signal, undefined);
        return this.freezeDescriptors(this.guard(descriptors));
      };
    }
    if (inner.resolve !== undefined) {
      this.resolve = async (capabilityId, signal) => {
        if (this.startupDescriptors !== undefined) {
          const startupDescriptor = this.startupDescriptors.find((descriptor) => descriptor.capabilityId === capabilityId);
          if (startupDescriptor === undefined || startupDescriptor.disclosurePolicy?.mode !== 'DEFERRED') {
            return startupDescriptor;
          }
          const hydrated = await this.invokeDiscovery(
            (guardedSignal) => inner.resolve!(capabilityId, guardedSignal),
            startupDescriptor,
            signal,
            capabilityId,
          );
          return hydrated === undefined ? startupDescriptor : this.guardOne(hydrated);
        }
        const descriptor = await this.invokeDiscovery(
          (guardedSignal) => inner.resolve!(capabilityId, guardedSignal),
          undefined,
          signal,
          capabilityId,
        );
        return descriptor === undefined ? undefined : this.guardOne(descriptor);
      };
    }
    if (inner.search !== undefined) {
      this.search = async (criteria, signal) => {
        const descriptors = await this.invokeDiscovery(
          (guardedSignal) => inner.search!(criteria, guardedSignal),
          [],
          signal,
          criteria.requestedCapabilityId,
        );
        return this.guard(descriptors);
      };
    }
    if (inner.discoveryMode === 'EAGER') {
      this.listCurrent = async (_criteria, signal) => {
        if (signal.aborted) {
          throw new Error('Capability current discovery was canceled.');
        }
        if (this.startupDescriptors === undefined) {
          throw new Error('Capability current discovery is unavailable.');
        }
        return this.startupDescriptors;
      };
    } else if (inner.listCurrent !== undefined) {
      this.listCurrent = async (criteria, signal) => {
        const descriptors = await this.invokeCurrentDiscovery((guardedSignal) => inner.listCurrent!(criteria, guardedSignal), signal);
        if (!Array.isArray(descriptors) || descriptors.some((descriptor) => validateCapabilityDescriptor(descriptor) !== true)) {
          throw new Error('Capability current discovery returned invalid descriptors.');
        }
        return this.freezeDescriptors(this.guard(descriptors));
      };
    }
    if (isSkillSourceDiscovery(inner)) {
      this.loadCanonicalBodyView = (input, signal) => inner.loadCanonicalBodyView(input, signal);
      if (inner.listSkillResources !== undefined) {
        this.listSkillResources = (input, signal) => inner.listSkillResources!(input, signal);
      }
      if (inner.readSkillResource !== undefined) {
        this.readSkillResource = (input, signal) => inner.readSkillResource!(input, signal);
      }
    }
  }

  async prepareStartup(signal: AbortSignal): Promise<void> {
    if (this.discoveryMode !== 'EAGER' || this.listAll === undefined || this.startupDescriptors !== undefined) {
      return;
    }
    const descriptors = this.listAll === undefined ? [] : await this.listAll(signal);
    this.startupDescriptors = this.freezeDescriptors(descriptors);
  }

  getSkillScanEvidence(): ReturnType<NonNullable<CapabilityDiscovery['getSkillScanEvidence']>> {
    return this.inner.getSkillScanEvidence?.() ?? [];
  }

  getSkillScanRoot(): string | undefined {
    return this.inner.getSkillScanRoot?.();
  }

  private guard(descriptors: readonly CapabilityDescriptor[]): readonly CapabilityDescriptor[] {
    return descriptors.map((descriptor) => this.guardOne(descriptor));
  }

  private freezeDescriptors(descriptors: readonly CapabilityDescriptor[]): readonly CapabilityDescriptor[] {
    return Object.freeze(
      descriptors.map((descriptor) =>
        Object.freeze({
          ...descriptor,
          provider: Object.freeze({ ...descriptor.provider }),
        }),
      ),
    );
  }

  private guardOne(descriptor: CapabilityDescriptor): CapabilityDescriptor {
    if (!sameProvider(this.provider, descriptor.provider)) {
      this.recordDiagnostic('ERROR', 'DESCRIPTOR_PROVIDER_MISMATCH', 'Descriptor provider mismatch.', descriptor.capabilityId);
      return makeUnavailable(descriptor, 'DESCRIPTOR_PROVIDER_MISMATCH');
    }
    if (this.provider.providerKind === 'CUSTOM' && this.provider.providerType === pluginToolProviderType && descriptor.kind !== 'TOOL') {
      this.recordDiagnostic(
        'ERROR',
        'PLUGIN_PROVIDER_DESCRIPTOR_KIND_UNSUPPORTED',
        'Plugin provider descriptor kind is unsupported.',
        descriptor.capabilityId,
      );
      return makeUnavailable(descriptor, 'PLUGIN_PROVIDER_DESCRIPTOR_KIND_UNSUPPORTED');
    }
    if (descriptor.kind === 'TOOL' && descriptor.availabilityStatus === 'AVAILABLE' && !this.hasExecutor) {
      this.recordDiagnostic('WARNING', 'EXECUTOR_UNAVAILABLE', 'Capability executor is unavailable.', descriptor.capabilityId);
      return makeUnavailable(descriptor, 'EXECUTOR_UNAVAILABLE');
    }
    if (descriptor.kind === 'TOOL' && descriptor.availabilityStatus === 'AVAILABLE' && hasMissingRequiredDependency(descriptor)) {
      this.recordDiagnostic('ERROR', 'TOOL_DEPENDENCY_MISSING', 'Tool dependency is unavailable.', descriptor.capabilityId);
      return makeUnavailable(descriptor, 'TOOL_DEPENDENCY_MISSING');
    }
    if (descriptor.kind === 'TOOL' && descriptor.availabilityStatus === 'AVAILABLE' && hasInvalidToolConfig(descriptor)) {
      this.recordDiagnostic('ERROR', 'TOOL_CONFIG_INVALID', 'Tool configuration is invalid.', descriptor.capabilityId);
      return makeUnavailable(descriptor, 'TOOL_CONFIG_INVALID');
    }
    return descriptor;
  }

  private async invokeDiscovery<T>(
    action: (signal: AbortSignal) => Promise<T>,
    fallback: T,
    signal: AbortSignal,
    capabilityId?: CapabilityDescriptor['capabilityId'],
  ): Promise<T> {
    const timeoutSignal = AbortSignal.timeout(discoveryTimeoutMs);
    const controller = new AbortController();
    const abortFromInput = () => controller.abort();
    const abortFromTimeout = () => controller.abort();
    signal.addEventListener('abort', abortFromInput, { once: true });
    timeoutSignal.addEventListener('abort', abortFromTimeout, { once: true });
    const timeoutAbort = rejectOnAbort(timeoutSignal, 'DISCOVERY_TIMED_OUT');
    const inputAbort = rejectOnAbort(signal, 'DISCOVERY_CANCELED');
    try {
      return await Promise.race([action(controller.signal), timeoutAbort.promise, inputAbort.promise]);
    } catch (error) {
      const reasonCode = error instanceof DiscoveryGuardError ? error.reasonCode : 'DISCOVERY_FAILED';
      const summary = discoverySummary(reasonCode);
      this.recordDiagnostic(reasonCode === 'DISCOVERY_TIMED_OUT' ? 'WARNING' : 'ERROR', reasonCode, summary, capabilityId);
      return fallback;
    } finally {
      timeoutAbort.dispose();
      inputAbort.dispose();
      signal.removeEventListener('abort', abortFromInput);
      timeoutSignal.removeEventListener('abort', abortFromTimeout);
      abortFromInput();
    }
  }

  private async invokeCurrentDiscovery<T>(action: (signal: AbortSignal) => Promise<T>, signal: AbortSignal): Promise<T> {
    const timeoutSignal = AbortSignal.timeout(discoveryTimeoutMs);
    const controller = new AbortController();
    const abortFromInput = () => controller.abort();
    const abortFromTimeout = () => controller.abort();
    signal.addEventListener('abort', abortFromInput, { once: true });
    timeoutSignal.addEventListener('abort', abortFromTimeout, { once: true });
    const timeoutAbort = rejectOnAbort(timeoutSignal, 'DISCOVERY_TIMED_OUT');
    const inputAbort = rejectOnAbort(signal, 'DISCOVERY_CANCELED');
    try {
      return await Promise.race([action(controller.signal), timeoutAbort.promise, inputAbort.promise]);
    } catch (error) {
      const reasonCode = error instanceof DiscoveryGuardError ? error.reasonCode : 'DISCOVERY_FAILED';
      this.recordDiagnostic(reasonCode === 'DISCOVERY_TIMED_OUT' ? 'WARNING' : 'ERROR', reasonCode, discoverySummary(reasonCode));
      if (reasonCode === 'DISCOVERY_TIMED_OUT') {
        throw new Error('Capability current discovery timed out.', { cause: error });
      }
      if (reasonCode === 'DISCOVERY_CANCELED') {
        throw new Error('Capability current discovery was canceled.', { cause: error });
      }
      throw new Error('Capability current discovery failed.', { cause: error });
    } finally {
      timeoutAbort.dispose();
      inputAbort.dispose();
      signal.removeEventListener('abort', abortFromInput);
      timeoutSignal.removeEventListener('abort', abortFromTimeout);
      abortFromInput();
    }
  }

  private recordDiagnostic(
    severity: ExtensionRegistrationDiagnostic['severity'],
    reasonCode: ExtensionRegistrationDiagnosticReasonCode,
    summary: string,
    capabilityId?: string,
  ): void {
    this.diagnostics.record(severity, reasonCode, this.provider, summary, capabilityId);
  }
}

class DiscoveryGuardError extends Error {
  constructor(readonly reasonCode: Extract<ExtensionRegistrationDiagnosticReasonCode, 'DISCOVERY_TIMED_OUT' | 'DISCOVERY_CANCELED'>) {
    super(reasonCode);
    this.name = 'DiscoveryGuardError';
  }
}

function rejectOnAbort(
  signal: AbortSignal,
  reasonCode: DiscoveryGuardError['reasonCode'],
): { readonly promise: Promise<never>; readonly dispose: () => void } {
  if (signal.aborted) {
    return { promise: Promise.reject(new DiscoveryGuardError(reasonCode)), dispose() {} };
  }
  let rejectAbort: ((error: DiscoveryGuardError) => void) | undefined;
  const promise = new Promise<never>((_, reject) => {
    rejectAbort = reject;
  });
  const onAbort = () => rejectAbort?.(new DiscoveryGuardError(reasonCode));
  signal.addEventListener('abort', onAbort, { once: true });
  return {
    promise,
    dispose() {
      signal.removeEventListener('abort', onAbort);
    },
  };
}

function discoverySummary(reasonCode: ExtensionRegistrationDiagnosticReasonCode): string {
  switch (reasonCode) {
    case 'DISCOVERY_TIMED_OUT':
      return 'Capability discovery timed out.';
    case 'DISCOVERY_CANCELED':
      return 'Capability discovery was canceled.';
    default:
      return 'Capability discovery failed.';
  }
}

function hasMissingRequiredDependency(descriptor: CapabilityDescriptor): boolean {
  const requiredDependencies = descriptorMetadata(descriptor).requiredDependencies;
  return requiredDependencies !== undefined && (!Array.isArray(requiredDependencies) || requiredDependencies.length > 0);
}

function hasInvalidToolConfig(descriptor: CapabilityDescriptor): boolean {
  const metadata = descriptorMetadata(descriptor);
  if (!('config' in metadata)) {
    return false;
  }
  if (!isJsonObject(metadata.config) || !isJsonObject(metadata.configSchema)) {
    return true;
  }
  try {
    return ajv.compile(metadata.configSchema)(metadata.config) !== true;
  } catch {
    return true;
  }
}

function descriptorMetadata(descriptor: CapabilityDescriptor): Record<string, unknown> {
  return isJsonObject(descriptor.metadata) ? descriptor.metadata : {};
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isSkillSourceDiscovery(value: CapabilityDiscovery): value is CapabilityDiscovery & SkillSourceDiscovery {
  return 'loadCanonicalBodyView' in value && typeof value.loadCanonicalBodyView === 'function';
}

function makeUnavailable(descriptor: CapabilityDescriptor, reason: string): CapabilityDescriptor {
  return {
    ...descriptor,
    availabilityStatus: 'UNAVAILABLE',
    availabilityReason: reason,
  };
}

function sameProvider(left: CapabilityProviderIdentity, right: CapabilityProviderIdentity): boolean {
  return left.providerId === right.providerId && left.providerKind === right.providerKind && left.providerType === right.providerType;
}

function diagnostic(
  severity: ExtensionRegistrationDiagnostic['severity'],
  reasonCode: ExtensionRegistrationDiagnosticReasonCode,
  provider: CapabilityProviderIdentity,
  summary: string,
  capabilityId?: string,
): ExtensionRegistrationDiagnostic {
  return {
    severity,
    reasonCode,
    providerId: provider.providerId,
    ...(capabilityId === undefined ? {} : { capabilityId }),
    summary,
  };
}

class ExtensionRegistrationDiagnostics {
  private readonly items: ExtensionRegistrationDiagnostic[] = [];
  private readonly keys = new Set<string>();

  record(
    severity: ExtensionRegistrationDiagnostic['severity'],
    reasonCode: ExtensionRegistrationDiagnosticReasonCode,
    provider: CapabilityProviderIdentity,
    summary: string,
    capabilityId?: string,
  ): void {
    const key = `${severity}\0${reasonCode}\0${provider.providerId}\0${capabilityId ?? ''}`;
    if (this.keys.has(key)) {
      return;
    }
    this.keys.add(key);
    this.items.push(diagnostic(severity, reasonCode, provider, summary, capabilityId));
  }

  snapshot(): readonly ExtensionRegistrationDiagnostic[] {
    return Object.freeze(this.items.map((item) => Object.freeze({ ...item })));
  }
}

function deepFreeze<T extends FrozenCapabilityProviderSnapshot>(snapshot: T): T {
  Object.freeze(snapshot.providers);
  Object.freeze(snapshot.eagerDiscoveries);
  Object.freeze(snapshot.searchDiscoveries);
  Object.freeze(snapshot.executors);
  return Object.freeze(snapshot);
}
