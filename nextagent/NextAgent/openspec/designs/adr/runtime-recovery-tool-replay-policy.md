# ADR: Runtime 恢复能力重放策略

## 状态

Accepted

## 背景

Tool/Capability invocation 在进程重启时处于 pending 状态时，重复执行会造成重复 side effect 风险。runtime 需要可审计、可重复判断的 replay policy。

## 决策

capability descriptor 暴露 replay policy，runtime 在 invocation 时写入 stable invocation anchor 或等价 durable fact。startup recovery 遇到 pending invocation 时，按 descriptor policy 和 durable anchor 决定复用结果、safe replay、skip 或 recovery failed。

non-idempotent capability 不得在没有 durable result 的情况下重复执行。

## 取舍

- 放弃 provider 自行决定 recovery，因为 provider 不拥有 request lifecycle。
- 放弃统一重放所有 capability，因为 non-idempotent tool 会重复 side effect。
- 放弃只靠 idempotencyKey 字符串，因为还需要 descriptor policy 和 durable invocation state。

## 后果

capability contract 必须表达 replay policy。runtime recovery 逻辑必须读取 durable invocation facts，并在无法证明安全时 fail closed。

## 验证

- pending idempotent/non-idempotent capability recovery tests。
- descriptor replay policy contract tests。
- non-idempotent pending invocation 不重复执行的 negative tests。
