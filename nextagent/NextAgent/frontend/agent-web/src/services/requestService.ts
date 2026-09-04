import { apiClient } from './apiClient.ts';
import type { QuestionAnswerKind, RequestAccepted, RequestControlAccepted } from '../state/contracts.ts';

export interface StagedAttachmentRef {
  readonly tempRunId: string;
  readonly fileName: string;
}
export type TempFileRef = StagedAttachmentRef;

export interface StagedUploadResponse extends StagedAttachmentRef {
  readonly sizeBytes: number;
}

export interface RequestService {
  submitRequest: (
    sessionId: string,
    params: {
      readonly inputText: string;
      readonly locale: string;
      readonly idempotencyKey: string;
      readonly attachments?: readonly StagedAttachmentRef[];
      readonly targetSkill?: string;
    },
  ) => Promise<RequestAccepted>;
  stageAttachments: (sessionId: string, files: readonly File[]) => Promise<readonly StagedAttachmentRef[]>;
  stageAttachment: (sessionId: string, tempRunId: string, file: File, onProgress?: (percent: number) => void) => Promise<StagedUploadResponse>;
  deleteStagedAttachment: (sessionId: string, tempRunId: string, fileName: string) => Promise<void>;
  downloadFile: (sessionId: string, objectName: string) => Promise<void>;
  cancelRequest: (sessionId: string, expectedLatestRequestId: string, idempotencyKey: string) => Promise<RequestControlAccepted>;
  retryRequest: (sessionId: string, expectedLatestRequestId: string, idempotencyKey: string) => Promise<RequestAccepted>;
  editRequest: (
    sessionId: string,
    expectedLatestRequestId: string,
    inputText: string,
    attachments: readonly File[] | undefined,
    idempotencyKey: string,
    targetSkill?: string,
  ) => Promise<RequestAccepted>;
  submitUserInputResponse: (
    sessionId: string,
    inputRequestId: string,
    response: {
      readonly answers: ReadonlyArray<readonly string[]>;
      readonly answerKinds?: readonly QuestionAnswerKind[];
    },
  ) => Promise<void>;
}

export const requestService: RequestService = {
  submitRequest: (sessionId, params) => {
    return submitOrEditRequest({
      path: `/api/v1/sessions/${encodeURIComponent(sessionId)}/requests`,
      inputText: params.inputText,
      locale: params.locale,
      idempotencyKey: params.idempotencyKey,
      ...(params.attachments === undefined ? {} : { attachments: params.attachments }),
      ...(params.targetSkill === undefined ? {} : { targetSkill: params.targetSkill }),
    });
  },

  stageAttachments: async (sessionId, files) => {
    if (files.length === 0) {
      return [];
    }
    const tempRunId = crypto.randomUUID();
    return Promise.all(
      files.map(async (file) => {
        const staged = await requestService.stageAttachment(sessionId, tempRunId, file);
        return { tempRunId: staged.tempRunId, fileName: staged.fileName };
      }),
    );
  },

  stageAttachment: async (sessionId, tempRunId, file, onProgress) => {
    const formData = new FormData();
    formData.append('tempRunId', tempRunId);
    formData.append('file', file, file.name);
    return apiClient.uploadFormData<StagedUploadResponse>(`/api/v1/sessions/${encodeURIComponent(sessionId)}/files/upload`, formData, onProgress);
  },

  deleteStagedAttachment: async (sessionId, tempRunId, fileName) => {
    await apiClient.delete<void>(
      `/api/v1/sessions/${encodeURIComponent(sessionId)}/files/tmp/${encodeURIComponent(tempRunId)}?fileName=${encodeURIComponent(fileName)}`,
    );
  },

  downloadFile: async (sessionId, objectName) => {
    const { blob, filename } = await apiClient.getBlob(
      `/api/v1/sessions/${encodeURIComponent(sessionId)}/files/download?path=${encodeURIComponent(objectName)}`,
    );
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = filename ?? objectName.split('/').pop() ?? 'download';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(objectUrl);
  },

  cancelRequest: async (sessionId, expectedLatestRequestId, idempotencyKey) => {
    return apiClient.post<RequestControlAccepted>(`/api/v1/sessions/${encodeURIComponent(sessionId)}/cancel`, {
      expectedLatestRequestId,
      action: 'CANCEL_LATEST',
      idempotencyKey,
    });
  },

  retryRequest: async (sessionId, expectedLatestRequestId, idempotencyKey) => {
    return apiClient.post<RequestAccepted>(`/api/v1/sessions/${encodeURIComponent(sessionId)}/retry`, { expectedLatestRequestId, idempotencyKey });
  },

  editRequest: async (sessionId, expectedLatestRequestId, inputText, attachments, idempotencyKey, targetSkill) => {
    if (attachments !== undefined && attachments.length > 0) {
      throw new Error('Attachments must be staged before request submission.');
    }
    return submitOrEditRequest({
      path: `/api/v1/sessions/${encodeURIComponent(sessionId)}/requests/latest/edit`,
      inputText,
      idempotencyKey,
      expectedLatestRequestId,
      ...(targetSkill === undefined ? {} : { targetSkill }),
    });
  },

  submitUserInputResponse: async (sessionId, inputRequestId, response) => {
    await apiClient.post<void>(`/api/v1/sessions/${encodeURIComponent(sessionId)}/pending-inputs/${encodeURIComponent(inputRequestId)}/answer`, {
      answers: response.answers,
      ...(response.answerKinds === undefined ? {} : { answerKinds: response.answerKinds }),
    });
  },
};

function submitOrEditRequest(params: {
  readonly path: string;
  readonly inputText: string;
  readonly idempotencyKey: string;
  readonly locale?: string;
  readonly expectedLatestRequestId?: string;
  readonly attachments?: readonly StagedAttachmentRef[];
  readonly targetSkill?: string;
}): Promise<RequestAccepted> {
  const inputText = withSkillDirective(params.inputText, params.targetSkill);

  if (params.expectedLatestRequestId !== undefined) {
    const editBody: Record<string, unknown> = {
      expectedLatestRequestId: params.expectedLatestRequestId,
      editedInputText: inputText,
      idempotencyKey: params.idempotencyKey,
    };
    return apiClient.post<RequestAccepted>(params.path, editBody);
  }

  const submitBody: Record<string, unknown> = {
    inputText,
    locale: params.locale,
    idempotencyKey: params.idempotencyKey,
    ...(params.attachments === undefined || params.attachments.length === 0 ? {} : { attachments: params.attachments }),
  };
  return apiClient.post<RequestAccepted>(params.path, submitBody);
}

function withSkillDirective(inputText: string, targetSkill?: string): string {
  const normalizedTargetSkill = targetSkill?.trim();
  if (!normalizedTargetSkill) {
    return inputText;
  }
  return `$skill:${normalizedTargetSkill} ${inputText}`;
}
