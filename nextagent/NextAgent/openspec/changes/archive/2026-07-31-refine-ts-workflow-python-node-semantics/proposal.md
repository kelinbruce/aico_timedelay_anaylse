## 背景与问题(Why)

workflow `python` 节点当前由 `agent-workflow` 的 `executePythonNode` 实现，经 `Python` capability（sandbox gateway）执行用户脚本。当前实现与目标 PythonNode 语义在两处不一致，导致 recipe 无法按预期方式注入参数和消费 print 输出：

1. **参数注入**：当前只跳过 `script`，用 `JSON.stringify` 统一生成变量赋值，不区分类型。这会产出 Python 不认识的字面量——`null` 而非 `None`、`true`/`false` 而非 `True`/`False`、数字字符串 `"42"` 被包成 `"42"` 而非原样 `42`。同时缺少 `param_to_json_str` 开关和 JSON 字符串模式（`r'''...'''`），且未跳过 `param_to_json_str` 自身。
2. **输出处理**：当前把 sandbox 返回的 `{exit_code, stdout, stderr, timed_out}` 整体作为 `python_result`，再用 `expandStdoutJsonFields` 把 stdout 的 JSON 字段展开到 payload 顶层。recipe 拿到的是带执行元数据的混合对象，而非按 print 输出条数解析的纯结果。目标语义要求：0 条 print → `null`；1 条 → 该条本身（尝试 JSON 解析）；多条 → 列表，每条分别解析。

## 变更范围(What Changes)

- **修改** `python` 节点（`agent-workflow`）的参数注入语义：
  - 跳过 `script` 和 `param_to_json_str` 两个保留 key
  - 普通模式（`param_to_json_str=false`，默认）：按类型生成 Python 原生字面量（`None`/`True`/`False`/数字原样/数字字符串原样/其他类型 JSON 序列化）
  - JSON 字符串模式（`param_to_json_str=true`）：所有值统一序列化为 JSON 字符串并用 `r'''...'''` 三引号包裹
- **修改** `python` 节点的输出处理语义：
  - 按 stdout 换行分割近似 print 输出条数（sandbox 返回 stdout 原始字符串，无法区分 print 调用次数，换行分割是现有 contract 下的最小增量）
  - 0 条 → `null`；1 条 → 该条（合法 JSON 对象/数组则解析，否则原字符串）；多条 → 列表，每条分别解析
  - `python_result` 不再混入 `exit_code`/`stderr`/`timed_out`/`_trace`；`invocation_trace` 继续作为独立 output variable 保留
- **不改** `Python` capability 的 input/output schema（python-tool 仍返回 `{exit_code, stdout, stderr, timed_out}`）
- **不改** sandbox gateway、`agent-contracts`、recipe DSL 节点类型名和字段名

## Capability 影响(Capabilities)

### 修改的 Capability

- `workflow-capability-node-handlers`：`python` 节点的参数注入和输出处理语义

### 新增 Capability

无。

## 影响范围(Impact)

- `agent-workflow`：`executePythonNode`（参数注入逻辑）、输出处理 helper（替代 `expandStdoutJsonFields` 的 print 行解析）、相关单元/集成测试
- 不影响 `agent-capability`、`agent-platform-gateway-*`、`agent-contracts`、`agent-runtime`

## 职责边界对齐(Boundary Alignment)

- `agent-capability`（python-tool）：继续 owner sandbox 执行、stdout/stderr 收集、timeout、guardrail（nl2py）；本 change 不改其 input/output contract
- `agent-platform-gateway-local`（restricted-local-sandbox）：继续 owner 进程隔离、路径校验、环境变量；本 change 不涉及
- `agent-contracts`：本 change 不修改任何 contract；workflow node-specific schema 仍由 change owner 在 `agent-workflow` 定义，`agent-contracts/core` 的 `WorkflowNodeDef.inputs/outputs` 仍为 opaque 容器
- `agent-runtime`：继续 owner request lifecycle、cancel、checkpoint；本 change 只定义单节点 handler 语义

## 归档前基线(Baseline Promotion Plan)

- `openspec/specs/workflow-capability-nodes/spec.md`：更新 `Python Node` requirement，补充 `param_to_json_str` 输入语义和 print 输出处理语义；保留 `Sandbox Only` scenario

## 验证入口(Validation)

- Unit test：普通模式各类型注入（null/boolean/数字/数字字符串/字符串/对象/数组）、JSON 字符串模式注入、跳过 `script` 和 `param_to_json_str`
- Unit test：0/1/N 条 print 输出处理、合法 JSON 对象/数组解析、非 JSON 保持原字符串
- Integration test：`python` 节点端到端产出 `python_result` 纯结果，后续节点可引用
- Regression：现有 `python` 节点测试更新以反映新语义（`exit_code`/`stdout` 不再出现在 `python_result` 中）
