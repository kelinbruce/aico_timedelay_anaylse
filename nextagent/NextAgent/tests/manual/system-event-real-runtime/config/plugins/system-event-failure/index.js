const provider = Object.freeze({
  providerId: 'system-event-failure.tools',
  providerKind: 'CUSTOM',
  providerType: 'nextagent-plugin-tool',
});

const descriptor = Object.freeze({
  capabilityId: 'system_event_failure_probe',
  kind: 'TOOL',
  provider,
  displayName: 'System event failure probe',
  description: 'Fails safely to verify governed system-event presentation.',
  modelInvocable: true,
  availabilityStatus: 'AVAILABLE',
  inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  outputSchema: { type: 'object', additionalProperties: false, properties: {} },
});

const capabilityProvider = Object.freeze({
  identity: provider,
  discovery: Object.freeze({
    provider,
    discoveryMode: 'EAGER',
    async listAll() {
      return [descriptor];
    },
    async resolve(capabilityId) {
      return capabilityId === descriptor.capabilityId ? descriptor : undefined;
    },
  }),
  executor: Object.freeze({
    capabilityKinds: ['TOOL'],
    async invoke() {
      return {
        status: 'FAILED',
        structuredPayload: {},
        generatedMessages: [],
        artifactRefs: [],
        safeError: {
          code: 'SYSTEM_EVENT_SCENARIO_FAILED',
          message: 'The controlled verification Tool failed safely.',
          category: 'INTERNAL',
          retryable: false,
        },
      };
    },
  }),
});

export default Object.freeze({
  apiVersion: '1.0',
  pluginId: 'system-event-failure',
  version: '1.0.0',
  providers: Object.freeze([capabilityProvider]),
});
