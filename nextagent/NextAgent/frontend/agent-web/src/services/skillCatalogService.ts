import { apiClient } from './apiClient.ts';
import type { SkillCatalogQueryResult } from '../state/contracts.ts';

export interface SkillCatalogQueryParams {
  readonly pageNum?: number;
  readonly pageSize?: number;
  readonly keyword?: string;
}

export function querySkills(params: SkillCatalogQueryParams): Promise<SkillCatalogQueryResult> {
  const searchParams = new URLSearchParams();
  if (params.pageNum !== undefined) {
    searchParams.set('pageNum', String(params.pageNum));
  }
  if (params.pageSize !== undefined) {
    searchParams.set('pageSize', String(params.pageSize));
  }
  if (params.keyword !== undefined && params.keyword.trim().length > 0) {
    searchParams.set('keyword', params.keyword.trim());
  }
  const qs = searchParams.toString();
  const path = qs ? `/api/v1/skills?${qs}` : '/api/v1/skills';
  return apiClient.get<SkillCatalogQueryResult>(path);
}
