## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-10.1 注册和执行钩子` | Hook 合法结果可直接携带执行后 JSON 结果，timeline invocation fact 正交表达执行状态、真实控制结论和失败处置 | `lifecycle-hook-execution` | `FN-10.1 注册和执行钩子` |

## `FN-10.1 注册和执行钩子`

### 目标与规范依据

本设计实现 proposal 中“让 Hook 显式返回的执行后结果原样进入 `HOOK_INVOKED.inlinePayload.resultSummary`，并消除非成功 invocation 的伪 `PASS`”目标。`HookResult` 是 Hook producer 与 runtime executor 之间的公共契约；`HOOK_INVOKED` 继续是 runtime-owned、timeline-only invocation fact。`resultSummary` 不成为 lifecycle authority，也不改变 Channel 可见性。

本 change 修改 `agent-contracts` 暴露的公共 Hook 契约和既有 timeline payload 语义。实施和检视必须把它作为公共核心契约 refinement，不得降级为普通内部重构。

#### 本 Function 的目标 Requirements

canonical spec：`lifecycle-hook-execution`

- `ADDED`：`Hook 结果可以直接携带执行后结果输出`
- `ADDED`：`Hook 结果输出必须由 Hook 明确负责 timeline 安全性`
- `MODIFIED`：`Every hook invocation produces a timeline-only observability fact`
- `MODIFIED`：`Lifecycle-changing hook outcomes are recorded in HOOK_INVOKED without default client projection`

### 当前实现

- `packages/agent-contracts/src/runtime/index.ts` 定义 stage-indexed `HookResult` union。合法结果没有通用执行结果输出字段。
- `packages/agent-plugin-sdk/src/index.ts` 重新导出 `HookResult`，Plugin Hook authoring 与 runtime 使用同一公共类型。
- `LifecycleHookStageExecutor.invokeSingle(...)` 取得 Hook 返回值后校验 outcome 和各 stage effect；`emitHookInvoked(...)` 写 `HOOK_INVOKED`。
- 当前 event payload 包含 `status`、必填 `outcome`、安全错误摘要和仅含 mutation kind/字段名的 `mutationSummary`，没有 `resultSummary` 或 `failureMode`。
- 非成功路径当前合成 `outcome: "PASS"`，并且非法结果通常没有准确映射为 `INVALID_RESULT`。
- `RunTimelineEvent.inlinePayload` 已是 `JsonObject`；gateway record、SQLite row 和 timeline persistence 不需要新增字段。runtime 已对 persisted event 的完整 `inlinePayload` 使用 `49_000 bytes` 容量守卫。
- `HOOK_INVOKED` 在 Channel projector 中保持 `TIMELINE_ONLY`；SSE、WebSocket、history Web response 和普通 Agent Web 不接收该事件。
- roadmap 当前把 `HookResult` 限定为 Runtime 必须处理的控制信号和边界修改。本 change 是对该公共核心契约的显式 refinement；用户已确认新增结果输出字段。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| `HookResult` 可携带 JSON 执行结果 | 公共 union 无该字段 | 缺少唯一 contract 和 SDK authoring 类型 |
| 结果对象原样进入同一条 event | event producer 无透传路径 | 需要从 validated result 直接赋值，不能复用 `mutationSummary` |
| Runtime 不加工结果内容 | 当前没有该路径 | 需要明确禁止 mapper、摘要器、内容清洗和字段级 schema |
| 非 JSON/超限结果不能部分生效 | effect 校验和 event 容量降级并非 Hook result validation | 需要在 effect 应用前拒绝，并避免合法 Hook 结果因 event 过大而静默变成 live-only |
| `status`、`outcome`、`failureMode` 正交 | 非成功路径合成 `PASS` | 需要按真实 invocation fact 生成 payload并准确分类 `INVALID_RESULT` |
| 公开 Channel 边界不变 | Channel 当前过滤 `HOOK_INVOKED` | 需要 non-regression 证明新增内容不会扩大 stream vocabulary |

### 修改方案

唯一实施路径是扩展现有公共 `HookResult`，由既有 runtime executor 在同一结果校验点验证 JSON 边界，并由既有 event producer直接赋值到 `inlinePayload.resultSummary`。不新增结果 port、第二类 Hook event、Channel adapter、persistence shape 或专用 summary 类型。

#### 1. 公共契约直接复用 `JsonObject`

在 `agent-contracts/runtime` 的两个 `HookResult` union branch 增加：

```ts
readonly resultSummary?: JsonObject;
```

`JsonObject` 继续来自 `agent-common`，`agent-plugin-sdk` 继续复用同一 public export。不定义 `HookResultSummary`、result DTO、schema vocabulary 或映射层。

字段名沿用用户确认的 `resultSummary`，其规范语义是“Hook 显式返回的执行后 JSON 结果对象”。Runtime 不根据字段名执行摘要操作。

#### 2. effect 应用前只校验 JSON 与完整 event 容量

`LifecycleHookStageExecutor` 在收到返回值后按固定顺序处理：

1. 验证结果为 object 并包含 canonical `outcome`。
2. 若存在 `resultSummary`，验证其本身是非数组、非 null、可序列化的 `JsonObject`，且不含 `undefined`、function、symbol、bigint、非有限数值、循环引用等非 JSON 值。
3. 使用将要写入 `HOOK_INVOKED` 的完整 `inlinePayload` 执行既有 `49_000 bytes` 容量检查，不能为 `resultSummary` 新增另一套任意上限。
4. 对 impact Hook 执行既有 stage/effect/mutation/pending 校验；对 observe-only Hook 保持既有 ignored-control 规则。
5. 只有适用校验全部成功后，才能应用 mutation、创建 pending input 或解释 control outcome。
6. 生成单一 `HOOK_INVOKED`。

校验失败统一使用既有 `LIFECYCLE_HOOK_RESULT_INVALID`，event status 为 `INVALID_RESULT`；同一结果中的 mutation、control outcome 和 pending intent 均不部分应用。`failureMode` 仍按既有规则决定继续或失败。

校验成功后，event producer 直接使用 validated `resultSummary`。为了异步持久化不受 Hook 返回后继续修改对象影响，可以在 JSON validation/serialization 时取得 detached JSON value；该 copy 只能保持 JSON 语义等价，不得执行内容转换。无需额外 sanitizer、redactor、normalizer 或业务 mapper。

#### 3. 从同一 validated result 生成正交 event payload

`emitHookInvoked(...)` 的内部 event input 调整为可选 `outcome`、必填 resolved `failureMode` 和可选 `resultSummary`：

| invocation fact | `status` | `outcome` | `failureMode` | `resultSummary` |
|---|---|---|---|---|
| 返回合法结果 | `SUCCESS` | Hook 返回的真实值 | definition/activation 解析值 | Hook 提供时按 JSON 语义原样写入 |
| timeout | `TIMEOUT` | 缺失 | resolved value | 缺失 |
| 抛错或不可用 | `FAILED` | 缺失 | resolved value | 缺失 |
| 非法 Hook result | `INVALID_RESULT` | 缺失 | resolved value | 缺失 |

`mutationSummary` 的生成函数、内容和出现条件保持不变。`resultSummary` 只来自 Hook 显式返回值；Runtime 不从 mutation、boundary、safe reason、error details 或后续业务事件反推。

trusted terminal Hook 保持既有专用 `diagnostic` shape，不增加通用 `resultSummary`；其普通 invocation 状态语义与同类路径一致。

#### 4. 保持 timeline 与 Channel 单一边界

事件仍通过 `AgentRunStatePort.emitEvent()` 进入现有 timeline persistence/live publication。`RunTimelineEvent`、gateway record、SQLite row 和 history page 不增加专用字段；新值只位于既有 `inlinePayload`。

`agent-channel-common` 的 visible event 闭集和 `agent-contracts/channel.StreamEventType` 不修改。Channel 投影入口仍对 `HOOK_INVOKED` 返回 `TIMELINE_ONLY`；实时 SSE/WS 和 Web run-event history 继续过滤该事件。

本 change 不新增开发工作台专用解析或展示逻辑。已有内部 timeline reader 可以从通用 `inlinePayload` 读取该对象；普通 Agent Web 不新增消费路径。

黑盒效果示例：Bash Capability 执行后得到 `a:1, b:2`，对应 Hook 显式返回 `resultSummary: { a: 1, b: 2 }` 时，内部 timeline 产生且仅产生一条如下事实；Channel 仍不投影该事件。

```json
{
  "type": "HOOK_INVOKED",
  "inlinePayload": {
    "hookId": "capability-result-output",
    "stage": "AFTER_CAPABILITY_RESULT",
    "status": "SUCCESS",
    "outcome": "PASS",
    "failureMode": "CONTINUE",
    "resultSummary": {
      "a": 1,
      "b": 2
    }
  }
}
```

#### 5. 安全责任边界

`resultSummary` 是 Hook 主动选择进入内部 timeline 的输出；Hook author/Plugin owner 必须只返回该 surface 允许承载的数据。Runtime 不可能在不理解业务语义的情况下既“原样输出”又可靠识别所有敏感内容，因此本 change 不引入伪安全的通用脱敏。

既有明确禁止项继续有效：Hook 不得把 prompt、模型输入输出、Capability 输入输出、Hook input、完整 boundary、mutation 值、Owner Scope、credential、authentication token、附件内容或原始异常放入该字段。不能满足这一前置条件的 Hook 必须省略 `resultSummary`。Runtime 的职责仅是 JSON/容量边界和可见性隔离。

### 质量属性影响

| 质量属性 | 规范依据 | 实现机制 | 验证关注点 |
|---|---|---|---|
| 审计/可追溯性 | `Every hook invocation produces a timeline-only observability fact` | 单条 invocation fact；状态、真实控制结论、失败模式、结果对象分字段表达 | success/failure truth table、原样透传和单事件约束 |
| 安全 | `Hook 结果输出必须由 Hook 明确负责 timeline 安全性` | Hook producer 明确责任、Runtime JSON/容量边界、Channel timeline-only 隔离 | 禁止从其他字段合成、Channel negative case、Plugin review |
| 可维护性 | 功能性 Requirements | 复用 `JsonObject`、既有 executor/event producer/容量常量，不新增摘要处理层 | 无平行类型、validator、mapper 或 persistence path |

### 备选方案（Alternatives Considered）

- 扩大 `mutationSummary`：会把“改了什么”与“Hook 返回了什么”合并，破坏既有语义；不采用。
- 新增闭合 `code/counts/flags` 摘要 schema：不能承载 Hook 的实际执行结果，且需要额外转换；按用户确认不采用。
- Runtime 从完整 Hook result 或处理后 boundary 自动生成摘要：需要业务解释和敏感内容处理，且不是 Hook 显式输出；不采用。
- 新增 `HookResultSummary` 类型：与 `JsonObject` 同形且没有独立不变量，形成一次性 DTO；不采用。
- 新增用户可见 Hook stream event：突破 timeline-only 和 Channel ownership；不采用。

## 验证策略（Verification Strategy）

- contract：验证两个 `HookResult` union branch 接受可选 `JsonObject resultSummary`，Plugin SDK 复用同一 contract，不产生平行 DTO。
- kernel/unit：通过真实 lifecycle executor 验证嵌套 object、array、string、number、boolean、null 等 JSON 内容原样进入 event；验证省略、非 object、非 JSON、循环引用和完整 event 超限。
- no-processing：使用容易暴露转换的 key、Unicode 文本、嵌套数组和 `null`，断言 event 与 Hook 返回值 JSON 语义等价且没有增删字段。
- failure characterization：覆盖 success、timeout、throw/unavailable、invalid-result 与 `CONTINUE/FAIL`，断言 `status`、可选真实 `outcome`、resolved `failureMode` 和请求处置一致。
- Channel negative case：验证携带 `resultSummary` 的 `HOOK_INVOKED` 仍为 `TIMELINE_ONLY`，SSE、WebSocket 和 Web history response 均不输出该事件。
- architecture/人工审查：确认公共 contract 已获升级确认，未新增目录、Gateway DTO、表、stream vocabulary、Agent Web 投影、summary schema、mapper、sanitizer 或第二结果路径。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/lifecycle-hook-execution/spec.md`：合并两个新增和两个修改 Requirements，并保留 `FN-10.1` 唯一归属元数据。
- `openspec/designs/functions/D10-二次开发与平台集成/D10.1-扩展与插件/FN-10.1-注册和执行钩子.md`：刷新描述、输出、处理过程、结果与接口导航。
- `openspec/designs/features/D10-二次开发与平台集成/D10.1-扩展与插件/F-10.1-扩展生命周期钩子.md`：补充 Hook 结果输出和 invocation evidence 的开发者/运维价值。
- `openspec/designs/architecture/core-contracts.md`：更新 `HookResult.resultSummary` 与 `HOOK_INVOKED` 正交字段语义。
- `openspec/designs/architecture/observability.md`：更新 lifecycle Hook signal inventory、Hook-owned result output 和非成功 invocation 投影规则。
- `openspec/designs/modules/agent-runtime.md`：更新 Hook result JSON/容量 validation 和单一 timeline fact 生成职责。
- `openspec/designs/modules/agent-contracts.md`：更新公共 Hook result contract 导航。
- `openspec/designs/modules/agent-plugin-sdk.md`：更新 Hook authoring 的 timeline 安全责任。
- `openspec/overview.md`、`openspec/designs/adr/`、`agent-channel-web` 与 `agent-web` module design：无；顶层范围、既有 ADR 和 Channel 边界不变。
- `openspec/designs/spec-to-design-map.md`：无需改变导航目标；归档时复核验证说明。

## 风险与取舍（Risks / Trade-offs）

- 开放 JSON object 能表达真实 Hook 结果，也扩大内部 timeline 的数据暴露面。选择把内容安全责任明确放在 Hook producer，并保持 Runtime 无业务加工；实施 review 必须逐个审查返回 `resultSummary` 的 built-in Hook。
- 完整 event 超限时不能沿用 run-state 当前“只 live 不持久化”的静默降级，否则 canonical Hook invocation fact 会丢失。executor 必须在应用 effect 前按同一上限判定结果非法。
- `outcome` 从非成功事件中移除会影响依赖旧占位值的内部消费者。仓内 consumer 必须在同一 change 更新为 `status + optional outcome + failureMode`，不设置兼容 alias 或双写窗口。

## 迁移与回滚（Migration / Rollback）

- 数据库无需迁移；`inlinePayload` 已支持 JSON object。
- Hook 定义采用 opt-in 字段；现有未返回 `resultSummary` 的 Hook 无需修改。
- 内部 consumer 必须容忍历史 `HOOK_INVOKED` 缺少 `failureMode`/`resultSummary`，并停止假设非成功 event 必有 `outcome`。
- 回滚必须整体恢复本 change 的 contract 与 consumer 版本；已有含 `resultSummary` 的历史 record 仍可被开放 `inlinePayload` 读取或忽略。
