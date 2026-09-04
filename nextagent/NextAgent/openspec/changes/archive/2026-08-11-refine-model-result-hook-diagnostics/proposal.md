## Why

Agent 开发者和运维人员通过模型调用生命周期 hook 诊断电信网络智能体执行时，当前无法稳定获得模型首次反馈耗时、端到端耗时和 provider 返回的 token usage。模型调用变慢或 token 消耗异常时，现有 `AFTER_MODEL_RESULT` 边界不足以区分等待首个反馈、完整生成和用量变化，降低了本地运行诊断的可解释性与可追溯性。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- 每次成功完成且受生命周期 hook 治理的模型调用，都提供从调用开始到成功结果的端到端耗时。
- 模型首次产生非空 content、reasoning 或 tool call 反馈时，提供从调用开始到该反馈的首次反馈耗时；流式和非流式调用遵守同一语义。
- provider 返回 usage 时，`AFTER_MODEL_RESULT` 精确投影其已提供的 token 计数字段；provider 未返回的字段保持缺失。
- 这些诊断事实对 run-bound 和 background 模型调用保持一致，并可由黑盒测试验证。

**非目标：**

- 不新增 Web API、stream、timeline、metric 或 operational log 字段。
- 不记录或扩散 prompt、模型原始输出、provider raw error、credential 或认证 token。
- 不估算、补齐或推导 provider 未返回的 usage。
- 不改变 hook mutation 能力，不允许 hook 修改诊断字段或模型调用结果。
- 模型调用失败时不合成 `AFTER_MODEL_RESULT` 边界。

## What Changes

- 修改 `AFTER_MODEL_RESULT` 公共 hook boundary：成功模型调用提供非负整数毫秒的端到端耗时；存在可识别模型反馈时同时提供首次反馈耗时。
- 修改 `AFTER_MODEL_RESULT` 公共 hook boundary：模型结果携带 usage 时，原样投影其已提供的 token 计数字段；未携带 usage 时省略该字段。
- 明确新增诊断字段仅用于观察，不属于 `AFTER_MODEL_RESULT` mutation fields，不改变既有模型结果和失败语义。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-10.1 注册和执行钩子` → `specs/lifecycle-hook-execution/spec.md`
  - 功能边界：细化成功模型调用的 `AFTER_MODEL_RESULT` 边界输出，增加一致、可验证的模型耗时与 usage 诊断事实。
  - 系统质量属性：可测试性、审计/可追溯性。
  - 映射说明：canonical spec。

## 影响范围（Impact）

- Agent 开发者和本地诊断插件可读取新增的可选边界字段；现有 hook 无需修改即可继续运行。
- 公共 runtime hook contract 增加可选诊断字段，不改变现有请求输入、配置或 provider 集成接口。
- 模型生命周期 hook 的 contract、实现和产品路径测试需要同步验证流式、非流式、terminal-only tool call、usage 缺失与失败路径。
