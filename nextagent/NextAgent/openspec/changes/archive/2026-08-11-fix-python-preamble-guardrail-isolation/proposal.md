## 背景与问题（Why）

Python 节点执行前，workflow 引擎将非 `script` 的输入参数注入为 Python 变量声明（preamble），拼接到 `code` 字段中一并发送给 nl2py guardrail 检查。preamble 包含大量 JSON 序列化的业务数据（如知识检索结果），被 guardrail 误判为不安全代码而拦截（`NL2PY_GUARD_BLOCKED`），导致 Python 节点无法正常执行。

根因：preamble 是由 workflow 引擎可信生成的变量声明，不是用户编写的 Python 代码，不应进入 guardrail 的代码安全检查范围。

## 变更范围（What Changes）

- **新增** `preamble` 字段到 Python capability input schema，作为可选的变量声明文本
- **修改** Python capability 执行逻辑：guardrail 只检查 `code`，不检查 `preamble`；sandbox 执行时将 `preamble` 拼接到 `code` 前面。`guardrail-gateway` spec 现有描述 `content: "<python 代码>"` 已排除 preamble（preamble 是可信变量声明，不是 python 代码），无需修改 guardrail-gateway spec
- **修改** workflow `python` 节点：变量声明从拼进 `code` 改为放到 `preamble` 字段，`code` 只放原始 `script`
- **保留** `param_to_json_str` 双路径（普通模式 / JSON 字符串模式）不变，仅改变变量声明的传递方式

## Function 影响（OpenSpec Capabilities）

- 修改 Function `FN-5.5 执行命令和脚本`（`python-tool`）：Python capability input schema 新增可选 `preamble` 字段，guardrail 只检查 `code` 不检查 `preamble`；涉及安全。
- 修改 Function `FN-9.4 执行能力节点`（`workflow-capability-nodes`）：workflow python 节点变量声明从拼进 `code` 改为独立 `preamble` 字段传递；涉及安全。

## 影响范围（Impact）

- `agent-capability`：`python-schemas.ts`、`python-tool.ts`
- `agent-workflow`：`capability-nodes.ts`

## 验证入口（Validation）

- Integration test：preamble 数据不进入 guardrail 检查（`checkNl2Python` 只收到 `code`）
- Integration test：sandbox 执行时 `preamble` 拼接到 `code` 前
- Integration test：workflow python 节点构建 `{ code, preamble }` 分离结构
- Existing test：guardrail blocked/passed/skipped 场景不回归
