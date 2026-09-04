## 背景与问题（Why）

NextAgent 现有高频问题和问题联想能力依赖本地问题活动数据与静态问题资源，不能为正式问题推荐功能提供统一的 Working Memory 外部服务契约。前台后续需要查询用户历史高频问题和基于当前输入查询预置相似问题，但当前 `agent-contracts/gateway` 没有能够同时表达可信 Owner Scope、Agent Scope、请求边界、结果语义和取消语义的 gateway contract。

同时，当前 `ConversationAnnotationRecord.isFavorited` 表示回答/turn 收藏，不能表达“收藏用户问题”。若直接复用该字段，会混淆问题收藏与回答收藏，并改变 `listFavoriteTurns()` 的既有语义。

本 change 先冻结正式问题推荐所需的 canonical gateway contract，并让 SQLite conversation annotation 能持久化问题收藏事实，为后续 remote adapter、应用编排、Web API 和前台接入提供稳定边界。

### 术语

- **正式问题推荐（Formal Question Recommendation）**：由 Working Memory service 提供的历史高频问题和预置相似问题查询；它不等同于既有 `SuggestedQuestionPort` 在回答完成后通过模型生成的下一步问题。
- **历史高频问题（Frequent History Question）**：按当前 Owner Scope 和 Agent Scope 聚合的历史问题及其出现频次。
- **预置相似问题（Preset Question Recommendation）**：根据当前查询文本从预置问题库返回的相似问题，包含稳定问题标识和展示文本。
- **问题收藏（Question Favorite）**：对用户问题本身的布尔标注；它与回答/turn 收藏是两个独立事实。

### 规范上下文

- 需求记录：GitCode issue `#391`“增加正式问题推荐功能所需 Gateway Contract”。
- Change 类型：frozen contract refinement 与 SQLite local conformance。
- 主要 owner：`agent-contracts/gateway`；`agent-platform-gateway-local` 只实现 conversation annotation persistence 映射。
- 发布语义：本 change 不启用正式问题推荐产品路径；可选 binding 只冻结后续 adapter 的注入位置。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- `agent-contracts/gateway` 提供唯一的 `QuestionRecommendationGateway`，分别查询历史高频问题和预置相似问题。
- 问题推荐请求显式携带可信 Owner Scope 和 Agent Scope，定义确定的输入范围、输出 shape、取消语义和安全失败结果。
- `QuestionRecommendationGateway` 作为 `WorkingMemoryGatewayBindings` 的可选成员暴露，不新增顶层 gateway binding 或 adapter kind。
- `ConversationAnnotationRecord` 使用可选布尔字段 `isQuestionFavorited` 独立表达问题收藏，SQLite adapter 能正确保存、更新、读取和清理该事实。
- 既有回答/turn 收藏查询只由 `isFavorited` 决定，不受 `isQuestionFavorited` 影响。

**非目标：**

- 不实现 remote memory service HTTP adapter、认证、重试、限流或应用配置。
- 不新增 Web API、runtime/application service 或 agent-web 问题推荐交互。
- 不替换现有 Pin API、`UserQuestionActivityStoreGateway`、高频问题 API 或问题联想 API。
- 不定义问题收藏的跨 session 聚合、去重、排序或推荐加权行为。
- 不改变 conversation annotation 现有的 request-run 锚点，以及 retry、edit、session 删除时的清理边界。

## 变更范围（What Changes）

- 新增 `QuestionRecommendationGateway` 及其两组 request、result、item contract 和 runtime JSON schema：
  - 历史高频问题查询接收 Owner Scope、`agentId`、`limit` 和可选 `locale`，返回问题文本与频次。
  - 预置相似问题查询接收 Owner Scope、`agentId`、查询文本、`limit` 及可选检索维度，返回问题标识与文本。
  - 两个异步方法均接收可选 `AbortSignal`，失败时返回 `SafeError`。
- 修改 `WorkingMemoryGatewayBindings`，新增可选的 `questionRecommendations` binding。
- 修改 `ConversationAnnotationRecord`，新增可选布尔字段 `isQuestionFavorited`；`undefined` 表示 partial upsert 不修改原值，`true` 表示收藏，`false` 表示取消收藏。
- 修改 SQLite conversation annotation schema，使用 `question_favorite` 布尔整数列承载 `isQuestionFavorited`，并同步 row mapping、upsert 和空标注清理条件，使问题收藏能够独立 round-trip。
- 增加 contract 与 SQLite characterization 测试，覆盖请求/响应 schema、边界值、partial upsert、取消收藏、空行删除、Owner Scope/Agent Scope 隔离和回答收藏查询不受影响。

## Capability 影响（Capabilities）

### 新增 Capability

- 无。

### 修改的 Capability

- `question-recommendation`：在保留既有 `SuggestedQuestionPort` 行为的前提下，增加 Working Memory 问题推荐 gateway 的绑定位置、两类查询契约、验证边界、scope 和失败语义。
- `conversation-annotation`：为 request-run conversation annotation 增加独立的问题收藏事实，并调整 SQLite 持久化与空标注判定。

## 影响范围（Impact）

- `packages/agent-contracts`：新增 gateway 类型、JSON schema 和 Working Memory binding 字段，扩展 conversation annotation record。
- `packages/agent-platform-gateway-local`：SQLite schema、迁移兼容、row mapping 和 conversation annotation store 行为受到影响。
- 现有 gateway contract tests、SQLite store tests 和 architecture checks 需要增加覆盖。
- remote gateway package、`agent-app`、Web channel 和 `frontend/agent-web` 不在本 change 的实现范围内，不产生运行时行为变化。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/question-recommendation/spec.md`：合并正式问题推荐 gateway 稳定行为，保留既有 `SuggestedQuestionPort` 行为。
- `openspec/specs/conversation-annotation/spec.md`：合并问题收藏字段及其持久化语义。
- `openspec/overview.md`：无。
- `openspec/designs/architecture/core-contracts.md`：补充 Working Memory 问题推荐 gateway，并为 frozen `ConversationAnnotationRecord` 增加问题收藏字段。
- `openspec/designs/modules/agent-contracts.md`：补充问题推荐 gateway contract 与 conversation annotation 字段。
- `openspec/designs/modules/agent-platform-gateway-local.md`：补充 SQLite 问题收藏映射。
- `openspec/designs/adr/`：无。
- `openspec/designs/features/`：无。
- `openspec/designs/functions/`：无。
- `openspec/designs/spec-to-design-map.md`：更新 `question-recommendation` 和 `conversation-annotation` 导航。

长期基线更新由归档流程执行，不是实施阶段任务。
