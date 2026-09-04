import {
  AgentError,
  TASK_EVENT_ID_MAX_LENGTH,
  TASK_EVENT_ID_PATTERN,
  isTaskEventId,
  type JsonObject,
  type TaskEventId,
} from '@nextagent/agent-common';
import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

const TASK_MESSAGE_TEXT_MAX_LENGTH = 32_768;
const TASK_MESSAGE_FILE_NAME_MAX_LENGTH = 255;
const TASK_MESSAGE_MEDIA_TYPE_MAX_LENGTH = 255;
const TASK_MESSAGE_RAW_MAX_LENGTH = 16 * 1024 * 1024;
const TASK_MESSAGE_URL_MAX_LENGTH = 2_048;
const attachmentInputText = 'The task input is provided in the attached file.';

const taskMessageMetadataSchema = Type.Object(
  {
    eventId: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: TASK_EVENT_ID_MAX_LENGTH,
        pattern: TASK_EVENT_ID_PATTERN,
      }),
    ),
  },
  { additionalProperties: true },
);
const batchTaskMessageMetadataSchema = Type.Object(
  {
    eventId: Type.Optional(Type.Unknown()),
  },
  { additionalProperties: true },
);
const taskMessageDataSchema = Type.Record(Type.String(), Type.Unknown());

const rawFileContentSchema = Type.Object(
  {
    raw: Type.String({ minLength: 1, maxLength: TASK_MESSAGE_RAW_MAX_LENGTH }),
    filename: Type.String({ minLength: 1, maxLength: TASK_MESSAGE_FILE_NAME_MAX_LENGTH }),
    mediaType: Type.String({ minLength: 1, maxLength: TASK_MESSAGE_MEDIA_TYPE_MAX_LENGTH }),
  },
  { additionalProperties: false },
);

const urlFileContentSchema = Type.Object(
  {
    url: Type.String({ minLength: 1, maxLength: TASK_MESSAGE_URL_MAX_LENGTH }),
    filename: Type.String({ minLength: 1, maxLength: TASK_MESSAGE_FILE_NAME_MAX_LENGTH }),
    mediaType: Type.String({ minLength: 1, maxLength: TASK_MESSAGE_MEDIA_TYPE_MAX_LENGTH }),
  },
  { additionalProperties: false },
);

export const TaskMessageSchema = createTaskMessageSchema(taskMessageMetadataSchema);
export const BatchTaskMessageSchema = createTaskMessageSchema(batchTaskMessageMetadataSchema);

export const SingleTaskMessagesSchema = Type.Array(TaskMessageSchema, { minItems: 1, maxItems: 1 });
export const BatchSingleTaskMessagesSchema = Type.Array(BatchTaskMessageSchema, {
  minItems: 1,
  maxItems: 1,
});

export type TaskMessage =
  | { readonly text: string; readonly metadata?: JsonObject }
  | { readonly data: JsonObject; readonly metadata?: JsonObject }
  | {
      readonly fileContent:
        | { readonly raw: string; readonly filename: string; readonly mediaType: string }
        | { readonly url: string; readonly filename: string; readonly mediaType: string };
      readonly metadata?: JsonObject;
    };

export interface TaskMessageInputProjection {
  readonly inputText: string;
  readonly taskEventId?: TaskEventId;
  readonly inputVariables?: JsonObject;
  readonly inlineFile?: {
    readonly fileName: string;
    readonly declaredMimeType: string;
    readonly sizeBytes: number;
    readonly bytes: Uint8Array;
  };
  readonly remoteFile?: {
    readonly url: string;
    readonly fileName: string;
    readonly declaredMimeType: string;
  };
}

export function parseSingleTaskMessage(value: unknown): TaskMessage {
  if (!Value.Check(SingleTaskMessagesSchema, value)) {
    throw validationError('taskMessages must contain exactly one valid TaskMessage.');
  }
  const message = value[0];
  if (message === undefined) {
    throw validationError('taskMessages must contain exactly one valid TaskMessage.');
  }
  const metadata = message.metadata === undefined ? undefined : toJsonObject(message.metadata, 'metadata');
  if (metadata !== undefined && Object.hasOwn(metadata, 'eventId') && !isTaskEventId(metadata.eventId)) {
    throw validationError(`metadata.eventId must match ${TASK_EVENT_ID_PATTERN} and contain at most ${TASK_EVENT_ID_MAX_LENGTH} characters.`);
  }
  if ('text' in message) {
    return { text: message.text, ...(metadata === undefined ? {} : { metadata }) };
  }
  if ('data' in message) {
    return { data: toJsonObject(message.data, 'data'), ...(metadata === undefined ? {} : { metadata }) };
  }
  if ('raw' in message.fileContent) {
    return {
      fileContent: message.fileContent,
      ...(metadata === undefined ? {} : { metadata }),
    };
  }
  assertHttpUrl(message.fileContent.url);
  return {
    fileContent: message.fileContent,
    ...(metadata === undefined ? {} : { metadata }),
  };
}

export function projectTaskMessageInput(message: TaskMessage): TaskMessageInputProjection {
  const taskEventId = taskEventIdFromMetadata(message.metadata);
  if ('text' in message) {
    return { inputText: message.text, ...(taskEventId === undefined ? {} : { taskEventId }) };
  }
  if ('data' in message) {
    return {
      inputText: stableJsonStringify(message.data),
      inputVariables: message.data,
      ...(taskEventId === undefined ? {} : { taskEventId }),
    };
  }
  if ('raw' in message.fileContent) {
    const bytes = decodeBase64(message.fileContent.raw);
    return {
      inputText: attachmentInputText,
      ...(taskEventId === undefined ? {} : { taskEventId }),
      inlineFile: {
        fileName: message.fileContent.filename,
        declaredMimeType: message.fileContent.mediaType,
        sizeBytes: bytes.byteLength,
        bytes,
      },
    };
  }
  return {
    inputText: attachmentInputText,
    ...(taskEventId === undefined ? {} : { taskEventId }),
    remoteFile: {
      url: message.fileContent.url,
      fileName: message.fileContent.filename,
      declaredMimeType: message.fileContent.mediaType,
    },
  };
}

function createTaskMessageSchema(metadataSchema: ReturnType<typeof Type.Object>) {
  return Type.Union([
    Type.Object(
      {
        text: Type.String({ minLength: 1, maxLength: TASK_MESSAGE_TEXT_MAX_LENGTH }),
        metadata: Type.Optional(metadataSchema),
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        data: taskMessageDataSchema,
        metadata: Type.Optional(metadataSchema),
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        fileContent: Type.Union([rawFileContentSchema, urlFileContentSchema]),
        metadata: Type.Optional(metadataSchema),
      },
      { additionalProperties: false },
    ),
  ]);
}

function taskEventIdFromMetadata(metadata?: JsonObject): TaskEventId | undefined {
  const value = metadata?.eventId;
  return isTaskEventId(value) ? value : undefined;
}

function stableJsonStringify(value: JsonObject): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortJson(entry)]),
    );
  }
  return value;
}

function decodeBase64(raw: string): Uint8Array {
  if (raw.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(raw)) {
    throw validationError('fileContent.raw must be valid base64.');
  }
  return new Uint8Array(Buffer.from(raw, 'base64'));
}

function toJsonObject(value: Record<string, unknown>, fieldName: string): JsonObject {
  const entries: Array<readonly [string, JsonObject[string]]> = [];
  for (const [key, entry] of Object.entries(value)) {
    if (!isJsonValue(entry)) {
      throw validationError(`${fieldName} must contain only JSON values.`);
    }
    entries.push([key, entry]);
  }
  return Object.fromEntries(entries);
}

function isJsonValue(value: unknown): value is JsonObject[string] {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return true;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  if (typeof value === 'object') {
    return Object.values(value).every(isJsonValue);
  }
  return false;
}

function assertHttpUrl(rawUrl: string): void {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error('unsupported protocol');
    }
  } catch {
    throw validationError('fileContent.url must be a valid HTTP URL.');
  }
}

function validationError(message: string): AgentError {
  return new AgentError({
    code: 'REQUEST_VALIDATION_FAILED',
    message,
    category: 'VALIDATION',
    retryable: false,
  });
}
