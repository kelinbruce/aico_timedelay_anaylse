## 背景和现状（Context）

当前 NextAgent 后端有 `sessions`、`messages`、`request_runs` 等持久化表。contract 中定义了 `FeedbackRecord`/`FeedbackStoreGateway`（1-5 星 rating，锚定 `messageId`/`requestRunId`），但从未在 gateway-local 落地实现，且缺少 `agentId`，语义与实际需求不匹配。

retry/edit 时旧 run 被标记为 `SUPERSEDED`，旧消息通过 `hideMessage` 设置 `visible=false`。用户在对话视图看不到旧 run 的消息（`listMessages` 硬编码 `includeHidden: false`）。

系统当前没有会话老化机制。`memory-aging` 只管 `long_term_memory` 表。会话老化是未来独立 change 的范围。

## 目标和非目标（Goals / Non-Goals）

**目标：**
- 提供对话标注的完整后端持久化和 API 能力：upsert 标注（sentiment + isFavorited）、分页查询收藏会话、查询会话内标注。
- 统一点赞/点踩/收藏为单表单行 per run，`sentiment` 和 `isFavorited` 是同一行上的两个独立字段。
- retry/edit supersede 时自动清理旧 run 标注，确保无隐形标注。
- 为未来会话老化机制提供数据基础：可见收藏（`isFavorited=true`）存在即表示会话不可老化。

**非目标：**
- 不实现会话老化机制（独立 change）。
- 不将收藏与 `long_term_memory.isPinned` 关联——两者是不同层面的概念。
- 不实现标注的评论或理由文字——如需要可后续扩展。

## 设计决策（Decisions）

### 决策 1：一个 run 一行，sentiment 和 isFavorited 是同行独立字段

用户对同一轮问答的点赞/点踩/收藏是同一行记录上的两个独立维度：`sentiment`（UP/DOWN/null，互斥）和 `isFavorited`（true/false，独立）。不存在用 `type` 列区分的多行设计——一个 run 只有一行标注，所有标注字段在同一行上。

UP↔DOWN 切换是 `UPDATE sentiment='DOWN'`，一个字段值的更新。收藏是 `UPDATE is_favorited=1`，同一行另一个字段。两者互不干扰。

当 `sentiment=null` 且 `isFavorited=false` 时，该行被物理删除——不保留全空僵尸记录。

### 决策 2：统一锚定 `requestRunId`

锚定 `requestRunId` 而非 `requestId`：NextAgent retry/edit 后旧消息被隐藏（`visible=false`），用户看不到旧 run。锚定 `runId` 使标注跟随具体版本的回复——retry 后旧标注和旧答案一起"沉下去"，与 ChatGPT regenerate 行为一致。

### 决策 3：supersede 清理

run 被 retry/edit 取代时，runtime 调用 `deleteAnnotationsByRun` 删除该 run 的标注行。这确保已被隐藏的旧 run 不残留"隐形标注"——用户看不到的收藏不应阻止 session 被老化。防老化语义完全自洽：只有用户能看到的收藏才保护 session。清理作为独立 gateway 调用在 retry/edit 流程中执行；若清理失败，retry/edit 操作 MUST 报告失败。

清理通过 `ConversationAnnotationStoreGateway.deleteAnnotationsByRun` 执行。runtime 在 retry/edit 流程中调用。若清理失败，retry/edit 必须失败。

### 决策 4：独立 `RuntimeConversationAnnotationPort`

标注是独立能力，不属于 session lifecycle。独立 port 保持 `RuntimeSessionPort` 职责聚焦，允许标注独立禁用（optional dependency）。`WebChannelDependencies.annotations` 为可选依赖，未注入时返回 503。

### 决策 5：替代未实现的 `FeedbackStoreGateway`/`FeedbackRecord`

现有 `FeedbackRecord`/`FeedbackStoreGateway` 从未落地实现。本 change 将其替换为 `ConversationAnnotationStoreGateway`/`ConversationAnnotationRecord`，并 MODIFY `ts-core-contracts` spec。因原有 contract 从未实现，无运行时 breaking change。

### 数据模型

```
ConversationAnnotationRecord (gateway persistence DTO)
├─ extends OwnerScoped { tenantId, subjectId }
├─ agentId: AgentId
├─ annotationId: string                // PK, UUID v7
├─ sessionId: SessionId
├─ requestRunId: RequestRunId          // 锚点
├─ sentiment: "UP" | "DOWN" | null     // 互斥, null=中性
├─ isFavorited: boolean                // 独立于 sentiment
├─ createdAt: EpochMillis              // 首次标注动作时间
├─ updatedAt: EpochMillis              // 最后修改时间
├─ comment?: string | null           // 自由文本, 附属标注, 不参与全空行判定

ConversationFavoriteSessionSummary (gateway projection, WHERE is_favorited=1)
├─ sessionId: SessionId
├─ favoriteCount: number

ConversationAnnotationView (runtime public DTO)
├─ annotationId, sessionId, requestRunId, sentiment, isFavorited, comment, createdAt

ConversationFavoriteSessionEntry (runtime public DTO, enriched)
├─ sessionId, favoriteCount
├─ sessionTitle?, sessionUpdatedAt
```

```
SQLite: conversation_annotations (一个 run 一行)
┌────────────────────────────────────────────────────────────────────┐
│ tenant_id, subject_id, agent_id    ← scope (三元)                  │
│ annotation_id                      ← PK                             │
│ session_id                         ← 标注所在会话                   │
│ request_run_id                     ← 锚点                           │
│ sentiment                          ← 'UP' | 'DOWN' | NULL          │
│ is_favorited                       ← 0 | 1                         │
│ comment                           ← 自由文本, NULL when not set      │
│ idempotency_key                    ← 幂等                           │
│ created_at                         ← 首次标注时间                   │
│ updated_at                         ← 最后修改时间                   │
│ PRIMARY KEY (tenant_id, subject_id, agent_id, annotation_id)       │
├────────────────────────────────────────────────────────────────────┤
│ UNIQUE INDEX (scope, session_id, request_run_id) ← 一个 run 一行   │
│ UNIQUE INDEX (scope, idempotency_key) WHERE NOT NULL  ← 写入幂等   │
│ INDEX (scope, session_id, created_at ASC) ← 会话内查询            │
│ INDEX (scope, is_favorited, updated_at DESC) ← 收藏列表查询     │
└────────────────────────────────────────────────────────────────────┘
```

### API 路由

```
POST   /api/v1/sessions/:sessionId/runs/:runId/annotations
       body: { sentiment?: "UP"|"DOWN"|null, isFavorited?: boolean, comment?: string|null }
       至少提供其一
       → 200: { annotationId, sessionId, requestRunId, sentiment, isFavorited, comment, createdAt }
       upsert: 无行则 INSERT, 有行则 UPDATE 提供的字段
       若 sentiment=null 且 isFavorited=false → DELETE 行 (comment 同时被删), 返回空状态
       幂等: 相同值返回当前状态

GET    /api/v1/favorites?offset=0&limit=50
       → 200: { entries: [{ sessionId, favoriteCount,
               sessionTitle, sessionUpdatedAt }],
               offset, limit, hasMore }

GET    /api/v1/sessions/:sessionId/annotations
       → 200: { annotations: [{ annotationId, requestRunId, sentiment,
               isFavorited, createdAt }] }
```

### 调用链路

```
Frontend (agent-web)
    │
    ├── POST ─────────────────────────► agent-channel-web (Fastify routes)
    │                                    │
    │                                    ├── identityResolver → IdentityContext
    │                                    └── annotations?: RuntimeConversationAnnotationPort
    │                                          │
    │                                          ▼
    │                                    agent-session (RuntimeConversationAnnotationPort impl)
    │                                          │
    │                    ┌─────────────────────┼─────────────────────┐
    │                    ▼                     ▼                     ▼
    │    ConversationAnnotationStoreGateway  SessionStoreGateway   (session metadata)
    │    (agent-platform-gateway-local)
    │                    │
    │                    ▼
    │    SQLite: conversation_annotations (一个 run 一行)
    │
    └── retry/edit supersede cleanup:
         agent-runtime → ConversationAnnotationStoreGateway.deleteAnnotationsByRun
```

### 前端状态管理

标注图标与复制、重新生成按钮位于同一操作行（hover 显示），排列顺序为：复制、点赞、点踩、收藏、重新生成。三个标注图标与复制/重新生成使用相同的图标尺寸（18x18px）、间距（gap 8px）和交互模式。仅在 terminal 状态且有回复内容时展示。

```
打开会话时:
  GET /api/v1/sessions/S1/annotations
    → annotations: [{ annotationId, requestRunId, sentiment, isFavorited, comment, createdAt }]

  构建: Map<requestRunId, { sentiment, isFavorited }>
    R1 → { sentiment: "UP", isFavorited: true }
    R2 → { sentiment: "DOWN", isFavorited: false }
    R3 → 不在 Map 中 (无标注, 全灰)

  渲染每条回复时查 Map:
    R1: 👍高亮 👎灰色 ⭐高亮
    R2: 👍灰色 👎高亮 ⭐灰色
    R3: 👍灰色 👎灰色 ⭐灰色

点击图标时 (乐观更新 Map + 调 API):
  点赞 (R3, 当前无标注):
    乐观: Map.set(R3, { sentiment: "UP", isFavorited: false })
    API:  POST { sentiment: "UP" }
    成功 → 保持
    失败 → Map.delete(R3) + 显示错误

  取消点赞 (R1, sentiment="UP", isFavorited=true):
    乐观: Map.set(R1, { sentiment: null, isFavorited: true })
    API:  POST { sentiment: null }
    成功 → 保持 (行仍在, isFavorited=true)

  收藏 (R2, sentiment="DOWN", isFavorited=false):
    乐观: Map.set(R2, { sentiment: "DOWN", isFavorited: true })
    API:  POST { isFavorited: true }
    成功 → 保持
```

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | 三元 scope 强制隔离；owner scope 只来自 IdentityResolver；请求体不得携带 scope 字段；日志不含对话内容 | gateway unit test scope 隔离断言；web route test scope 校验断言 |
| 性能/容量 | `listFavoriteSessions` 使用 SQL `WHERE is_favorited=1 GROUP BY session_id`；`(scope, is_favorited, updated_at DESC)` 索引；分页上限 100 | gateway unit test 分页正确性 |
| 可靠性/恢复 | upsert 幂等（unique constraint + idempotency key）；全空行自动删除；supersede 清理失败则 retry 失败 | gateway unit test 幂等/全空删除场景；runtime test supersede 清理 |
| 可维护性 | 独立 port 不污染 RuntimeSessionPort；一行 per run 数据模型简洁；web channel 可选依赖 | architecture assertion test |
| 可测试性 | gateway port 可注入 in-memory 实现；runtime port 可注入 mock gateway | 各层 unit test + integration test |
| 审计/可追溯性 | 标注 upsert 产生 structured log，只含 annotationId/sessionId/requestRunId/sentiment/isFavorited/comment(长度)/scope/occurredAt | log assertion in unit test |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| 三元 scope 隔离 | gateway impl + test | `agent-platform-gateway-local` unit test: 跨 scope 查询返回空 |
| requestRunId 锚点 | gateway impl + test | `agent-platform-gateway-local` unit test: 标注锚定 runId |
| upsert 幂等 | gateway impl + test | `agent-platform-gateway-local` unit test: 重复 upsert 返回同一行 |
| UP↔DOWN 字段更新 | gateway impl + test | `agent-platform-gateway-local` unit test: UP→DOWN 只改 sentiment 字段 |
| FAVORITE 独立 | gateway impl + test | `agent-platform-gateway-local` unit test: 设 isFavorited 不影响 sentiment |
| 全空行删除 | gateway impl + test | `agent-platform-gateway-local` unit test: sentiment=null+isFavorited=false 删除行 |
| supersede 清理 | runtime impl + test | `agent-runtime` test: retry 后旧 run 标注被删除 |
| 清理失败则 retry 失败 | runtime impl + test | `agent-runtime` test: 清理失败时 retry 报告失败 |
| 503 降级 | web route impl + test | `agent-channel-web` route test: annotations 未注入返回 503 |
| limit 上限 | web route impl + test | `agent-channel-web` route test: limit=200 返回 400 |
| 前端三态 toggle | frontend impl + test | `agent-web` test: 灰→UP→DOWN→灰 切换 |
| 前端收藏 toggle | frontend impl + test | `agent-web` test: 收藏/取消收藏 |
| 前端还原会话 | frontend impl + test | `agent-web` test: 单击列表项还原对话 |
| 架构边界 | architecture assertion | dependency-cruiser / source-level assertion |
| 标注不影响 terminal commit | characterization test | `agent-session` test: 标注操作不改变 request run 状态 |
| session aging 豁免义务 | spec requirement | 文档检查: spec 声明 future aging MUST 检查 isFavorited |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/conversation-annotation/spec.md`（新增）
- 架构和跨模块设计：`openspec/designs/architecture/core-contracts.md`（修改，`FeedbackStoreGateway` → `ConversationAnnotationStoreGateway`）
- 模块设计：
  - `openspec/designs/modules/agent-contracts.md`（修改，标注 gateway 和 runtime port）
  - `openspec/designs/modules/agent-channel-web.md`（修改，标注路由 projection）
  - `openspec/designs/modules/agent-session.md`（修改，`RuntimeConversationAnnotationPort` 实现）
  - `openspec/designs/modules/agent-runtime.md`（修改，supersede 清理职责）
- ADR：无
- 导航：`openspec/designs/spec-to-design-map.md`（修改，新增 `conversation-annotation` 导航）

## 风险与取舍（Risks / Trade-offs）

- [前端 `agent-web` 不在本仓库] -> 后端 API contract 和前端行为契约在 spec 中定义，前端实现由独立 workspace 完成。
- [supersede 清理修改现有 retry/edit 流程] -> runtime 的 retry/edit 流程需要新增 `deleteAnnotationsByRun` 调用。若清理失败，retry/edit 报告失败。
- [会话老化尚未实现] -> 收藏的防老化价值暂时无法端到端验证。spec 声明契约义务，supersede 清理保证语义自洽。

## 迁移计划（Migration Plan）

无迁移风险。`conversation_annotations` 是全新表。被替换的 `FeedbackRecord`/`FeedbackStoreGateway` 从未实现，移除不影响运行时。`WebChannelDependencies.annotations` 为可选依赖。SQLite 表通过 `CREATE TABLE IF NOT EXISTS` 在启动时创建。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/conversation-annotation/spec.md`：新增，承载全部行为契约。
- `openspec/specs/ts-core-contracts/spec.md`：修改，`FeedbackStoreGateway` → `ConversationAnnotationStoreGateway`。
- `openspec/overview.md`：新增对话标注能力说明。
- `openspec/designs/architecture/core-contracts.md`：`FeedbackStoreGateway` → `ConversationAnnotationStoreGateway`。
- `openspec/designs/modules/agent-contracts.md`：补充标注 gateway 和 runtime port。
- `openspec/designs/modules/agent-channel-web.md`：补充标注路由 projection。
- `openspec/designs/modules/agent-session.md`：补充 `RuntimeConversationAnnotationPort` 实现。
- `openspec/designs/modules/agent-runtime.md`：补充 supersede 清理职责。
- `openspec/designs/spec-to-design-map.md`：新增 `conversation-annotation` 导航。

## 待确认问题（Open Questions）

无。
