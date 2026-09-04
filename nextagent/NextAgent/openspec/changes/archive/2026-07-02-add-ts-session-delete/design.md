## 背景和现状（Context）

当前 NextAgent 会话主路径已经具备创建、列表、详情、stream、submit、cancel、retry、重命名、搜索、标注和分享等能力。会话列表缺少删除能力，导致本地运维诊断、客户系统联调和误建会话长期留在用户可见历史中。删除会话会触达 Web API、runtime/session contract、gateway-local 事务、annotation/share 从属事实和前端 host runtime 状态，因此必须先定义唯一边界。

现有约束：
- `agent-channel-web` 只负责 transport、schema validation 和 projection，不拥有 request lifecycle 或 persistence。
- Runtime 拥有 trusted Agent Scope 解析；session domain 负责 owner+agent scoped session 语义。
- 主路径持久化事实必须使用 dedicated table 和 gateway public contract，不得绕过 scope 直接操作私有 row。
- active/in-flight run 仍由 runtime lifecycle 管理；删除会话不能成为隐式 cancel。

## 目标和非目标（Goals / Non-Goals）

**目标：**
- 为会话列表提供用户可触发的单会话删除能力。
- 删除命令贯穿 trusted owner scope 和 Agent scope。
- 删除前阻止非 terminal active/in-flight run，避免破坏 terminal commit 和 stream/history 一致性。
- gateway-local 使用单一 composite transaction 物理删除会话主路径事实及 annotation/share 等会话从属事实。
- 前端普通列表、search dialog 和 PIU History Popover 复用同一删除动作，并在删除后按当前窗口刷新。

**非目标：**
- 不做批量删除、回收站、恢复、软删除列表、后台老化、保留策略或跨用户管理删除。
- 不实现“删除并取消运行中请求”。
- 不改变 session search 的匹配、排序、分页和日期过滤语义。
- 不改变 submit、cancel、retry、terminal commit、stream replay、history consistency 或 memory lifecycle。
- 不新增 share/annotation 诊断读取能力。

## 设计决策（Decisions）

### D1. 删除入口只新增单会话 DELETE API

唯一外部入口为 `DELETE /api/v1/sessions/:sessionId`。请求不接收 body。`sessionId` 来自 path parameter，identity 来自 Web auth boundary，agent scope 由 runtime 内部解析。成功返回 HTTP 204。

放弃方案：
- 前端本地隐藏列表项：会留下历史详情、搜索、分享和标注仍可读的状态。
- `POST /api/v1/sessions/:id/delete`：与 REST 资源删除语义重复，增加 API surface 噪声。
- 批量删除：需要独立定义部分成功、容量和恢复语义，超出当前最小目标。

### D2. Runtime 只解析 Agent Scope 并委托 session domain

新增 `RuntimeDeleteSessionCommand { identityContext, sessionId }` 和 `RuntimeSessionPort.deleteSession(command): Promise<void>`。Runtime 收到命令后使用既有 trusted Agent Scope resolver 得到 `agentId`，再调用 `UserSessionPort.deleteSession({ identityContext, agentId, sessionId })`。

Runtime 不直接删除 gateway facts，不组装 Record，不向 Web 返回 Record。这样保持 runtime 负责 scope admission，session domain 负责会话生命周期语义。

### D3. Session domain 拥有删除前 active run 防护

`agent-session` 删除流程先通过 gateway composite boundary 在同一 owner+agent scoped coordinate 下检查 session 存在性和非 terminal run。若 session 不存在，返回 safe not-found；若存在非 terminal run，返回 safe conflict。检查和删除必须位于同一个 gateway transaction，避免检查后 run 状态变化导致半删。

放弃“先调用 runtime cancel 再删除”：cancel 是 request lifecycle 命令，删除列表项不能隐式推进 run terminal state，也不能绕过用户对 cancel/retry 的显式控制。

### D4. Gateway-local 提供单一 composite delete

新增 gateway public contract，例如 `deleteSessionCascade(command)`，输入包含 trusted owner scope、`agentId`、`sessionId`。SQLite 实现位于 `agent-platform-gateway-local`，由 `SqliteGatewayStores` 管理。

事务顺序固定：
1. 按 `(tenantId, subjectId, agentId, sessionId)` 锁定或读取 session。
2. 检查该 session 是否存在非 terminal request run。
3. 删除 session 从属事实：conversation annotations、conversation shares、active context items/state、checkpoints、timeline events、messages、request runs、session row，以及当前实现中由该 session 派生的 favorite/search/preview 从属表。
4. 提交事务。

若任一步失败，事务回滚。删除顺序以外键/约束安全为准，但业务 owner 是同一个 composite delete，不允许 runtime、session domain 或 Web channel 分散逐表删除。

### D5. 物理删除，不引入 retained deleted state

本 change 采用物理删除。删除后 session list 不返回 tombstone，conversation/history/stream/share path 不再暴露原内容。稳定系统暂不承诺审计检索被删除会话内容。

放弃软删除：软删除需要定义 retained state、恢复、安全可见性、搜索排除、容量和合规保留策略，会把列表删除扩成数据治理系统。当前用户目标是清理会话列表噪声，物理删除最小且唯一。

### D6. Share 与 annotation 随 session 删除

Annotation 是 session/run 从属用户标注，删除 session 后必须消失，收藏列表也不能再展示该 session。

Share 是创建者主动公开的 session/run 快照入口。既有稳定 spec 曾声明未来删除时级联清理；本 change 将该义务兑现为删除事务的一部分。删除后旧 `shareId` 不再返回原 messages。为保持 KISS，不保留 share record 作删除审计。

### D7. 前端复用现有列表行动作

Sidebar 普通列表、local/immersive search dialog、collaborative PIU History Popover 都在现有 row action 中增加删除入口和确认交互。删除成功后：
- 普通列表按当前普通列表偏好刷新。
- 搜索态按当前 `q`、日期范围和已加载窗口刷新。
- PIU 清除被删除 active session id，且只继续使用既有 `nextagent:AIAgentPIU:activeSessionId` key。

删除当前打开会话时，前端清空 current session selection 并显示安全的新会话/未选中状态，不继续展示旧 conversation。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | 删除仅使用 trusted identity 和 runtime resolved `agentId`；跨 owner/agent 返回 safe not-found；Web 不接触 gateway；safe error 不暴露 SQL、路径或会话内容。 | Web route negative tests、runtime/session contract tests、gateway-local cross-scope tests、`npm run lint:architecture` |
| 性能/容量 | 单会话删除按 scoped indexed coordinates 下推到 SQL；不做全 scope JS 扫描；不新增搜索索引或 tombstone 表。 | gateway-local tests 断言 scoped delete；code review 检查 SQL owner+agent predicates |
| 可靠性/恢复 | active run conflict 防止破坏 terminal commit；全部删除在一个事务内完成，失败回滚；删除不隐式 cancel。 | gateway transaction rollback tests、active run conflict tests、runtime lifecycle non-regression tests |
| 可维护性 | 唯一路径为 Web route -> RuntimeSessionPort -> UserSessionPort -> gateway composite delete；annotation/share 清理由 composite delete 统一承载。 | architecture lint、module boundary review、contract tests |
| 可测试性 | 每层都有可观察边界：HTTP 204/404/409、runtime/session command、gateway 删除后查询不可见、前端列表刷新。 | unit、contract、frontend component tests、OpenSpec validate |
| 审计/可追溯性 | 本 change 不保留被删除内容作为审计事实；日志只记录 safe coordinates、结果和错误码，不记录 prompt、message content、raw SQL 或路径。 | observability/safe-log review checkpoint、safe error tests |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| `DELETE /api/v1/sessions/:sessionId` 只使用 trusted identity，成功不返回内容 | 1.1, 4.1 | Web route tests、`npm test` |
| Runtime 内部解析 Agent Scope 并委托 session domain | 1.2, 2.1 | runtime contract tests、architecture lint |
| 跨 owner/agent 删除返回 safe not-found | 2.2, 3.2, 4.2 | session/gateway/Web negative tests |
| 非 terminal run 阻止删除且不隐式 cancel | 2.3, 3.3 | runtime/session characterization tests |
| gateway-local 单事务物理删除并失败回滚 | 3.1, 3.4 | gateway-local transaction tests |
| 删除级联清理 annotation/share | 3.5 | gateway-local annotation/share tests、share API not-found/deleted tests |
| 搜索态删除保留过滤条件 | 5.1 | frontend component tests |
| 删除当前会话后前端不展示旧历史 | 5.2 | frontend route/state tests |
| 架构边界不出现 private path import 或 Web 直连 gateway | 6.1 | `npm run lint:architecture` |
| OpenSpec delta 完整有效 | 7.1 | `openspec validate add-ts-session-delete --strict`、`openspec validate --all --strict` |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/session-delete/spec.md` 主承载删除行为；`session-history-search`、`conversation-annotation`、`conversation-share`、`ts-minimal-agent-kernel` 只承载与各自能力直接相关的交叉要求。
- 架构和跨模块设计：`openspec/designs/architecture/web-channel-api-surface.md` 主承载 API surface；`runtime-boundaries.md` 主承载 runtime/session lifecycle 边界；`core-contracts.md` 主承载 port/contract shape。
- 模块设计：`openspec/designs/modules/agent-channel-web.md`、`agent-runtime.md`、`agent-session.md`、`agent-platform-gateway-local.md` 分别承载模块职责和非职责。
- ADR：若归档时仍需要保留物理删除、无回收站、active run conflict 的取舍，新增 `openspec/designs/adr/session-delete-lifecycle.md`；否则不新增 ADR。
- 导航：`openspec/designs/spec-to-design-map.md` 增加 `session-delete` 的 spec、architecture、module 和验证入口映射。

## 风险与取舍（Risks / Trade-offs）

- [删除事务触达表较多] -> 用 gateway-local composite delete 统一 owner，测试覆盖回滚和跨 scope，避免分散业务层逐表删除。
- [删除当前打开会话造成前端状态悬空] -> 前端在删除成功后显式清空 current session selection，不复用旧 conversation cache。
- [active run 与删除并发] -> 检查和删除放在同一 transaction；非 terminal run 返回 conflict。
- [物理删除缺少恢复能力] -> 当前 change 明确不承诺恢复；未来需要恢复或合规保留时必须新增独立 change。
- [share 删除影响已发出的链接] -> 删除会话是用户主动移除内容，旧 share 链接不再暴露内容，返回 safe not-found/deleted。

## 迁移计划（Migration Plan）

无数据迁移。新增代码发布后，现有 session、message、annotation、share 数据保持原样；只有用户主动调用删除 API 时才删除对应会话事实。

回滚策略：若发布后需要回滚代码，已删除的会话不会恢复。由于本 change 不引入新 retained state 或 schema 必填迁移，代码回滚不需要数据回滚脚本。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/session-delete/spec.md`：新增删除能力完整行为。
- `openspec/specs/session-history-search/spec.md`：补充搜索结果列表项删除与刷新窗口行为。
- `openspec/specs/conversation-annotation/spec.md`：补充会话删除级联清理标注和收藏投影。
- `openspec/specs/conversation-share/spec.md`：更新 session lifecycle obligation，删除后不暴露分享内容。
- `openspec/specs/ts-minimal-agent-kernel/spec.md`：补充 runtime/session port 删除和 gateway composite delete 主路径边界。
- `openspec/overview.md`：补充用户主动会话清理的长期背景。
- `openspec/designs/architecture/web-channel-api-surface.md`：新增 DELETE route。
- `openspec/designs/architecture/runtime-boundaries.md`：补充 deletion boundary、active run conflict 和非 cancel 取舍。
- `openspec/designs/architecture/core-contracts.md`：补充 RuntimeSessionPort、UserSessionPort、gateway composite delete contract。
- `openspec/designs/modules/agent-channel-web.md`、`agent-runtime.md`、`agent-session.md`、`agent-platform-gateway-local.md`：补充模块职责。
- `openspec/designs/adr/session-delete-lifecycle.md`：仅当归档评审认为取舍需要长期保留时新增。
- `openspec/designs/spec-to-design-map.md`：新增导航和验证入口。

## 待确认问题（Open Questions）

无。
