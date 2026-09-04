## 背景与问题（Why）

附件上传与暂存边界已经单独规划，但“附件何时进入请求上下文、由谁触发、如何受预算约束、何时必须失败、何时允许降级、哪些结果要对用户可见”还没有被冻结为独立规格。

当前需要补齐的是 **attachment request context flow**，而不是上传协议、文件解析算法或存储实现。这个 change 只回答以下问题：

- 请求生命周期中，附件上下文由哪个主流程触发，发生在什么阶段；
- accepted request 的最终附件引用集由哪个 owner 写入哪一份权威 message fact，并供 retry/edit/cleanup 继续消费；
- 哪些附件可以进入当前请求上下文，哪些必须被拒绝或降级；
- 预算不足、附件不可用、读取失败或缺少受控投影时，系统如何显式处理；
- 附件上下文产物如何被 Context Engine、Model invocation 和 runtime-owned degradation notice 消费；后续压缩/summary/ref change 只能消费本 flow 的安全 decision 或已存在受控替代物。

## 变更范围（What Changes）

- 新增 `add-ts-attachment-request-context-flow` change。
- 修改 `add-ts-attachment-request-context-flow` 基线规格，冻结附件进入 request context 的生命周期、判断顺序、产物契约、durable attachment set ownership 和失败/降级语义。
- 在 design 中固定当前核心实现策略：`agent-runtime` 负责 request acceptance 前的 owner-scoped + agent-scoped 权威校验，`agent-context-engine` 在同步 context build 中重新解析并选择可消费附件上下文，`agent-attachment-runtime` 保持附件元数据、availability 与受控内容投影的唯一可信边界。

## 当前核心实现策略（Strategy To Freeze）

本 change 固定以下策略，不对未来代码目录或类级拆分施加约束：

1. 请求提交、retry latest、edit latest 的 accepted 路径都必须在 runtime admission 阶段先校验附件引用。
2. request acceptance 成功后，runtime/session owner 必须把本次 request 的最终附件引用集写入 immutable root user message 或等价唯一权威 message fact；retry latest、后续 context flow 和 cleanup 引用保护都只消费这份 durable set。
3. edit latest 的附件语义是“为新 request 生成最终附件引用集”，而不是“仅附加新附件”；旧 request 的附件集合不被隐式继承到新 request，除非它们出现在新 request 的最终 attachment set 中。
4. 附件上下文只在 Context Engine 的同步装配阶段消费，不依赖后台预展开 job。
5. Context Engine 对每个附件按固定规则判定为：
   - latest-request-critical
   - latest-request-optional
   - historical
   - excluded
6. `latest-request-critical` 判定必须基于请求绑定、owner scope、agent scope、availability、controlled projection 和同一 `attachmentId` 的等价受控替代物，不引入自由语义分类器。
7. latest-request-critical 附件上下文不能被静默移除、静默截断或静默降级。
8. 首版本地 release 只要求 Markdown 受控投影；summary/ref 生成、异步装配和非 Markdown 解析不属于本 change。
9. 历史附件和非关键附件允许在预算或读取失败时显式降级，但必须留下可解释 evidence，并在需要时投影用户可见 notice。

## 影响范围（Impact）

- `add-ts-attachment-request-context-flow`
- `agent-runtime` request admission / retry / edit 接口语义
- `agent-session` / runtime acceptance 侧 root message durable attachment set 语义
- `agent-context-engine` context build 与预算判断语义
- runtime-owned degradation / insufficient-context outcome projection
- `agent-attachment-runtime` 作为受控附件事实与 Markdown 投影可信边界

## 非目标（Non-Goals）

- 不定义 Word/PDF/Excel 的具体解析算法或 OCR 行为。
- 不定义附件长期清理、aging 或 retention 策略。
- 不定义新的独立附件 summary 生成流程。
- 不定义新的长期 ref 生成、异步附件装配或进度通知流程。
- 不引入代码结构、文件层级或未来 TSX 重写的实现约束。
