---
sources:
  - packages/agent-common/src/
  - packages/agent-contracts/src/
last-verified: 2026-09-01
---

# 词汇与类型系统参考

NextAgent 的类型系统围绕 branded ID、严格枚举和 DO/DTO/PO/Record 分层构建。创建新类型时必须遵守以下规范。

## Branded ID 类型

所有实体 ID 使用 branded type（`string & { readonly __brand: 'TypeName' }` 模式），防止混用。定义在 `agent-common`，提供 `createXxxId()` factory 和 `isXxxId()` type guard。具体 brand 标记从代码推导，不在此重复。

| ID 类型 | 标识对象 |
|---|---|
| `TenantId` | 租户 |
| `SubjectId` | 用户/主体 |
| `SessionId` | 会话 |
| `MessageId` | 消息 |
| `RequestRunId` | 请求运行 |
| `CapabilityId` | 能力 |
| `CapabilityInvocationId` | 能力调用 |
| `ToolCallId` | 工具调用 |
| `ArtifactId` | 制品 |
| `AttachmentId` | 附件 |
| `AttachmentIntakeReservationId` | 附件预约 |
| `BlobRef` | 二进制引用 |
| `CheckpointId` | 检查点 |
| `LongTermMemoryId` | 长期记忆 |
| `TaskTrajectoryId` | 任务轨迹 |
| `PendingInputId` | 待处理输入 |
| `AgentId` | Agent |
| `AgentType` | Agent 类型 |
| `AgentVersion` | Agent 版本 |
| `RequestContextId` | 请求上下文 |
| `IdempotencyKey` | 幂等键 |
| `TaskEventId` | 任务事件 |
| `EpochMillis` | 时间戳 |
| `TimelineSequence` | 时间线序号 |
| `RequestLocale` | 请求语言 |
| `SecretReference` | 密钥引用 |

### 创建新 Branded ID 规则

1. 只有跨包共享的实体 ID 才定义为 branded type
2. 只在 `agent-common` 中定义
3. 使用 `& { readonly __brand: 'TypeName' }` 模式
4. 提供 `createXxxId()` factory 和 `isXxxId()` type guard
5. 不得为包内部使用的临时 ID 创建 branded type

## 关键枚举

### RunStatus

```typescript
// 定义在 agent-common
type RunStatus =
  | 'ACCEPTED'
  | 'QUEUED'
  | 'PLANNING'
  | 'EXECUTING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELED'
  | 'SUPERSEDED'
```

### TimelineEventType（33 种）

核心事件类型（不完全列表）：
- `REQUEST_ACCEPTED` - 请求被接受
- `MODEL_INVOCATION_STARTED` - 模型调用开始
- `LLM_THINKING_DELTA` - 思考增量（只用于 live）
- `CONTENT_DELTA` - 内容增量
- `TOOL_CALL_DELTA` - 工具调用增量
- `TOOL_STRUCTURED_DELTA` - 结构化工具增量（过渡 Event snapshot）
- `CAPABILITY_RESULT` - 能力结果（权威，由 Message 拥有）
- `PENDING_INPUT_CREATED` - 待处理输入创建
- `PENDING_INPUT_RESOLVED` - 待处理输入解决
- `REQUEST_COMPLETED` / `REQUEST_FAILED` / `REQUEST_CANCELED` - 请求终态
- `POLICY_APPLIED` - 策略已应用
- `FORK_SNAPSHOT` - 派生快照（child-only）

### CapabilityKind

```typescript
type CapabilityKind = 'TOOL' | 'SKILL' | 'AGENT' | 'WORKFLOW'
```

### CapabilityProviderKind

```typescript
type CapabilityProviderKind =
  | 'BUNDLED'        // 内置能力
  | 'LOCAL_DIRECTORY' // 本地目录 Skill
  | 'SKILL_HUB'      // SkillHub 远程获取
  | 'MCP_SERVER'     // MCP 协议服务
  | 'AGENT_REGISTRY' // Agent 注册中心
  | 'CUSTOM'         // 自定义插件
```

### PendingInputKind

```typescript
type PendingInputKind =
  | 'QUESTION'       // 澄清问题
  | 'CONFIRMATION'   // 确认
  | 'AUTHORIZATION'  // 授权
  | 'HUMAN_HANDOFF'  // 人工接管
```

### RiskPolicyOutcome

```typescript
type RiskPolicyOutcome =
  | 'ALLOW'
  | 'DENY'
  | 'REQUIRE_AUTHORIZATION'
  | 'DEGRADED'
  | 'POLICY_FAILED'
```

### MemoryCategory

```typescript
type MemoryCategory =
  | 'FACTUAL'             // 事实性
  | 'CONCEPTUAL'          // 概念性
  | 'PROCEDURAL'          // 过程性
  | 'USER_CHARACTERISTICS' // 用户特征
```

### TerminalCommitState

```typescript
type TerminalCommitState =
  | 'NOT_STARTED'
  | 'PENDING'
  | 'RETRYING'
  | 'COMMITTED'
  | 'FAILED'
```

### LifecycleStage（9 个阶段）

```typescript
type LifecycleStage =
  | 'BEFORE_REQUEST_ACCEPT'
  | 'AFTER_REQUEST_ACCEPT'
  | 'BEFORE_PLANNING'
  | 'AFTER_PLANNING'
  | 'BEFORE_MODEL_INVOCATION'
  | 'AFTER_MODEL_RESULT'
  | 'BEFORE_CAPABILITY_INVOKE'
  | 'AFTER_CAPABILITY_RESULT'
  | 'BEFORE_AGENT_TERMINAL'
```

### GatewayAdapterKind（17 种）

在 `agent-contracts/gateway` 中定义，涵盖所有持久化适配器类型。

## 命名规范

| 场景 | 模式 | 举例 |
|---|---|---|
| Branded ID | `{Entity}Id` | `SessionId`, `RequestRunId` |
| Record (持久化 DTO) | `{Entity}Record` | `SessionRecord`, `MessageRecord` |
| DB Row (gateway-local) | `{Entity}Row` | `SessionRow`, `MessageRow` |
| Web DTO | `{Entity}DTO` 或语义名 | `StreamEnvelope`, `SessionMessageDTO` |
| Port interface | `{Verb}{Noun}Port` | `RuntimeCommandPort`, `UserSessionPort` |
| Gateway port | `{Entity}StoreGateway` | `SessionStoreGateway`, `AuditEventStoreGateway` |
| Schema (TypeBox) | `{Entity}Schema` | `SubmitRequestSchema`, `SessionRecordSchema` |
| 事件类型 | `{VERB}_{NOUN}` | `REQUEST_ACCEPTED`, `CAPABILITY_RESULT` |
| 枚举值 | UPPER_SNAKE_CASE | `RUNNING`, `COMPLETED` |
| Branded ID factory | `create{Entity}Id` | `createSessionId()`, `createRequestRunId()` |
| Branded ID guard | `is{Entity}Id` | `isSessionId()`, `isRequestRunId()` |

## 新增枚举/ID 的检查清单

1. 是否跨包共享？→ 是：放 `agent-common`；否：放对应包内部
2. 是否是实体 ID？→ 是：branded type + factory + guard
3. 是否需要持久化？→ 是：在 `agent-contracts/gateway` 定义 Record
4. 是否需要 Web 暴露？→ 是：在 `agent-channel-web` 定义 DTO
5. 是否影响已有 enum？→ 检查是否需要更新 `agent-contracts` 对应 subpath
6. 是否让 gateway 依赖了其他业务 subpath？→ 禁止，共享 vocabulary 归 `agent-common`
