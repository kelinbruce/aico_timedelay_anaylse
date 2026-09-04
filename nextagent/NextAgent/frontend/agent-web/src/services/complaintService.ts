import { apiClient } from './apiClient.ts';

export interface ComplaintRiskRecord {
  readonly id: string;
  readonly name_en: string;
  readonly name_zh: string;
}

export interface ComplaintRiskConfig {
  readonly records: readonly ComplaintRiskRecord[];
}

export interface ComplaintCreateParams {
  readonly alog_card: string;
  readonly tenant_id: string;
  readonly user_id: string;
  readonly reason_id: string;
  readonly reason_detail: string;
}

function isRiskRecord(value: unknown): value is ComplaintRiskRecord {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>).id === 'string' &&
    typeof (value as Record<string, unknown>).name_en === 'string' &&
    typeof (value as Record<string, unknown>).name_zh === 'string'
  );
}

export const complaintService = {
  async fetchRiskConfig(signal?: AbortSignal): Promise<ComplaintRiskConfig> {
    const body = await apiClient.get<{ records?: unknown }>('/rest/naie/guardrail/config/v1/report/risks', signal ? { signal } : undefined);
    if (!Array.isArray(body?.records)) {
      throw new Error('Complaint risk config response must contain a records array.');
    }
    const records = body.records.filter(isRiskRecord);
    return { records };
  },

  async createReport(params: ComplaintCreateParams, signal?: AbortSignal): Promise<void> {
    await apiClient.post('/rest/naie/guardrail/config/v1/report/create', params, signal ? { signal } : undefined);
  },
};
