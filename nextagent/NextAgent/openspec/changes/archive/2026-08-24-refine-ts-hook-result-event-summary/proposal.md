## Why

Agent 开发者可以通过 Hook 的 `outcome` 控制处理继续、跳过、拒绝、阻断或等待，也可以通过 mutation 改写获准的生命周期边界；但运维人员和内部平台集成方从 `HOOK_INVOKED` 只能看到执行状态、控制结论和被修改字段名，拿不到 Hook 显式返回的执行后结果输出。复用 `safeReason`、`diagnosticCode` 或 `mutationSummary` 会混淆既有字段语义。

现有失败路径还会在 Hook 未返回合法结果时合成 `outcome: "PASS"`。这使 `status` 表达“Hook 是否完成”、`outcome` 表达“Hook 返回的控制结论”的正交关系在失败场景失真，也无法仅凭 `HOOK_INVOKED` 判断失败后是继续还是终止。

本变更为 `HookResult` 增加可选 `resultSummary`，并把该对象原样写入 `HOOK_INVOKED.inlinePayload.resultSummary`。Runtime 不生成摘要、不重组字段、不做内容转换；同时收敛执行状态、控制结论和失败处置语义。

## 术语

- `resultSummary`：Hook 在执行结束时显式返回的 JSON 结果对象。字段名保留为 `resultSummary`，但其值不是 Runtime 二次加工的摘要，而是 Hook 提供的执行后结果输出。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- Agent 开发者可以在任一合法 `HookResult` 中可选返回 JSON object 形式的 `resultSummary`。
- 对每个按既有 lifecycle 契约形成 request-run timeline fact 的 Hook invocation，合法 `resultSummary` 原样进入对应 timeline-only `HOOK_INVOKED.inlinePayload.resultSummary`。
- Runtime 只验证该值是可序列化的 `JsonObject` 且完整 event 的 `inlinePayload` 不超过既有 `49_000 bytes` 上限；不得增删、改名、转换、裁剪、脱敏、摘要或解释其中的内容。
- `status` 只表达 Hook invocation 是否成功完成，`outcome` 只在 Hook 返回合法结果时表达 Hook 的真实控制结论，`failureMode` 表达 invocation 未成功完成后的系统处置策略。
- 非法 `resultSummary` 与其他非法 Hook result 使用同一失败语义，不能被静默删除后当作成功结果接受。

**非目标：**

- 不自动收集完整 Hook input、boundary、mutation、`HookResult` 或 mutation 应用后的 boundary；只有 Hook 显式放入 `resultSummary` 的对象会被透传。
- 不为 `resultSummary` 建立 `code/counts/flags` 等业务 schema，不新增摘要生成器、normalizer、sanitizer、redactor、mapper 或第二套结果 DTO。
- 不把 `HOOK_INVOKED` 加入用户对话 stream，也不新增 SSE、WebSocket 或 Agent Web 事件类型。
- 不改变 Hook stage、effects、ordering、timeout、pending input、mutation authority 或 request lifecycle。
- 不让 `resultSummary` 参与 Agent loop 决策、模型上下文、Capability 调用、terminal result、audit policy 或 persistence policy。
- 不扩展现有 trusted terminal Hook 的专用 `diagnostic` shape；其既有安全诊断字段保持不变。
- 不为缺少 active accepted-run 坐标的 background model Hook 合成 request-run `HOOK_INVOKED`。
- 不要求任何现有 built-in Hook 新增 `resultSummary`，也不新增开发工作台专用投影。

## What Changes

- 修改公共 Hook result 契约：合法结果可以携带可选 JSON object `resultSummary`；该字段只表达 Hook 显式返回的执行后结果。
- 修改既有 Hook result runtime validation：只验证 `resultSummary` 是可序列化的 JSON object，并保证包含它的完整 `HOOK_INVOKED.inlinePayload` 的 UTF-8 JSON 编码不超过既有 `49_000 bytes` 上限；非法时整个 Hook result 无效。
- 修改 timeline-only Hook invocation fact：合法 `resultSummary` 按 JSON 语义原样写入同一条 `HOOK_INVOKED.inlinePayload.resultSummary`；未提供时字段缺失，系统不合成默认值。
- 修改 `HOOK_INVOKED` 的正交状态语义：成功返回合法结果时记录 `status: "SUCCESS"` 和真实 `outcome`；超时、抛错或非法结果时记录对应非成功 `status`、省略 `outcome`，并记录 resolved `failureMode`。
- 保持 `mutationSummary` 的既有职责，只描述 mutation kind 与字段名，不承载结果输出或字段值。
- **BREAKING**：依赖“非成功 `HOOK_INVOKED` 总是携带合成 `outcome: "PASS"`”的内部 timeline consumer 必须改为按 `status`、可选 `outcome` 和 `failureMode` 解释事件。

## Feature 影响（Features）

### 修改的 Feature

- `F-10.1 扩展生命周期钩子`：Agent 开发者可为每次合法 Hook 结果提供执行后结果输出，运维人员可从 timeline-only Hook invocation fact 无歧义地区分执行状态、控制结论和失败处置；组成 Functions 不变。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-10.1 注册和执行钩子` → `specs/lifecycle-hook-execution/spec.md`
  - 功能边界：扩展 Hook 返回结果与 timeline-only invocation fact，原样透传 Hook 显式返回的 `resultSummary`，并收敛 `status`、可选 `outcome` 和 `failureMode` 的正交解释；不改变 lifecycle 控制和 mutation 行为。
  - 系统质量属性：审计/可追溯性、安全。
  - 映射说明：canonical spec；本 change 不触及 legacy spec。

## 影响范围（Impact）

- Agent 开发者：可选使用新增公共 Hook result 字段，并负责只提供允许进入内部 timeline 的结果对象；未返回该字段的既有合法 Hook 行为不变。
- 运维与平台集成：内部 timeline 与开发工作台可读取 Hook 返回的原始 JSON 结果对象，并根据正交字段解释 invocation；普通用户对话流不新增事件。
- 公共契约：显式 refinement 既有“`HookResult` 只表达控制信号和边界修改、`HOOK_INVOKED` 不承载 Hook result”的核心契约，新增受限于 timeline 安全边界的直接结果输出；用户已确认该契约升级。
- 代码与验证：影响 Hook contract、Plugin SDK 类型导出、runtime result validation、timeline event 生成及相应 contract、kernel、architecture 测试；Channel stream vocabulary、开发工作台专用投影与普通 Agent Web 不受影响。
