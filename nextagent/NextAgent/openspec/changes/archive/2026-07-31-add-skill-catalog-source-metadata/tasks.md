## 1. Catalog contract and projection

- [x] 1.1 Extend `SkillCatalogSummaryEntry` and the `/api/v1/skills` response schema with optional `sourceMetadata` using the validated source metadata value shape.
  验证：相关 TypeScript 编译和 `npm run test:contract` 通过。
  来源：Requirement “Skill catalog exposes validated source metadata”。
- [x] 1.2 Project only matched `SkillMetadata.sourceMetadata` from `agent-core` catalog queries, and omit it when unavailable.
  验证：`packages/agent-app/tests/skill-catalog-query-port.test.ts` 覆盖存在和缺失场景并通过。
  来源：Requirement “Skill catalog exposes validated source metadata”；design “设计决策”。
- [x] 1.3 Add a negative catalog projection test proving extension and governed metadata are not returned as source metadata.
  验证：`packages/agent-app/tests/skill-catalog-query-port.test.ts` 实际断言排除字段并通过。
  来源：Requirement “Skill catalog exposes validated source metadata”；design “质量属性设计-安全”。

## 2. Web and frontend display

- [x] 2.1 Synchronize the frontend Skill catalog DTO with the optional `sourceMetadata` API field.
  验证：前端 TypeScript 检查或 `npm run build` 通过。
  来源：Requirement “Skill catalog exposes validated source metadata”。
- [x] 2.2 Add one frontend display-name resolver that selects `zh-name` for Chinese UI language, `en-name` for non-Chinese language, and falls back to `displayName`.
  验证：`frontend/agent-web/tests/SkillSelector.test.tsx` 覆盖中文、非中文和缺失/非字符串回退并通过。
  来源：Requirement “Skill catalog uses localized display-name fallback”；design “设计决策”。
- [x] 2.3 Apply the resolver to existing catalog and selected Skill text displays without changing capabilityId selection or submission behavior.
  验证：`frontend/agent-web/tests/SkillSelector.test.tsx` 断言目录项和已选 Skill 显示；既有选择测试通过。
  来源：Requirement “Skill catalog uses localized display-name fallback”；proposal “不改变 Skill 路由和提交”。

## 3. Verification

- [x] 3.1 Run focused catalog, Web, and frontend tests after implementation.
  验证：相关 Vitest 命令全部通过。
  来源：design “验证映射”。
- [x] 3.2 Run build, contract tests, architecture lint, and strict validation for this change.
  验证：`npm run build`、`npm run test:contract`、`npm run lint:architecture`、`openspec validate add-skill-catalog-source-metadata --strict` 通过。
  来源：AGENTS.md 验证门禁；design “验证映射”。

## 归档前更新基线检查（非实施任务）

归档前依据 proposal 和 design，将稳定的目录 metadata 公开边界同步至 `openspec/specs/skill-catalog-query/spec.md`，并更新 `core-contracts`、`agent-core`、`agent-channel-web`、`agent-web` 和 `spec-to-design-map` 的长期设计文档。
