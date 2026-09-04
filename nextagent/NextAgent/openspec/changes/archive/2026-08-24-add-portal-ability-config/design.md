## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-5.2 调用能力` | Agent package 增加 portal 能力配置的受信解析和 LOCAL/REMOTE provider 生命周期 | `agent-owned-resource-dynamic-loading` | `FN-5.2 调用能力` |
| `FN-8.5 上传和管理附件` | Runtime bootstrap 在附件配置之外投影 portal 能力开关 | `ts-runtime-bootstrap-config` | `FN-8.5 上传和管理附件` |
| `FN-1.20 查看推荐问题` | 推荐问题在前端、terminal 预计算和 REST 生成路径统一受开关控制 | `question-recommendation` | `FN-1.20 查看推荐问题` |
| `FN-5.6 向用户提问` | Canonical `AskUserQuestion` 的默认等待时间来自受信配置且只影响新 pending input | `ask-user-question-tool` | `FN-5.6 向用户提问` |
| `FN-6.5 请求用户确认或授权` | Pending input timeout policy 增加唯一 canonical `AskUserQuestion` 受控例外 | `human-pending-input-core` | `FN-6.5 请求用户确认或授权` |

## `FN-5.2 调用能力`

### 目标与规范依据

Agent package 需要像文件上传配置一样拥有 portal 能力配置，并在 LOCAL/REMOTE 两种部署下提供确定的有效值和降级行为。设计不引入通用 key-value 配置框架，只解析两个受控字段。

#### 本 Function 的目标 Requirements

canonical spec：`agent-owned-resource-dynamic-loading`

- `ADDED`：`Portal ability configuration fields and defaults`
- `ADDED`：`PortalAbilityConfigProvider follows deployment-mode loading policy`

### 当前实现

- `agent-attachment-runtime` 已提供 `ChatUploadConfigProvider`，从 active Agent package 的 `config/config.json` 读取 `chat-upload-file-config`。
- LOCAL 实现启动后缓存；REMOTE 实现按 `statSync` 的 `size + mtimeMs` fingerprint 热更新。
- 当前 `config/config.json` 没有 `portal-ability-config` 解析，也没有供 bootstrap、推荐问题和 runtime 共用的 portal ability provider。
- `agent-app` 已有 active Agent package root locator 和 composition 注入边界。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 解析两个 portal ability 字段并安全回退默认值 | 只解析上传配置 | 需要新增独立 parser 和 effective config |
| LOCAL/REMOTE provider 生命周期 | 只有上传配置 provider | 需要为 portal ability 增加同形 provider |
| 配置只来自 trusted Agent package | 上传配置已有该边界，portal 配置缺失 | 需要复用 active Agent package root locator 并禁止请求侧输入 |

### 修改方案

在 `agent-app/src/config/portal-ability-config.ts` 新增 composition-owned provider：

```ts
interface PortalAbilityConfig {
  readonly suggestedQuestionsEnabled: boolean;
  readonly askUserQuestionTimeoutMs: number;
}

interface PortalAbilityConfigProvider {
  get(): Promise<PortalAbilityConfig>;
}
```

内部实现：

- 使用现有 active Agent package root locator 定位 `config/config.json`。
- 解析顶层 `portal-ability-config` object；未知字段不参与 effective config。
- `suggested-questions-enabled` 仅接受 boolean，非法或缺失回退 `true`。
- `ask-user-question-time-minutes` 仅接受 `1..1440` 的 integer，非法或缺失回退 `30`，内部转换为毫秒。
- LOCAL provider 首次 `get()` 后缓存 effective object，后续返回同一结果，不做 fingerprint 检测。
- REMOTE provider 每次 `get()` 计算 `${path}:${size}:${mtimeMs}` fingerprint；文件存在且 fingerprint 未变化时返回缓存，变化时重新读取。文件缺失、JSON 解析失败或配置非法时清空缓存并返回默认值。
- provider 不抛出业务异常；读取或解析错误只进入安全默认值路径。
- `agent-app` 创建单个 provider 实例并注入 channel、推荐问题 gate 和 runtime，避免多个消费者各自读文件造成状态不一致。

不修改 `agent-attachment-runtime` 的上传配置 parser；两个 provider 复用同一文件但拥有独立配置块和独立缓存。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 可靠性/恢复 | `PortalAbilityConfigProvider follows deployment-mode loading policy` | LOCAL 静态缓存；REMOTE fingerprint 缓存；缺失/非法安全回退 | 覆盖 LOCAL 不热更新、REMOTE 热更新、非法值回退和并发读取 |

## `FN-8.5 上传和管理附件`

### 目标与规范依据

Runtime bootstrap 需要把 portal 能力开关作为 public 配置投影给前端，同时不暴露仅后端使用的 AskUserQuestion 等待时间。

#### 本 Function 的目标 Requirements

canonical spec：`ts-runtime-bootstrap-config`

- `ADDED`：`Bootstrap API exposes portal ability configuration`

### 当前实现

- `agent-channel-web` 的 `runtimeBootstrapResponse` 目前只包含 `transportKind`、可选 `chatUploadFileConfig` 和可选 `guardrail`。
- bootstrap route 通过 `ChatUploadConfigProvider.get()` 在请求时解析上传配置。
- 前端 `runtimeConfig.ts` 解析 bootstrap response，但没有 portal ability 字段。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| bootstrap 返回 `portalAbilityConfig.suggestedQuestionsEnabled` | response schema 无该字段 | 需要扩展 public DTO 和 route projection |
| 不暴露 AskUserQuestion 等待时间 | 当前没有该字段 | schema 需要 `additionalProperties: false`，避免误投影 |
| 请求时解析当前值 | 上传配置已有 provider，portal 配置缺失 | route 需要消费 portal provider |

### 修改方案

在 `agent-channel-web` 中：

- `WebRuntimeBootstrapConfig` 增加 `portalAbilityConfig: { suggestedQuestionsEnabled: boolean }`。
- `runtimeBootstrapResponse` 增加 required `portalAbilityConfig` object，内部仅允许 `suggestedQuestionsEnabled`。
- `WebChannelDependencies` 增加窄化 `PortalAbilityConfigProviderPort`，只暴露 `get(): Promise<{ suggestedQuestionsEnabled: boolean }>`。
- bootstrap route 同时调用上传配置 provider 和 portal ability provider，并把 provider 结果交给 `projectRuntimeBootstrap`。
- `projectRuntimeBootstrap` 继续做 runtime schema 投影，不透传 provider 私有对象。
- `agent-app` 将完整 provider 适配为 channel 窄化 port 注入。

前端 `runtimeConfig.ts`：

- `RuntimeBootstrapResponse` 和 `RuntimeConfig` 增加 `portalAbilityConfig`。
- 解析 `portalAbilityConfig.suggestedQuestionsEnabled`，缺失或非法时使用 `true`。
- `assignRuntimeConfig` 保存该 public DTO，不保存 AskUserQuestion 等待时间。

## `FN-1.20 查看推荐问题`

### 目标与规范依据

推荐问题功能需要由同一个 effective 开关控制前端触发、terminal 预计算和 REST 生成，避免“前端关闭但后端仍消耗模型”的部分关闭状态。

#### 本 Function 的目标 Requirements

canonical spec：`question-recommendation`

- `MODIFIED`：`Frontend Recommendation Trigger`
- `ADDED`：`Suggested questions backend feature gate`

### 当前实现

- `TurnBlock.tsx` 在最新 live-streamed completed turn 上自动挂载 `SuggestedQuestions`。
- `SuggestedQuestions.tsx` 挂载后立即调用 suggested-questions REST endpoint。
- `agent-session` 的 `PrecomputedSuggestedQuestionPort` 在 terminal 后预计算并缓存结果。
- `agent-app` 将 precomputed port 同时注入 terminal callback 和 Web channel。
- 当前实现与 stable spec 的 `No Caching` 存在既有 5 分钟 precompute cache 债务，本 change 不修复该债务。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 前端按开关跳过组件和 API 调用 | 组件始终自动触发 | 需要读取 bootstrap public DTO 并 gate |
| 关闭时 terminal 不预计算 | terminal callback 总是调用 precompute | 需要在 precompute 入口 gate |
| 关闭时 REST 不调用模型 | REST 总是调用 suggested question port | 需要在 REST 入口 gate |
| 开启时行为不变 | 现有生成链路可用 | gate 必须保持 true 路径不变 |

### 修改方案

在 `agent-app` composition 中为 `PrecomputedSuggestedQuestionPort` 增加一个窄化 gate wrapper：

- `precompute(...)`：先 `await portalAbilityConfigProvider.get()`；若 `suggestedQuestionsEnabled === false`，直接返回，不调用 inner precompute。
- `generate(...)`：若 `suggestedQuestionsEnabled === false`，直接返回 `{ questions: [] }`，不调用 inner generate。
- `true` 时原样转发 inner port。

这样 Web channel 的 suggested-questions route 不需要新增 portal 配置依赖，terminal callback 和 REST 共享同一个 gate wrapper。

前端：

- `SuggestedQuestions` 组件在发起 API 请求前读取 `runtimeConfig.portalAbilityConfig?.suggestedQuestionsEnabled ?? true`。
- 值为 `false` 时直接返回 `null`，不进入 loading 状态，不调用 API。
- 保留既有 `REQUEST_COMPLETED`、`isLatest`、`isLiveStreamed`、history-load 和 terminal status 条件。
- local、immersive、collaborative 共用该组件，因此三种宿主行为一致。

不修改推荐问题 prompt、模型选择、输出清洗、解析和 `No Caching` 既有债务。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 性能/容量 | `Suggested questions backend feature gate` | false 时前端不请求、terminal 不预计算、REST 不调用模型 | 断言 false 时无 HTTP 调用、无 precompute、无 model invocation |

## `FN-5.6 向用户提问`

### 目标与规范依据

Canonical `AskUserQuestion` 的默认等待时间需要可配置，但配置只影响该 builtin Tool 创建的新 pending input，不影响其他人工交互。

#### 本 Function 的目标 Requirements

canonical spec：`ask-user-question-tool`

- `ADDED`：`AskUserQuestion default timeout uses portal ability config`

### 当前实现

- `agent-runtime` 的 `RuntimeOwnedAgentRunStatePort` 使用固定 `pendingInputDefaultTimeoutMs = 30 * 60 * 1000`。
- `acceptedPendingInputTimeoutAt` 在 intent 未显式提供 `timeoutAt` 时统一使用该常量。
- `agent-core` 在 canonical builtin descriptor 校验通过后调用 runtime pending input acceptance。
- `producerRef.kind === 'CAPABILITY_INVOCATION'` 且 `capabilityId === 'AskUserQuestion'` 标识 canonical Tool 的 pending producer。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| Canonical `AskUserQuestion` 使用配置默认等待时间 | 所有未显式 timeout 的 pending input 都固定 30 分钟 | 需要按 producer 选择配置值 |
| 显式 `timeoutAt` 优先 | 当前已优先 | 保持不变 |
| 其他 pending input 不受影响 | 当前固定 30 分钟 | 需要避免全局替换 |
| 已 accepted pending input 不受热更新影响 | accepted `timeoutAt` 已固化 | 保持不变并补充测试 |

### 修改方案

在 `agent-runtime` 的 run-state port dependencies 增加窄化依赖：

```ts
askUserQuestionDefaultTimeoutMs?: () => Promise<number>;
```

`agent-app` 注入：

```ts
async () => (await portalAbilityConfigProvider.get()).askUserQuestionTimeoutMs;
```

修改 `acceptedPendingInputTimeoutAt`：

1. 如果 `intent.timeoutAt !== undefined`，保持现有显式值路径。
2. 如果 `producerRef.kind === 'CAPABILITY_INVOCATION'` 且 `producerRef.capabilityId === 'AskUserQuestion'`，并且 runtime 注入了 `askUserQuestionDefaultTimeoutMs`，await 该值并计算 `createdAt + value`。
3. 其他情况保持现有 30 分钟默认值。
4. provider 失败或返回非法值时回退 30 分钟。

不把 provider 或文件路径传入 `agent-core`；`agent-core` 继续只提交 canonical pending intent。runtime 仍是 accepted `timeoutAt` 的唯一 owner。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 可靠性/恢复 | `AskUserQuestion default timeout uses portal ability config` | provider 失败回退 30 分钟；已 accepted deadline 不可变 | 覆盖配置值、非法回退、显式优先和其他 producer 不变 |

## `FN-6.5 请求用户确认或授权`

### 目标与规范依据

Pending input lifecycle 需要保留 runtime-owned timeout authority，同时为 canonical `AskUserQuestion` 增加唯一受控默认 timeout 例外。

#### 本 Function 的目标 Requirements

canonical spec：`human-pending-input-core`

- `MODIFIED`：`Runtime resolves pending input timeout`

### 当前实现

- Runtime 在 pending acceptance 时统一计算 accepted `timeoutAt`。
- 未显式提供 `timeoutAt` 时固定为创建后 30 分钟。
- 显式 `timeoutAt` 仍由 runtime 校验并接受。
- Timeout processing、workflow resume、非 workflow terminalization 和幂等恢复均使用已 accepted `timeoutAt`。
- 当前实现中的显式 timeout 上限为 24 小时，而 stable spec 写 48 小时；这是既有实现/规格偏差，本 change 不改变该上限。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 只为 canonical `AskUserQuestion` 开受控例外 | 当前所有默认值固定 | 需要按 producer 窄化 |
| Runtime 保留 timeout authority | 当前已保留 | provider 只能提供默认值，不能覆盖 accepted fact |
| 其他 pending input 不可配置 | 当前固定 | 保持现有路径 |
| 已 accepted deadline 不随配置变化 | 当前已固化 | 补充 REMOTE 热更新测试 |

### 修改方案

复用 `FN-5.6` 的 runtime 依赖和决策表，不在 `agent-runtime` 中读取文件：

| `intent.timeoutAt` | producer | effective timeout |
|---|---|---|
| 显式提供 | 任意 producer | 显式值，runtime 校验 |
| 未提供 | canonical `AskUserQuestion` | trusted provider 返回的 `1..1440` 分钟，非法回退 30 分钟 |
| 未提供 | 其他 producer | 创建后 30 分钟 |

保持 timeout processing、workflow resume、非 workflow terminalization、幂等恢复和 safe projection 不变。

## 跨 Function 协作与端到端流程

`agent-app` composition 创建唯一 `PortalAbilityConfigProvider`：

```text
active Agent package config/config.json
        │
        ▼
PortalAbilityConfigProvider
        ├─ agent-channel-web bootstrap projection
        │   └─ frontend SuggestedQuestions gate
        ├─ PrecomputedSuggestedQuestionPort gate
        │   ├─ terminal precompute
        │   └─ suggested-questions REST
        └─ agent-runtime AskUserQuestion default timeout
```

- LOCAL：provider 首次读取后静态返回，配置变化需重启。
- REMOTE：provider 在每次消费时按 fingerprint 读取当前值。
- 前端 bootstrap 只拿 `suggestedQuestionsEnabled`。
- Runtime 只拿 AskUserQuestion 默认 timeout 毫秒值。
- 推荐问题 gate 和 AskUserQuestion timeout 不共享业务状态，只共享同一个 trusted config provider。

## 跨 Function 质量属性设计（Cross-Function Quality Attributes）

| 质量属性 | 影响 Functions 与规范依据 | 共享或端到端机制 | 端到端验证 |
|---|---|---|---|
| 安全 | `FN-5.2` provider 生命周期、`FN-1.20` backend gate、`FN-5.6` AskUserQuestion timeout | 配置仅来自 trusted Agent package；请求体、模型输出和 Capability 参数不能修改 | negative tests 覆盖请求侧无法覆盖配置 |
| 性能/容量 | `FN-1.20` backend gate | false 时前端、terminal precompute 和 REST 均不发起模型调用 | integration/contract tests 断言无模型调用 |
| 可靠性/恢复 | `FN-5.2` provider、`FN-5.6` timeout、`FN-6.5` pending lifecycle | 配置异常安全回退；已 accepted deadline 固化 | unit/integration tests 覆盖异常回退与热更新边界 |

## 验证策略（Verification Strategy）

- **Unit**：
  - portal ability parser 默认值、边界值、非法值和 LOCAL/REMOTE provider 生命周期；
  - frontend runtime config 解析和 `SuggestedQuestions` gate；
  - runtime AskUserQuestion timeout 决策表。
- **Contract**：
  - runtime bootstrap response schema 必须包含 `portalAbilityConfig.suggestedQuestionsEnabled`，且拒绝未知字段；
  - suggested-questions REST 在关闭时返回空列表且不调用 model；
  - public bootstrap DTO 不暴露 AskUserQuestion 等待时间。
- **Integration**：
  - LOCAL 配置变化不热更新；
  - REMOTE 配置变化后 bootstrap 和新 AskUserQuestion pending input 使用新值；
  - 已 accepted pending input deadline 不变；
  - 推荐问题关闭时 terminal precompute 和 REST 均无模型调用。
- **Architecture**：
  - `agent-runtime` 不读取 `config/config.json`；
  - `agent-channel-web` 不解析 raw portal config；
  - `frontend/agent-web` 只消费 public bootstrap DTO；
  - 不新增 private path import。
- **Browser journey**：
  - 前端在 false 时不挂载推荐组件、不调用 API；
  - 默认和 true 行为保持不变。
- **Manual review**：
  - 确认本 change 不扩大 suggested questions precompute cache 既有债务，也不改变其他 pending input timeout。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/agent-owned-resource-dynamic-loading/spec.md`：新增 portal ability 配置字段与 provider 生命周期 Requirements。
- `openspec/specs/ts-runtime-bootstrap-config/spec.md`：更新 Purpose 为 runtime bootstrap 配置投影，并新增 bootstrap portal ability projection Requirement。
- `openspec/specs/question-recommendation/spec.md`：修改前端触发 Requirement，并新增后端功能开关 Requirement。
- `openspec/specs/ask-user-question-tool/spec.md`：新增 AskUserQuestion 默认等待时间 Requirement。
- `openspec/specs/human-pending-input-core/spec.md`：修改 pending input timeout Requirement 的受控例外。
- `openspec/designs/functions/D5-Capability能力体系/D5.1-能力治理/FN-5.2-调用能力.md`：补充 agent-owned portal ability 配置加载。
- `openspec/designs/functions/D8-数据与记忆/D8.3-附件与产物/FN-8.5-上传和管理附件.md`：补充 runtime bootstrap portal ability projection。
- `openspec/designs/functions/D1-会话与流式交互/D1.4-智能输入辅助/FN-1.20-查看推荐问题.md`：补充推荐问题功能开关。
- `openspec/designs/functions/D5-Capability能力体系/D5.2-内置工具/FN-5.6-向用户提问.md`：补充可配置默认等待时间。
- `openspec/designs/functions/D6-安全与治理/D6.3-交互与信息安全/FN-6.5-请求用户确认或授权.md`：补充唯一 timeout 例外。
- `openspec/designs/features/D1-会话与流式交互/D1.4-智能输入辅助/F-1.9-智能问题推荐.md`：补充开关语义。
- `openspec/designs/features/D5-Capability能力体系/D5.2-内置工具/F-5.4-向用户提问.md`：补充可配置等待时间。
- `openspec/overview.md`：补充 portal ability 配置能力。
- `openspec/designs/architecture/configuration-boundary.md`：补充 portal ability 配置信任来源和部署模式。
- `openspec/designs/modules/agent-app.md`：补充 provider composition 和推荐问题 gate。
- `openspec/designs/modules/agent-channel-web.md`：补充 bootstrap public DTO。
- `openspec/designs/modules/agent-runtime.md`：补充 AskUserQuestion default timeout dependency。
- `openspec/designs/modules/agent-web.md`：补充前端推荐问题 gate。
- `openspec/designs/adr/`：无。
- `openspec/designs/spec-to-design-map.md`：更新上述 spec 与 Function/设计章节导航。

## 风险与取舍（Risks / Trade-offs）

- REMOTE 热更新只影响后续 bootstrap 调用和新 pending input，已打开页面不会自动收到配置变化；这是为避免引入推送/轮询机制的刻意取舍。
- `portal-ability-config` 与 `chat-upload-file-config` 共用同一 JSON 文件但独立解析和缓存，可能产生一次文件重复读取；这是为了保持职责边界清晰且避免为两个配置块引入新的共享解析框架。
- AskUserQuestion timeout 依据 `producerRef.capabilityId` 窄化，依赖 agent-core 已完成的 canonical descriptor 校验；需要用 negative test 锁定非 canonical Tool 不进入该 pending input 路径。
- 本 change 不修复推荐问题 precompute cache 与 `No Caching` 的既有偏差，避免扩大范围。
- 本 change 不修复显式 pending input timeout 上限的既有实现/规格偏差，只新增默认值配置范围。

## 待确认问题（Open Questions）

无。
