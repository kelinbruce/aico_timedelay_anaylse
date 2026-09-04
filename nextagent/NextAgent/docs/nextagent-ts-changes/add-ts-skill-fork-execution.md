# add-ts-skill-fork-execution

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：Tool / Skill execution

状态：candidate
类型：扩展候选 change
主要 owner：`agent-capability`、`agent-core`、`agent-context-engine`
依赖：`add-ts-skill-tool`、`add-ts-skill-manifest-contract`、`add-ts-skill-resource-access`、`add-ts-model-invocation-contract`、`add-ts-capability-core-governance`

目标：
- 补齐 Skill manifest `context=fork` 的执行形态，使 Skill 可在独立受控上下文中执行模型循环和受限工具调用。
- 保持 `context=inline` 作为默认行为；fork Skill 不改变父 Agent 的 assembly、session 配置、capability catalog 或 prompt profile。
- fork 执行结果以安全、有限的 `CapabilityInvocationResult` 回流父 run，必要时通过 `generatedMessages`、`structuredPayload`、`resultRef` 或 `artifactRefs` 表达。

规格输入：
- `context=fork` 必须来自已治理 Skill manifest，不得由模型输出、Tool 参数或客户端 metadata 临时提升。
- fork Skill 执行必须使用独立 Skill execution context，只接收当前 run 中被授权的安全 handoff facts：Skill instructions、Skill resources、用户当前任务摘要、locale、预算、允许工具集、模型配置补丁和必要的 safe context。
- fork context 不得直接继承父 Agent 的 raw prompt、raw model output、raw tool args/result、checkpoint、flowVariables、provider-private metadata、credential、workspace physical path 或未经授权附件内容。
- `allowed-tools` / `denied-tools` 必须在当前 Agent 已授权能力集合内收窄，不得扩大父 run capability authority。
- fork Skill 可执行内部模型循环，但不得创建 `RequestRun`、写 canonical timeline、提交 terminal message 或拥有 runtime lifecycle；父 run 的 runtime lifecycle 和 terminal commit 仍由 `agent-runtime` 拥有。
- fork Skill 必须接收父 capability invocation 的 `AbortSignal`、timeout 和 idempotency/replay 约束；取消、超时和失败必须收敛为 safe capability result。
- fork Skill 的结果必须经过安全映射：不得泄漏 raw prompt、Skill source private path、managed install path、sandbox path、secret、credential、raw provider error 或高基数字段。
- nested invocation 首版默认 fail closed：fork Skill 内部不得再次执行 `skill` 或 `Agent` capability，除非后续 change 明确定义 nested policy、预算和审计边界。

实现约束：
- `agent-capability` 负责识别 governed Skill descriptor、manifest `context=fork`、resource projection 和 Tool result shape。
- `agent-core` 负责 fork 内部模型循环和 tool-loop 编排的目标语义；不得在 capability source 或 sandbox 中复制 Agent routing policy。
- `agent-context-engine` 负责 fork Skill prompt/input 的安全上下文装配和预算裁剪。
- `agent-runtime` 只承载父 run lifecycle、cancellation 和 capability invocation 边界，不为 fork Skill 创建新的 request lifecycle state machine。

非目标：
- 不重新定义 Skill manifest 格式、Skill source discovery、SkillHub package install 或 Skill resource projection。
- 不实现动态 Skill hot reload、远端 Skill runtime、Skill marketplace 或 package trust chain。
- 不定义任意 nested Skill/Agent 调用策略。
- 不定义 workflow recipe 或 Agent 内部 routing。

验收要点：
- Contract：`context=fork` Skill 不改变默认 inline Skill 行为。
- Security：fork context 不包含 raw prompt、raw model output、credential、provider-private metadata 或 source private path。
- Authorization：`allowed-tools` / `denied-tools` 只能收窄当前 Agent 已授权工具集合。
- Runtime boundary：fork Skill 不创建 `RequestRun`、不写 canonical timeline、不提交 terminal message。
- Resilience：timeout/cancel/storage/model failure 都返回 safe capability result，父 run 仍由 runtime 按既有规则终结。
- Architecture：source discovery、resource projection、fork model loop、runtime lifecycle owner 边界清晰，禁止 private path import。

并行边界：
- 本 change 依赖 `add-ts-skill-tool` 提供受控 Skill tool entry。
- 不得修改 `SubmitRequestCommand`、`RequestRun`、SessionMessage terminal commit 或 Agent Scope 解析。
- 若需要改变 capability invocation result shape，必须先提出 contract refinement change。
