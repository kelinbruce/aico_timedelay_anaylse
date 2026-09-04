## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-10.1 注册和执行钩子` | 为成功模型调用的 `AFTER_MODEL_RESULT` 增加一致的模型耗时和 usage 诊断事实 | `lifecycle-hook-execution` | `FN-10.1 注册和执行钩子` |

## `FN-10.1 注册和执行钩子`

### 目标与规范依据

本设计满足 proposal 中对模型首次反馈耗时、端到端耗时和 provider usage 精确投影的黑盒目标，同时保持现有 hook mutation、失败和敏感数据边界不变。

#### 本 Function 的目标 Requirements

canonical spec：`lifecycle-hook-execution`

- `MODIFIED`：`Stage-specific boundaries and mutations are minimal runtime contracts`

### 当前实现

- `ModelResultBoundary` 已经承载模型结果摘要、content、reasoning、tool calls 和可选 timing 字段，但没有 usage 字段。
- 模型调用生命周期 wrapper 是 `BEFORE_MODEL_INVOKE` 与 `AFTER_MODEL_RESULT` 的统一调用入口；它同时包装 `complete` 和 `stream`，并在模型安全失败时跳过 after hook。
- 当前 wrapper 没有从 concrete provider invocation 起点测量耗时，也没有把 `ModelFinalResult.usage` 投影到 after boundary。
- 现有单元测试覆盖 after hook mutation、流式 delta 顺序和失败路径；产品路径测试可从最终 NDJSON artifact 观察 hook boundary。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 成功调用提供 `modelE2ELatencyMs` | wrapper 未记录 provider invocation 起止 | 需要在统一调用入口以单调时钟测量并投影 |
| 首个 content、reasoning 或 tool call 反馈提供 `firstContentLatencyMs` | wrapper 未观察首次有效反馈 | 需要同时覆盖 stream delta 与 terminal-only 结果，并只记录首次反馈 |
| 精确投影 provider usage | `ModelFinalResult` 可携带 usage，after boundary 不承载 | 公共 boundary 需要复用现有 `ModelUsage`，wrapper 仅在存在时透传 |
| 诊断字段不改变模型结果和失败语义 | after hook 仅允许既有结果 mutation，safe failure 跳过 after hook | 需要保持现有 mutation 白名单和失败短路不变，并补齐 negative case |

### 修改方案

唯一实现路径如下：

1. 在 runtime hook 公共契约的 `ModelResultBoundary` 上复用现有 `ModelUsage` 类型，增加可选 `usage`；保留既有可选 timing 字段和 `AFTER_MODEL_RESULT` mutation schema，不增加新的 mutation authority。
2. 在模型生命周期 wrapper 完成 before hook 后、调用 concrete provider 前读取单调时钟。`complete` 返回成功 terminal result 时，根据 terminal content、reasoning 或 tool calls 判定首次反馈；`stream` 在首次有效 delta 到达时冻结首次反馈耗时，若没有有效 delta，再以成功 terminal result 判定。两条路径都在成功 terminal result 后计算端到端耗时。
3. wrapper 构造 `AFTER_MODEL_RESULT` boundary 时仅投影已存在的 usage 对象，不克隆补值、不估算 token；after hook 的返回仍只按既有 content、reasoning 和 tool calls mutation 归并到结果。
4. 保留 safe error、非法 stream terminal、consumer error、cancellation 和 lifecycle interruption 的现有处理路径；这些路径不产生 after boundary，也不产生合成 timing 或 usage。

该方案把测量放在同时覆盖 run-bound 与 background invocation 的统一 wrapper，避免调用方重复实现和语义漂移。它不修改 `developer-hook-trace` 插件；插件继续按通用 hook boundary 投影既有公共事实。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 可测试性 | 无新增黑盒质量目标；由功能性 Requirement 派生 | 单调计时集中在统一 wrapper，usage 使用既有 contract shape | 流式、非流式、各类首次反馈和缺失字段均可由 boundary 断言 |
| 审计/可追溯性 | 无新增黑盒质量目标；由功能性 Requirement 派生 | 只投影低敏耗时与 token count，不扩展 prompt 或模型输出范围 | 产品路径验证 NDJSON 中的关键诊断事实，失败路径验证不合成事件 |

## 验证策略（Verification Strategy）

- unit 验证 `complete` 与 `stream` 的成功 boundary，覆盖 content、reasoning、delta tool call、terminal-only tool calls、空反馈、完整或部分 usage，以及 provider 未返回 usage。
- unit negative case 验证 safe error、非法 terminal 和 consumer error 不产生合成 after boundary，并确认诊断字段不进入结果 mutation。
- e2e 从真实 plugin 装配与请求路径读取最终 NDJSON artifact，断言 `AFTER_MODEL_RESULT` 存在非负 timing 和精确 usage；测试不依赖 wrapper 私有实现。
- contract、typecheck 和 architecture gate 验证公共 runtime contract 仍从允许的 surface 导出且未形成非法依赖。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/lifecycle-hook-execution/spec.md`：合并本 change 的 MODIFIED Requirement。
- `openspec/designs/functions/D10-二次开发与平台集成/D10.1-扩展与插件/FN-10.1-注册和执行钩子.md`：刷新输出与处理过程摘要。
- Feature：无。
- `openspec/overview.md`：无。
- `openspec/designs/architecture/runtime-boundaries.md`：补充模型结果 hook 的 timing 与 usage 投影边界。
- `openspec/designs/modules/agent-model.md`：补充统一模型调用 wrapper 的诊断事实职责。
- ADR：无。
- `openspec/designs/spec-to-design-map.md`：验证入口发生变化时刷新测试导航，否则无。

## 风险与取舍（Risks / Trade-offs）

- 毫秒值经过整数舍入，极短调用可能观测为 `0`；这是非负整数毫秒契约允许的结果，测试不得假设正数。
- terminal-only 调用无法获得 provider 内部真正生成首个字符的时刻，只能以调用方首次观察到 terminal result 的时刻计量；字段语义明确限定为系统首次可识别反馈，避免伪造更细粒度精度。
- usage 由 provider 决定是否提供及提供哪些字段；保持缺失比跨 provider 推导更可审计。

## 待确认问题（Open Questions）

无。公共 runtime contract 的增量投影已由用户在本 change 中明确确认。
