## 背景和现状（Context）

Python capability 的 input schema 当前只有 `code`（必填）、`args`、`timeout_ms`。workflow 引擎在执行 `python` 节点时，将节点输入中非 `script` 的参数注入为 Python 变量声明，拼接到 `code` 字段前面，作为一个整体字符串发送。

guardrail 的 nl2py 检查在 `executePython` 中对 `code` 执行 `checkNl2Python({ content: code })`。由于变量声明已拼进 `code`，preamble 中的 JSON 数据（知识检索结果、对象/数组参数）会被 guardrail 看到并误判为不安全代码。

## 目标和非目标（Goals / Non-Goals）

**目标：**
- 将变量声明（preamble）与用户脚本（code）在 Python capability input 中分离
- guardrail 只检查 `code`，不检查 `preamble`
- sandbox 执行时将 `preamble` 拼接到 `code` 前，保持执行行为不变

**非目标：**
- 不改变 `param_to_json_str` 双路径的序列化逻辑
- 不改变 `toPythonLiteral` / `resolvePythonResult` 的行为
- 不改变 guardrail 的检查规则或 RobotRouter 端点
- 不改变 sandbox 执行的 command 格式（仍是 `preamble + "\n" + code`）

## 设计决策（Decisions）

1. `preamble` 作为 Python capability input schema 的可选 `string` 字段，而非新设独立 capability 或新 contract type。理由：preamble 是 code 的执行前置，不是独立语义实体；用可选字段避免破坏现有调用方。

2. `guardrail-gateway` spec 现有描述 `content: "<python 代码>"` 已排除 preamble——preamble 是由 workflow 引擎可信生成的变量声明，不是用户编写的 python 代码，不进入 nl2py 安全检查范围。本次修复使实现回归 spec 意图，无需修改 guardrail-gateway spec。

3. workflow `python` 节点构建 `{ code: inputs.script, preamble: declarations.join("\n") }`，不再拼接。当无变量声明时不传 `preamble`。

4. `preamble` 为空字符串时视为未传（`trim().length > 0` 检查），避免发送空 preamble 到 sandbox。

## 跨 Change 边界

- `add-ts-workflow-capability-nodes`：继续 owner python 节点的 `param_to_json_str` / 变量注入序列化语义；本 change 只改变变量声明的传递方式（拼接到 code → 独立 preamble 字段）
- `python-tool` stable spec：本 change 增量修改 input schema requirement

## 触发机制

- 当 python capability 被调用且 input 含 `preamble` 字段时
- 当 workflow python 节点有非 `script`/`param_to_json_str` 输入参数时

## 输入与前置条件

- `code`：必填，用户 Python 脚本
- `preamble`：可选，可信的变量声明文本，由 workflow 引擎生成
- guardrail 和 sandbox 的可用性不变

## 输出与副作用

- 执行行为不变：sandbox 仍执行 `preamble + "\n" + code`
- guardrail 行为变更：只检查 `code`，preamble 数据不再进入安全检查
- 无新增 side effect

## 核心判断逻辑

1. 读取 `code`（必填校验不变）
2. 读取 `preamble`（可选，空字符串视为未传）
3. guardrail 检查：`checkNl2Python({ content: code })`，不含 preamble
4. sandbox 执行：`command = preamble !== undefined ? preamble + "\n" + code : code`
## 长期基线刷新计划

归档前需要同步以下 stable spec：

- `openspec/specs/python-tool/spec.md`：将 `preamble` 字段合并到 "Python tool accepts code snippet input" requirement 的 input schema 描述中
- `openspec/specs/workflow-capability-nodes/spec.md`：将 preamble 分离语义合并到 "Python Node" requirement 的参数注入描述中

无 Feature、architecture、module、ADR 或 spec-to-design-map 需要更新。
