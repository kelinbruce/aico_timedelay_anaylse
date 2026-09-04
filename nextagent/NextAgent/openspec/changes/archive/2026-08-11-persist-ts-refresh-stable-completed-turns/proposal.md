## Why

电信运维用户会通过产品配置的 Workflow 获得 TEXT、PIU、DSL、ACTION 等业务过程和最终回答。当前已完成 Workflow 的实时页面可以保留这些产品过程，但刷新或重新打开会话后，系统不能稳定从 durable facts 恢复相同内容；Direct Workflow 的部分内部节点还会创建供模型使用的协议 Message，使同一产品过程同时跨越展示历史与模型上下文边界。

本 change 只解决这一条用户可观察问题：已完成 Workflow 的 live 与 cold history 最终显示一致，并让产品过程、模型协议和最终回答各自只有明确的 durable owner。

## 术语

- `PRODUCT_PROCESS`：Workflow 在执行期间产生、由产品定义并希望向用户展示的过程内容，包括 TEXT、PIU、DSL、STREAM_DSL、ACTION、OPERATOR、FILE；它不是该轮 canonical conversation answer。
- `TURN_ANSWER`：请求完成后由 terminal Assistant Message 表达的 canonical conversation answer。
- `inner process`：Direct Workflow 或 Workflow-as-Tool 内部 recipe/node 的 lifecycle 与产品过程；不包含 model loop 真实发起的 outer Workflow Tool invocation。

## 目标与非目标

### 目标

- Direct Workflow 与 Workflow-as-Tool 的 inner process 使用相同的 Event-owned lifecycle/product 语义。
- Direct Workflow 内部 `TOOL`、`SKILL`、`SUBFLOW` 不形成模型协议 Message；Workflow-as-Tool 只保留 model loop 真实发起的 outer Tool protocol Message pair。
- `PRODUCT_PROCESS` 从 persisted Event 恢复且不进入模型上下文；`TURN_ANSWER` 继续从 terminal Assistant Message 恢复并进入既有上下文管理。
- 清除浏览器 live/settled state 后，已完成 Workflow 的 lifecycle、产品结构、最终回答和可见顺序与完成态 live 一致。
- 完全相同的 product TEXT 与 `TURN_ANSWER` 最多显示一次；PIU、DSL、其他结构或不同 TEXT 与 `TURN_ANSWER` 同时保留。
- `STATUS_ONLY`、`SUMMARY`、`DETAIL` 继续只治理 ordinary/outer Capability Result，不裁剪 `PRODUCT_PROCESS` 或 `TURN_ANSWER`。
- ordinary Message-backed process、retry、edit、fork 和模型上下文的既有规则保持不变。

### 非目标

- 不修改 Workflow 的执行调度、pending input、terminal Hook、startup recovery 或 crash takeover。
- 不统一改造 Bash、ordinary Tool、Skill、LLM、ApiCall、CLIP 的 durable owner 或 structured projection。
- 不新增 `PRODUCT_PROCESS` 展示策略；未来确有产品需求时另建 change。
- 不实现 share 过程恢复、审计级全节点 input/output、Artifact/ContentRef 或新的通用安全/容量治理。
- 不新增 Gateway contract、数据库 migration、public Web DTO、公共 event/message vocabulary 或客户端输入字段。
- 不要求被调用 Workflow、API、output parser 或产品节点适配。

## 变更范围

1. Direct Workflow 和 Workflow-as-Tool 的 inner lifecycle/product 使用同一套可信 Workflow Event；调用中的 fragment 只服务 live，完成态 product 可以从 history 恢复。
2. Direct Workflow 的 `TURN_ANSWER` 继续使用 terminal Assistant Message；Workflow-as-Tool 的 outer Tool protocol Message pair 继续服务 model loop 与 ordinary Capability Result 展示。
3. cold history 组合 Message-owned answer、ordinary Message-backed process 与 qualified Workflow Event-owned process，得到与 completed live 相同的最终展示。
4. message-free 资格只适用于系统通过可信 Agent routing 或 governed Workflow Tool invocation 执行已注册 recipe 产生的 inner lifecycle/product；ordinary output 自报 Workflow identity 不取得该资格。
5. 三档 Capability Result 策略保持现有配置、默认值和安全上限，仅明确它不适用于 `PRODUCT_PROCESS` 与 `TURN_ANSWER`。

## 契约与确认边界

- Message 正文继续按现有规则进入 Active Context；本 change 不增加 context-exclusion 标志。
- 已有 canonical Message carrier 的 ordinary process 继续从 Message 恢复；Event 只提供其时序、状态和关联。
- Workflow completed product 沿用既有 Event persistence 能力，但把 Direct 与 Workflow-as-Tool inner process 收敛到同一个 closed exception。
- 本 change 不新增或修改 `agent-contracts`、`agent-common`、Gateway、public Web DTO 或数据库 schema。
- **需群内确认：None。** 本 change 没有引入新的内部共享契约；上述 Message/Event 使用边界是本 change 已确认的目标设计，main 已有且未被本 change 改变的其他行为不进入确认范围。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-9.8 持久化和恢复工作流`
  - canonical delta：`workflow-event-history`
  - legacy migration source：`tool-structured-delta / Workflow Selective Persistence`
  - 变化：定义 Workflow inner process、`PRODUCT_PROCESS` 与 `TURN_ANSWER` 的 durable owner。
- `FN-1.2 断线后从上次位置继续`
  - canonical delta：`ts-stream-history-consistency`
  - legacy migration source：`tool-structured-delta / Single Storage With History Reconstruction`
  - 变化：定义 completed live/cold history 收敛，并无损保留 ordinary/CLIP Message-first history 行为。
- `FN-2.4 查看请求状态`
  - canonical delta：`ts-run-status-visibility`
  - 变化：明确三档策略只治理 ordinary/outer Capability Result。

`FN-11.1 恢复运行状态` 不受本 change 影响；本 change 不新增系统质量属性 Requirement。

## Feature 影响

### 修改的 Feature

- `F-9.3 工作流持久化与恢复`：已完成 Workflow 的产品过程可以恢复，且不改变模型上下文。
- `F-1.2 断线重连恢复`：刷新或重新打开后恢复与 completed live 一致的 Workflow 展示。
- `F-2.4 查看请求状态`：Capability Result 三档策略与 Workflow 产品过程的边界明确。

## 依赖与归档顺序

- 行为依赖 `refine-agent-web-live-envelope-lifecycle` 已建立的 live/settled/history 合并边界。
- `tool-structured-delta` 同时被两个已完成但未归档的 change 修改。为避免归档时覆盖 Requirement，采用唯一顺序：`add-structured-delta-bash-apicall-identification` → `add-stream-dsl-message-type` → 本 change。
- 上述两个依赖只约束 OpenSpec stable 合并顺序，不要求本 change 等待其代码行为才能继续实现；本 change 只在归档前等待该顺序完成。
- 不依赖 Gateway、数据库或被调用 Workflow/API 的适配。

## 被动影响

- 用户体验：刷新、重连或重新打开后仍看到完成态 Workflow 产品过程和最终回答。
- 模型上下文：Direct Workflow inner product 不再通过协议 Message 增加 token budget 或 cacheable prefix；terminal answer 与真实 outer Tool protocol 保持现状。
- 配置：三档 Capability Result 配置和值域不变。
- 兼容性：ordinary Message-backed process、历史关联失败、旧消息、retry/edit/fork 保持既有行为并作为回归验证。
- 交付验证：需要覆盖 Direct 与 Workflow-as-Tool、live/cold、TEXT 与 structured product、三档策略和上下文边界。
