import { apiClient } from './apiClient.ts';

export interface BiReportParams {
  readonly sessionId: string;
  readonly requestIds: readonly string[];
  readonly signal?: AbortSignal;
}

/**
 * Calls the aicoservice bi-report endpoint. The response body is the DSL
 * content object itself (consumed directly by DSLEngine), not a wrapped
 * envelope.
 */
export const biReportService = {
  async generateReport(params: BiReportParams): Promise<unknown> {
    return apiClient.post<unknown>(
      `/rest/naie/aicoservice/v1/sessions/${encodeURIComponent(params.sessionId)}/bi-reports`,
      { requestIds: [...params.requestIds] },
      params.signal ? { signal: params.signal } : undefined,
    );
  },
};
