## 背景和现状（Context）

收藏事实存储在 `conversation_annotations` 表的 `is_favorited` 字段上，锚定 `requestRunId`，按 `(tenantId, subjectId)` scope（即单用户）隔离，列表查询仍带 `agentId` 做投影分页。写入链路：前端 `TurnBlock.callAnnotationApi`（乐观更新）→ `annotationService.upsertAnnotation` → `POST /sessions/:sid/runs/:rid/annotations` → `ConversationAnnotationService.upsertAnnotation` → gateway `saveAnnotation`。

`saveAnnotation`（`packages/agent-platform-gateway-local/src/db/sqlite-gateway-core.ts`）已在 `this.transaction()` 内执行 INSERT / UPDATE / DELETE，全程无收藏计数限制。表已有索引 `idx_conversation_annotations_favorites ON (tenant_id, subject_id, agent_id, is_favorited, updated_at DESC, session_id ASC)`，scope 内按 `is_favorited` 计数有索引支撑。

错误链路：gateway 返回 `SafeError` → service `isSafeError` 转 `AgentError` → web route `statusFor` 按 category 映射 HTTP 状态码（`VALIDATION`→400）。前端 `apiClient` 暴露 `ApiError.code`，`TurnBlock` catch 块回滚乐观更新并展示通用 `turn.annotationError`。

约束：

- AGENTS.md 规格优先：persistence owner 行为变化必须先有 OpenSpec change（本 change）。
- 同形同策：超限拒绝必须复用既有 SafeError + AgentError + statusFor 通道，与既有 annotation 写入拒绝（如 comment 超长 400）使用同一模式。
- 最小内核非回归：不修改 conversation 历史响应形状。
- 主路径持久化事实访问必须显式携带 agentId；收藏计数 scope 收窄为 `(tenantId, subjectId)`（跨所有 agent 共享配额），与 `listFavoriteTurns` 的列表投影 scope（仍含 agentId）不同，这是有意区分：计数是配额治理（per-user），列表是浏览投影（per-agent 分页）。

相关方：`agent-platform-gateway-local`（权威限制）、`agent-session`（既有 SafeError 转换，预期无需改动）、`agent-channel-web`（既有错误映射，预期无需改动）、`frontend/agent-web`（超限回滚与提示）。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 每个 `(tenantId, subjectId)` scope（单用户，跨所有 agent）最多 100 个 `isFavorited=true` 标注；local 宿主超限在 gateway 事务内以 `SafeError { code: "FAVORITE_LIMIT_EXCEEDED", category: "VALIDATION", retryable: false }` 拒绝，无 side effect；remote 宿主由前端前置检查拦截。
- 上限只在净新增收藏时校验：INSERT 新行且 `isFavorited=true`、UPDATE 将 `isFavorited` 从 false 翻转为 true。其余写入放行。
- local 宿主前端收到 `FAVORITE_LIMIT_EXCEEDED` 后回滚乐观收藏状态，并展示专门的数量超限提示。

**非目标：**

- 不引入上限配置项（固定常量 100）。
- 不限制 `isQuestionFavorited`（本字段不在本 change 范围内）。
- 不新增读端点暴露当前收藏计数；local 宿主权威限制在 gateway；remote 宿主无 gateway enforce 能力，由前端基于既有 `listFavoriteTurns` 做前置近似检查（受控例外，见 D7）。
- 不区分收藏来源做次数返还；supersede 清理和会话删除级联自然释放配额，无需配额返还机制。
- 不改变既有 annotation upsert 语义、全空行删除、幂等重放、supersede 清理行为。

## 设计决策（Decisions）

### D1：enforce 位置——gateway 事务内

上限校验放在 `saveAnnotation` 已有的 `this.transaction()` 内，紧接判定为净新增收藏之后、INSERT/UPDATE 之前执行一次 scope 内 `SELECT COUNT(*) ... WHERE is_favorited=1` 计数，达到 100 即返回 SafeError。better-sqlite3 同步串行写，count 与 write 同事务，零 TOCTOU 竞态。

- 放弃「service 层先 count 再 save」：两步不在同一事务，并发下两个净新增收藏可同时通过 count 检查后双双写入，突破 100。收藏是持久化事实，无法像附件那样用 in-memory `UploadQuotaTracker` 准确计数，语义不同，不构成同形同策约束。
- 该选择符合架构边界：scope 内收藏基数上限是一个持久化基数不变量（cardinality invariant），性质上接近唯一约束，属于 gateway-local 允许的「唯一约束、幂等和事务」职责，不触碰「gateway-local 不得反推业务事件语义」红线。

### D2：净新增判定时机

只在净新增收藏时校验，避免误拦合法操作：

- INSERT 路径（`existing === undefined`）：`record.isFavorited === true` 时校验。若 `isFavorited` 为 false 或 undefined，该行不产生新收藏，放行（若 sentiment 也为空则按既有逻辑不插入/返回 undefined）。
- UPDATE 路径（`existing !== undefined`）：当 `existing.is_favorited !== 1`（当前未收藏）且 `updatedIsFavorited === true`（翻转为收藏）时校验。已收藏行重新收藏（true→true）、取消收藏（true→false）、单独改 sentiment/comment 一律放行，不触发计数查询。

计数查询不计入当前正在写入的行：INSERT 路径下行尚未插入，UPDATE 路径下当前行 `is_favorited=0` 不在计数内，因此 count 即为「若本次写入成功后的现有其他收藏数」，count >= 100 即拒绝。

### D3：scope 与计数查询

计数 scope 为 `(tenantId, subjectId)`，跨所有 agent 共享配额：`SELECT COUNT(*) AS n FROM conversation_annotations WHERE tenant_id = ? AND subject_id = ? AND is_favorited = 1`。`listFavoriteTurns` 查询仍带 `agentId` 做列表投影分页，但配额上限按用户聚合。`idx_conversation_annotations_favorites` 索引前缀 `(tenant_id, subject_id)` 仍支撑该查询；收藏上限 100，结果集有界。

### D4：超限安全错误形态

新增稳定错误码 `FAVORITE_LIMIT_EXCEEDED`，category `VALIDATION`，`retryable=false`。`VALIDATION` 经 `statusFor` 映射 HTTP 400，与既有 comment 超长拒绝同形同策。`retryable=false` 防止调用方自动重试。错误 message 为通用安全文案，不含 scope、存储路径、SQL 或内部细节。

- 不使用 `CONFLICT`（409）：retry-attempt-limit 用 CONFLICT 是因为 retry 依赖 request run 的状态机冲突；收藏上限是配额/基数约束，不是状态机冲突，`VALIDATION`（400）语义更准确。两者虽同为「计数上限」，但锚点语义不同（durable attempt 状态 vs scope 内聚合基数），不属于同形同策要求强制对齐的同一语义类别。
- SafeError code 是自由字符串，无需新增枚举或注册表；gateway 既有 `annotationSafeError` helper 已用于构造 annotation SafeError，直接复用。

### D5：幂等与既有语义保持

幂等重放：`saveAnnotation` 在 `options.idempotencyKey !== undefined && existing === undefined` 时先按 idempotencyKey 查既有行，命中则直接返回首次结果，不进入 INSERT 路径，因此不触发计数校验——已 accepted 的幂等重放自然不受上限影响，与 retry 上限的幂等优先原则一致。该顺序已在既有代码中固定，本 change 不调整。

全空行删除、supersede 清理、会话删除级联均不涉及净新增收藏，不受上限影响；后两者会删除 `is_favorited=1` 行，自然释放配额。

### D6：前端超限投影

`TurnBlock.callAnnotationApi` 的 catch 块当前不区分错误类型，统一展示 `turn.annotationError`。改为捕获 `error` 并判断 `ApiError.code === "FAVORITE_LIMIT_EXCEEDED"`：命中则展示专门的数量超限提示（i18n key `turn.favoriteLimitError`，zh-CN「收藏已达上限，请先取消部分收藏后再收藏」/ en-US 对应文案），否则保留通用 `turn.annotationError`。两种情况都回滚乐观更新（既有行为）。此为 local 宿主路径（gateway enforce → 错误回滚）。

### D7：remote 宿主前置检查（受控例外）

remote 宿主（`immersive`/`piu` 模式）无 gateway 事务 enforce 能力。在 `TurnBlock` 收藏操作（`isFavorited` 从 false→true）前，先调用 `annotationService.listFavoriteTurns(0, 100)` 查询当前用户收藏列表，若 `entries.length >= 100` 则不发 upsert 请求，直接回滚乐观状态并展示 `turn.favoriteLimitError` 提示。local 宿主不做前置查询，依赖 gateway 事务 enforce + 错误回滚。

用户身份通过 `webIdentityResolver` 传递链解析：前端 `apiClient` 通过 `x-subject-id` / `x-tenant-id` header（远端来源 `site.user.id`）传递，后端 `identityResolver(request)` 解析成 `IdentityContext { tenantId, subjectId, displayName }`，scope 即 `{ tenantId, subjectId }`。前端不需要自行解析 userId，收藏列表查询已隐式按当前用户 scope 过滤。

同形同策例外说明：local 用事务内原子 enforce，remote 用前端 check-then-insert。两者 scope 一致（都 per-user），但机制不同。remote 的 check-then-insert 存在竞态窗口（两个收藏同时通过 99 的检查），但远端无 gateway enforce 能力，接受 ≤100 的近似语义。这是受控例外，非理想方案。remote 前置检查只拦截净新增收藏（false→true），取消收藏、已收藏行重收藏不触发前置查询。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | 上限常量固化在 gateway，不接受 client 输入；超限错误为 safe error，不泄漏 scope/存储/SQL/内部细节；agent+owner scope 校验顺序不变 | gateway 超限负例测试断言错误码与无泄漏；Web 错误透传测试 |
| 性能/容量 | 上限直接约束 scope 内最大收藏行数（100）；计数查询有索引支撑、结果集有界；事务内一次 COUNT | 既有 annotation 测试不退化 |
| 可靠性/恢复 | 幂等重放优先于上限校验；超限拒绝无 side effect，不产生需 reconcile 的中间态 | 幂等重放 + 超限组合测试；无 side effect 断言 |
| 可维护性 | gateway 权威上限保持单一常量和单一校验点；remote 前置检查是已文档化受控例外，复用既有 SafeError/AgentError/statusFor 通道 | `npm run lint:architecture`；code review |
| 可测试性 | 上限行为由持久化行驱动，可用既有 gateway 测试基建构造 100/101 收藏的确定性场景 | gateway characterization 测试；前端组件测试 |
| 审计/可追溯性 | 超限拒绝以稳定错误码进入既有 safe error 路径；无新增可观测信号 | 既有 observability 断言路径 |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| scope 内第 100 个收藏接受、第 101 个以 `FAVORITE_LIMIT_EXCEEDED` 拒绝且无 side effect | T2 | `npm test -- ...agent-platform-gateway-local` 收藏上限测试 |
| 取消收藏、已收藏行重收藏、单独改 sentiment 不触发上限 | T2 | gateway 负例/放行测试 |
| 幂等重放优先于上限 | T2 | gateway 幂等重放 + 超限组合测试 |
| 跨 agent 共享配额（同用户不同 agent 的收藏计入同一 100 上限） | T2 | gateway 跨 agent 共享配额测试 |
| supersede 清理释放配额 | T2 | gateway 清理后新收藏接受测试 |
| Web channel 透传 safe error、HTTP 400、无敏感信息泄漏 | T3 | `npm run test:contract` / channel 错误映射测试 |
| agent-web 超限回滚 + 专门提示 | T4 | `frontend/agent-web` 组件测试 |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/conversation-annotation/spec.md`（本 change delta 归档合并：上限数值、scope、enforce 位置与时机、错误码、投影行为）。
- 架构和跨模块设计：`openspec/designs/modules/agent-platform-gateway-local.md` 归档前补充收藏计数上限常量与事务内 enforce 语义。
- 模块设计：无（`saveAnnotation` 职责不变，仅新增基数不变量校验）。
- ADR：无（决策复杂度不足以单独立 ADR，取舍记录在本 design）。
- 导航：无。

## 风险与取舍（Risks / Trade-offs）

- [超限提示文案需用户手动清理] -> 设计如此：上限是配额治理，用户取消部分收藏后即可继续；不自动淘汰最早收藏，避免无声数据丢失。
- [既有已达 100+ 收藏的存量数据上线后立即受限] -> 符合预期：上限对净新增生效，存量收藏不被删除；用户取消后才能新增。
- [刷新后前端不知道当前收藏计数] -> local 权威限制在 gateway，超限错误即反馈；remote 前置检查基于既有 `listFavoriteTurns` 投影，不新增读端点暴露计数，避免为单字段扩 API surface。

## 迁移计划（Migration）

无数据迁移。上限为运行时判定，对存量收藏自然生效（存量不被删除，仅阻止净新增）。发布无需特殊步骤；回滚即还原代码，无持久化格式变化。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/conversation-annotation/spec.md`：合并「收藏数量上限」requirement。
- `openspec/overview.md`：稳定基线描述补充收藏上限一句。
- `openspec/designs/modules/agent-platform-gateway-local.md`：补充上限常量与事务内 enforce 语义。

## 待确认问题

无。
