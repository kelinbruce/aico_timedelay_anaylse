# 会话搜索关键词上限调整设计

## 设计范围

| Function | 目标变化 | delta specs | Function 设计章节 |
|---|---|---|---|
| `FN-1.6 查询会话列表` | `q.trim()` 上限从 50 个 Unicode code point 调整为 200 个，前后端与 mock 保持一致 | `session-history-search`、`ts-minimal-agent-kernel` | `FN-1.6 查询会话列表` |

## 存量 Requirement 迁移方案

| 来源 spec / Requirement | 目标 Function / canonical spec | 来源 delta operation | 目标 delta operation | 处理 |
|---|---|---|---|---|
| `ts-minimal-agent-kernel` / `Web Submit Stream And History` | `FN-1.6 查询会话列表` / `session-history-search` | `MODIFIED` | `MODIFIED` | 不迁移 Requirement ownership；仅将其中 `q` 长度约束从 50 同步为 200。该 legacy Requirement 的其他行为和其他 Requirements 保持不变，归档时同步 stable spec，不退役导航。 |

## FN-1.6 查询会话列表

### 目标与规范依据

会话列表关键词搜索允许 trim 后非空且不超过 200 个 Unicode code point 的 `q`；超过 200 时前端不发起请求，Web API 返回请求校验错误且不得调用 runtime/session/gateway。

本 Function 的目标 Requirements：

- canonical spec：`session-history-search`
- `MODIFIED`：`前端会话列表复用原展示并提供搜索和日期交互`
- `MODIFIED`：`搜索查询保持 scope 隔离和安全校验`
- 同步修改 legacy spec `ts-minimal-agent-kernel` 中 `Web Submit Stream And History` 的对应 `q` 约束。

### 当前实现

- `agent-channel-web` 的 `sessionListQuery.q` 使用共享常量 `WEB_QUERY_SEARCH_MAX_LENGTH = 50` 作为 schema `maxLength`。
- `parseQuestionSearchText()` 在 trim 后按 Unicode code point 检查 `> 50`。
- `agent-web` 的 `keywordState()` 在 trim 后按 Unicode code point 检查 `> 50`。
- zh-CN/en-US 提示文案均写死 50 个字符。
- `agent-web-mock-server` 的 `parseQuestionSearchText()` 同样检查 `> 50`。

### GAP 分析

- 目标要求 200，当前后端 schema、后端 parser、前端校验、提示文案和 mock server 均为 50。
- `WEB_QUERY_SEARCH_MAX_LENGTH` 同时被 favorites `keyword` schema 使用，不能作为会话搜索专用上限直接修改。

### 修改方案

1. 在 `agent-channel-web` 的 validation limits 中新增会话搜索专用常量 `WEB_SESSION_SEARCH_MAX_CODE_POINTS = 200`，不修改 `WEB_QUERY_SEARCH_MAX_LENGTH`。
2. `sessionListQuery.q` 的 `maxLength` 改用专用常量。
3. `parseQuestionSearchText()` 改用专用常量，并将错误消息中的上限更新为 200。
4. `agent-web` 的 `sessionHistorySearch.ts` 新增前端专用常量 `MAX_SEARCH_KEYWORD_CODE_POINTS = 200`，`keywordState()` 使用该常量。
5. zh-CN/en-US 的 `keywordTooLongHint` 更新为 200。
6. `agent-web-mock-server` 的会话列表 `q` 校验更新为 200。
7. 不修改 favorites、时间范围、分页、scope 隔离和 SQL 查询行为。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 安全 | `搜索查询保持 scope 隔离和安全校验` | schema 与 parser 双层校验，超过 200 在 Web 边界失败关闭 | 201 个 code point 返回 400 且不调用 runtime |
| 可维护性 | `搜索查询保持 scope 隔离和安全校验` | 使用会话搜索专用常量，避免影响 favorites keyword | 确认 `WEB_QUERY_SEARCH_MAX_LENGTH` 仍为 50 且 favorites schema 不变 |
| 可测试性 | `搜索查询保持 scope 隔离和安全校验` | 前后端和 mock 使用同一确定上限 | 覆盖 200 通过、201 拒绝和提示文案 |

## 验证策略

- 后端 contract/unit 测试覆盖：`q` 为 200 个 Unicode code point 时调用 runtime 搜索；`q` 为 201 个 code point 时返回 HTTP 400 + `REQUEST_VALIDATION_FAILED`，且 runtime session facade 不被调用。
- 前端 unit 测试覆盖：`keywordState()` 对 200 判定合法、对 201 判定非法；zh-CN/en-US 提示文案更新为 200。
- mock server 测试覆盖：200 个字符可通过，201 个字符返回 400。
- 构建验证覆盖 TypeScript 编译和前端构建，确认共享常量未被误改。
- 人工/模型检视确认 favorites `keyword`、时间范围、分页和 scope 隔离未被修改。

## 长期基线刷新计划

- `openspec/specs/session-history-search/spec.md`：归档时同步 `q` 上限 200。
- `openspec/specs/ts-minimal-agent-kernel/spec.md`：归档时同步对应 `q` 约束 200。
- `openspec/designs/functions/D1-会话与流式交互/D1.2-会话生命周期管理/FN-1.6-查询会话列表.md`：归档时更新搜索词长度规格。
- `openspec/designs/features/D1-会话与流式交互/D1.2-会话生命周期管理/F-1.3-管理会话.md`：归档时更新搜索词长度规格。
- `openspec/overview.md`：无。
- `openspec/designs/architecture/`：无。
- `openspec/designs/modules/`：无。
- `openspec/designs/adr/`：无。
- `openspec/designs/spec-to-design-map.md`：无导航变化。

## 风险与取舍

- 200 个 Unicode code point 的关键词会进入 SQL LIKE 查询，但该值仍是显式上限并继续受 owner/agent scope 约束；验证需覆盖超长失败关闭路径。
- 共享常量不能复用，否则影响 favorites keyword schema；因此引入会话搜索专用常量，接受一个小的命名重复以换取边界隔离。

## 待确认问题

无。