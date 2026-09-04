# Prompt Template Complete Selection

## Status

Accepted

## Context

System prompt、summary generation、memory extraction 和后续自定义 prompt consumer 都需要可治理的 prompt customization。旧的 profile/loader chain 容易把 template 选择、model selection、partial merge 和 request-path file loading 混在一起，导致 ownership 不清晰，也难以验证 prompt text 的可信来源。

## Decision

Prompt template assembly 选择一个完整 template 作为主 template。Template selection 由 `agent-context-engine` 内部 `PromptTemplateAssembler` 负责，输入只来自 frozen registry facts 和 context-engine 安全投影的 request/model facts。

Agent package templates 可以覆盖 builtin templates；当选中 Agent template 缺少某些 sections 时，可以从唯一最佳匹配的 builtin template 按 section 补齐。除此之外，系统不得把多个 template 的任意文本片段合并为一个 prompt。

`modelOptions` 只作为 prompt assembly 的 override handoff 返回。最终模型选择、模型参数合并和 provider option 合并由 context-engine/model invocation assembly 拥有，不由 prompt renderer 执行。

## Consequences

这个决策牺牲了任意 partial layering 的灵活性，换取确定性、安全审计和较小的 public contract surface。Prompt template 类型、assembler 和 registry 留在 context-engine implementation boundary；`AgentAssembly` 和 `agent-contracts/context` 不承载 template refs、prompt text 或 public prompt assembly DTO。

如果未来确实需要跨 template 组合，必须先新增 OpenSpec change，定义可验证的 merge owner、merge 粒度、conflict 规则、安全日志和负面测试。
