- [x] 1. Python capability input schema 新增 `preamble` 字段
  - `python-schemas.ts`: `pythonInputSchema.properties` 新增 `preamble: { type: "string", description: ... }`
  验证：`tsc -b` 通过；schema 校验不拒绝含 preamble 的输入
  来源：proposal `变更范围`

- [x] 2. Python capability 执行逻辑分离 preamble 和 code
  - `python-tool.ts`: 读取 `input["preamble"]`（空字符串视为未传）
  - guardrail 检查只传 `code`，不传 `preamble`
  - sandbox 执行 `command` 改为 `preamble + "\n" + code`（preamble 存在时）
  验证：`tsc -b` 通过；现有 guardrail blocked/passed/skipped 测试不回归
  来源：proposal `变更范围`

- [x] 3. Workflow python 节点构建 preamble 分离结构
  - `capability-nodes.ts`: `executePythonNode` 变量声明从拼进 `code` 改为 `preamble` 字段
  - `code` 只放 `inputs.script`
  - 保留 `param_to_json_str` 双路径不变
  验证：`tsc -b` 通过；6 个 Python 节点测试断言 `code` 和 `preamble` 分离
  来源：proposal `变更范围`

- [x] 4. 补充 Python capability preamble 隔离 characterization test
  - `python-capability.test.ts`: 新增测试验证 `checkNl2Python` 只收到 `code`，`runPython` 收到 `preamble + code`
  验证：`vitest run packages/agent-capability` 通过
  来源：AGENTS.md 验证门禁 — 改 sandbox、安全时必须补 characterization test

- [x] 5. openspec validate --all --strict 通过
  验证：`openspec validate --all --strict` 0 errors
  来源：AGENTS.md OpenSpec 验证命令
