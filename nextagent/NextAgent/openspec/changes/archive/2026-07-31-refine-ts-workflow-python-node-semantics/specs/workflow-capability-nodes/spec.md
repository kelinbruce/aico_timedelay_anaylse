# workflow-capability-nodes Specification

## Purpose
TBD - created by archiving change add-ts-workflow-capability-nodes. Update Purpose after archive.

## MODIFIED Requirements

### Requirement: Python Node

`python` MUST 通过 sandbox gateway 执行脚本，并按 print 输出条数产出纯结果。

**触发机制：**
- 节点 ready 时触发

**输入与前置条件：**
- `script`（必填）：Python 脚本内容，缺失或为空则报错终止
- `param_to_json_str`（可选，默认 `false`）：是否将参数值统一序列化为 JSON 字符串并用 `r'''...'''` 三引号包裹注入
- 其他自定义参数：注入为 Python 变量（跳过 `script` 和 `param_to_json_str`）
- sandbox gateway 可用

**参数注入语义：**

当 `param_to_json_str=false`（默认，普通模式）时，按参数值类型生成 Python 原生字面量：

| 参数值类型 | Python 变量赋值形式 |
|-----------|-------------------|
| `null` / `undefined` | `None` |
| `true` | `True` |
| `false` | `False` |
| 数字（整数、浮点数） | 原样输出 |
| 数字字符串 | 原样输出，不加引号 |
| 其他（字符串、对象、数组） | JSON 序列化 |

当 `param_to_json_str=true`（JSON 字符串模式）时，所有参数值统一序列化为 JSON 字符串并用 Python 原始三引号字符串包裹：`key=r'''JSON序列化值'''`。

变量赋值代码拼接到用户 `script` 头部，`script` 和 `param_to_json_str` 不作为变量注入。

**输出与副作用：**
- `python_result`：按 print 输出条数解析的纯结果
- `invocation_trace`：capability 调用摘要

**输出处理语义：**

脚本执行返回 stdout 原始字符串。按换行分割近似 print 输出条数：

- 0 条 print 输出 → `python_result = null`
- 1 条 print 输出 → `python_result = 该条解析结果`（合法 JSON 对象/数组则解析，否则保持原始字符串）
- 多条 print 输出 → `python_result = 列表`，每条按上述规则分别解析

`python_result` MUST NOT 包含 `exit_code`、`stderr`、`timed_out` 或 `_trace` 等执行元数据。

**核心判断逻辑：**
1. 校验 `script` 非空
2. 读取 `param_to_json_str`，跳过 `script` 和 `param_to_json_str` 取变量输入
3. 按模式生成变量赋值代码，拼到 `script` 头部
4. 通过 sandbox gateway 执行完整脚本
5. 从返回 stdout 按 print 输出条数解析并产出 `python_result`

**失败与降级：**
- `script` 缺失或空 → 明确失败
- sandbox denial / timeout → 明确失败

#### Scenario: Sandbox Only
- **WHEN** `python` 节点执行
- **THEN** 系统 MUST 通过 sandbox gateway 执行
- **AND** MUST NOT 直接使用宿主进程权限

#### Scenario: Param Injection Normal Mode
- **WHEN** `python` 节点输入 `script="print(x)"` 且 `x=10`（`param_to_json_str` 未设置）
- **THEN** 注入代码 MUST 生成 `x=10`
- **AND** `python_result` MUST 为 `10`（单条 print，数字字符串解析）

#### Scenario: Param Injection JSON String Mode
- **WHEN** `python` 节点输入 `param_to_json_str=true` 且参数 `x={"k":"v"}`
- **THEN** 注入代码 MUST 生成 `x=r'''{"k":"v"}'''`

#### Scenario: Reserved Keys Not Injected
- **WHEN** `python` 节点输入包含 `script` 和 `param_to_json_str`
- **THEN** `script` 和 `param_to_json_str` MUST NOT 作为 Python 变量注入

#### Scenario: Single Print JSON Object Result
- **WHEN** 脚本 print 输出一条合法 JSON 对象 `{"a":1}`
- **THEN** `python_result` MUST 为 `{a:1}`（解析为对象，不包装为数组）

#### Scenario: Multiple Print Results
- **WHEN** 脚本 print 输出多条（如 `["a", "b"]`）
- **THEN** `python_result` MUST 为列表，每条分别解析

#### Scenario: No Print Output
- **WHEN** 脚本无 print 输出
- **THEN** `python_result` MUST 为 `null`

#### Scenario: Result Excludes Execution Metadata
- **WHEN** `python` 节点完成
- **THEN** `python_result` MUST NOT 包含 `exit_code`、`stderr`、`timed_out` 或 `_trace`
