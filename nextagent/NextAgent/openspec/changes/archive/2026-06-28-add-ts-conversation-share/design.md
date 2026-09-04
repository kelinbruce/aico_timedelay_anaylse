## 背景和现状（Context）

NextAgent 的对话数据按三元 owner scope `(tenantId, subjectId, agentId)` 严格隔离。所有主路径数据访问必须同时校验 Agent Scope 和 Owner Scope，`SessionStoreGateway`、`SessionMessageStoreGateway` 等持久化 port 的主键和查询都携带三元 scope。这是系统的核心安全不变量。

对话标注功能（`conversation-annotation`）已落地，建立了完整的分层模式：gateway persistence DTO + 专用 SQLite 表 + runtime application port + web route + 前端操作组件。分享功能与之高度同构，但引入一个本质差异——**跨用户只读访问**。标注是用户对自己的对话数据做标记，scope 天然一致；分享是用户授权他人查看自己的对话，必然跨 scope。

系统当前没有 session 删除能力（`SessionStoreGateway` 只有 `loadSession`/`listSessions`/`saveSession`），因此"session 删除时级联清理分享"在本 change 中只作为契约义务声明，不实现主动清理。

前端有两个入口：`local.tsx`（local 模式，有登录守卫和 sidebar）和 `immersive.tsx`（remote/PIU 模式，通过宿主框架 `HostSiteContext` 注入 user 信息含 `ops` 数组）。分享查看页面需要绕过这两个入口的 auth 守卫，作为独立路由存在。

## 目标和非目标（Goals / Non-Goals）

**目标：**
- 让用户能将会话中选定的问答对生成为可分享的只读链接，支持有效期和权限门槛配置。
- 在 owner scope 隔离原则下，提供一条受控的跨 scope 只读读取路径。
- 支持多机部署：分享链接携带原始服务地址。
- 支持 local/remote 双模式：local 无权限配置，remote 支持 ops 白名单。
- 查看分享时提供过期、权限不足、内容已删除、分享不存在四种明确的异常状态提示。
- 只读展示页面复用现有问答渲染链路，不展示标注组件，不提供写操作。

**非目标：**
- 不实现 session 删除或会话老化机制（只声明级联清理契约义务）。
- 不实现分享记录的主动过期清理（过期分享记录保留，查看时返回 `SHARE_EXPIRED`）。
- 不实现分享链接的撤回/失效操作（用户无法主动使已生成的分享失效，只能等过期或内容删除）。
- 不在后端校验 ops 的真实性（ops 的可信来源是 host 的 IAM 认证，后端假设传输层和 host 可信）。
- 不实现分享内容的附件展示（本 change 只分享文本问答对，附件不在分享范围）。

## 设计决策（Decisions）

### 1. 分享记录归属创建者 scope，查看时用冻结 scope 跨 scope 读取

分享记录按创建者三元 scope 存储，主键 `(tenant_id, subject_id, agent_id, share_id)`。这是唯一选定的实现路径：查看分享时，系统用 shareRecord 中冻结的创建者 scope + agentId 去查 messages，而非查看者的 scope。

**放弃的备选方案**：
- "复制分享内容到独立分享表"：将问答对内容快照复制到 `share_contents` 表，查看时从快照读取。优点是完全脱离原 session 生命周期，内容删除不影响查看。缺点是数据冗余、内容不同步（分享后 session 编辑不影响快照反而是优点，但实现复杂度高，且需要处理附件等关联数据）。放弃——本 change 的需求是"看当前内容"，内容删除返回 `SHARE_CONTENT_DELETED` 是可接受的。
- "查看者 scope 映射"：将被分享者加入某种"授权列表"，查看时用查看者自己的 scope 查询。优点是不跨 scope。缺点是破坏了"分享链接即可查看"的简洁语义，且无法支持公开分享（`allowedOps=null`）。放弃。

### 2. shareId 作为唯一跨 scope 凭证，密码学安全随机生成

`shareId` 使用 `crypto.randomBytes(16)` 生成，转为 URL-safe base64，约 22 字符。不可预测性是受控例外的安全基础——攻击者无法枚举 shareId 查看他人对话。`shareId` 不携带任何 scope 信息，纯随机。

### 3. runIds 冻结快照，创建时确定，不可变

`runIds` 在创建分享时由前端传入（用户勾选的问答对），后端原样存储为 JSON 数组。后续 session 中 run 的 retry/edit/supersede 不影响已冻结的快照——分享的是创建时刻的问答对。查看时只查 `runIds` 中的 run 对应的 messages，不扩散到 session 其他 run。

### 4. ops 子集校验，后端为唯一权限裁决者

权限校验语义：`allowedOps ⊆ viewerOps`。`allowedOps=null` 时不校验（公开分享）。前端不需要提前知道分享是否需要权限——remote 模式下有 ops 就带上（`X-Viewer-Ops` header），后端自己决定要不要校验。Local 模式不存在 ops，`allowedOps` 始终 null，自然放行。

**ops 可信链路的断裂点**：ops 从前端 HTTP 请求传入后端，后端无法独立验证 ops 真实性。可信链路依赖：IAM 认证 → host 应用拿到真实 user.ops → 注入 HostSiteContext → 前端发 HTTP 请求 → 后端收到。后端假设传输层（HTTPS）和 host 可信。若未来需要更强保证，可扩展 `IdentityContext` 直接从 IAM token 解析 ops，但那是后续 change 的事。

### 5. originUrl 前端传入，后端拼接完整 shareUrl

多机部署下，不同机器有不同 IP/端口。前端从 `window.location.origin` 获取当前服务地址作为 `originUrl` 传入后端，后端拼成 `{originUrl}/#/shared/{shareId}` 返回。后端不自己推断 origin——它看不到前端的实际访问地址。

### 6. 分享查看页面独立路由，绕过 auth 守卫

`/#/shared/:shareId` 路由在 auth 守卫之前被拦截。理由：公开分享（`allowedOps=null`）允许任何人凭链接查看，不应要求登录。Local 和 immersive 入口的 auth 守卫分别检查 `authChallenge` 和 `useNonLocalAuthRedirect`，分享页面必须绕过这些检查。

实现方式：在 `App` 和 `ImmersiveApp` 的路由层，先匹配 `/shared/:shareId` 分支，匹配到则直接渲染 `SharedConversationPage`，不进入 auth 守卫流程。其他路径走原有 auth → ChatWorkspace 流程。

### 7. 只读展示复用纯函数渲染链路

```
GET /api/v1/shares/:shareId/conversation
  → 返回 SessionConversationMessage[]（经 projection 的只读 DTO）
  → conversationMessagesToHistoryEnvelopes(messages) → StreamEnvelope[]
  → buildHistoricalTurnBlocks(envelopes) → TurnBlock[]
  → MessageList blocks={turnBlocks} turnActionsDisabled showAnnotations={false}
```

`buildHistoricalTurnBlocks` 是纯函数，输入 `StreamEnvelope[]`，输出 `TurnBlock[]`，不依赖 session store、stream 连接或写操作。分享页面只调用这条链路，不调用 `overlayLiveTurnBlocks`（无 live stream）。`turnActionsDisabled=true` 时 `TurnBlockComponent` 的 `showAnnotations` 为 false，annotation 图标不渲染；retry/edit 按钮通过不传 `onRetry`/`onEdit` 关闭。复制按钮保留。

### 8. ConversationShareStoreGateway port 形态

```typescript
interface ConversationShareStoreGateway {
  createShare(record: ConversationShareRecord, options: IdempotentWriteOptions): Promise<ConversationShareRecord | SafeError>;
  loadShare(request: LoadShareRequest): Promise<ConversationShareRecord | undefined | SafeError>;
  deleteSharesBySession(request: DeleteSharesBySessionRequest): Promise<void | SafeError>;  // 未来 session 删除时调用
}

interface LoadShareRequest {
  readonly shareId: string;  // 不带 scope，shareId 是全局唯一凭证
}
```

`loadShare` 不携带 owner scope——`shareId` 是全局唯一的主键，任何人都可凭 `shareId` 加载分享记录。跨 scope 访问的安全性由 `shareId` 不可预测性保证。`deleteSharesBySession` 带 scope，只在创建者 scope 下清理。

### 9. RuntimeConversationSharePort port 形态

```typescript
interface RuntimeConversationSharePort {
  createShare(command: CreateShareCommand): Promise<ShareResult>;
  loadSharedConversation(query: LoadSharedConversationQuery): Promise<SharedConversationPage | SafeError>;
}

interface CreateShareCommand {
  readonly identityContext: IdentityContext;
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
  readonly runIds: readonly RequestRunId[];
  readonly originUrl: string;
  readonly expiresIn: "24h" | "7d" | "30d" | "permanent";
  readonly allowedOps: readonly string[] | null;
  readonly idempotencyKey: IdempotencyKey;
}

interface LoadSharedConversationQuery {
  readonly shareId: string;
  readonly viewerOps: readonly string[] | null;  // remote 模式有值，local 模式为 null
}

type SharedConversationPage = {
  readonly sessionId: SessionId;
  readonly messages: readonly SessionMessage[];
  readonly createdAt: EpochMillis;
};
```

`loadSharedConversation` 实现内部：先 `loadShare` 拿到 shareRecord，校验过期/权限，然后用 shareRecord 冻结的 scope + agentId 通过 `SessionMessageStoreGateway.listMessages` 查 messages（只查 `runIds` 对应的 run）。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | shareId 密码学安全随机生成，不可枚举；跨 scope 读取锁定在 runIds 快照，只读不写；ops 子集校验由后端裁决；请求体不得覆盖 scope；日志不含对话内容。ops 可信链路依赖 host IAM 认证 + HTTPS 传输，后端不独立校验 ops 真实性——作为已知风险记录。 | gateway scope 隔离测试、web route 权限校验测试、shareId 随机性测试、日志内容审计测试 |
| 性能/容量 | 分享记录单行写入，无批量操作；查看分享一次 `loadShare` + 一次 `listMessages`（按 runIds 过滤），O(runIds 数量)；runIds 数量无硬性上限，但前端勾选模式天然限制在单 session 的问答对数。`conversation_shares` 表按 `(tenant_id, subject_id, agent_id, share_id)` 主键索引，`loadShare` 按 `share_id` 全局查找需额外索引。 | gateway 查询性能测试、web route 集成测试 |
| 可靠性/恢复 | 分享创建使用 `IdempotentWriteOptions` 支持幂等重试；查看分享是纯读操作，无 side effect；存储不可用返回 `SHARE_STORAGE_UNAVAILABLE`；过期/权限/内容删除返回明确 SafeError，不静默失败。 | gateway 幂等测试、web route 异常路径测试 |
| 可维护性 | 分层与 annotation 同构：gateway → runtime port → web route → 前端；`ConversationShareRecord` 只在 gateway boundary 出现；Web response 只暴露 DTO projection；跨 scope 例外只存在于 loadSharedConversation，不传染其他主路径。 | 架构边界测试（agent-channel-web 不直接访问 gateway、agent-runtime 不导入分享 port） |
| 可测试性 | gateway port 可注入 in-memory 实现；runtime port 可注入 mock gateway；web route 可注入 mock runtime port；前端纯函数链路可独立测试。 | unit test、contract test、web route integration test、前端 component test |
| 审计/可追溯性 | 分享创建产生 structured log，只含 `shareId`、`sessionId`、`runIds`（不含内容）、`allowedOps` 长度、`expiresAt`、scope 标识；日志不含 message text、prompt 或模型输出。 | 日志内容审计测试 |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| 分享记录三元 scope 隔离 | T-gateway-unit | gateway-local unit test: 跨 scope 查询不可见 |
| shareId 不可预测，后端生成 | T-gateway-unit | gateway-local unit test: shareId 随机性、长度 |
| runIds 冻结快照不可变 | T-gateway-unit | gateway-local unit test: 冻结快照完整性 |
| 请求体不得覆盖 scope | T-web-integration | web route integration test: 携带 tenantId 的请求体被忽略 |
| 跨 scope 读取用冻结创建者 scope | T-session-port | agent-session port test: loadSharedConversation 用创建者 scope 查 messages |
| 读取范围锁定 runIds 快照 | T-session-port | agent-session port test: 只返回 runIds 中的 run 的 messages |
| ops 子集校验 | T-web-integration | web route integration test: allowedOps ⊆ viewerOps 正反向 |
| allowedOps=null 不校验权限 | T-web-integration | web route integration test: 公开分享无 ops 通过 |
| 过期返回 SHARE_EXPIRED | T-web-integration | web route integration test: 过期分享返回 410 |
| 内容删除返回 SHARE_CONTENT_DELETED | T-web-integration | web route integration test: 删除 run 后返回 404 |
| Web channel 不直接访问 gateway | T-arch-boundary | 架构测试: agent-channel-web 不导入 ConversationShareStoreGateway |
| 分享不影响 request lifecycle | T-session-port | agent-session port test: 创建分享不改变 terminal commit |
| 只读展示无标注组件 | T-frontend | 前端 test: 分享页面 TurnBlock 无 annotation 图标 |
| 只读展示无写操作 | T-frontend | 前端 test: 分享页面无 retry/edit/cancel 按钮 |
| local 模式无权限选项 | T-frontend | 前端 test: local 模式分享弹窗不展示 ops 勾选框 |
| 分享路由绕过 auth 守卫 | T-frontend | 前端 test: /#/shared/:shareId 不触发 authChallenge |
| 未注入 shares 依赖返回 503 | T-web-integration | web route integration test: 503 + SHARES_UNAVAILABLE |

## 文档承载决策（Documentation Ownership）

- **行为契约**：`openspec/specs/conversation-share/spec.md` 主承载分享 gateway/runtime/web/前端行为契约、owner scope 受控例外、ops 权限校验、有效期校验、异常防护、只读展示约束。
- **架构和跨模块设计**：`openspec/designs/architecture/owner-scope-isolation.md` 主承载"查看分享"作为 owner scope 隔离受控例外的设计；`openspec/designs/architecture/core-contracts.md` 补充 `ConversationShareStoreGateway` port。
- **模块设计**：`openspec/designs/modules/agent-platform-gateway-local.md` 主承载 `conversation_shares` 表和 gateway 实现职责；`openspec/designs/modules/agent-session.md` 主承载 `RuntimeConversationSharePort` 实现职责；`openspec/designs/modules/agent-channel-web.md` 主承载分享路由 projection 职责；`openspec/designs/modules/agent-contracts.md` 主承载分享 contract 归属。
- **ADR**：`openspec/designs/adr/` 新增 ADR 记录"owner scope 受控例外用于分享查看"的长期技术决策和取舍理由。
- **导航**：`openspec/designs/spec-to-design-map.md` 新增 `conversation-share` spec 到 design 导航。

## 风险与取舍（Risks / Trade-offs）

- [ops 可信链路断裂] → 后端无法独立验证 ops 真实性，依赖 host IAM 认证 + HTTPS 传输。缓解：design.md 明确记录此假设；未来可通过扩展 IdentityContext 从 IAM token 解析 ops 增强保证。
- [shareId 泄露即授权] → shareId 是唯一凭证，泄露后任何人可查看公开分享。缓解：shareId 不可预测；支持有效期限制；用户可在 session 中删除对应问答对使分享返回 `SHARE_CONTENT_DELETED`。不实现主动撤回——作为已知限制记录。
- [过期分享记录不主动清理] → 过期分享记录永久占用存储。缓解：记录量小（单行 JSON），未来 session 删除/老化机制引入时级联清理。
- [跨 scope 读取扩大攻击面] → loadShare 不带 scope，理论上任何 shareId 可加载。缓解：shareId 密码学安全随机；读取范围锁定 runIds；只读不写；权限校验在跨 scope 读取之后执行。
- [内容删除与查看的竞态] → 查看分享时 session/run 刚好被删除。缓解：`SHARE_CONTENT_DELETED` 校验在权限校验之后、返回内容之前执行；若校验通过但查询 messages 时已删除，gateway 返回空结果，runtime 转为 `SHARE_CONTENT_DELETED`。

## 迁移计划（Migration Plan）

无迁移风险。`conversation_shares` 是全新表，`ConversationShareStoreGateway` 是全新 port，`WebChannelDependencies.shares` 是可选依赖。部署后旧功能不受影响，分享功能渐进可用。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/conversation-share/spec.md`：新增，承载全部行为契约。
- `openspec/overview.md`：补充对话分享能力背景。
- `openspec/designs/architecture/owner-scope-isolation.md`：新增"查看分享"受控例外段落。
- `openspec/designs/architecture/core-contracts.md`：补充 `ConversationShareStoreGateway` port。
- `openspec/designs/modules/agent-platform-gateway-local.md`：补充 `conversation_shares` 表和 gateway 实现。
- `openspec/designs/modules/agent-session.md`：补充 `RuntimeConversationSharePort` 实现。
- `openspec/designs/modules/agent-channel-web.md`：补充分享路由 projection。
- `openspec/designs/modules/agent-contracts.md`：补充分享 contract 归属。
- `openspec/designs/adr/`：新增 ADR 记录 owner scope 受控例外决策。
- `openspec/designs/spec-to-design-map.md`：新增 `conversation-share` 导航。

## 待确认问题（Open Questions）

无。所有关键设计决策在 explore 阶段已与用户对齐：
1. 分享粒度为 run（问答对），与收藏逻辑一致。
2. 权限模型为 ops 白名单子集校验，local 模式无权限选项。
3. originUrl 前端传入后端拼接，支持多机部署。
4. 分享记录与 session 同生命周期，本 change 不实现 session 删除，只声明契约义务。
5. 只读展示保留复制按钮，不展示标注组件。
