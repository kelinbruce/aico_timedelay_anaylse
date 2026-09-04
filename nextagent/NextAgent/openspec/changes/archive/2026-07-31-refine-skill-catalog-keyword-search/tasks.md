## 1. Backend keyword search scope

- [x] 1.1 Extend the keyword filter in `skill-catalog-query-port.ts` to also match `sourceMetadata.zh-name` and `sourceMetadata.en-name` (string values only) in addition to `displayName` and `capabilityId`.
  验证：`packages/agent-app/tests/skill-catalog-query-port.test.ts` 新增 sourceMetadata 中文关键字匹配场景并通过。
  来源：Requirement "Skill 列表查询关键字搜索"（MODIFIED）。
- [x] 1.2 Add a catalog port test proving a keyword matching only the localized name (not displayName or capabilityId) returns that Skill.
  验证：`packages/agent-app/tests/skill-catalog-query-port.test.ts` 断言中文关键字命中 zh-name 的 Skill。
  来源：Requirement "Skill 列表查询关键字搜索"（MODIFIED）。
- [x] 1.3 Add a negative test proving the keyword filter does not match `description`, `extension` or governed metadata values.
  验证：`packages/agent-app/tests/skill-catalog-query-port.test.ts` 断言 description/extension 内容不命中。
  来源：Requirement "Skill 列表查询关键字搜索"（MODIFIED）；design "非目标"。

## 2. Frontend search input length guard

- [x] 2.1 Add `SKILL_SEARCH_KEYWORD_MAX_LENGTH` constant in `frontend/agent-web/src/constants/inputLimits.ts` matching the backend `WEB_QUERY_TEXT_MAX_LENGTH` (512).
  验证：前端 TypeScript 编译通过。
  来源：Requirement "Modal 搜索与分页加载"（MODIFIED）。
- [x] 2.2 Apply `maxLength` to the Skill Modal search `Input` in `SkillCatalogModal.tsx` using the new constant.
  验证：`frontend/agent-web` Modal 测试断言 maxLength 约束生效。
  来源：Requirement "Modal 搜索与分页加载"（MODIFIED）。

## 3. Verification

- [x] 3.1 Run focused catalog, Web, and frontend tests after implementation.
  验证：相关 Vitest 命令全部通过。
  来源：design "验证映射"。
- [x] 3.2 Run build, contract tests, architecture lint, and strict validation for this change.
  验证：`npm run build`、`npm run test:contract`、`npm run lint:architecture`、`openspec validate refine-skill-catalog-keyword-search --strict` 通过。
  来源：AGENTS.md 验证门禁；design "验证映射"。

## 归档前更新基线检查（非实施任务）

归档前依据 proposal 和 design，将关键字搜索匹配范围扩展同步至
`openspec/specs/web-skill-catalog/spec.md`，将 Modal 搜索 maxLength 约束同步至
`openspec/specs/skill-selector-ui/spec.md`。
