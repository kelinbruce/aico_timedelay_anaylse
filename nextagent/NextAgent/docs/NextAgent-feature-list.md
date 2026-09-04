# NextAgent Feature List（特性清单）

> 定位：面向智能体用户与智能体开发者，按能力域呈现平台价值。Feature 的主角是 actor，每条特性回答“actor 能获得什么价值、主要用例和黑盒边界是什么、由哪些 Functions 形成”。
>
> 本文档与现有文档职责区分：`NextAgent对外特性介绍.md` 为叙述式概览，`nextagent-feature-spec-review-list.md` 为带规格值的设计评审清单；本文档为按能力域组织的特性价值清单，不含规格值表格，聚焦价值呈现与状态标注。
>
> 配套文档：[NextAgent Function List（功能清单）](./NextAgent-function-list.md)。Feature 与 Function 通过清单列和长期叶子文档显式关联，不按 `F-*` 与 `FN-*` 编号推断一一对应关系。Feature 不重复定义 stable spec 的 Requirement 或 design 的白盒实现。

## 状态定义

| 状态 | 含义 | 事实源 |
|---|---|---|
| 稳定 | 已归档稳定行为契约，可在产品路径上依赖 | `openspec/specs/` 归档 spec |
| 在建 | 已有 active change 但未归档，契约/实现可能调整 | `openspec/changes/` 非 archive 目录 |
| 稳定基线 + 在建补齐 | 已有最小稳定基线，active change 正在扩展完整能力 | 两者均有 |
| 规划 | roadmap 提及但无归档 spec 也无 active change | `openspec/overview.md` 范围外说明 |

## 能力域索引

| 域 | 名称 | 特性数 |
|---|---|---|
| D1 | 会话与流式交互 | F-1.1 ~ F-1.6 |
| D2 | 请求运行时 | F-2.1 ~ F-2.8 |
| D3 | Agent 装配与主链路 | F-3.1 ~ F-3.5 |
| D4 | 模型与上下文 | F-4.1 ~ F-4.8 |
| D5 | Capability 能力体系 | F-5.1 ~ F-5.7 |
| D6 | 安全与治理 | F-6.1 ~ F-6.7 |
| D7 | 可观测与审计 | F-7.1 ~ F-7.6 |
| D8 | 数据与记忆 | F-8.1 ~ F-8.7 |
| D9 | Workflow 编排 | F-9.1 ~ F-9.7 |
| D10 | 二次开发与平台集成 | F-10.1 ~ F-10.12 |
| D11 | 可靠性与韧性 | F-11.1 ~ F-11.5 |

---

## D1 会话与流式交互

| 编号 | 特性 | 价值描述 | 状态 | spec 追溯 | 关联 function |
|---|---|---|---|---|---|
| F-1.1 | 过程透明的流式交互体验 | SSE/WebSocket 双通道等价输出 timeline envelope，用户实时看到受理、进展、工具调用、等待确认、降级与最终结果，避免黑盒等待 | 稳定 | `ts-web-sse-ws-transports`、`ts-minimal-agent-kernel` | FN-1.1、FN-1.2 |
| F-1.2 | 断连恢复与历史一致性 | 基于 canonical timeline 支持断点续传、冷启动重放，stream/history/终态三方一致，用户重进会话看到的终态与权威事实一致 | 稳定 | `ts-stream-resume-replay`、`ts-stream-history-consistency` | FN-1.3、FN-1.4、FN-1.5 |
| F-1.3 | 会话全生命周期管理 | 创建、列表/搜索、删除、预览导航、标题管理均按 owner+agent scope 隔离，支撑运维人员多会话工作流 | 稳定 | `ts-minimal-agent-kernel`、`session-delete`、`session-conversation-preview`、`session-title-generation`、`session-history-search` | FN-1.6 ~ FN-1.10 |
| F-1.4 | 对话标注与分享 | 对 run 点赞/点踩/收藏（sentiment UP/DOWN、isFavorited、isQuestionFavorited；评论 comment 仅持久层 Record 定义，Web DTO 未暴露），并创建受控只读分享链接，支撑团队复盘与跨班次交接 | 稳定 | `conversation-annotation`、`conversation-share`、`conversation-annotation-controls`（标注控件）、`favorite-turn-list`（收藏列表交互）、`shared-conversation-view`（共享视图一致性）、`agent-web-complaint-feedback`（投诉反馈入口） | FN-1.11、FN-1.12、FN-1.13、FN-1.14 |
| F-1.5 | 会话派生 | 从已持久化可见的 assistant message 派生子会话，复制 canonical message prefix，支撑"基于历史结论继续新分析" | 稳定 | `session-fork-from-message`；在建 `fix-agent-web-fork-inherited-retry-edit-disable`(0/8) | FN-1.15 |
| F-1.6 | 智能问题推荐 | 分类问题快捷选择、基于行为的动态高频问题排序、输入联想，降低运维人员提问门槛 | 稳定基线 + 在建补齐 | `category-question-api`、`category-question-ui`、`frequent-question-api`、`high-frequency-question-ui`、`question-association-api`、`question-association-ui`、`agent-web-high-frequency-questions`、`user-question-activity`、`question-recommendation`、`cross-session-activity-awareness`（跨会话活动感知投影）；在建 `migrate-question-pin-to-annotation`（pin 迁移到 annotation `isQuestionFavorited`） | FN-1.16 ~ FN-1.21 |

## D2 请求运行时

| 编号 | 特性 | 价值描述 | 状态 | spec 追溯 | 关联 function |
|---|---|---|---|---|---|
| F-2.1 | 可信请求提交与幂等 | 提交后快速返回 request/run 坐标并进入 runtime 生命周期；相同 idempotencyKey 重复提交返回首次结果，不产生重复副作用 | 稳定 | `ts-minimal-agent-kernel`、`ts-web-command-idempotency`；在建 `refine-ts-input-guard-blocked-round-as-run`(0/13) | FN-2.1、FN-2.2、FN-2.3 |
| F-2.2 | 请求取消与级联中止 | 用户可取消最新活动请求，通过 AbortSignal 级联中止模型/工具/Skill/Agent，产生权威 canceled 终态 | 稳定 | `request-cancel` | FN-2.4、FN-2.5 |
| F-2.3 | 请求重试与编辑重提 | 对已结束请求重试（新 run/attempt 递增、保留旧结果可追溯）；编辑最近一次已结束请求并重提，创建新 root 用户消息和新 run | 稳定 | `request-retry`、`request-edit-resubmit` | FN-2.6、FN-2.16 |
| F-2.4 | 同会话串行调度 | 同一 session lane 默认串行推进，单 session 单 active run 拒绝并发，避免会话内状态竞争 | 稳定 | `session-lane-scheduling` | FN-2.7、FN-2.8 |
| F-2.5 | 请求路由与分发 | routing policy 在 accepted 后、context/model/capability 前决策，支持 deterministic flow、model-driven loop、clarify、reject、human handoff，并支持 `$skill:`/`$workflow:` directive 与目标 Skill 约束 | 稳定 | `agent-routing-core`、`targeted-skill-routing`、`routing-evidence-and-fallback`、`routing-constraint-validation` | FN-2.9、FN-2.10、FN-2.11 |
| F-2.6 | 运行状态可见性 | 用户可区分 accepted、running/executing、waiting input、completed、failed、canceled、superseded 等状态，Web channel 不创造与 runtime facts 竞争的状态 | 稳定 | `ts-run-status-visibility` | FN-2.12 |
| F-2.7 | 唯一终态提交 | 每个 accepted request 只有一个权威终态，stream、RequestRun、visible history 三方一致 | 稳定 | `ts-minimal-agent-kernel`（terminal consistency） | FN-2.13 |
| F-2.8 | 后台任务异步完成通知 | 长耗时后台任务完成后异步通知前端，避免用户在会话中无界等待 | 稳定 | `background-task-completion`、`agent-web-background-task-control` | FN-2.14、FN-2.15 |

## D3 Agent 装配与主链路

| 编号 | 特性 | 价值描述 | 状态 | spec 追溯 | 关联 function |
|---|---|---|---|---|---|
| F-3.1 | Agent 产品化装配 | 通过 `agents/{agentId}` package（agent.yaml/skills/subagents/prompts）声明 Agent，启动期编译为 runtime-ready AgentAssembly，业务团队无需改内核即可构建领域专属智能体；agent-owned 本地资源支持运行时动态加载 | 稳定 | `agent-package-assembly`、`extension-registration`、`agent-owned-resource-dynamic-loading` | FN-3.1、FN-3.2 |
| F-3.2 | Agent Scope 绑定与固化 | Session 绑定 agentId，RequestRun 在 acceptance 固化 agentId/agentVersion/agentAssemblyRef，accepted 后主路径不重新按默认 Agent 选择执行路径；请求入口层由 agent selection policy 从 channel boundary 提取 host 选择 | 稳定 | `ts-minimal-agent-kernel`（架构约束）、`ts-core-contracts`、`agent-selection-policy` | FN-3.3、FN-3.4 |
| F-3.3 | Agent 主链路编排 | 受控执行链路：context assembly → prompt template → model invocation → capability invocation → tool loop，各阶段边界清晰、可治理 | 稳定 | `ts-core-contracts`、`context-engine`、`prompt-template-assembly`、`model-invocation-contract` | FN-3.5 ~ FN-3.9 |
| F-3.4 | 多 Agent 协作与子 Agent 调用 | 通过 Agent tool 调用子 Agent，创建 fresh-context child session/run，保持 Agent Scope 与执行审计可控；支持主 Agent 选择与受控 handoff | 稳定 | `agent-tool`、`invoked-agent-discovery` | FN-3.10 |
| F-3.5 | 工具循环收敛保护 | 同一 run 内相同 capability + 相同参数 + 相同非取消失败可多次进入模型循环，每次重新过治理边界并生成配对 `CAPABILITY_RESULT`；系统不建 failure fingerprint、错误次数阈值或 `CAPABILITY_REPEATED_FAILURE` 终止。收敛由 canonical `maxTurns` 唯一保证，达到上限时停止 Tool 执行并注入 `toolChoice=NONE` 执行一次无工具收尾 turn，发布 `TOOL_ROUND_LIMIT_EXCEEDED` degradation fact | 稳定 | `tool-loop` | FN-3.11 |

## D4 模型与上下文

| 编号 | 特性 | 价值描述 | 状态 | spec 追溯 | 关联 function |
|---|---|---|---|---|---|
| F-4.1 | 模型调用与 provider 隔离 | agent-model 隔离 provider SDK、request 构造、stream normalization、tool-use normalization 与 safe error mapping，核心契约不耦合具体厂商 | 稳定 | `model-invocation-contract`、`model-provider-adapter`、`app-config-schema`（modelProfiles 契约，原 `model-provider-configuration`/`model-profile-contracts` spec 已并入）；在建 `restore-model-gateway-bypass`(0/11) | FN-4.1、FN-4.2、FN-4.3 |
| F-4.2 | 流归一化与安全错误映射 | provider 流式 chunk 归一化，raw provider error 经 safe mapping 后跨边界输出，不泄漏 prompt/模型输出/credential | 稳定 | `model-stream-normalization`、`provider-error-safe-mapping` | FN-4.4、FN-4.5 |
| F-4.3 | 模型 fallback 语义 | fallback 由 Agent Core 显式编排（非 model 边界），消费 stabilized candidates，记录 routing evidence | 稳定 | `model-fallback-semantics`、`routing-evidence-and-fallback` | FN-4.6 |
| F-4.4 | 上下文窗口自适应与预算可解释 | Context Engine 独占 history selection、window budget、compaction、prompt shaping，render 前计算 budget evidence | 稳定 | `context-engine`、`context-token-estimator`、`context-assembly-contracts` | FN-4.7、FN-4.8 |
| F-4.5 | 上下文压缩 | 多级压缩：微压缩旧工具结果、大内容转储为 preview 引用、摘要压缩较早历史并保留可追溯引用 | 稳定 | `context-engine`、`large-content-references` | FN-4.9、FN-4.10、FN-4.11 |
| F-4.6 | 上下文保护 | 保护 latest request minimum safe context 与 current request 不被静默丢弃，确保当前请求上下文完整进入模型 | 稳定 | `context-engine` | FN-4.12 |
| F-4.7 | 大内容分页读回 | 外部化的超大工具结果经 `read` 工具 + file_path 分页读回，owner-scope 由 execution workspace resolver 强制 | 稳定 | `large-content-readback` | FN-4.13 |
| F-4.8 | 电信双语输出 | 模型默认跟随用户实际输入语言，对 NE/interface/KPI/protocol/alarm/CLI 等电信术语保留原始英文形式 | 稳定 | `telecom-bilingual-output` | FN-4.14 |

## D5 Capability 能力体系

| 编号 | 特性 | 价值描述 | 状态 | spec 追溯 | 关联 function |
|---|---|---|---|---|---|
| F-5.1 | 统一 Capability 治理体系 | Tool/Skill/Agent 统一进入 Capability Catalog，经发现、描述、可用性判断、Agent binding 过滤、conflict/shadowing 治理后才被模型使用，避免"发现即授权" | 稳定 | `capability-catalog`、`capability-source-configuration`、`ts-core-contracts`、`extension-registration`、`conflict-resolution`（capability 冲突解决） | FN-5.1、FN-5.2、FN-5.3 |
| F-5.2 | 内置工具集 | 文件读写编辑检索（read/write/edit/glob/grep）、Bash/Python（sandbox 执行）、AskUserQuestion/Agent/Skill/ToolSearch/TodoWrite/Memory 等 14 种内置工具，覆盖运维常见操作 | 稳定 | `builtin-tool-framework`、`bash-tool`、`python-tool`、`write-tool`、`edit-tool`、`grep-tool`、`glob-tool`、`read-tool`、`todo-write-tool`、`file-operation-tools`、`file-search-tools`、`command-script-tools`（Bash/Python 统一黑盒契约）、`cross-platform-executable-semantics`；在建 `refine-builtin-tool-guidance`(9/13) | FN-5.4 ~ FN-5.16 |
| F-5.3 | Skill 系统 | builtin/system/agent 三级 Skill 发现（EAGER/SEARCH）、SKILL.md manifest、受控资源访问、SkillHub 远端获取、inline/fork 执行与模型参数定制；正文解析/路径泄漏校验、catalog 查询元数据、前端选择组件、运行时 SkillHub 获取回路与非 agentic Skill 驱动 API 调用 | 稳定 | `local-skill-source`、`builtin-skill-source`、`skill-manifest-contract`、`skill-tool`、`skill-resource-access`、`skillhub-source`、`web-skill-catalog`、`skill-body-validation`、`skill-catalog-query`、`skill-selector-ui`、`runtime-skill-acquisition-loop`、`skill-driven-api-call`；在建 `restore-extension-array-support`(0/5)、`refine-skill-manifest-keys`(6/6 已完成待归档) | FN-5.18 ~ FN-5.23 |
| F-5.4 | RAG 知识检索 | `Rag` 工具统一查询入口，只依赖 public RagRetrievalGateway，本地语料治理按 trusted workspace read scope 构建 | 稳定 | `rag-tool`、`rag-knowledge-governance`；在建 `refine-rag-retrieval-display`(0/11)、`remove-rag-provenance-field`(0/7) | FN-5.17 |
| F-5.5 | 工具渐进式加载 | ToolSearch request-local 激活：系统 prompt 只暴露轻量 deferred 候选，ToolSearch 搜索当前 request governed visible 元数据后激活，支撑万级工具规模 | 稳定 | `tool-search-tool` | FN-5.24、FN-5.26 |
| F-5.6 | 跨平台可执行语义 | Bash/Python 跨平台语义适配，命令权威下沉到 sandbox gateway denylist，executable allow/deny 由 sandbox policy 决定 | 稳定 | `cross-platform-executable-semantics`、`bash-tool` | FN-5.9、FN-5.10 |
| F-5.7 | API-backed Tool source | 外部系统 API 建模为受治理 Tool（CLIP），复用 schema validation、result mapping、audit、safe error | 稳定 | `api-backed-tool-source` | FN-5.25 |

## D6 安全与治理

| 编号 | 特性 | 价值描述 | 状态 | spec 追溯 | 关联 function |
|---|---|---|---|---|---|
| F-6.1 | 双层身份隔离 | owner scope（tenantId/subjectId）+ agent scope 双隔离，身份只来自可信 channel/auth 边界，请求体/模型输出/capability 参数不得覆盖 | 稳定 | `ts-minimal-agent-kernel`、`ts-core-contracts`（架构约束）、`owner-scope-security`（design 文档：`openspec/designs/architecture/owner-scope-security.md`，非 stable spec） | FN-6.1、FN-6.2 |
| F-6.2 | 沙箱执行与 deny-by-default | 动态 shell/python/脚本/模型生成代码必须走 sandbox gateway，默认 adapter deny-by-default/unavailable，控制 timeout/stdout/stderr/env/cwd | 稳定 | `sandbox-runtime`、`sandbox-deny-by-default-adapter` | FN-6.3、FN-6.4 |
| F-6.3 | 风险策略强制执行 | capability invocation、sandbox 动态执行、authorization/high-risk confirmation、recovery replay 前的受限操作都先经 risk policy，输出 ALLOW/DENY/REQUIRE_AUTHORIZATION/DEGRADED/POLICY_FAILED 并留安全证据；外部安全护栏路由经 GuardrailGateway 唯一出口获得一致风险决策 | 稳定 | `risk-policy-enforcement`、`guardrail-gateway` | FN-6.5 |
| F-6.4 | 人工交互边界 | 澄清/确认/授权/选择/人工接管通过同一 pending input lifecycle 进入暂停、超时、恢复、终止；AskUserQuestion 只是创建 QUESTION pending input 的 builtin 入口 | 稳定基线 + 在建补齐 | `human-pending-input-core`、`human-pending-input-timeout`、`confirmation-pending-input`、`authorization-pending-input`、`question-pending-input`、`human-handoff`、`ask-user-question-trigger-policy`；在建 `enable-ask-user-question-free-text-answer`(3/13) | FN-6.6 ~ FN-6.10 |
| F-6.5 | 脱敏与安全错误 | 日志/metric/trace/audit/stream diagnostic/health diagnostic 经统一脱敏策略；所有 unknown/internal/provider/tool error 经 SafeError 归一化后跨边界输出；web channel 输入安全校验、Capability 执行失败统一安全分类（actionable execution failure）、ASSISTANT 正文透明水印替换 | 稳定 | `redaction-policy`、`provider-error-safe-mapping`、`web-channel-input-security`、`actionable-execution-failure`、`watermark-gateway` | FN-6.11、FN-6.12 |
| F-6.6 | Secret 配置边界 | Secret 通过 SecretReference（env:/file:）处理，raw secret 不得进入 config/log/stream/audit/metric/model context | 稳定 | `secret-configuration-boundary` | FN-6.13 |
| F-6.7 | 本地配置认证 | 本地单用户认证，signed HttpOnly cookie，票据过期与服务重启后失效，凭证来自 env/file secret reference | 稳定 | `ts-local-configured-auth` | FN-6.14 |

## D7 可观测与审计

| 编号 | 特性 | 价值描述 | 状态 | spec 追溯 | 关联 function |
|---|---|---|---|---|---|
| F-7.1 | 结构化日志与运行时日志 | structured logging projector 与 runtime logging 职责分离，业务模块通过 observation/event envelope 输出，日志写入有 backpressure 策略不阻塞 terminal commit | 稳定 | `structured-logging`、`runtime-logging` | FN-7.1、FN-7.2 |
| F-7.2 | 审计事件与审计 sink | capability/hook/policy/pending input/terminal commit/feedback 等关键执行事实产生安全审计事件，run-bound audit 携带 trusted agentId；capability invocation 审计事实独立成 spec | 稳定基线 + 在建补齐 | `audit-event-contract`、`audit-sink`、`invocation-audit`；在建 `add-ai-log-reporting`(0/10) | FN-7.3、FN-7.4 |
| F-7.3 | Trace/Metric 与 OTel adapter | 统一 TraceProjector、MetricsRegistry 与安全字段 allowlist；OTel adapter 为正式 owner 边界，W3C Trace Context，traceId/spanId 不进入核心契约 | 稳定 | `otel-observability-adapter`、`agent-runtime-metrics`、`trace-log-linking`、`otel-trace-export`；在建 `adjust-trace-reporting`(18/18 已完成待归档) | FN-7.5、FN-7.6、FN-7.7、FN-7.8 |
| F-7.4 | Agent 执行轨迹 | context assembly、capability selection、sandbox execution、first visible model content、terminal outcome 通过统一 ObservabilityObservationEvent stream 进入结构化可观测面，`nextagent-observability.log` 为主复盘视图 | 稳定基线 + 在建补齐 | `agent-execution-trajectory`；在建 `add-workflow-execution-trace`(0/11) | FN-7.9 |
| F-7.5 | 健康检查 | 提供 health、readiness/liveness 和核心 metrics，诊断输出使用 safe facts | 稳定 | `system-health-check` | FN-7.10 |
| F-7.6 | 内部生命周期可观测 | runtime 内部生命周期事件可观测，开发者 hook trace logging 可诊断；context 组装过程监控日志、任务事件与请求追踪关联、插件开发诊断产物与离线轨迹查看器 | 稳定 | `internal-lifecycle-observability`、`developer-hook-trace-logging`、`context-monitor-logging`、`task-event-trace-correlation`、`plugin-developer-diagnostic-artifacts`、`plugin-diagnostic-trace-viewer` | FN-7.11 |

## D8 数据与记忆

| 编号 | 特性 | 价值描述 | 状态 | spec 追溯 | 关联 function |
|---|---|---|---|---|---|
| F-8.1 | 本地持久化与 gateway 解耦 | 持久化能力与 SQLite 实现解耦：working memory provider 拥有运行中工作事实，long-term memory provider 拥有长期记忆；LOCAL 部署三库分离不双写 | 稳定 | `gateway-store-provider-ownership`（含 sessions/checkpoints store，原 `local-session-store`/`local-checkpoint-store` spec 已并入）、`local-run-timeline-store` | FN-8.1、FN-8.2、FN-8.3、FN-8.4 |
| F-8.2 | 长期记忆核心 | owner/agent scoped long-term memory core，定义跨 session retained memory 的 record、search/list/detail/count/state transition 与 graceful degradation，不阻塞 request terminal commit；Web 管理界面在 immersive Shell 内提供记忆 CRUD、共享管理和只读脱敏 | 稳定基线 + 在建补齐 | `memory-core`、`memory-configuration`、`long-memory-web-management`、`long-term-memory-management-contract`（管理 Channel 端口）、`memory-sharing`（授权共享）、`long-memory-import-export`（JSON 导入导出）；在建 `add-ts-response-memory-disclosure`(1/26)、`add-ts-system-reminder-memory-v1` | FN-8.5、FN-8.6、FN-8.15 |
| F-8.3 | 记忆工具与显式调用 | 模型通过 governed memory tools（search_memory/get_memory_detail/add_memory）显式调用记忆，Context Assembly 不自动注入长期记忆 | 稳定 | `memory-tools`；在建 `refine-memory-add-memory-guidance`(0/19) | FN-8.7 |
| F-8.4 | 任务轨迹学习输入层 | post-terminal task trajectory 学习输入层，为自学习提供数据基础 | 稳定 | `task-trajectory` | FN-8.8 |
| F-8.5 | 记忆提取与老化 | memory extraction（默认关闭 dreaming）与 aging lifecycle（默认关闭），提供记忆生命周期管理边界 | 稳定 | `memory-extraction`、`memory-aging` | FN-8.9、FN-8.10 |
| F-8.6 | 附件可信管理 | 附件 intake 校验类型/大小/数量/owner scope/可用性并暂存引用，提供显式 cleanup port；accepted 后附件参与请求上下文、上传配置分部署模式加载、存储模式无关的两阶段暂存上传、文件内容安全校验（magic bytes/zip bomb/zip slip） | 稳定 | `ts-attachment-intake`、`ts-attachment-cleanup`、`request-attachments`、`ts-attachment-config`、`ts-attachment-remote-upload`、`ts-file-security-validation` | FN-8.11、FN-8.12 |
| F-8.7 | 产物引用 | 保存 artifact metadata/ref，为后续下载/保留策略奠定基础（首版不提供下载入口） | 稳定 | `large-content-references`（baseline） | FN-8.13 |

## D9 Workflow 编排

| 编号 | 特性 | 价值描述 | 状态 | spec 追溯 | 关联 function |
|---|---|---|---|---|---|
| F-9.1 | Workflow 执行与路由 | agent-core routing 的 workflow 执行分支、单实例内存态 WorkflowExecutionService、启动期本地 recipe 加载、RECIPE capability 发现、六类节点 handler、workflow pending-input 桥接 | 稳定基线 + 在建补齐 | `workflow-routing`、`workflow-execution-engine`、`workflow-package`（recipe 加载与 RECIPE capability 发现，原 `workflow-execution-and-routing` design 名已拆分并入）；在建 `add-ts-workflow-orchestration-policy`(0/31 未启动) | FN-9.1 ~ FN-9.4、FN-9.11 |
| F-9.2 | Workflow 契约与执行引擎 | WorkflowExecutionService、Recipe DSL、FlowGraph、节点 DTO 契约与执行引擎 v2；节点输出解析器控制投影与展示、不泄漏下游变量 | 稳定 | `workflow-contracts`、`workflow-execution-engine`、`workflow-output-parser-contract` | FN-9.12、FN-9.13 |
| F-9.3 | Recipe DSL 与分发 | recipe 匹配（显式 recipeId 或 intent recognition）、recipe v2 契约、分类字段 | 稳定 | `add-ts-workflow-recipe-classification-fields`、`workflow-contracts` | FN-9.14、FN-9.15、FN-9.16 |
| F-9.4 | Workflow 节点族 | gateway/parallel-gateway/capability/interaction/knowledge/llm 六类稳定节点 + agent-loop-tool 等扩展节点；RESTFUL 节点 SSE 流式执行、workflow 专用 RAG gateway | 稳定基线 + 在建补齐 | `workflow-gateway-nodes`、`workflow-parallel-gateway`、`workflow-capability-nodes`、`workflow-knowledge-nodes`、`workflow-llm-nodes`、`workflow-interaction-nodes`、`workflow-agent-loop-tool`、`workflow-restful-sse`、`workflow-rag-gateway`；在建 `enhance-ts-workflow-knowledge-qa`(57/60)、`enhance-ts-workflow-api-choice-node`(0/30)、`enhance-ts-workflow-llm-nodes`(0/17) | FN-9.5 ~ FN-9.10、FN-9.21 |
| F-9.5 | Workflow 持久化与恢复 | workflow snapshot/resume/recovery、durable workflow history | 稳定基线 + 在建补齐 | `workflow-execution-engine`（snapshot/resume/recovery 基线）、`workflow-event-history`（durable history，spec 基线已入 stable）；在建 `add-ts-workflow-event-history`(0/28 PAUSED) | FN-9.17、FN-9.20 |
| F-9.6 | Workflow 远程执行模式 | workflow 远程执行模式 | 稳定 | `add-ts-workflow-remote-execution-mode` | FN-9.18 |
| F-9.7 | Workflow 编排策略 | workflow 编排策略与 visible delta 限制 | 稳定基线 + 在建补齐 | `workflow-contracts`（visible delta 限制）；在建 `add-ts-workflow-orchestration-policy`(0/31 未启动) | FN-9.19、FN-9.22 |

## D10 二次开发与平台集成

| 编号 | 特性 | 价值描述 | 状态 | spec 追溯 | 关联 function |
|---|---|---|---|---|---|
| F-10.1 | 生命周期 Hook | Hook 只能挂载在批准 lifecycle stage，可 observe/control/transform，但不得修改 runtime 状态机、伪造终态或绕过 terminal commit；启动期冻结 snapshot，request path 不扫描 | 稳定 | `lifecycle-hook-execution` | FN-10.1、FN-10.2 |
| F-10.2 | Agent-scoped 插件组合 | 插件由 system config 显式清单启动期加载，只在激活 Agent 中生效，贡献进入 Tool/Policy/Hook 治理路径；不支持动态热加载 | 稳定 | `agent-scoped-plugin-composition`、`extension-registration` | FN-10.3、FN-10.4 |
| F-10.3 | 自定义 Policy | AgentRoutingPolicy 与 RiskPolicy 通过 controlled contracts 承载自定义策略，依赖不可用时 fail closed | 稳定 | `agent-routing-core`、`risk-policy-enforcement` | FN-10.5、FN-10.6 |
| F-10.4 | 自定义 Tool 与 Prompt 模板 | defineTool + CUSTOM provider kind 承载自定义工具；prompt template assembly 支持自定义 purpose/模板/受控变量 | 稳定 | `builtin-tool-framework`、`capability-source-configuration`、`prompt-template-assembly` | FN-10.7、FN-10.8、FN-10.9 |
| F-10.5 | Gateway 集成边界 | 接入外部存储、远端服务、SkillHub、business API、sandbox 时通过 gateway/adapter boundary，local atomic transaction 以一致性为先 | 稳定 | `gateway-configuration`、`gateway-store-provider-ownership`；在建 `refine-ts-agent-gateway-state-store-boundary`(0/22) | FN-10.10 |
| F-10.6 | Web API 与 Stream 集成 | Web API 只暴露 public DTO，internal DO/gateway Record/DB row 不进入 Web response；SSE/WS 共享同一 stream input 与 StreamEnvelope projection；channel 层 API 契约、输入安全校验与机器交互 IR surface（`/api/v1/ir`） | 稳定 | `ts-web-sse-ws-transports`、`ts-core-contracts`、`web-channel-api-contract`、`web-channel-input-security`、`web-channel-ir-surface` | FN-10.11、FN-10.12 |
| F-10.7 | Fullstack 打包与本地运行边界 | 后端可托管前端构建后的 @nextagent/agent-web npm 包产物，profile 和 route precedence 可验证；不直接依赖前端源码私有路径。本地运行包边界、release candidate 证据、共享数据只读根、日志滚动基础包、runtime bootstrap 上传配置、HOFS 文件下载端点、启动网络连通检查（IPv6/双栈、监听安全边界） | 稳定 | `fullstack-packaging-boundary`、`local-runtime-package`、`local-runtime-release`、`local-shared-data-root`、`local-file-roll`、`ts-runtime-bootstrap-config`、`ts-hofs-file-download`、`network-connectivity` | FN-10.13 |
| F-10.8 | 前端集成契约 | AICOConfig 外部 UI 定制、host modes、structured message rendering、PIU 注入、布局模式/展示控制，支撑前端与后端协同 | 稳定基线 + 在建补齐 | `aico-config-contract`、`aico-piu-injection`、`aico-layout-mode`、`aico-display-control`、`agent-web-multi-host-modes`、`agent-web-structured-message-rendering`；在建 `add-piu-panel-position-and-display-control`(20/25)、`harden-agent-web-request-acceptance-control`(0/7) | FN-10.14 ~ FN-10.18 |
| F-10.9 | 测试工具与门禁 | agent-test-kit、contract/architecture/E2E gates（alpha/product-journey/security/resilience/release/p1-p2 与业务流/并发/非功能/UI 交互五类 e2e 场景族）共同构成验证门禁；TestClaw 独立系统集成门禁对候选包和外部 package artifacts 执行 122 个 activated 用例；HarnessBench 框架效果外部评测 | 稳定 | `ts-contract-test-gate`、`ts-architecture-test-gate`、`ts-e2e-alpha-kernel-gate`、`ts-e2e-product-journey-gate`、`ts-e2e-security-gate`、`ts-e2e-resilience-gate`、`ts-e2e-release-package-gate`、`ts-e2e-p1-p2-scenario-gate`、`e2e-business-flow`、`e2e-concurrency`、`e2e-non-functional`、`e2e-ui-interaction`、`e2e-spec-shall`、`ts-system-integration-validation-gate`、`testclaw-test-framework`、`harnessbench-evaluation` | FN-10.19、FN-10.20、FN-10.21、FN-10.31 |
| F-10.10 | 运维可观测增强与性能/可靠性门禁 | runtime operational log hardening、OTLP trace export、performance test gate、reliability test gate | 稳定基线 + 在建补齐 | `add-ts-runtime-operational-log-hardening`（多 spec 归档：`runtime-logging`、`structured-logging`、`redaction-policy` 等）、`otel-trace-export`、`ts-performance-test-gate`；在建 `add-ts-reliability-test-gate`(0/31 spec-only) | FN-10.22 ~ FN-10.25 |
| F-10.11 | 扩展能力（Cron/Task Channel/Workbench/Skill 元数据） | Cron 工具与任务管理 API、Task Channel 接入、Dev Agent Workbench、Skill catalog source metadata、Skill metadata extension | 稳定 | `cron-tools`、`cron-task-management-api`、`dev-agent-workbench`、`skill-catalog-query`、`skill-manifest-contract`（metadata extension）、`agent-task-channel` | FN-10.26 ~ FN-10.30 |
| F-10.12 | 前端交互与渲染能力族 | agent-web 浏览器投影下的交互与渲染能力：消息 markdown/mermaid 渲染、turn-run graph、BI 报表生成、PIU 历史回放/知识渲染/最小化、知识导入、composer 交互与输入上限、pending input UI、cron 任务面板、附件 composer、认证控件、页面布局与样式族（chat pane/composer button/right pane/skill selector/welcome block/process panel/expand panel）。与各域能力耦合的前端投影（标注控件、收藏列表、高频问题、投诉反馈）归属对应域特性 | 稳定 | `agent-web-assistant-markdown-rendering`、`agent-web-mermaid-rendering`、`agent-web-turn-run-graph`、`agent-web-bi-report-generation`、`agent-web-piu-historical-chat-replay`、`agent-web-piu-knowledge-render`、`agent-web-piu-minimize`、`agent-web-knowledge-import`、`agent-web-composer-interaction`、`agent-web-composer-input-limit`、`agent-web-composer-button-styles`、`agent-web-pending-input-ui`、`agent-web-cron-task-dashboard`、`agent-web-attachment-composer`、`agent-web-auth-control`、`agent-web-page-layout`、`agent-web-expand-panel`、`agent-web-chat-pane-styles`、`agent-web-right-pane-styles`、`agent-web-skill-selector-styles`、`agent-web-welcome-block-styles`、`agent-web-process-panel` | FN-10.32 ~ FN-10.37 |

## D11 可靠性与韧性

| 编号 | 特性 | 价值描述 | 状态 | spec 追溯 | 关联 function |
|---|---|---|---|---|---|
| F-11.1 | Checkpoint 恢复 | 重启后 runtime 按 queued/executing/terminal-pending、checkpoint、message、timeline、terminal facts 恢复；无法安全恢复时显式失败 | 稳定 | `local-runtime-recovery`、`gateway-store-provider-ownership`（checkpoints store）、`runtime-recovery-idempotency-guard`；在建 `fix-runtime-recovery-startup-readiness`(5/5 已完成待归档) | FN-11.1、FN-11.2、FN-11.3 |
| F-11.2 | 幂等写入 | IdempotencyKey 非空必填，重复 key 返回首次锚点事实结果且不重复 side effect；terminal commit 幂等 | 稳定 | `idempotency-contract`、`ts-web-command-idempotency` | FN-11.4、FN-11.5 |
| F-11.3 | 事务一致性 | 主路径复合持久化操作由 gateway 提供单一 composite write，gateway-local 以一个数据库事务完成 | 稳定 | `ts-backend-architecture`（架构约束） | FN-11.6 |
| F-11.4 | 并发控制 | same-session lane 串行 + 单 session 单 active run 拒绝并发，避免会话内状态竞争 | 稳定 | `session-lane-scheduling` | FN-11.7、FN-11.8 |
| F-11.5 | 容量与性能/可靠性验证门禁 | performance test gate 与 reliability test gate 提供可重复压测与边界测试 | 稳定基线 + 在建补齐 | `add-ts-performance-test-gate`；在建 `add-ts-reliability-test-gate`(0/31 spec-only) | FN-11.9、FN-11.10 |

---

## 状态统计

| 状态 | 特性数 |
|---|---|
| 稳定 | 66 |
| 稳定基线 + 在建补齐 | 12 |
| 在建 | 0 |
| 规划 | 0 |

> 注：本清单对活跃 change 的口径：add/enhance 类 change 扩展能力面，对应特性标「稳定基线 + 在建补齐」；refine/fix/adjust/restore/remove 类 change 只收敛或修正既有行为，特性保持「稳定」，仅在 spec 追溯列注明在建 change 与任务进度。已完成待归档的活跃 change（`adjust-trace-reporting` 18/18、`fix-runtime-recovery-startup-readiness` 5/5、`refine-skill-manifest-keys` 6/6）归档后需同步移除在建标注。workflow 域（D9）的契约、节点、执行引擎、持久化与远程执行已归档稳定（recipe v2 契约与 task channel 已分别于 2026-08-22、2026-08-21 归档）；剩余在建项为编排策略（model-planned workflow / loop-to-workflow learning / DAG optimization，未启动）与 durable event history（PAUSED）。F-1.6 的 pin 端点已移除，`migrate-question-pin-to-annotation` 正在将问题收藏迁移到 `conversation_annotations.isQuestionFavorited`。规划态特性（如 A2A-T 北向协议、远端 IAM 认证、动态插件热加载等）记录在 `openspec/overview.md` 范围外，未纳入本清单。
>
> **覆盖与排除说明**：`openspec/specs/` 全部归档 spec 均应在本清单 spec 追溯列可见。唯一显式排除项为 `tool-structured-delta`：该能力存在 2 个已确认未修复的持久化 bug（completion→LIVE_ONLY 丢失重建、流式 chunk 碎片化，根因为单一 `streaming` flag 控制点，见 GitCode issue #845），修复并归档对应 change 前不映射为稳定 Feature/Function。`conflict-resolution` spec 的 Purpose 段在归档时尚为 TBD 占位，按其来源 change（capability conflict resolution）归入 F-5.1。
