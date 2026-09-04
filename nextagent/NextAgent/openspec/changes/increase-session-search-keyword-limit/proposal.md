# Increase session search keyword limit

## Why

运维和集成人员在会话历史搜索中需要使用较长的告警名、工单号、接口路径或复合关键词定位历史会话。当前 `GET /api/v1/sessions` 的 `q` 在 trim 后最多允许 50 个 Unicode code point，前端会话搜索也在发起请求前拦截超过 50 的关键词。较长的合法检索词被拒绝，用户只能手动缩短关键词，可能丢失精确匹配上下文。

本次将仅面向会话历史搜索的关键词上限提升到 200 个 Unicode code point，保持搜索结果 scope 隔离、时间范围、分页和失败关闭语义不变。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- `GET /api/v1/sessions` 的非空 `q.trim()` 在不超过 200 个 Unicode code point 时可通过校验并参与会话搜索。
- 超过 200 个 Unicode code point 的 `q` 在 Web API 边界返回请求校验错误，且不得调用 runtime、session 或 gateway 查询。
- Local、Immersive 和 Collaborative / PIU 的会话搜索输入框使用同一 200 上限，超过上限时不发起搜索请求。
- 用户提示文案反映 200 个字符上限。

**非目标：**

- 不新增跨会话全文搜索、搜索结果高亮、结果计数或消息定位能力。
- 不修改会话搜索的 `createdFrom` / `createdTo` 时间范围、`offset` / `limit` 分页或排序语义。
- 不修改搜索 `limit` 的 50 上限和普通列表 `limit` 的 200 上限。
- 不修改收藏 `/api/v1/favorites` 的 `keyword` 校验或行为。

## What Changes

- 修改 `GET /api/v1/sessions` 的公共查询契约：非空 `q.trim()` 长度上限从 50 个 Unicode code point 调整为 200 个 Unicode code point。
- 修改前端会话历史搜索的本地校验：超过 200 个 Unicode code point 时不发起请求，并提示关键词最多 200 个字符。
- 保持校验失败的安全行为：超过上限返回 HTTP 400 + `REQUEST_VALIDATION_FAILED`，不得执行宽松或降级查询。

## Feature 影响（Features）

### 修改的 Feature

- `F-1.3 管理会话`：用户可以在会话搜索中使用更长的精确关键词；会话管理的其他创建、查询、删除和 scope 隔离边界不变。

## Function 影响（OpenSpec Capabilities）

### 修改的 Function

- `FN-1.6 查询会话列表` → `specs/session-history-search/spec.md`
  - 功能边界：会话列表关键词搜索的 `q` 长度上限从 50 个 Unicode code point 调整为 200 个 Unicode code point，前后端校验保持一致。
  - 系统质量属性：安全（失败关闭）、可维护性（契约与实现一致）、可测试性（边界值可验证）。
  - 映射说明：canonical spec 为 `session-history-search`；本 change 同步触及 legacy spec `ts-minimal-agent-kernel` 中的相同校验约束。

## 影响范围（Impact）

- 影响 Local、Immersive 和 Collaborative / PIU 共享的会话历史搜索交互。
- 影响公共 Web API `GET /api/v1/sessions` 的 `q` 输入校验和错误文案。
- 影响前端 mock server 对同一查询契约的模拟行为。
- 不影响收藏搜索、ToolSearch、RAG、问题联想或其他使用关键词的接口。