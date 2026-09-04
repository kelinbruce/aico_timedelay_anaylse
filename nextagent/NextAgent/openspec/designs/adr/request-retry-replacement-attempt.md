# ADR: 请求重试替换尝试

## 状态

Accepted

## 背景

retry 需要让用户重新执行同一用户意图，同时保留旧 attempt 的审计事实，并让默认 conversation/history 只展示最新有效输出。

## 决策

retry 创建新的 request/run attempt，并把旧 attempt 标记为 replaced/hidden for default history。旧 attempt 的 message、timeline 和 capability facts 保留在 owner+agent scoped durable store 中，可通过明确 diagnostic/recovery path 读取。

runtime 拥有 retry command、attempt 创建、lane scheduling 和 idempotency。session 拥有默认可见 history 与 hidden audit read model。context engine 默认排除被替换 attempt 的输出。

## 取舍

- 放弃覆盖旧 message，因为会破坏审计和 recovery。
- 放弃把 retry 作为同一 run 的状态回退，因为 terminal/CAS 和 stream replay 会变得含糊。
- 放弃让 frontend 过滤旧 attempt，因为 public UI 不是 history truth。

## 后果

retry 后默认历史展示新的 replacement attempt。旧 attempt 仍可审计，但不进入默认 model-visible context。

## 验证

- retry 创建新 attempt/run 的 runtime tests。
- 默认 history 隐藏旧 attempt 的 session tests。
- hidden/audit query 和 context filtering tests。
