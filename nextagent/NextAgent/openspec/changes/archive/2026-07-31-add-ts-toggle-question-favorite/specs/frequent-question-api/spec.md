所属 Function：FN-1.19 收藏问题
Function 变更类型：修改
spec 角色：主规格

## REMOVED Requirements

### Requirement: Pin API 端点

**Reason**: 问题收藏的写路径已与回答收藏、点赞/点踩统一为标注 upsert API（`POST /api/v1/sessions/:sessionId/runs/:runId/annotations` 的 `isQuestionFavorited` 字段），专用 `POST /api/v1/user-questions/pin` 端点无任何前端调用方，属于死路径；继续保留会为同一语义维护两条写路径。

**Migration**: 调用方改用 `POST /api/v1/sessions/:sessionId/runs/:runId/annotations`，请求体携带 `isQuestionFavorited`（`true` 收藏、`false` 取消收藏）；取消收藏语义由 `conversation-annotation` spec 的 upsert 行为承载。端点移除后对该路径的请求返回 HTTP 404。

## Function 变更汇总

### 接口

- 变更类型：修改
- 目标内容：`POST /api/v1/sessions/:sessionId/runs/:runId/annotations`（`isQuestionFavorited` 字段）；专用 `POST /api/v1/user-questions/pin` 端点移除。
- 依据 Requirements：Pin API 端点（REMOVED）、用户消息「添加到常问」图标（MODIFIED，见 `high-frequency-question-ui` delta）
