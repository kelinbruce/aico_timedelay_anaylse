# Proposal: Improve model-correctable Tool errors

## 背景（Background）

面向模型的 Tool 失败当前诊断质量不一致。某些
语义校验器返回可操作的消息，例如 Skill 的 forbidden-key
错误，而通用 JSON Schema 边界和若干 builtin 校验器把
不同的失败折叠成诸如 `Capability input failed
validation.` 的消息。模型可以在 `VALIDATION` 失败后继续，但泛化
消息无法指出它必须纠正什么，导致重复的非法调用。

## 变更范围（What Changes）

本 change 修改既有的 builtin Tool 框架；不新增
capability 类型或公开契约。

1. provider 中立的 Tool JSON Schema 校验路径返回对第一个可操作 schema
   违规的有界、确定性、模型可见的说明，不返回
   被拒绝的值。
2. Builtin 语义输入校验器在模型可以纠正下一次 Tool 调用的地方，
   用按字段或按约束的 safe message
   替换泛化校验消息。
3. 既有 error code、category、retryable 标志、Tool
   schema、执行授权和失败终止语义保持不变。
4. 授权、策略、内部、provider 响应、来源位置、
   路径、凭据、prompt、模型输出、附件内容和原始输入
   细节保持排除在模型可见错误之外。
5. Skill `args` 消费保持不变，并显式排除
   在本 change 之外。

## 原因（Why）

capability result 投影已经把 `SafeError.message` 作为
`safeError.errorMessage` 暴露给下一个模型轮次。使 safe 校验消息
可操作，让模型自然修复其参数，而不引入
基础设施重试循环，也不削弱校验。

## 影响范围（Impact）

- `agent-capability`：共享的 JSON Schema 诊断格式化、executor 输入
  失败投影和聚焦的 builtin 语义校验消息。
- `agent-core`：characterization 覆盖，证明详细 safe message 通过既有
  capability-result 投影保持模型可见。
- 测试：schema keyword 覆盖、builtin 负向用例、纠正循环
  行为和不泄漏断言。
- 不改变公开 Tool SPI shape，不新增 Tool metadata，不新增 Memory 或
  Skill 专属的 executor 分支。

## 非目标（Non-goals）

- 改变 capability contract、Tool metadata、JSON Schema、error code 或
  重试语义。
- 新增基础设施重试循环或持久化新的诊断状态。
- 泄露授权策略、文件系统 roots、被拒绝的原始值或
  provider/内部失败细节。
- 消费或渲染 Skill `args`。
