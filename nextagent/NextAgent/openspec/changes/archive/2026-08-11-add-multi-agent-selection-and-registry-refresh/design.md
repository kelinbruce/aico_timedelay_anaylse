## 设计范围

| Function | 目标变化 | delta specs | 设计章节 |
|---|---|---|---|
| FN-3.5 Agent 选择策略 | 新增入口层 agent 选择策略，Web channel 和 task channel 统一调用 | `specs/agent-selection-policy/spec.md` | FN-3.5 设计 |
| FN-3.2 编译智能体装配 | registry 支持运行时动态刷新 + active 支持任意已注册 agent | `specs/agent-package-assembly/spec.md` | FN-3.2 设计 |
| legacy spec web-channel-api-contract | 所有携带 agentId 的端点接受 header `x-agent-id` | `specs/web-channel-api-contract/spec.md` | Web channel 设计 |

## FN-3.5 设计

### 目标与规范依据

proposal 和 spec 定义了入口层 agent 选择策略的黑盒目标：在 `createSession` 调用链中同步执行，接收 channel boundary 提取的 hosted-agent selection 原始值，经格式校验和可信 assemblyRegistry 校验后产出 agentId，绑定到 session。Web channel 和 task channel 统一调用。

本 Function 的目标 Requirements：
- canonical spec：`specs/agent-selection-policy/spec.md`
- ADDED `Agent 选择策略在 session 创建前决定请求路由到哪个 agent`
- ADDED `Agent Selection Policy 校验选择的 agentId 可用后才绑定到 session`
- ADDED `Agent Selection Policy 接口可扩展支持集成服务定制`

### 当前实现

当前不存在 Agent Selection Policy。agentId 的来源是唯一的 `defaultRouteAgentId`（来自 `hostedAgent.activeAgentId` 配置），在 runtime 的 `createSession` 中通过 `resolveAgentId()` 硬编码返回（`submit.ts:5384`）。Web channel 和 task channel 的 createSession 不解析 header 中的 agentId。

### GAP 分析

| 规范目标 | 当前事实 | 待闭合差距 |
|---|---|---|
| AgentSelectionPolicy 在 createSession 链中同步执行 | `resolveAgentId()` 硬编码返回 `defaultRouteAgentId` | 需新增接口和默认实现，在 runtime createSession 中调用 |
| 接收 channel 提取的原始值做格式校验 | 无格式校验（agentId 来自配置） | 需在 policy 内做 safeId 格式校验 |
| Web channel 和 task channel 统一调用 | 两个 channel 各自硬用 defaultAgentId | 需两个 channel 的 createSession 都传原始值给 runtime |
| 选择的 agentId 经 assemblyRegistry 校验后绑定 | createSession 不校验 assembly | 需在 createSession 中加 assembly 校验 |

### 修改方案

**新增 `AgentSelectionPolicy` 接口**（`agent-contracts/agent-assembly`）：

```ts
export interface AgentSelectionRequest {
  readonly headerAgentId?: string;
  readonly defaultRouteAgentId: AgentId;
}

export interface AgentSelectionResult {
  readonly agentId: AgentId;
  readonly safeReason: string;
}

export interface AgentSelectionPolicy {
  resolve(request: AgentSelectionRequest, signal: AbortSignal): Promise<AgentSelectionResult>;
}
```

`AbortSignal` 保留在接口签名中供未来异步自定义实现使用；默认实现是同步的，不实际使用 signal。

**默认实现 `DefaultAgentSelectionPolicy`**（`agent-app/src/composition/agent-selection-policy.ts`）：
1. `headerAgentId` 存在且满足 safeId 正则 -> brand 为 AgentId，返回 `{ agentId, safeReason: 'HEADER_AGENT_ID_SELECTED' }`
2. `headerAgentId` 缺失或为空 -> 返回 `{ agentId: defaultRouteAgentId, safeReason: 'DEFAULT_ACTIVE_AGENT' }`
3. `headerAgentId` 存在但不满足 safeId -> 抛 safe validation error，不 fallback

**RuntimeCreateSessionCommand 加 agentId**（`agent-contracts/runtime`）：新增可选 `agentId?: string` 字段（原始值，未经格式校验）。

**runtime createSession 改造**（`agent-runtime/lifecycle/submit.ts`）：
1. `createSession` 接收 `command.agentId`（原始值）
2. 调用 `AgentSelectionPolicy.resolve({ headerAgentId: command.agentId, defaultRouteAgentId })`
3. 产出 agentId 后调用 `assemblyRegistry.active(agentId)` 校验存在且 `userInvocable=true`
4. 校验通过后绑定到 session；失败返回 missing-assembly safe failure

**Web channel createSession**（`agent-channel-web/routes/requests.ts`）：从 header `x-agent-id` 提取原始字符串值，传给 `RuntimeCreateSessionCommand.agentId`。不在 channel 层做格式校验或 brand。

**Task channel createSession**（`agent-channel-task/routes/routes.ts`）：从 header `x-agent-id` 提取原始字符串值，传给 `RuntimeCreateSessionCommand.agentId`。不在 channel 层做格式校验或 brand。

**非 session 内端点（仅 Web channel）**：用 `resolveAgentIdFromHeader(request, defaultAgentId)` 在 channel 层完成格式校验、brand 和 fallback，直接传解析后的 agentId 给 runtime port。不走 AgentSelectionPolicy。

**调用关系**：
- createSession 路径：channel 提取原始值 -> `RuntimeCreateSessionCommand.agentId` -> runtime 调用 `AgentSelectionPolicy.resolve`（格式校验 + 决策） -> `assemblyRegistry.active` 校验 -> 绑定 session
- 非 session 端点路径：channel 用 `resolveAgentIdFromHeader` 完整解析 -> 直接传 branded agentId 给 runtime port

**owner**：`agent-contracts` 定义接口；`agent-app` composition 实例化和注入；`agent-runtime` 调用 policy 和校验 assembly；`agent-channel-web` 和 `agent-channel-task` 提取 header 原始值。

**不修改的边界**：agent-internal routing policy 不变；`activeAgentId` 配置语义不变；session 绑定后 agentId 不可变更；submit 路径已有 agentId 处理不变。

**质量属性影响**：无新增黑盒质量目标。安全信任链由功能性 Requirement 定义。

## FN-3.2 设计

### 目标与规范依据

proposal 和 spec 定义了 registry 动态刷新的黑盒目标：运行时检测 `agentsRoot` 变化并重建 assembly 集合，刷新后 discovery 链路自动看到新 agent。

本 Function 的目标 Requirements：
- canonical spec：`specs/agent-package-assembly/spec.md`
- ADDED `AgentAssemblyRegistry 支持运行时动态刷新发现新增 agent`
- MODIFIED `AgentAssemblyRegistry Lookup Semantics Stay Frozen`

### 当前实现

`createCompiledAgentAssemblyRegistry`（`agent-assembly-registry.ts`）在启动时由 `createAgentDiscoveryAssemblies` 扫描 `agentsRoot` 构建固定数组 `allAssemblies`，之后无刷新机制。`createHotReloadingActiveAssemblyRegistry` 只监视 active agent 的 agent.yaml mtime，不覆盖 `agentsRoot` 新增目录。discovery 链路委托给静态 baseRegistry。

### GAP 分析

| 规范目标 | 当前事实 | 待闭合差距 |
|---|---|---|
| 运行时检测 agentsRoot 变化并重建 | baseRegistry 启动时固定数组 | 需可变引用 + fingerprint 扩展 + 重建 |
| 重建后 discovery 链路看到新 agent | list 方法委托给静态 baseRegistry | 需 list 方法改为闭包委托可变引用 |
| 重建失败保留上一次有效集合 | 无重建失败处理 | 需 try-catch 保留旧集合 |
| active 支持任意已注册 agent | active 只对 activeAgentId 做热重载 | 需 active 的 fallback 路径支持任意 agent |
| 并发请求不阻塞等待重建 | 无并发处理 | 并发时用上一次有效集合响应 |

### 修改方案

**baseRegistry 可变引用**（`assembly-composition.ts`）：`let baseRegistry = input.baseRegistry`，list 方法改为闭包 `(signal) => baseRegistry.listXxx(signal)`。

**fingerprint 扩展**：`readActiveAgentDefinitionFingerprint` 扩展为扫描 `agentsRoot` 下所有顶层 agent 目录的 agent.yaml（`agents/{agentId}/agent.yaml`），组合成 fingerprint。新增目录、删除目录、修改任何顶层 agent.yaml 都改变 fingerprint。fingerprint 不覆盖 `agents/{parentAgentId}/subagents/` 目录；pub 新增 subagent 需修改 parent agent.yaml 或重启进程触发重建。

**重建逻辑**：fingerprint 变化时同步调用 `createAgentDiscoveryAssemblies` + `createCompiledAgentAssemblyRegistry` 重建 baseRegistry。重建失败时 try-catch 保留上一次有效 baseRegistry，记录 structured log。

**fingerprint 检查触发点**：active、require 和 list 方法调用时同步检查 fingerprint。fingerprint 未变化时直接返回当前集合，无额外开销。fingerprint 变化时同步执行重建，当前请求等待重建完成后返回新集合。

**并发语义**：重建是同步的（在当前请求的 fingerprint 检查中完成）。JS 单线程，重建不会被其他请求中断。第一版不引入 async 重建或 `refreshPromise` 去重；如果未来改为 async 重建，需加 `refreshPromise` 去重并在重建期间用旧集合响应。

**workspaceFileExtensionPolicies 动态化**（`capability-composition.ts`）：从静态 Map 改为从 `assemblyRegistry.require()` 动态获取 assembly 后编译 policy。

**owner**：`agent-app/composition/assembly-composition` 负责 baseRegistry 可变引用和重建；`agent-app/composition/capability-composition` 负责 workspaceFileExtensionPolicies 动态化。

**不修改的边界**：`agent-capability` 的 catalog、discovery、subsystem 不改；`create-app.ts` composition 编排不变；已 accepted request 的 frozen assembly 不受重建影响。

**质量属性影响**：可靠性/恢复（重建失败保留旧集合）；性能/容量（fingerprint 检查同步扫描目录，agentsRoot 下 agent 数量多时有开销，第一版不加 debounce）。

## Web channel 设计

### 目标与规范依据

proposal 和 spec 定义了所有携带 `agentId` 参数的 Web channel 端点接受 header `x-agent-id` 的黑盒目标。

本 Function 的目标 Requirements：
- spec：`specs/web-channel-api-contract/spec.md`（legacy spec，无已确认 Function 映射）
- MODIFIED `Web channel public API MUST have complete request specifications`

### 当前实现

Web channel 的所有非 session 内端点（cron-tasks、category-questions、frequent-questions、question-associations、annotations/favorite-turns、memory、listSessions）硬用 `dependencies.defaultAgentId`。底层 contract 已有 `agentId` 字段，runtime/gateway 已按 agentId 隔离，但入口没接入。

`createSessionBody` schema 只接受 `locale`。createSession 和 convenience submit 不解析 header。

### GAP 分析

| 规范目标 | 当前事实 | 待闭合差距 |
|---|---|---|
| 所有携带 agentId 的端点接受 header | 全部硬用 `defaultAgentId` | 需统一 header 解析 helper |
| createSession 提取原始值传给 runtime | 不解析 header | 需提取原始值传给 RuntimeCreateSessionCommand.agentId |
| 非 session 端点在 channel 层完整解析 | 硬用 `defaultAgentId` | 需 helper 做格式校验 + brand + fallback |
| session 内端点用 session.agentId | 已实现 | 无差距 |
| listSessions 按 header 指定 agentId 过滤 | `resolveAgentId()` 限制单一 agent | 需改为 header 指定时按 agentId 过滤，未指定时保持当前行为 |

### 修改方案

**createSession 和 convenience submit**（`requests.ts`）：从 header `x-agent-id` 提取原始字符串值，传给 `RuntimeCreateSessionCommand.agentId`。不在 channel 层做格式校验或 brand。

**非 session 内端点统一 header 解析 helper**（`requests.ts`）：

```ts
function resolveAgentIdFromHeader(request: FastifyRequest, defaultAgentId: AgentId): AgentId {
  const value = singleHeader(request.headers['x-agent-id']);
  if (value === undefined || value.length === 0) return defaultAgentId;
  if (!safeId.test(value)) throw safeValidationError;
  return brand(value);
}
```

所有非 session 内端点的 `dependencies.defaultAgentId` 替换为 `resolveAgentIdFromHeader(request, dependencies.defaultAgentId)`。涉及 `requests.ts` 约 12 处和 `memory.ts` 约 2 处，改动模式完全一致。

**listSessions 处理**（`submit.ts`）：header 指定 agentId 时按该 agentId 过滤；未指定时保持当前行为（用 `defaultRouteAgentId` 过滤）。不扩展为跨 agent 查询。

**不修改的边界**：`createSessionBody` schema 不变；session 内端点不变；`WebChannelDependencies.defaultAgentId` 保留。

**质量属性影响**：无新增黑盒质量目标。

## 跨 Function 协作与端到端流程

```
createSession 路径（Web channel 和 task channel 统一）：
  1. Channel 从 header x-agent-id 提取原始字符串值
  2. 传给 RuntimeCreateSessionCommand.agentId（原始值，未校验）
  3. Runtime createSession 调用 AgentSelectionPolicy.resolve(headerValue, defaultRouteAgentId)
     -> 格式校验（safeId） + 产出 agentId + safeReason
  4. assemblyRegistry.active(agentId) 校验
     -> 如果是启动后 pub 的新 agent，registry 先同步刷新（FN-3.2）
  5. 校验通过 -> session 绑定 agentId 并持久化
  6. 后续请求 -> requireSession -> session.agentId -> 自动隔离

非 session 内端点路径（仅 Web channel）：
  1. resolveAgentIdFromHeader(request, defaultAgentId)
     -> 格式校验 + brand + fallback（在 channel 层完成）
  2. 传解析后的 agentId 给 runtime port（底层已按 agentId 隔离）

session 内端点路径：
  1. requireSession -> session.agentId -> 自动隔离（已有机制，不改）
```

## 验证策略

| 验证层级 | 覆盖内容 |
|---|---|
| contract test | RuntimeCreateSessionCommand agentId 字段；header x-agent-id 解析；非 session 内端点 header 传递；createSession 不在 channel 层做格式校验 |
| unit test | DefaultAgentSelectionPolicy 格式校验 + fallback + fail closed；registry 动态刷新；重建失败保留旧集合；并发不阻塞 |
| integration test | header 指定 agentId 创建 session + submit + 数据隔离（Web channel 和 task channel）；非 session 内端点 header 指定 agentId 隔离；多 agent 并存 |
| architecture test | AgentSelectionPolicy 接口在 agent-contracts 定义；createSession 路径不绕过 AgentSelectionPolicy |

negative case：header 无效 fail closed（policy 内）；agent 不存在 missing-assembly；session 绑定后 header 覆盖无效；重建失败不影响已有 agent。

## 长期基线刷新计划

| 类别 | 目标 |
|---|---|
| stable spec | `specs/agent-package-assembly/spec.md`、`specs/web-channel-api-contract/spec.md`、新增 `specs/agent-selection-policy/spec.md` |
| Function | 新增 FN-3.5 Function 文档；修改 FN-3.2 Function 文档；`web-channel-api-contract` legacy spec 补充 Function 映射 |
| Feature | 修改 F-3.1 Feature 文档 |
| overview | 无 |
| architecture | 无 |
| modules | 修改 agent-app module 文档 |
| ADR | 无 |
| spec-to-design-map | 新增 agent-selection-policy 映射 |

## 风险与取舍

- **性能**：fingerprint 检查每次 active/require/list 调用时同步扫描目录。agentsRoot 下 agent 数量多时有开销。第一版不加 debounce，记录为 known limitation。
- **并发重建**：当前依赖 JS 单线程模型，重建是同步的，不会被中断。如果未来改为 async 重建，需加 `refreshPromise` 去重。
- **recipeDefinitionSource**：重建 baseRegistry 后不更新。pub 的 agent 带新 recipe 时需额外处理。第一版不处理，记录为 known limitation。
- **subagent fingerprint**：fingerprint 只覆盖 `agentsRoot` 下顶层 agent 目录，不覆盖 `agents/{parentAgentId}/subagents/`。pub 新增 subagent 需修改 parent agent.yaml 或重启进程触发重建。第一版不处理，记录为 known limitation。
- **skill-catalog-query-port**：仍用 `defaultAgentId`，不在此 change 修复。由 `web-skill-catalog` spec 已记录限制，后续单独修复。
