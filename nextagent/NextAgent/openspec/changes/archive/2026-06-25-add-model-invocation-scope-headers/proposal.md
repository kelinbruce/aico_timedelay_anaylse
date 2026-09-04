## 背景与问题（Why）

Model provider 请求需要把稳定的 NextAgent 执行坐标放入 HTTP header，让下游 model gateway 无需检查 prompt 或模型可见消息，即可把流量关联到所属的 Agent session 和 run。

## 变更范围（What Changes）

- 为 `ModelInvocationRequest` 扩展可选的可信 `invocationScope`，携带 `agentId`、`sessionId`、`requestId` 和 `runId`。
- 在 Agent Core 展平渲染后的 model 输入时，从已 accepted 的 `RequestRun` 填充这些坐标。
- 新增 provider 出站 header：
  - `X-NextAgent-Agent-Id`
  - `X-NextAgent-Session-Id`
  - `X-NextAgent-Request-Id`
  - `X-NextAgent-Run-Id`
- 仅当 `invocationScope` 存在时发送这些 header；非法的入参 scope 会被安全拒绝。
- 保持这些标识符不进入 prompt 消息、tool 结果、safe error 和 provider 请求体。

## 影响范围（Impact）

- 受影响 contract：`agent-contracts/model`。
- 受影响实现：`agent-core` model 请求构建器和 `agent-model` OpenRouter provider 适配器。
- 不改变 Web API、stream event、持久化 schema、owner scope 或 Agent Scope 选择。

## 验证入口（Validation）

- `openspec validate --all --strict`
- `npm run build`
- 聚焦的 model provider 和 contract 测试
