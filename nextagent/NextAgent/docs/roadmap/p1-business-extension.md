[返回 Roadmap V2](../nextagent-ts-change-roadmap-v2.md)

## P1 — 业务自定义/扩展机制

业务自定义与扩展能力：请求编辑、附件、pending input、子 Agent、路由、增强工具、长期记忆、质量门禁。

### Composition / Extension Refinement

| Change | 状态 | 目标 | 详情 |
|---|---|---|---|
| [`refine-ts-extension-registration`](../nextagent-ts-changes/refine-ts-extension-registration.md) | ready | 建立受控启动期 extension registration 机制，使 builtin capabilities、framework/reserved capability providers 和 model provider adapters 通过确定性 contribution manifest/registry 发现、校验和冻结；新增贡献不再要求修改中心硬编码注册列表，同时不引入运行时热加载、任意目录扫描或 import side-effect 自注册。 | [详情](../nextagent-ts-changes/refine-ts-extension-registration.md) |
| [`shrink-agent-app-to-composition-root`](../nextagent-ts-changes/shrink-agent-app-to-composition-root.md) | complete | 收缩 `agent-app` 为严格 composition root：只做配置加载、依赖注入和服务启动；memory、workflow、context、observability、capability、question、health 等业务策略由 owning package public factory 提供。 | [归档](../../openspec/changes/archive/2026-07-14-shrink-agent-app-to-composition-root) |
| [`refine-agent-app-composition-pipeline`](../nextagent-ts-changes/refine-agent-app-composition-pipeline.md) | ready | 在既有严格 composition root 内建立唯一 prepared-input/shared-core/module-entry pipeline，将Local/Remote/Test差异收敛为core前的host input projection，让全部public factory仅作为facade并恰好复用一个sync runner、一个canonical async runner和同一core；保留public sync compatibility surface，删除/废弃另立change。同时显式固定config后一次plugin snapshot load/validation/freeze及跨层消费，正交化channel auth/frontend hosting profile，按冻结selection→gateway→capability→runtime消费点分层cron装配，并按黑盒职责完整收敛local-auth、with-frontend typed finalization、local runtime package/private host facts、local gateway/workbench、37项test host、external hosts、typed deferred binding和composition failure cleanup；保持public contracts和产品能力不变。 | [详情](../nextagent-ts-changes/refine-agent-app-composition-pipeline.md) |

### Developer Experience / SDK

| Change | 状态 | 目标 | 详情 |
|---|---|---|---|
| [`add-ts-simple-agent-facade`](../nextagent-ts-changes/add-ts-simple-agent-facade.md) | candidate | 提供面向二次开发者的最小起步入口：`new SimpleAgent(instructions, tools, skills)` / `app.run(agent)`；内部编译为受治理的 Agent assembly、model profile、workspace policy 和 capability bindings，不绕过 app composition、Agent Scope、runtime lifecycle 或 capability governance。 | [详情](../nextagent-ts-changes/add-ts-simple-agent-facade.md) |

### 策略与治理

| Change | 状态 | 目标 | 详情 |
|---|---|---|---|
| [`add-ts-lifecycle-hook-execution`](../nextagent-ts-changes/add-ts-lifecycle-hook-execution.md) | complete | 支持系统内置 lifecycle hook definition、Agent hook binding、按阶段顺序执行、超时、decision/mutation 处理、safe error 和 hook invocation event。 | [详情](../nextagent-ts-changes/add-ts-lifecycle-hook-execution.md) |
| [`add-ts-risk-policy-enforcement`](../nextagent-ts-changes/add-ts-risk-policy-enforcement.md) | complete | 支持系统内置 risk policy 在 capability、sandbox、authorization/high-risk confirmation 等受限操作前执行；risk policy 使用自身接口，不依赖泛化 `PolicyPort`。 | [详情](../nextagent-ts-changes/add-ts-risk-policy-enforcement.md) |
| [`add-ts-skill-resource-access`](../nextagent-ts-changes/add-ts-skill-resource-access.md) | complete | 为授权 Skill resources 建立运行期安全访问路径：通过 execution file access policy 派生 `workspace/`、`.nextagent/`、`temp/` 三个物理 root，并让文件工具和 sandbox 只消费按需裁剪的 run workspace view。 | [详情](../nextagent-ts-changes/add-ts-skill-resource-access.md) |

### 附件

| Change | 状态 | 目标 | 详情 |
|---|---|---|---|
| [`add-ts-attachment-intake`](../nextagent-ts-changes/add-ts-attachment-intake.md) | complete | 按共同附件范围和限制接入 attachment runtime；仅启用 Markdown，未启用类型返回明确 safe error。 | [详情](../nextagent-ts-changes/add-ts-attachment-intake.md) |
| [`add-ts-attachment-request-context-flow`](../nextagent-ts-changes/add-ts-attachment-request-context-flow.md) | complete | Runtime 接受请求前校验 attachmentIds 并查询权威 RequestAttachment，Context Engine 只消费安全 descriptor、summary 或受控内容引用。 | [详情](../nextagent-ts-changes/add-ts-attachment-request-context-flow.md) |
| [`add-ts-attachment-cleanup`](../nextagent-ts-changes/add-ts-attachment-cleanup.md) | ready | 提供显式 attachment cleanup port，并保留 owner scope 和 audit 接入点；不提供后台调度器或保留期策略。 | [详情](../nextagent-ts-changes/add-ts-attachment-cleanup.md) |

### 增强工具

| Change | 状态 | 目标 | 详情 |
|---|---|---|---|
| [`add-ts-ask-user-question-tool`](../nextagent-ts-changes/add-ts-ask-user-question-tool.md) | complete | 新增 AskUser tool 向用户追问，涉及 runtime pending input boundary 和 channel 协作。 | [归档](../../openspec/changes/archive/2026-06-23-add-ts-ask-user-question-tool) |
| [`add-ts-tool-search-tool`](../nextagent-ts-changes/add-ts-tool-search-tool.md) | complete | 新增 ToolSearch tool 搜索可用能力。 | [归档](../../openspec/changes/archive/2026-06-23-add-ts-tool-search-tool) |
| [`add-ts-edit-tool`](../nextagent-ts-changes/add-ts-edit-tool.md) | complete | 新增 Edit tool 对 workspace 内文件执行基于行范围的部分编辑，原子性操作。 | [归档](../../openspec/changes/archive/2026-06-21-add-ts-edit-tool) |
| [`add-ts-grep-tool`](../nextagent-ts-changes/add-ts-grep-tool.md) | complete | 新增 Grep tool 在 workspace 内文件中搜索文本内容或正则表达式，返回匹配行和上下文。 | [归档](../../openspec/changes/archive/2026-06-20-add-ts-grep-tool) |
| [`add-ts-rag-tool`](../nextagent-ts-changes/add-ts-rag-tool.md) | complete | 新增 RAG tool 作为语义检索入口，调用已装配的 RAG retrieval gateway 返回有界、安全、可追溯的知识片段。 | [归档](../../openspec/changes/archive/2026-06-23-add-ts-rag-tool) |
| [`add-ts-rag-knowledge-governance`](../nextagent-ts-changes/add-ts-rag-knowledge-governance.md) | complete | 新增本地 RAG 知识治理能力：本地启动时一次性治理 workspace 安全文本文件，生成临时检索数据，关闭时清理。 | [归档](../../openspec/changes/archive/2026-06-23-add-ts-rag-knowledge-governance) |

### 长期记忆

| Change | 状态 | 目标 | 详情 |
|---|---|---|---|
| [`add-ts-memory-core`](../nextagent-ts-changes/add-ts-memory-core.md) | complete | 跨会话记忆可存储、检索和管理，有独立生命周期。 | [详情](../nextagent-ts-changes/add-ts-memory-core.md) |
| [`add-ts-memory-tools`](../nextagent-ts-changes/add-ts-memory-tools.md) | complete | 模型可通过工具读写长期记忆。 | [详情](../nextagent-ts-changes/add-ts-memory-tools.md) |
| [`add-ts-memory-extraction`](../nextagent-ts-changes/add-ts-memory-extraction.md) | complete | 从对话中自动提取可记忆事实。 | [详情](../nextagent-ts-changes/add-ts-memory-extraction.md) |
| [`add-ts-memory-aging`](../nextagent-ts-changes/add-ts-memory-aging.md) | complete | 记忆按时间和使用频率衰减，过期记忆可被清理。 | [详情](../nextagent-ts-changes/add-ts-memory-aging.md) |
| [`add-ts-memory-configuration`](../nextagent-ts-changes/add-ts-memory-configuration.md) | complete | 自学习行为可通过配置控制启停和策略。 | [详情](../nextagent-ts-changes/add-ts-memory-configuration.md) |
| [`add-ts-task-trajectory`](../nextagent-ts-changes/add-ts-task-trajectory.md) | complete | 从 request run 提取可审计任务轨迹（目标/约束/动作/事实/结果），供长期记忆提取使用。 | [归档](../../openspec/changes/archive/2026-06-24-add-ts-task-trajectory) |
| [`add-ts-memory-application-contract`](../nextagent-ts-changes/add-ts-memory-application-contract.md) | active | 建立 `agent-contracts/channel` 管理契约和 `agent-memory` application service，使 Web Channel 通过唯一管理入口调用既有长期记忆 Gateway。 | [详情](../nextagent-ts-changes/add-ts-memory-application-contract.md) |
| [`add-ts-response-memory-disclosure`](../nextagent-ts-changes/add-ts-response-memory-disclosure.md) | active | 只在 owner 会话未重建执行且最终完成的回复底部披露当前 attempt 实际引用和同步新增的长期记忆；`add_memory` 以原 invocation key 幂等恢复，但 reply disclosure 不参与 checkpoint/replay，恢复执行及 FAILED、CANCELED、SUPERSEDED 均不展示披露；live 与 conversation 使用同一终态事实，模型上下文和 conversation share 均不接收披露内容。 | [详情](../nextagent-ts-changes/add-ts-response-memory-disclosure.md) |

### Skill Hub 与 Agent 发现

| Change | 状态 | 目标 | 详情 |
|---|---|---|---|
| [`add-ts-skillhub-source`](../nextagent-ts-changes/add-ts-skillhub-source.md) | ready | 支持 SkillHub 通过 remote gateway 进行显式 refresh、agent-scoped list/search、metadata fetch、package download；下载、校验、安装到 managed skills 目录并启用后才进入统一 catalog。 | [详情](../nextagent-ts-changes/add-ts-skillhub-source.md) |
| [`add-ts-invoked-agent-discovery`](../nextagent-ts-changes/add-ts-invoked-agent-discovery.md) | ready | 支持内置 Agent capability 和 `agents/{agentId}/subagents/` 两个来源进入统一 catalog；远端 AgentRegistry discovery 后置。 | [详情](../nextagent-ts-changes/add-ts-invoked-agent-discovery.md) |

### Runtime Host Agent 选择

| Change | 状态 | 目标 | 详情 |
|---|---|---|---|
| [`add-ts-runtime-host-agent-selection`](../nextagent-ts-changes/add-ts-runtime-host-agent-selection.md) | candidate | 支持同一 runtime 托管多个 Host Agent 时，由可信 host/path/auth/app composition selection 在 request acceptance 前或 acceptance 时确定本次新 session/request 绑定的 Agent Scope；已有 session 继续使用持久化 `Session.agentId`，请求体、模型输出和 capability 参数不得覆盖。 | [详情](../nextagent-ts-changes/add-ts-runtime-host-agent-selection.md) |
| [`refine-ts-agent-identity-and-id-format`](../nextagent-ts-changes/refine-ts-agent-identity-and-id-format.md) | active | Contract refinement：删除重复 `agentAssemblyRef`，明确 AgentAssembly identity 为 `agentId + agentVersion`；将系统生成 durable identity 收敛为 TypeID，将 sequence/ordinal/version 收敛为 scoped coordinate，并保留 human-authored safe id 与 deterministic idempotency key 的独立语义。 | [详情](../nextagent-ts-changes/refine-ts-agent-identity-and-id-format.md) |

### Agent 路由

本节只描述第二层路由：在 runtime 已经固化 Agent Scope 后，当前 Agent 内部选择 deterministic flow、targeted skill、workflow recipe、model-driven loop、clarify/reject/handoff 等处理路径。第一层“哪个 Host Agent 处理当前请求”由 `add-ts-runtime-host-agent-selection` 单独承载。

| Change | 状态 | 目标 | 详情 |
|---|---|---|---|
| [`add-ts-agent-routing-core`](../nextagent-ts-changes/add-ts-agent-routing-core.md) | ready | 在 Agent 接口之后建立 routing policy，runtime 不做业务语义路由。 | [详情](../nextagent-ts-changes/add-ts-agent-routing-core.md) |
| [`add-ts-routing-evidence-and-fallback`](../nextagent-ts-changes/add-ts-routing-evidence-and-fallback.md) | complete | 支持确定性路径、模型驱动路径、拒绝、澄清或人工接管的选择证据和回退原因，并将 routing evidence 写入审计与脱敏日志。 | [详情](../nextagent-ts-changes/add-ts-routing-evidence-and-fallback.md) |
| [`add-ts-targeted-skill-routing`](../nextagent-ts-changes/add-ts-targeted-skill-routing.md) | ready | 支持用户显式指定技能，并继续经过可用性、权限和 owner scope 校验。 | [详情](../nextagent-ts-changes/add-ts-targeted-skill-routing.md) |
| [`add-ts-routing-constraint-validation`](../nextagent-ts-changes/add-ts-routing-constraint-validation.md) | ready | 校验用户或上游入口提供的处理约束，防止绕过 Agent 和 capability governance。 | [详情](../nextagent-ts-changes/add-ts-routing-constraint-validation.md) |

### 人工介入（Pending Input）

| Change | 状态 | 目标 | 详情 |
|---|---|---|---|
| [`refine-ts-pending-input-contracts`](../nextagent-ts-changes/refine-ts-pending-input-contracts.md) | complete | 共享契约收敛：冻结 pending input question/answer、Agent/Core pending pause outcome、gateway active/due query、resolve idempotency 和后续 pending lifecycle changes 共享的最小 contract。 | [归档](../../openspec/changes/archive/2026-06-23-refine-ts-pending-input-contracts) |
| [`add-ts-human-pending-input-core`](../nextagent-ts-changes/add-ts-human-pending-input-core.md) | ready | 建立 pending input 三对象契约和 runtime 生命周期，支持创建、持久化、投影、回答、取消和恢复原 run 的核心流程。 | [详情](../nextagent-ts-changes/add-ts-human-pending-input-core.md) |
| [`add-ts-human-pending-input-timeout`](../nextagent-ts-changes/add-ts-human-pending-input-timeout.md) | ready | 支持 pending input 超时发现、超时事实记录、late answer 拒绝和后续处理。 | [详情](../nextagent-ts-changes/add-ts-human-pending-input-timeout.md) |
| [`add-ts-question-pending-input`](../nextagent-ts-changes/add-ts-question-pending-input.md) | ready | 支持模型通过 `question` 工具向当前用户发起问题，并在用户回答后继续原 run。 | [详情](../nextagent-ts-changes/add-ts-question-pending-input.md) |
| [`add-ts-confirmation-pending-input`](../nextagent-ts-changes/add-ts-confirmation-pending-input.md) | ready | 支持系统发起普通二态确认，并将用户选择转化为系统控制结果。 | [详情](../nextagent-ts-changes/add-ts-confirmation-pending-input.md) |
| [`add-ts-authorization-pending-input`](../nextagent-ts-changes/add-ts-authorization-pending-input.md) | ready | 支持当前 run 内一次受限操作的显式授权。 | [详情](../nextagent-ts-changes/add-ts-authorization-pending-input.md) |
| [`add-ts-human-handoff`](../nextagent-ts-changes/add-ts-human-handoff.md) | ready | 支持系统将当前 run 转入人工接管 pending，并允许人工终结或恢复原 run。 | [详情](../nextagent-ts-changes/add-ts-human-handoff.md) |

### 子 Agent 执行

| Change | 状态 | 目标 | 详情 |
|---|---|---|---|
| [`add-ts-agent-tool`](../nextagent-ts-changes/add-ts-agent-tool.md) | complete | 新增 `Agent` tool entry 和 runtime `SubagentExecutionPort` 本地路径：通过 `submit()` 创建隔离 child session/run，同步等待终态并返回 safe completed result。 | [归档](../../openspec/changes/archive/2026-06-22-add-ts-agent-tool) |
| [`add-ts-local-invoked-agent-execution`](../nextagent-ts-changes/add-ts-local-invoked-agent-execution.md) | not-planned | 已合并入 `add-ts-agent-tool`；本地子 Agent 执行不再以 `task` 工具专属 change 单独实施。 | [详情](../nextagent-ts-changes/add-ts-local-invoked-agent-execution.md) |
| [`add-ts-isolated-branch-execution`](../nextagent-ts-changes/add-ts-isolated-branch-execution.md) | not-planned | 已合并入 `add-ts-agent-tool`；隔离 child session/run 与 parent linkage 由 `submit()` 路径承载。 | [详情](../nextagent-ts-changes/add-ts-isolated-branch-execution.md) |
| [`add-ts-invoked-agent-context-inheritance`](../nextagent-ts-changes/add-ts-invoked-agent-context-inheritance.md) | ready | 后续定义 Agent tool 子调用的继承上下文场景：受控传递 selected safe history、attachments、预算和约束；不改变首版 fresh-context 路径。 | [详情](../nextagent-ts-changes/add-ts-invoked-agent-context-inheritance.md) |
| [`add-ts-invoked-agent-result-return`](../nextagent-ts-changes/add-ts-invoked-agent-result-return.md) | not-planned | 已合并入 `add-ts-agent-tool`；同步 safe text result return 不再作为独立实施 change。 | [详情](../nextagent-ts-changes/add-ts-invoked-agent-result-return.md) |

### 反馈与语言

| Change | 状态 | 目标 | 详情 |
|---|---|---|---|
| [`add-ts-bilingual-telecom-output`](../nextagent-ts-changes/add-ts-bilingual-telecom-output.md) | ready | 支持回答语言默认跟随用户主语言，并在 prompt/context 组装中要求保留电信术语原始表达。 | [详情](../nextagent-ts-changes/add-ts-bilingual-telecom-output.md) |
| [`add-ts-user-facing-i18n-contract`](../nextagent-ts-changes/add-ts-user-facing-i18n-contract.md) | candidate | 为后端返回给客户端的用户可见错误、状态、提示和管理操作结果建立国际化契约：后端输出稳定 `messageKey`、安全参数和 fallback 文案，前端按 locale 使用本地 bundle 渲染；不再把硬编码英文 `message` 作为唯一展示来源。 | [详情](../nextagent-ts-changes/add-ts-user-facing-i18n-contract.md) |

### 前端交互与控制

| Change | 状态 | 目标 | 详情 |
|---|---|---|---|
| [`agent-web-auth-control`](../nextagent-ts-changes/agent-web-auth-control.md) | complete | 前端宿主模式基于 HostSiteContext ops 做权限控制，区分只读/读写用户操作入口。 | [归档](../../openspec/changes/archive/2026-06-29-agent-web-auth-control) |
| [`agent-web-ui-interaction`](../nextagent-ts-changes/agent-web-ui-interaction.md) | active | 前端与同 Document 内其他 GUI 组件实时联动，后端 ACTION 结构化指令驱动外部业务面板状态变更。 | [详情](../nextagent-ts-changes/agent-web-ui-interaction.md) |
| [`establish-agent-web-assistant-markdown-rendering`](../../openspec/changes/establish-agent-web-assistant-markdown-rendering/) | active | 为已完成 ordinary assistant 正文补齐 Markdown、GFM pipe table 和普通代码语义；主 owner 为 `agent-web`，不接管 Mermaid、structured message、stream 或 answer action。 | [Active change](../../openspec/changes/establish-agent-web-assistant-markdown-rendering/) |
| [`establish-agent-web-pending-input-ui`](../../openspec/changes/establish-agent-web-pending-input-ui/) | active | 补齐 Pending Input 响应面、普通 Composer 互斥/恢复、展示型过期和 owning-request 取消委托；主 owner 为 `agent-web`，runtime/channel 继续拥有 lifecycle、payload 和 answer authority。 | [Active change](../../openspec/changes/establish-agent-web-pending-input-ui/) |
| [`establish-agent-web-existing-behavior-baseline`](../../openspec/changes/establish-agent-web-existing-behavior-baseline/) | active | 按当前产品路径补齐 Composer、附件队列、根路由会话建立、title/edit、HFQ、Turn Run Graph 和有限 Mermaid 行为；以 `agent-web` 为主 owner，runtime/session/channel/gateway 仅保留已有 title/edit 责任。 | [Active change](../../openspec/changes/establish-agent-web-existing-behavior-baseline/) |

### 质量测试门禁

| Change | 状态 | 目标 | 详情 |
|---|---|---|---|
| [`add-ts-contract-test-gate`](../nextagent-ts-changes/add-ts-contract-test-gate.md) | ready | 为核心契约、channel event、capability descriptor、gateway store contract 建立必须通过的 contract test gate。 | [详情](../nextagent-ts-changes/add-ts-contract-test-gate.md) |
| [`add-ts-architecture-test-gate`](../nextagent-ts-changes/add-ts-architecture-test-gate.md) | ready | 自动检查模块边界、依赖方向、跨层绕行和实现包泄漏，防止破坏架构设计。 | [详情](../nextagent-ts-changes/add-ts-architecture-test-gate.md) |
| [`add-ts-security-test-gate`](../nextagent-ts-changes/add-ts-security-test-gate.md) | ready | 验证 secret/redaction、sandbox deny-by-default、授权/高危确认、敏感日志泄露等安全边界。 | [详情](../nextagent-ts-changes/add-ts-security-test-gate.md) |
| [`add-ts-resilience-test-gate`](../nextagent-ts-changes/add-ts-resilience-test-gate.md) | ready | 覆盖 cancel、retry、checkpoint recovery、runtime recovery idempotency guard、pending timeout、stream replay 等关键恢复路径。 | [详情](../nextagent-ts-changes/add-ts-resilience-test-gate.md) |
| [`add-ts-capacity-benchmark-gate`](../nextagent-ts-changes/add-ts-capacity-benchmark-gate.md) | ready | 建立首版容量/性能基线并记录结果；只阻断明显不可用场景，不绑定严格 SLA。 | [详情](../nextagent-ts-changes/add-ts-capacity-benchmark-gate.md) |

### Workflow 契约

| Change | 状态 | 目标 | 详情 |
|---|---|---|---|
| [`add-ts-workflow-engine-contracts`](../nextagent-ts-changes/add-ts-workflow-engine-contracts.md) | candidate | 在 `agent-contracts/core` 定义 workflow 最小 contract：`WorkflowExecutionService`、最小 `RecipeDefinition` / `FlowGraph`、`WorkflowNodeType` 和最小执行 DTO。 | [详情](../nextagent-ts-changes/add-ts-workflow-engine-contracts.md) |
