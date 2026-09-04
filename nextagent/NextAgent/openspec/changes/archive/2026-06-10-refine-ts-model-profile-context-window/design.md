## Contract Decisions

### Context Window Field

`agent-contracts/app.ModelProfile` gains one field:

```ts
interface ModelProfile {
  readonly profileId: string
  readonly providerKind: ModelProviderKind
  readonly modelName: string
  readonly baseUrl: string
  readonly credentialRef: SecretReference
  readonly timeoutMs: number
  readonly modelOptions: ModelOptions
  readonly providerOptions: ModelProviderOptions
  readonly contextWindowTokens: number   // 新增：模型上下文窗口容量（token）
  readonly enabled: boolean
  readonly fallbackEligible: boolean
}
```

窗口是模型固有容量事实，跟模型标识（provider / model）放在一起。它由 `assemble()` 从 accepted model profile 解析，作为预算计算的 selected model window。

### Why Not ModelOptions or ContextAssemblyRequest

- `ModelOptions`：放的是 agent 作者的行为偏好（temperature / maxTokens / topP / thinking）。`maxTokens` 是**输出**上限，与上下文窗口是不同维度，不能复用。
- `ContextAssemblyRequest`：冻结契约用否定测试禁止 `budget` 进入该请求；窗口同理不能由客户端请求携带。

## Rejected Alternatives

- 复用 `ModelOptions.maxTokens` 表达窗口：拒绝，因为它语义是输出上限，混用会让"输入预算"和"输出上限"耦合。
- 把窗口放进 `ContextAssemblyRequest`：拒绝，预算输入不能由客户端请求携带。
- 新建独立的 model-capability 查找表：拒绝，窗口就该贴着它描述的那个 profile，避免同一模型事实拆到两处。
