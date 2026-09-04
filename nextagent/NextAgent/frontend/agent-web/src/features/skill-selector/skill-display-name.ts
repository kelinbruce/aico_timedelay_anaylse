import type { SkillCatalogSummaryEntry } from '../../state/contracts.ts';

export function resolveSkillDisplayName(skill: SkillCatalogSummaryEntry, language: string): string {
  const key = language.toLowerCase().startsWith('zh') ? 'zh-name' : 'en-name';
  const displayName = skill.sourceMetadata?.[key];
  return typeof displayName === 'string' && displayName.length > 0 ? displayName : skill.displayName;
}
