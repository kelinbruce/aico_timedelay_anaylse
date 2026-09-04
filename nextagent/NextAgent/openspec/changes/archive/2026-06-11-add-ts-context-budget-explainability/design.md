## 1. 输入与输出边界

本 change 不引入新的 Web API、stream event 或 runtime command，只在已有 Context Assembly 主路径上补齐"预算决策可解释 + 不静默截断"的契约。

输入（来自 [[add-ts-context-history-selection]] 的产物与既有 kernel 契约）：

- `ContextAssemblyRequest`：当前 model-backed step 的装配请求，携带 agentId/owner scope 等定位/意图字段，不携带 model window 或 output budget。
- 选定 model window：`assemble()` 内从 accepted model profile 的 `contextWindowTokens` 解析（模型固有容量事实，字段由 [[refine-ts-model-profile-context-window]] 冻结），不经请求体。
- 保留 output budget：来自当前 step 生效的 `ModelOptions.maxTokens`。
- 历史候选：上一阶段 History Selection 产出的 `selectedMessageRefs`（仅候选，不含最终窗口截断）。
- `ActiveContextView`：model-visible 历史权威视图。
- 当前请求事实：root user message、current-request protocol-required messages、latest-request-required attachment 引用。
- 稳定 prompt 槽位估算：runtime context、project instruction、capability disclosure、attachment projection、memory disclosure。

输出（本 change 拥有的契约）：

- `ContextBudgetEvidence`：source-category 级预算证据集合（每条含安全 category、estimated input units、selected/omitted/degraded 状态、reason code、owning boundary）。
- `ContextCompactionPlan`：稳定机读决策契约（`reasonCode`、`compressionMode`、`degradationMode`、`pipelineStageStoppedAt`、`estimatedFinalInputUnits`、`omittedContextTypes`），表达 continue / compact-degrade / pre-send-check / explicit-failure 之一。
- runtime-owned degradation 事实：供 channel 投影为 presentation-safe `DEGRADATION_NOTICE`。

边界图：

```text
History Selection 候选 ──┐
ActiveContextView ───────┤
当前请求事实 ────────────┼─> [Budget Policy 阶段] ─> ContextBudgetEvidence
稳定 prompt 槽位估算 ─────┤        │                    ContextCompactionPlan
选定 window / output 预算 ┘        │                          │
                                   └─> runtime degradation 事实 ─> channel DEGRADATION_NOTICE 投影
```

## 2. 选定方案（Chosen Design）

实现路径：在 Context Assembly 流水线的第 3 段"预算策略"内，作为一次**同步决策关口**执行。决策关口的**位置、输入、输出契约与不变量是固定的**；具体的预算分配与降级算法由可插拔的 `ContextBudgetPolicyPort` 承担。`agent-context-engine` 拥有决策关口编排，`agent-observability` 拥有安全证据落地，runtime 拥有 degradation 事实发布。预算决策是装配内的同步段，不拆为独立 service、不引入 durable budget record、不引入异步预算任务。

### D0：决策关口位置、owner 与 policy 边界

预算策略发生在 History Selection 与 Compression/Prompt-Shaping 之间，是装配流程内的同步段。决策关口调用 `ContextBudgetPolicyPort.evaluate(...)` 取得 `ContextCompactionPlan` 与 `ContextBudgetEvidence`；下游 Compression / Prompt-Shaping 消费该计划，不重新推导预算。

`ContextBudgetPolicyPort` 是可插拔扩展点：

```ts
interface ContextBudgetPolicyInput {
  readonly availableInputUnits: number
  readonly minimumSafeContextUnits: number
  readonly sourceCandidates: readonly ContextSourceCandidate[]  // 每源 category + 估算 units
  readonly window: number
  readonly reservedOutput: number
}

interface ContextBudgetPolicyOutcome {
  readonly plan: ContextCompactionPlan
  readonly evidence: readonly ContextBudgetEvidence[]
}

interface ContextBudgetPolicyPort {
  evaluate(input: ContextBudgetPolicyInput, signal: AbortSignal): ContextBudgetPolicyOutcome
}
```

app composition 注入一个 policy 实现；缺省注入下文 D3–D5 描述的**默认 policy**（`DefaultProportionalBudgetPolicy`）。同一进程生命周期内 policy 实例是稳定注入项，不接受按请求体、模型输出或 capability 参数动态切换。

### 不变量（任何 policy 实现都必须遵守）

policy 可自定义预算分配比例、降级优先级和阈值，但**不得**破坏以下决策关口不变量——这些不变量属于 Context Engine / Query Policy 契约，不属于某个 policy：

1. minimum safe current-request context 是硬保护基线，任何 policy 都不得把它放进 history 预算或为腾空间而省略它（D2）。
2. 基线本身超预算时，policy 必须产出显式 insufficient-context outcome，不得伪造成功装配（D2）。
3. policy 必须为每个 source category 与 role group 产出安全、完整的 explainability 证据，且证据不得含 raw prompt/message/tool/attachment、path、credential、高基数标识（D4）。
4. `ContextCompactionPlan` 必须收敛为 continue / compact-degrade / pre-send-check / explicit-failure 之一的稳定 decision（D4）。
5. 输出侧 output-window guard 必须显式化，不得静默截断（D5）。

### D1：收集候选并计算 `availableInputUnits`

`assemble()` 内从 accepted model profile 解析 model window（`ModelProfile.contextWindowTokens`，模型固有容量事实），从当前 step 生效的 `ModelOptions.maxTokens` 取保留 output budget，计算 `availableInputUnits = window - reservedOutput - 固定 prompt 槽位`。window 与 output budget 都不来自 `ContextAssemblyRequest`、客户端请求体、模型输出或 capability 参数。runtime context、project instruction、capability disclosure 等稳定槽位单独估算，不混入 prior-history 估算（对应 query-policy "Stable prompt slots are not hidden inside history estimates"）。这些是 `ContextBudgetPolicyInput`，对所有 policy 一致。

### D2：判定并硬保护 minimum safe current-request context

minimum safe current-request context = root user message + current-request protocol-required messages + latest-request-required attachment context。这条基线是硬保护，不进入 60% history cap，不可被省略。

- 若基线本身 `> availableInputUnits`：返回显式 insufficient-context（safe error 或显式降级），`reasonCode`/`degradationMode`/explainability 必须显示基线超预算（对应 context-engine "Minimum safe context cannot fit" 与 query-policy "Minimum safe current request exceeds budget"）。
- latest-request-required attachment 无法安全投影或预算时，fail 当前装配，不得静默退化为纯文本（对应 context-engine "Latest request attachment cannot be silently degraded away"）。

### D3：默认 policy 对 prior-history domain 应用 60% cap

以下是**默认 policy（`DefaultProportionalBudgetPolicy`）的参数与算法**，非决策关口不变量；替换 policy 可调整这些数值与降级顺序，但仍受上文不变量约束。

`historyBudgetCapUnits = floor(availableInputUnits * historyBudgetRatio)`，默认 `historyBudgetRatio = 0.60`。cap 适用于 prior raw turns 及其 summary/memory 替代、非 latest-request-critical 历史附件投影；不适用于 minimum safe context、runtime context、project instruction、capability disclosure。超 cap 部分必须先 summarize/trim/omit/degrade，绝不动 current-request-critical context。大 capability/tool result 在与 request-critical context 竞争时，优先 excerpt/reference/summary/omission（对应 query-policy "Large capability result is degraded before request-critical context"）。`historyBudgetRatio` 是默认 policy 的可配置参数，默认锁定 0.60。

### D4：产出 source-category + role-level explainability 决策契约

为每个 source category（current request、prior history、summary/session-memory 替代、attachment projection、capability disclosure、large capability/tool result、runtime context、project instruction、memory disclosure）产出一条 `ContextBudgetEvidence`：安全 category、estimated units、selected/omitted/degraded 状态、reason code、owning boundary。同时为 `system`/`user`/`assistant`/`tool` role group 产出 retain/protect/compress/summarize/excerpt/reference/omit/reject 的安全 role-level 证据。证据**禁止**含 raw prompt、raw message、raw tool args/result、attachment content、local path、credential、高基数标识。

`ContextCompactionPlan` 把这些证据收敛为一个稳定 decision：continue / compact-degrade / pre-send-check / explicit-failure，下游无需重算预算数学（对应 query-policy "Explainability is a decision contract not a bare number"）。

### D5：残余压力 pre-send check 与输出窗口 guard

- 输入侧（默认 policy 参数）：若发生 overflow 且压缩后 `estimatedFinalInputUnits / availableInputUnits >= preSendCheckRatio`（默认 `preSendCheckRatio = 0.885`），`ContextCompactionPlan.degradationMode` 必须含 `PRE_SEND_CHECK_REQUIRED`，且 reasons 可观察该残余压力。`preSendCheckRatio` 是默认 policy 的可配置参数，默认锁定 0.885；替换 policy 可调整该阈值。
- 输出侧（决策关口不变量，与 policy 无关）：每个 model-backed step 强制 output-window guard。输出超窗时表达为显式 continuation / partial-result degrade / failure，绝不静默截断（对应 context-engine "Output-window safety is explicit"）。本 change 不提供自动续写，只保证显式提示。

### D6：用户可见降级经 runtime-owned 事实投影

当 D2–D5 的降级影响用户可见语义时，runtime 在受影响请求进展前或同时发布 canonical degradation 事实；channel 以该事实为唯一来源投影 presentation-safe `DEGRADATION_NOTICE`，channel/UI 不得独立合成。`RunStatus` 保持当前生命周期状态，不引入 `DEGRADED`（对应 ts-run-status-visibility 三个新 scenario）。

### D7：安全证据落地

`agent-observability` 把 `ContextBudgetEvidence` 与 plan 落到 structured log / metric，经统一 redaction；不新增独立 explainability API、不落 durable budget record。所有越过不可信边界的字段先 schema validation。

## 3. 决策关口流程（关口固定，算法由 policy 实现）

决策关口固定执行下列阶段；其中预算分配与降级（步骤 3、5 的具体数值与顺序）由注入的 policy 实现，默认 policy 取 D3–D5 参数：

```text
1. 收集候选 + 计算 availableInputUnits          -> 验证: 稳定槽位单独估算,不混入 history (D1, 关口)
2. 硬保护 minimum safe current-request context  -> 验证: 基线超预算时显式 insufficient-context (D2, 不变量)
3. policy 分配 history 预算并降级超额部分       -> 验证: 默认 floor(avail*0.60),超额先降级 history,不动 request-critical (D3, policy)
4. 产出 source+role explainability 决策契约     -> 验证: 每类证据安全完整,plan 给稳定 decision (D4, 不变量)
5. pre-send check + 输出窗口 guard              -> 验证: 默认 ratio>=0.885 标记,输出超窗显式提示 (D5, 阈值=policy/guard=不变量)
```

任一步失败都收敛为 `ContextCompactionPlan` 的 explicit-failure 或 insufficient-context outcome，绝不伪造成功装配。用户可见影响经 D6 由 runtime 投影。

## 4. 质量属性评审

- 安全：所有 explainability 证据与 `DEGRADATION_NOTICE` 经 redaction，禁含 raw prompt/message/tool/attachment、path、credential、高基数标识；不可信边界字段先 schema validation（D4、D6、D7）。
- 性能：预算决策是装配内一次同步关口，不引入异步任务或 durable record；稳定槽位单独估算避免重复推导；下游消费 plan 不重算预算数学（D0、D1、D4）。
- 可靠性：minimum safe context 硬保护 + 显式 insufficient-context，杜绝静默丢弃 request-critical context；输出侧 guard 杜绝静默截断（D2、D5）。
- 可维护性：固定决策关口位置与不变量、稳定 anchor D0–D7、预算算法经 `ContextBudgetPolicyPort` 隔离为可替换单元，change 内 spec/tasks 与 design 一一对应。
- 可测试性：每步有可断言的黑盒结果（默认 cap 数值、ratio 阈值、insufficient-context outcome、证据字段安全性）；`ContextBudgetPolicyPort` 可注入 stub policy 独立测试关口不变量与替换性；negative case（基线超预算、attachment 静默退化、channel 独立合成 notice、替换 policy 破坏不变量）可被测试触发并断言失败。
- 审计：`ContextBudgetEvidence` 与 plan decision 落 structured log/metric，runtime degradation 事实可重放，notice 投影可追溯到 runtime fact（D6、D7）。

## 5. 归档基线落点

change 归档时，delta 内容并入以下长期基线：

- `agent-context-engine` 模块基线：D1–D5 预算关口、minimum safe context 保护、`ContextBudgetPolicyPort` 可插拔扩展点与默认 policy、explainability 决策契约、输出窗口 guard。
- `query-policy` capability 基线（本 change 经 ADDED 首次建立）：决策关口不变量、可插拔 policy port、默认 policy 的降级优先级与 60% cap、selection reasons、budget-stage explainability + pre-send check。
- `ts-run-status-visibility` 基线：新增 budget/output degradation 三个 scenario 并入 "Run Status Visibility Source Of Truth"。
- `agent-observability` 模块基线：`ContextBudgetEvidence` 与 plan 的安全落地与 redaction。
- spec-to-design map：D0–D7 → 对应 requirement/scenario 的映射保留在模块基线 ADR 引用中。
