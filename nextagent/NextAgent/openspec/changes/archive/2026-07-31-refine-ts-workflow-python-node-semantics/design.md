## 上下文(Context)

`python` 节点由 `agent-workflow/src/nodes/capability-nodes.ts` 的 `executePythonNode` 实现。它把节点输入参数拼成变量赋值代码，拼到用户 `script` 头部，经 `Python` capability（`agent-capability/src/builtins/python/python-tool.ts` → `sandbox.runPython`）执行，再处理返回结果写入 `python_result`。

当前实现与目标 PythonNode 语义在参数注入和输出处理两处不一致，需对齐。

## 目标和非目标(Goals / Non-Goals)

**目标：**
- `python` 节点参数注入支持 `param_to_json_str` 开关，分普通模式和 JSON 字符串模式
- `python` 节点输出处理按 print 输出条数产出纯结果（0→null / 1→该条 / N→列表）
- `python_result` 只包含 print 解析结果，不混入执行元数据

**非目标：**
- 不改 `Python` capability 的 input/output schema（仍是 `code`/`args` → `exit_code`/`stdout`/`stderr`/`timed_out`）
- 不改 sandbox gateway 的执行隔离、路径校验或环境变量逻辑
- 不改 recipe DSL 节点类型名（`PYTHON`）或字段名（`script`、`param_to_json_str`）
- 不在 sandbox contract 层引入"按 print 调用次数"的精确计数（sandbox 只返回 stdout 原始字符串）
- 不暴露 `exit_code`/`stderr` 到 `python_result`（这些是执行元数据，recipe 关心的是脚本计算结果；`invocation_trace` 已作为独立 output 保留）

## 设计决策(Decisions)

### D1：`param_to_json_str` 解析与保留 key 跳过

- 从 `inputs` 读取 `param_to_json_str`，用 `coerceBoolean` 解析，默认 `false`。
- 变量注入时跳过 `script` 和 `param_to_json_str` 两个 key（当前只跳过 `script`，会把 `param_to_json_str` 误注入为变量）。
- 入口：`executePythonNode`。主 owner：`agent-workflow`。

### D2：普通模式类型化字面量（`param_to_json_str=false`，默认）

按参数值类型生成 Python 原生字面量，不再统一用 `JSON.stringify`：

| 参数值类型 | Python 变量赋值形式 |
|-----------|-------------------|
| `undefined` / `null` | `None` |
| `true` | `True` |
| `false` | `False` |
| 数字（整数、浮点数） | 原样输出（`10`、`3.14`） |
| 数字字符串（`/^-?\d+(\.\d+)?$/`） | 原样输出，不加引号（`"42"` → `42`） |
| 其他（字符串、对象、数组） | `JSON.stringify` 后原样（字符串带双引号、对象/数组为 JSON） |

理由：当前 `JSON.stringify` 产出 `null`/`true`/`false`，Python 解释器会把它们当作未定义名称报 `NameError`；数字字符串被包成 JSON 字符串后失去"原样数字"语义。按类型映射是修正而非新增能力。

### D3：JSON 字符串模式（`param_to_json_str=true`）

所有参数值统一 `JSON.stringify` 后用 Python 原始三引号字符串包裹：`key=r'''JSON序列化值'''`。

理由：`r'''...'''` 是 Python 原始字符串，不会被转义序列干扰；三引号避免值内含单引号时截断。用户脚本可对变量做 `json.loads(x)` 拿到结构化值。

### D4：输出按 stdout 行分割近似 print 输出条数

- sandbox（python-tool）返回 `stdout` 为原始字符串（所有 print 输出拼接），无法区分单次 print 调用。
- 在现有 contract 下的最小增量：按 `\n` 分割 stdout，过滤末尾空行（print 默认 `end='\n'`，末行后有空换行）。
- 边界：`print("a\nb")` 会产出 `a\nb\n`，分割为 `["a","b"]` 两条——这是 sandbox contract 限制，无法在不改 python-tool 的前提下区分。本 change 接受这一近似，不改 python-tool contract。
- 解析规则：每条尝试 `JSON.parse`；合法 JSON 对象/数组则解析为对应 JS 值；非法则保持原字符串。

### D5：`python_result` 纯结果，不混入执行元数据

- 0 条 print 输出 → `python_result = null`
- 1 条 → `python_result = 该条解析结果`（对象/数组/字符串）
- N 条 → `python_result = [条1, 条2, ...]`（列表，每条分别解析）
- `exit_code`/`stderr`/`timed_out` 不再出现在 `python_result` 中。
- `invocation_trace` 继续作为独立 output variable 保留（当前已有）。
- 向后兼容性：现有 recipe 中 `${python_result.alarm_count}`（依赖 stdout JSON 字段展开）在单条 `print('{"alarm_count":3}')` 场景下仍可用（单条 JSON 解析为对象后字段可投影）；`${python_result.exit_code}` / `${python_result.stdout}` 将不再可用，需更新引用方。当前仓内 recipe 与测试未依赖 `python_result.exit_code`/`stdout` 字段。

### D6：不改 `Python` capability contract

- `python-tool.ts` 的 `inputSchema`（`code`/`args`/`timeout_ms`）和 `outputSchema`（`exit_code`/`stdout`/`stderr`/`timed_out`）保持不变。
- workflow 层继续把拼接好的完整脚本放进 `code` 字段，`args` 传空数组。
- sandbox 执行、guardrail（nl2py）、timeout、stdout/stderr 截断逻辑全部不动。

## 当前代码基线与最小增量(Current State / Delta / Verification)

### Current State

- `executePythonNode`（`agent-workflow/src/nodes/capability-nodes.ts`）：
  - 校验 `script` 非空
  - `omitKeys(inputs, ["script"])` 取变量输入
  - `${key} = ${value === undefined ? "None" : JSON.stringify(value)}` 拼接赋值（带空格的 `key = value`，用 `JSON.stringify`）
  - 调 `Python` capability，`args` 传 `[]`
  - `expandStdoutJsonFields(capabilityResultPayload(result, trace))` 处理输出
  - `projectNodeOutputs` 映射 `python_result` 和 `invocation_trace`
- `expandStdoutJsonFields`（`agent-workflow/src/nodes/shared.ts`）：
  - 若 `stdout` 是合法 JSON 对象/数组，把顶层字段/元素展开到 payload 顶层（不覆盖 `exit_code`/`stdout`/`stderr`/`timed_out`/`_trace`）
  - 若 stdout 非 JSON 但有多行，按行 JSON.parse 展开为数字索引字段
  - payload 始终保留 `{exit_code, stdout, stderr, timed_out, _trace}`
- `python-tool.ts`（`agent-capability`）：返回 `{exit_code, stdout, stderr, timed_out}`，不动。

### Delta

1. `executePythonNode` 参数注入：
   - 读取 `param_to_json_str`（`coerceBoolean`，默认 `false`）
   - `omitKeys(inputs, ["script", "param_to_json_str"])` 取变量输入
   - 普通模式：按 D2 类型映射生成 `key=value`（紧凑无空格）
   - JSON 字符串模式：按 D3 生成 `key=r'''...'''`
   - 赋值块以 `\n` 连接，末尾加 `\n`，再拼用户 `script`
2. `executePythonNode` 输出处理：
   - 替换 `expandStdoutJsonFields` 为新的 `resolvePythonResult` helper
   - 从 capability payload 取 `stdout`（string），按 D4 分割为行数组
   - 按 D5 规则产出 `python_result`（null / 单条 / 列表）
3. `shared.ts`：
   - 新增 `resolvePythonResult(payload: JsonObject): unknown`（或类似签名）
   - `expandStdoutJsonFields` 和 `reservedPythonResultKeys` 若仅被 `executePythonNode` 使用则移除；若被其他路径引用则保留并在 design 中标注（当前确认仅 `executePythonNode` 引用）
4. 测试更新：`workflow-capability-nodes.test.ts` 中 python 相关用例更新断言（`python_result` 不再含 `exit_code`/`stdout`）

### Verification

- `npm run build`
- `npm test`（agent-workflow 相关用例）
- `npm run test:contract`
- `npm run lint:architecture`
- `openspec validate --all --strict`

## 跨 Change 边界矩阵(Cross-Change Boundary Matrix)

- `add-ts-workflow-capability-nodes`（已归档）：定义了 `python` 节点的初始 owner 和 sandbox-only 契约；本 change 只修改其参数注入和输出处理语义，不新建 capability path、registry 或 dispatch
- `agent-capability`（python-tool）：继续 owner sandbox 执行契约；本 change 不改其 input/output schema
- `agent-platform-gateway-local`（restricted-local-sandbox）：继续 owner 进程隔离；本 change 不涉及
- `agent-contracts`：本 change 不修改任何 contract

## 触发机制(Trigger)

- 当 `python` 节点 ready 时由 engine 触发（不变）
- 节点启动同步调度，sandbox 调用异步等待（不变）
- 受 request/node timeout、cancel、retry 控制（不变）

## 输入和前置条件(Inputs / Preconditions)

- 节点 `inputs`：`script`（必填）、`param_to_json_str`（可选，默认 `false`）、其他自定义参数
- 当前 execution `contextVariables`
- `Python` capability（sandbox gateway）可用

## 输出和副作用(Outputs / Side Effects)

- `python_result`：print 输出解析后的纯结果（null / 单条 / 列表）
- `invocation_trace`：capability 调用摘要（不变）
- side effect：sandbox 内脚本执行（不变，可追溯）

## 核心判断逻辑(Core Decision Logic)

1. 校验 `script` 为非空字符串（不变）
2. 读取 `param_to_json_str`，跳过 `script` 和 `param_to_json_str` 取变量输入
3. 按模式生成变量赋值代码，拼到 `script` 头部
4. 调 `Python` capability 执行完整脚本
5. 从返回 payload 取 `stdout`，按行分割近似 print 输出条数
6. 按 0/1/N 规则解析并产出 `python_result`

## 状态 / 产物契约(State / Artifact Contract)

- `python_result`：print 解析结果（null / 标量 / 对象 / 数组 / 混合列表）；不再包含执行元数据
- `invocation_trace`：`{capabilityId, executionId, nodeId, retryCount}`（不变）

## 流程集成(Flow Integration)

- 上游：gateway / llm / knowledge / interaction 节点输出
- 下游：任意消费 `python_result` 的节点

## 失败和降级(Failure / Degradation)

- `script` 缺失或空 → `WORKFLOW_NODE_INPUT_INVALID`（不变）
- sandbox denial / timeout → `capabilityResultPayload` 抛 safe error（不变）
- `Python` capability 不可用 → `WORKFLOW_CAPABILITY_BOUNDARY_UNAVAILABLE`（不变）
- stdout 为空 → `python_result = null`（新行为）

## 验收示例(Acceptance Examples)

- 普通模式注入：`script: "print(x)"`, `x: 10` → 变量赋值 `x=10` → `python_result = 10`（单条 print，数字字符串解析）

  > 注：`print(10)` 输出 `"10"`，按 D4 行分割得 `["10"]`，单条尝试 `JSON.parse("10")` 得 `10`。

- JSON 字符串模式：`param_to_json_str: true`, `x: {"k":"v"}` → 变量赋值 `x=r'''{"k":"v"}'''`
- 单条 JSON 对象：`script: "print(json.dumps({'a':1}))"` → stdout `'{"a":1}'` → `python_result = {a:1}`
- 多条 print：`print("a"); print("b")` → `python_result = ["a", "b"]`
- 无 print：`python_result = null`
- 失败路径：sandbox denial → 节点 FAILED，safe error 透传
