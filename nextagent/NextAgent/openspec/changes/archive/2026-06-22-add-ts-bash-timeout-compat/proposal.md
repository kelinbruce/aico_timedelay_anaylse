## 背景与问题（Why）

稳定的 `bash` tool contract 使用 canonical 字段 `timeout`，而独立新增的 `python` tool 使用 `timeout_ms`。实践中，模型的 tool 调用可能在调用 `bash` 时错误地沿用 `python` 风格的 timeout 命名，导致 schema 校验在命令策略或 sandbox 边界之前就失败。

作为第一步兼容性措施，我们需要一个最小风险修复，既保持稳定的 `bash` 公共形态，又接受模型最常产生的 timeout 别名。

## 变更范围（What Changes）

- 保持 `timeout` 作为 `bash` 的 canonical 公共 timeout 字段。
- 为 `bash` tool 输入新增可选别名 `timeout_ms` 的兼容支持。
- 若 `timeout` 和 `timeout_ms` 同时存在，`timeout` 保持权威。
- 归一化后的有效 timeout 语义不变：默认 `120000`，受可信调用 timeout 约束，上限 `600000`。

## 非目标（Non-Goals）

- 不把 `bash` 的 canonical 字段从 `timeout` 改名为 `timeout_ms`。
- 不改变独立的 `python` tool contract。
- 不扩展 `bash` 命令语法、allowlist、sandbox 权威或后台执行行为。
