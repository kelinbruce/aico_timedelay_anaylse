## 背景与问题（Why）

当前主 Agent loop 已能从 provider-neutral `ModelFinalResult.finishReason` 识别 `length`，但 `agent-core` 未对该终止原因执行恢复：只要模型返回了非空文本且没有 Tool call，就会把被输出 Token 上限截断的内容当作完整回答提交。电信网络查询可能需要消费较大的配置或性能结果并完成聚合分析，固定较小的 `maxOutputTokens` 会使回答停在半句、未完成的枚举或重复退化文本中，同时请求仍错误地以成功结束。

系统必须把“provider 已明确报告输出长度耗尽”和“内容超过平台硬安全字符上限”区分开：前者是可恢复的模型调用状态；后者必须停止继续消费超限输出，但不能因此把已经生成且仍处于安全容量内的用户可见内容全部丢弃。本 change 同时避免把已知不完整输出静默提交为完整回答，以及在容量保护生效时只留下通用失败信息。

## 变更范围（What Changes）

- `agent-core` 在模型调用返回 `finishReason="length"` 时，不得进入 terminal commit 或执行可能不完整的 Tool call。
- 同一 model round 首次命中输出 Token 上限后，使用同一模型、同一消息和同一工具集合重试一次，并把 `maxOutputTokens` 提升到受模型上下文窗口、平台可见输出硬上限和实现固定上限共同约束的恢复预算。
- 提升预算后的结果仍为 `length` 且只包含文本时，把该段 assistant 文本和一条隐藏的直接续写指令加入本次 request-local 模型上下文，最多继续 3 次；续写内容按顺序拼接为一个最终回答，不持久化中间恢复消息。
- 任一恢复调用正常完成时，沿用现有 terminal 或 Tool loop 路径；恢复耗尽或恢复阶段出现 Tool call 时，发布安全降级信号并以 `REQUEST_FAILED` 结束，不提交截断回答。
- 恢复调用继续传播当前 `AbortSignal`、timeout、Agent Scope、Owner Scope 和已冻结模型路由，不新增 provider-specific 分支、配置字段、Web API、stream event 或公共 contract。
- 将 direct model 可见文本硬上限与 runtime 已有的 `150000` 字符 terminal 上限对齐，使提升后的输出预算具有可用空间；超过该硬上限时立即停止本次模型输出，发布安全降级信号，并提交带明确截断标记且总长仍不超过该上限的有界前缀。超出上限的后缀、未完整形成的 Tool call 和 provider 原始事实不得进入 stream 或 history。
- 不处理 Qwen、`<think>` 标签、reasoning/content 分离、默认 thinking 配置或 provider stream-normalizer 行为。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-4.1 调用模型`：canonical spec 为 `model-invocation-contract`，本 change 触及 legacy spec `ts-minimal-agent-kernel` 中的模型输出超限行为；增加 provider 报告 `finishReason="length"` 时的受限自动恢复语义，并把 direct model 硬字符上限从整段失败收敛为显式、有界且可观察的截断交付。变化涉及性能/容量、可靠性/恢复和安全质量属性，不改变公共模型调用 contract。

## 影响范围（Impact）

- 生产代码：`packages/agent-core/src/agent/default-agent.ts` 与其模型输出恢复 helper、`packages/agent-core/src/model/output-guard.ts`。
- 测试：`packages/agent-core/tests/` 增加正常完成、预算提升、三次续写、恢复耗尽、Tool call fail-closed、取消传播和硬字符上限有界交付用例；既有 output guard 黑盒测试同步断言保留前缀、截断标记、后缀不泄漏和 request terminal 一致性。
- 公共 API/contract：无变更；复用现有 `ModelFinishReason`、`ModelInvocationRequest.maxOutputTokens`、`ModelMessage`、`DEGRADATION_NOTICE` 和 safe failure 路径。
- 配置与依赖：不新增配置项，不修改默认 model profile，不新增依赖。
- 运维与安全：model invocation timeline 会自然记录每次恢复调用；日志和降级事件只包含稳定 reason code、次数和低基数预算值，不包含 prompt、模型输出或 provider raw payload。
