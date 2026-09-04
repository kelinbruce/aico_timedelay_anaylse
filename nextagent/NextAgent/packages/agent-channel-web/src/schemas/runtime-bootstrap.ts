import { Type } from '@sinclair/typebox';

export const webTransportKinds = ['SSE', 'WEBSOCKET'] as const;
export type WebTransportKind = (typeof webTransportKinds)[number];

export interface ChatUploadFileConfig {
  readonly chatUploadFileType: readonly string[];
  readonly chatUploadMaxFileNumber: number;
  readonly chatUploadMaxFileSize: number;
  readonly uploadFileIdleExpireTime: number;
  readonly uploadFileMaxExpireTime: number;
}

export interface PortalAbilityBootstrapConfig {
  readonly suggestedQuestionsEnabled: boolean;
  readonly cronTasksEnabled: boolean;
  readonly longTermMemoryManagementEnabled: boolean;
  readonly knowledgeImportEnabled: boolean;
  readonly fullProcessEnabled: boolean;
}

export interface WebRuntimeBootstrapConfig {
  readonly transportKind: WebTransportKind;
  readonly chatUploadFileConfig?: ChatUploadFileConfig;
  readonly portalAbilityConfig?: PortalAbilityBootstrapConfig;
  readonly guardrail?: { readonly enabled: boolean };
}

/**
 * Port for resolving the public portal ability projection at request time.
 * The channel does not parse the Agent package's raw config file.
 */
export interface PortalAbilityConfigProviderPort {
  get: () => Promise<PortalAbilityBootstrapConfig>;
}

/**
 * Port for dynamically resolving ChatUploadFileConfig at request time.
 * Mirrors the ChatUploadConfigProvider shape from agent-attachment-runtime
 * without taking a direct dependency on that package.
 */
export interface ChatUploadConfigProviderPort {
  get: () => Promise<ChatUploadFileConfig | undefined>;
}

export const chatUploadFileConfigSchema = Type.Object({
  chatUploadFileType: Type.Array(Type.String({ minLength: 1 })),
  chatUploadMaxFileNumber: Type.Integer({ minimum: 1 }),
  chatUploadMaxFileSize: Type.Integer({ minimum: 1 }),
  uploadFileIdleExpireTime: Type.Integer({ minimum: 1 }),
  uploadFileMaxExpireTime: Type.Integer({ minimum: 1 }),
});

export const portalAbilityBootstrapSchema = Type.Object(
  {
    suggestedQuestionsEnabled: Type.Boolean(),
    cronTasksEnabled: Type.Boolean(),
    longTermMemoryManagementEnabled: Type.Boolean(),
    knowledgeImportEnabled: Type.Boolean(),
    fullProcessEnabled: Type.Boolean(),
  },
  { additionalProperties: false },
);
export const guardrailBootstrapSchema = Type.Object({ enabled: Type.Boolean() });

export const runtimeBootstrapResponse = Type.Object(
  {
    transportKind: Type.Union([Type.Literal('SSE'), Type.Literal('WEBSOCKET')]),
    chatUploadFileConfig: Type.Optional(chatUploadFileConfigSchema),
    portalAbilityConfig: portalAbilityBootstrapSchema,
    guardrail: Type.Optional(guardrailBootstrapSchema),
  },
  { additionalProperties: false },
);

export function isWebTransportKind(value: unknown): value is WebTransportKind {
  return typeof value === 'string' && (webTransportKinds as readonly string[]).includes(value);
}
