# Proposal: Refine skill catalog keyword search

## Background

两个用户可见的 skill 搜索缺陷同时存在于 `/api/v1/skills` 目录查询和前端
Skill 列表 Modal：

1. 输入中文关键字搜不到任何 Skill。根因是 `web-skill-catalog` spec 明确
   规定关键字搜索只匹配 `displayName` 或 `capabilityId`，且 MUST NOT 搜索
   `metadata`。但 `add-skill-catalog-source-metadata` 已让前端按当前界面语言
   显示 `sourceMetadata.zh-name` 或 `sourceMetadata.en-name`，用户看到的是中
   文名，搜索匹配的却是英文 `displayName`（即 capabilityId 同形的 frontmatter
   `name`），两者不一致导致中文搜索必然无结果。
2. 前端 Skill Modal 搜索输入框没有长度校验。后端 schema 已限制 `keyword`
   `maxLength` 为 `WEB_QUERY_TEXT_MAX_LENGTH`（512），但前端既未限制输入长度，
   也未在超长时阻止请求。超长请求被后端 400 拒绝后，前端 catch 静默清空结果，
   用户体验为"搜了没结果"而非"输入太长"。

## What Changes

1. `web-skill-catalog` 关键字搜索要求扩展匹配范围：除 `displayName` 和
   `capabilityId` 外，MUST 同时匹配已投影到响应 DTO 的 `sourceMetadata` 中本地
   化显示名（`zh-name`、`en-name`）。MUST NOT 搜索 `description`、`extension`、
   运行治理 metadata 或其他非可见字段。
2. `skill-selector-ui` Modal 搜索与分页加载要求新增前端长度约束：搜索输入
   MUST 限制关键字最大长度，超过服务端接受上限时 MUST NOT 发起 API 请求。

## Why

1. 搜索匹配范围必须与用户可见的显示字段一致。`add-skill-catalog-source-metadata`
   引入本地化显示名后，搜索仍只匹配英文 `displayName`，造成中文搜索完全失效，
   这是引入本地化显示名时遗漏的搜索一致性缺陷。
2. 前端缺少长度校验会让超长输入产生无意义的 400 错误和静默空结果，应在前端
   阻断并保持与服务端上限一致。

## Impact

- `packages/agent-core/src/tools/skill-catalog-query-port.ts`：关键字过滤逻辑
  扩展匹配 `sourceMetadata` 中的 `zh-name` 和 `en-name`。
- `frontend/agent-web/src/features/skill-selector/components/SkillCatalogModal.tsx`：
  搜索输入框增加 `maxLength` 约束。
- `frontend/agent-web/src/constants/inputLimits.ts`：新增 skill 搜索关键字最大
  长度常量。
- Specs: `web-skill-catalog`、`skill-selector-ui` requirement deltas。
- 测试：catalog port 关键字匹配 sourceMetadata 场景；前端 maxLength 场景。
