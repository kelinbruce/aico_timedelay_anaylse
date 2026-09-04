## ADR: Owner scope 受控例外用于分享查看

## 状态

Accepted

## 日期

2026-06-28

## 背景

NextAgent 的对话数据按三元 owner scope `(tenantId, subjectId, agentId)` 严格隔离。所有主路径数据访问必须同时校验 Agent Scope 和 Owner Scope。这是系统的核心安全不变量。

对话分享功能需要让用户将选定的问答对生成为可分享的只读链接，供同事或合作伙伴查看。这必然涉及跨用户（跨 owner scope）只读访问——被分享者的 scope 与创建者的 scope 不同。

系统当前没有 session 删除能力，因此"session 删除时级联清理分享"只作为契约义务声明。

## 决策

查看分享路径是 owner scope 隔离原则的受控例外。系统用 `ConversationShareRecord` 中冻结的创建者三元 scope 和 `agentId` 去查询 messages，而非查看者的 scope。

触发此跨 scope 读取的唯一凭证是不可猜测的 `shareId`（密码学安全随机生成，`crypto.randomBytes(16).toString("base64url")`）。读取范围严格锁定在 `runIds` 快照中的 run，只读不写。

此受控例外的安全保证基于三点：

1. `shareId` 的不可预测性——攻击者无法枚举 shareId 查看他人对话。
2. 读取范围的严格锁定——只读 `runIds` 快照，不扩散到 session 其他 run。
3. 只读语义——不产生任何写操作，不影响 request terminal commit、canonical timeline 或 active context。

`loadShare` 不携带 owner scope——`shareId` 是全局唯一主键，任何人都可凭 `shareId` 加载分享记录。`deleteSharesBySession` 带 scope，只在创建者 scope 下清理。

权限模型：`allowedOps=null` 表示公开分享，任何人凭链接可查看；`allowedOps` 非 null 时校验 `allowedOps ⊆ viewerOps`（子集校验）。Local 模式不存在 ops，`allowedOps` 始终为 null。

## 取舍

- [ops 可信链路断裂] 后端无法独立验证 ops 真实性，依赖 host IAM 认证 + HTTPS 传输。未来可通过扩展 IdentityContext 从 IAM token 解析 ops 增强保证。
- [shareId 泄露即授权] shareId 是唯一凭证，泄露后任何人可查看公开分享。缓解：shareId 不可预测；支持有效期限制；用户可删除对应问答对使分享返回 `SHARE_CONTENT_DELETED`。不实现主动撤回。
- [跨 scope 读取扩大攻击面] loadShare 不带 scope，理论上任何 shareId 可加载。缓解：shareId 密码学安全随机；读取范围锁定 runIds；只读不写；权限校验在跨 scope 读取之后执行。
- [过期分享记录不主动清理] 过期分享记录永久占用存储。缓解：记录量小（单行 JSON），未来 session 删除/老化机制引入时级联清理。

## 后果

此例外只存在于"查看分享"只读路径，不传染其他主路径的数据访问逻辑。其他所有主路径持久化数据访问必须同时校验 Agent Scope 和 Owner Scope。未来如需新增跨 scope 读取能力，必须先在 OpenSpec design 中明确说明凭证、读取范围和安全保证，并获得 ADR 批准。
