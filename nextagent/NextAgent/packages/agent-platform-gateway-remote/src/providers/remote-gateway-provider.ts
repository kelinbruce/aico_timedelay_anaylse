import type { GatewayAdapterKind, GatewayProvider, GatewayProviderCreateInput } from '@nextagent/agent-contracts/gateway';
import {
  blockedRemoteGatewayBindings,
  createSelectedRemoteGatewayBindings,
  remoteGatewayReferenceAdapterKinds,
  resolveRemoteGatewayReferenceBindings,
  selectedRemoteGatewayMissingBinding,
  type RemoteGatewayReferenceBindings,
  type RemoteGatewayReferenceBindingsFactory,
} from '../bindings/remote-gateway-bindings.js';

export interface RemoteGatewayProviderOptions {
  readonly providerId?: string;
  readonly supportedAdapterKinds?: readonly GatewayAdapterKind[];
  readonly bindings?: RemoteGatewayReferenceBindings | RemoteGatewayReferenceBindingsFactory;
}

export function createRemoteGatewayProvider(options: RemoteGatewayProviderOptions = {}): GatewayProvider {
  const providerId = options.providerId ?? 'remote-gateway';
  const supportedAdapterKinds = options.supportedAdapterKinds ?? remoteGatewayReferenceAdapterKinds;
  return {
    providerId,
    deploymentMode: 'REMOTE',
    supportedAdapterKinds,
    create(input) {
      const unsupported = validateRemoteSelection(input, providerId, supportedAdapterKinds);
      if (unsupported !== undefined) {
        return blockedRemoteGatewayBindings(providerId, unsupported);
      }
      const selectedKinds = new Set(input.selectedEntries.map((entry) => entry.adapterKind));
      const referenceBindings = resolveRemoteGatewayReferenceBindings(options.bindings, input);
      const missingBinding = selectedRemoteGatewayMissingBinding(selectedKinds, referenceBindings);
      if (missingBinding !== undefined) {
        return blockedRemoteGatewayBindings(providerId, missingBinding);
      }
      return createSelectedRemoteGatewayBindings({
        providerId,
        selectedKinds,
        bindings: referenceBindings,
      });
    },
  };
}

function validateRemoteSelection(
  input: GatewayProviderCreateInput,
  providerId: string,
  supportedAdapterKinds: readonly GatewayAdapterKind[],
): string | undefined {
  for (const entry of input.selectedEntries) {
    if (entry.deploymentMode !== 'REMOTE') {
      return `provider:${providerId}:non-remote-selection`;
    }
    if (!supportedAdapterKinds.includes(entry.adapterKind)) {
      return `adapter:${entry.adapterKind}:unsupported`;
    }
  }
  return undefined;
}
