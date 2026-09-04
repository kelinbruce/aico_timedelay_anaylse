# NextAgent TS 后端规格概览

NextAgent 是面向电信网络智能体的框架，服务直接使用智能体的用户，以及基于框架二次开发的开发者和集成者。TS 后端规格必须围绕电信级质量要求组织：可靠、可恢复、安全隔离、可审计、可诊断、可维护、可测试。

Capability 最终结果稳定基线要求一次逻辑 Tool/Skill/Agent 调用只交付一个严格规范化结果；同参自动 retry 只由 `agent-capability` 在瞬态、retryable、幂等、未取消和 `maxRetries` 门禁同时满足时执行，缺省一次、最多五次额外 retry。成功、复合部分成功、失败和超时共用 `safeError`、`256000` UTF-16 code unit 容量及外置回读边界；合法空结果、正常非零进程退出、Workflow waiting control 和仅触发 fallback 不伪装降级。

Capability 调用、E1–E7 失败平面、20 个一方 Tool、普通 Agent/定向 Skill/隐藏 ApiCall/Workflow 消费、`ToolChoice`、loop 收敛和恢复坐标的完整白盒设计统一由 `openspec/designs/architecture/capability-invocation-and-failure-disposition.md` 承载，并作为可独立维护的长期事实入口。

TS 后端采用契约先行的开发方式。`agent-common` 和 `agent-contracts` 先冻结 shared id、owner scope、safe error、runtime command、RequestRun、timeline、stream projection、context、model、capability、gateway、observability 和 app composition 的最小 public contract，再由 runtime、Web channel、context、capability、gateway、observability 和 app package 并行实现。当前稳定基线已经包含最小 Agent 问答内核、Web submit/SSE/history、受控会话历史搜索、当前会话 conversation preview/navigation、SSE/WS 等价 stream transport、stream resume/replay（含无游标 live-tail）、stream/history consistency、runtime lifecycle、same-session lane scheduling、request cancel/retry、Agent assembly 版本绑定、context/model/capability 主链路、SQLite local gateway、terminal commit、本地单实例 runtime recovery、capability replay guard、owner scope、agent scope、local configured auth、对话标注（点赞/点踩/收藏；单用户回答收藏上限 100 条）能力及其 agent-web 集成契约、no-op 边界调用、自然语言 `$skill:` / `$workflow:` directive routing、SkillHub runtime acquisition loop、TodoWrite、local shared-data 只读输入根、受治理 structured tool delta / agent-web structured rendering、agent-web AICOConfig 外部 UI 定制契约（不含 Capability 业务名称，业务名称由 Provider-backed presentation resources 承载），以及同仓前端源码通过构建后 npm 包进入 `agent-app` 静态托管的 fullstack packaging boundary。

当前 Agent Web 稳定基线还包含：`FN-1.22 展示会话消息正文` 所定义的普通 assistant 完成态安全 Markdown、点分标识符、不可交互任务状态、保留列对齐的 GFM 表格与代码语义，以及表格和 Mermaid 在窄视口内保持 `560px` 可读结构并各自横向滚动、所有模型返回内容复用共享响应式消息列、完整 main scroll viewport 与 footer surface 安全区；Pending Input 响应面与普通 Composer 的互斥、恢复、展示型过期和 owning-request 取消委托；Composer 键盘、命令和草稿交互；Composer 输入框 2000 字符截断与引导（textarea 内容超过 `LONG_TEXT_THRESHOLD=2000` 字符时自动截断并显示 inline notice 引导用户使用 `.md` 文件作为附件上传大文本，截断不禁用发送按钮，中英文均按 1 字符计）；浏览器附件队列；根路由首次合法普通提交的会话建立顺序；自动和手工会话标题；仅面向当前最新问题的 text-only edit-resubmit；欢迎页高频问题回填；Turn Run Graph；以及有限的 Mermaid fence 检测、异步渲染和失败降级。上述浏览器行为只拥有投影与交互，不改变 runtime、channel、session、attachment 或 persistence 的既有 owner。

Agent Web 会话、定时任务和收藏主内容页面使用统一页面布局契约：共享 Header 和 `contained | fluid` 内容边界在 local、immersive 和 collaborative/PIU 中保持一致，页面操作继续由目标页面声明，宿主导航继续由宿主拥有，会话跟随底部、历史分页和锚点定位继续由既有 conversation viewport owner 决定。

当前跨会话活动稳定基线为每个可信 Owner + Agent scope 派生 `WAITING_FOR_INPUT`、`RUNNING`、`UNREAD_FAILURE`、`UNREAD_RESULT` 或 `NONE` 的唯一 session attention 状态。每个浏览器 app instance 使用一条独立于 Request Execution Stream 的全 scope Activity SSE/WS connection，以首帧稀疏 snapshot 和后续 session-keyed delta 驱动 local/immersive/collaborative 共用的列表提示；terminal unread 只在 matching run 已真实进入可见 shared conversation projection 后消费。Activity 不进入 `StreamEnvelope`、timeline、request lifecycle 或 IR route，重启只恢复 durable in-flight 状态，不复活历史 terminal unread。

当前 conversation process history 稳定基线保持 message/event 分离：调用中的累计 `LLM_THINKING_DELTA` 只用于 live，单次模型调用最后一个非空累计 delta 以 `completed=true` 持久化；ordinary Capability 的 canonical semantic result 仍由 `CAPABILITY_RESULT` Message 唯一拥有，受治理 `TOOL_STRUCTURED_DELTA` 只以按 `(runId, toolCallId)` 隔离、gateway 前不超过 49,000 UTF-8 bytes 的过渡 Event snapshot 服务 UI live/history，裁剪时保形并投影 `truncated=true`。Browser 对同一 run/tool 在 eligible Event snapshot 与 Message compatibility projection 中只选一个；该 snapshot 不进入 Context、terminal 或 completion limitation。run-scoped event API 与 SSE/WS/resume 复用同一 `StreamEnvelope` projector。Fork 在同一 composite 中物化 child-owned event snapshot，source 删除不影响 child，但 snapshot run anchor 不是 RequestRun，也不进入 lifecycle、context、provider input 或 prefix cache。完整边界见 `architecture/conversation-process-history.md`。

当前 web channel IR surface 稳定基线在 `/api/v1/ir` URL prefix 下提供与 ER 协议对等的机机交互 surface，恰好暴露 6 个端点（create session、submit request、SSE stream、cancel、retry、answer pending input），复用 ER 的 DTO、schema、stream envelope 和 runtime delegation，仅 URL prefix 和认证方式不同。IR surface identity 由 trusted-header 模式解析：`x-tenant-id` 和 `x-subject-id` 为必需、`x-display-name` 可选，上游 gateway 已完成认证并注入这些 header，NextAgent 只读取不自行校验凭据；请求体、query、metadata 和模型输出不得覆盖 header identity。IR surface 与 ER 认证隔离：IR route 使用 header-based auth，不暴露 UI-only ER 端点（bootstrap、skills、frequent-questions、conversation、favorites、shares）、WebSocket 或 multipart 上传；ER 端点路径保持不变。`registerWebChannel` 接受 `routePrefix` 参数构造路由路径，ER 注册 `/api/v1`、IR 注册 `/api/v1/ir` 并以 route whitelist 限定 6 个端点。

当前 capability 稳定基线包含统一 Tool/Skill/Agent capability contract、startup-only extension registration、owner-owned provider contributions、Agent-scoped startup plugin composition、builtin Tool/Skill source、Skill manifest contract、本地 Skill source、`bash`/`glob`/`python`/`write` builtin tools、`ToolSearch` 查询工具、`AskUserQuestion` 交互工具、`rag` 检索工具、CLIP-backed API tool source、Skill 驱动非 agentic API 调用（`_naie_agentic_loop_flag="false"` 时编排层程序化调用隐藏 `ApiCall` tool，解析 Swagger 2.0 yaml、模型单次提参、HTTP 调用并终态返回，不经模型多轮 loop）、穿越 sandbox gateway 的 executable capability 执行路由、Bash 命令权威下沉到 sandbox gateway denylist（Bash 只做 tokenization + sandbox 路由，executable allow/deny 由 sandbox gateway policy 决定，`clipc` 由 sandbox trusted locator 解析）、deny-by-default 安全兜底和跨平台可执行语义适配。Framework/reserved providers 不由 `agent-app` 手写清单或 raw config 声明；`agent-capability` 在启动期组装 internal owner providers、config-driven providers、external owner providers 和 plugin providers，冻结 `capabilityProviders` 供 app ready gate 做跨模块校验。系统级本地 Skill 由 `configRoot/skills` 以 EAGER discovery 进入 Catalog governance；Agent-owned 本地 Skill 由 trusted Agent package locator 定位 `configRoot/agents/{agentId}/skills`，以 SEARCH discovery 在当前 Agent request scope 中进入可用 Skill 清单。生命周期 Hook 的产品路径由 `agent-app` 在启动期接收 trusted app/plugin composition 已装配的显式 `LifecycleHook` 对象，冻结 hook registration / definition / AgentAssembly activation snapshot；Agent package 只通过 `agent.yaml.hooks` 表达当前 Agent 的启用、关闭、stage 收窄、排序、超时和配置，runtime 只消费 accepted run 固化的 snapshot，不从配置目录、manifest 或请求主路径扫描 hook。Plugin policy 通过 `agent-runtime` policy registry/resolver 保存为 Agent-scoped activation executable；policy point owner 通过 typed adapter 查询执行，当前仅开放 `agentRoutingPolicy`，未激活时 core 执行既有默认 routing policy。Agent capability discovery 已纳入统一 Catalog：builtin Agent 使用 `builtin-agents + EAGER`，顶层 local Agent 使用 `local-agents + EAGER`，父 Agent package 下的本地 subagent 使用 `local-subagents + SEARCH`，都以 governed `CapabilityDescriptor(kind="AGENT")` 表达；Agent tool 作为 Tool-kind 模型入口解析 governed AGENT descriptor，并通过 runtime-owned subagent execution 创建 fresh-context child session/run。配置输入和运行输出统一收敛为 `configRoot` 与 `workspaceRoot` 两个根；execution file access 从 `workspaceRoot/execution` 派生 accepted-run 逻辑 root：`workspace/` durable read/write、`.nextagent/` system-managed authorized resources、`temp/` run-scoped scratch。Read、Write、Edit、Glob、Grep 与 Bash/Python 对无已知 root 前缀的相对路径统一使用 accepted-run execution view 根；需要跨 run 保留的产物显式使用 `workspace/`，默认根统一不扩大系统管理 root、共享只读 root 或跨 scope 权限。

当前 capability prompt/disclosure 稳定基线包含 ToolSearch-owned request-local activation。trusted app composition 可以把 Skill disclosure 和 CLIP disclosure 配置为 `tool-search` 模式：系统 prompt 只暴露 `available-deferred-skills` 或 `available-deferred-clipc` 轻量候选，`ToolSearch` 只搜索当前 request 中 governed visible 的 Tool / Skill 元数据，并通过 request-local `allowedTools` 或 `discoveredSkills` 激活后续能力；该模式不得借机隐藏原本就可见的普通 Tool Calling 项。

当前 observability 稳定基线包含统一 observation handoff、operational / metrics / audit / trace 输出语义分离、fixed projector set 下的 audit / metrics / health / trace surfaces，以及 OTel adapter 的正式 owner 边界。`agent-observability` 拥有 TraceProjector、unified MetricsRegistry 和安全字段 allowlist；`agent-app` 是唯一的 tracer/meter/provider/exporter composition owner。cross-process trace propagation 只使用 W3C Trace Context，导出语义对齐 OTLP traces；`traceId/spanId` 和 OTel SDK 类型不得进入核心契约、runtime timeline、message metadata、gateway records 或 public DTO。`observability.logging.diagnosticDetail=debug` 仍不放宽 structured logging / audit / metric / trace redaction；唯一受控例外是 local operational runtime diagnostic 的 `toolInput` / `toolOutput` / `modelInput` / `modelOutput` / `rawExceptionData` 字段在 normal 与 debug 下均启用，只对 credential 与认证类 token 做窄匹配脱敏，不得由 `diagnosticDetail` 配置关闭。operational、LOCAL metrics、LOCAL audit 和 plugin diagnostic 四个文件族共享 `agent-local-file-roll` 机制代码但使用独立 handle/policy/destination，均按 30 MiB 或 process-local daily OR 轮转、gzip closed segment、最多 10 个 committed archive 和各自 retention（operational 7 天、metrics 7 天、audit 7 天、plugin diagnostic 3 天）。audit 只通过 write-only `AuditEventStoreGateway` 输出，不进入 SQLite、operational log 或共享 `AuditProjector`；LOCAL audit 写独立 NDJSON 文件族，REMOTE/PaaS 上报 audit service。metrics 只通过 OTel SDK `PeriodicExportingMetricReader` 输出，不进入 operational log；LOCAL 每 60 秒追加 cumulative 聚合快照到独立 metrics NDJSON 文件族，REMOTE/PaaS 使用 OTLP metric exporter。`agent-local-file-roll` 是 Node-only technical foundation package，只被 `agent-log`、`agent-observability` 和 `agent-platform-gateway-local` 消费。

当前 agent 执行轨迹稳定基线要求 context assembly、capability selection、sandbox execution、first visible model content 和 terminal outcome 通过统一 `ObservabilityObservationEvent` stream 进入结构化可观测面。`nextagent-operational.log.jsonl` 是主复盘视图，按 `surface` 区分 `runtime_diagnostic` 与 `observation_derived`，按稳定业务 refs 串起一次 request 的安全轨迹骨架；observation-derived trajectory 与 runtime direct diagnostic 共享物理 writer 但保留不同事实责任。canonical persisted timeline 仍是生命周期真相，默认 info log 只提供安全问题定位骨架，不是完整 durable replay source。稳定 turn ref / `AGENT_TURN_*` vocabulary 仍是后续可显式扩展的范围，不在首版已落地基线内。

当前治理稳定基线包含 runtime-owned risk policy enforcement 和统一 human interaction boundary。capability invocation、sandbox 动态执行、authorization/high-risk confirmation 和 recovery replay 前的受限操作都先经过系统内置 risk policy；policy 只消费可信安全摘要，输出 `ALLOW`、`DENY`、`REQUIRE_AUTHORIZATION`、`DEGRADED` 或 `POLICY_FAILED`，并通过 runtime-owned pending input、timeline-only `POLICY_APPLIED` 与 observability-owned `RiskPolicyEvaluation` 留下安全证据。澄清、确认、授权、选择和人工接管都通过同一 pending input lifecycle 进入暂停、超时、恢复和终止边界；默认 deadline 为创建后 30 分钟，显式 deadline 只允许创建后 24 小时内，runtime 以 deadline-driven single-flight processing 在无客户端流量时继续到期处理，并从 Agent-scoped durable unresolved facts 恢复半完成 timeout。`AskUserQuestion` 只是创建 `QUESTION` pending input 的 builtin Tool 入口，不创建第二套交互状态机。risk policy 不引入独立 `agent-contracts/policy`、独立 authorization store 或新的用户可见 stream event。

当前 guardrail 稳定基线包含 input/output guard 拦截轮的后端持久化语义。输入 BLOCKED 轮次不创建 run、不产生 terminal timeline event，Web channel 经 `RuntimeCommandPort.recordInputGuardBlock` 持久化共享同一 `requestId` 的用户输入消息与 RobotRouter 透传拒答消息，两条消息 `visible=true` 使 conversation 接口按真实时序返回供页面渲染，同时携带 `metadata.modelVisibility = { excluded: true, reason: "GUARD_BLOCKED" }` safe marker 使 context assembly 在后续轮次排除它们（`isHiddenReplacement` 在 `modelVisibility.excluded === true` 时返回 true，与 `visible` 字段无关）。output-guard block 的 assistant 终态消息以 `visible=false` 持久化，不进下一轮 model context。前端不再依赖本地伪造信封或 `sessionStorage` 镜像维持拦截轮可见性；页面刷新、关闭重开、锚定视图与 older/newer 游标分页后均按后端持久化事实可见。`recordInputGuardBlock` 是 `RuntimeCommandPort` 的可选命令，与 `hideRunMessages` 对称，identity 来自当前 trusted owner/Agent/session scope，经 `SessionMessageStoreGateway.appendSessionMessage` 写入，不新增 message role、stream event type、gateway port 或数据库表。

当前 prompt 稳定基线包含 context-engine owned purpose-aware prompt template assembly。`SYSTEM_PROMPT` 是高风险 purpose，summary generation、memory extraction 和自定义 purpose 复用同一 template selection/rendering/fallback/modelOptions handoff 边界。Agent package `prompts/` 在同步装配期注册为 Agent-scoped frozen template facts，runtime-facing `AgentAssembly` 不携带 prompt text、prompt root path、template refs 或 prompt id allowlist。内置 system prompt 还承载双语电信输出规则：模型默认跟随用户实际输入语言，同时对 NE/interface/KPI/protocol/alarm/CLI 等电信术语保留原始英文形式。

当前本地知识检索稳定基线包含 `rag` Tool 与本地 corpus governance 的分层边界。`rag` Tool 是统一 capability framework 下的查询入口，只依赖 public `RagRetrievalGateway`；显式 logical `indexes` 优先于 app composition 冻结的默认 logical indexes，只有省略 `indexes` 时才消费默认值；本地知识治理在 startup 基于 trusted workspace read scope 构建受治理语料，只服务当前 trusted owner + workspace scope 的本地检索可用性，不等同完整长期知识平台。

当前 Agent Core 稳定基线对 Capability 最终失败采用统一模型处置：所有非取消最终失败以完整安全 `CAPABILITY_RESULT` 进入下一模型轮，重复失败、空 Tool 名称和 Tool-call 超限不建立局部终止阈值；只有显式授权/生命周期控制、取消、模型结束或 accepted `maxTurns` 收敛请求。每个 normal turn 只接纳 `maxToolCallsPerTurn` 内的有序 Tool-call 前缀，尾部不保存、不执行并向模型反馈拆分；普通轮次耗尽后保留 Tool descriptors、强制 `toolChoice=NONE` 并且只执行一次 finalizing model turn。`RequestContext` 与 checkpoint 的 `agentTurnIndex` 保证 pause、resume 和 crash recovery 不重置轮次或重复 finalizing。模型终态把 provider-neutral `finishReason` 与 optional `incompleteOutputReason` 分离；`agent-model` 只用明确 Token 超限或预算饱和的结构残缺 Tool call 建立 `output-limit | truncated-tool-call` 封闭事实，空 Tool-call 终态仅凭精确 `truncated-tool-call` 证据进入恢复，`agent-core` 只依据该事实进入唯一恢复流程。两类原因均可先执行一次同请求预算提升；提升后的 reasoning-only 空 `output-limit` 先做至多一次 request-local 收敛重试，再最多续写 3 次，`truncated-tool-call` 提升后仍不完整则立即安全失败且不续写，所有残缺 Tool call 均零执行。correction 与恢复消息不持久化，usage 缺失、非法或预算未饱和不触发推断恢复。direct model 可见文本硬上限为 `150000` 个 UTF-16 code unit，超限时停止输出、保留有界前缀并追加固定截断标记作为唯一 terminal assistant message，以 `REQUEST_COMPLETED` 结束；超限后缀和未完整 Tool call 不进入 stream/history。

当前长期记忆稳定基线包含 owner-scoped、agent-scoped long-term memory core persistence contract，以及管理界面的 JSON 批量导入、每批 1 至 100 条的批量新增 REST 契约和当前筛选 CSV 导出。它定义跨 session retained memory 的基础 record、search/list/detail/count/state transition、批量新增逐项准入和 graceful degradation 行为；浏览器只拥有严格文件校验、transient preview、本地化安全导出和交互反馈，服务端继续拥有容量、安全、幂等与持久化最终裁决，且不阻塞 request terminal commit。

当前长期记忆稳定基线包含 owner/agent scoped long-term memory core、冻结 `nextAgent.memory.*` 配置、模型显式调用的 memory tools、post-terminal task trajectory 学习输入层、默认关闭的 dreaming extraction 和默认关闭的 aging lifecycle。长期记忆能力不进入 request terminal commit 必经路径；Context Assembly 不自动检索或注入长期记忆，模型需要记忆时通过 governed memory tools 显式调用。local backend 由 gateway-local 持久化 memory/trajectory facts，`agent-memory` 承载本地业务编排；remote complete-service backend 选择后，本地 trajectory/extraction/aging/revival helper 不启动。`get_memory_detail` 的模型可见成功结果只包含完整 category-specific 结构化业务内容，不包含 retained source 或内部执行来源坐标；retained source 写入模型隐藏的 `CapabilityInvocationResult.metadata.sourceTrace` 供本地 canonical `toolOutput` 一步定位，不进入模型输入、durable `CAPABILITY_RESULT` 或任何 outward surface。该隔离使 canonical 新记忆详情结果不携带 source run ID，从而保持会话分支通用 source-run 引用检查的 fail-closed 安全语义，无需 Tool 专用例外。
当前 gateway persistence 稳定基线将持久化能力与 SQLite 实现解耦。Working Memory provider 拥有 request/session/message/timeline/checkpoint/pending-input/annotation/share 等运行中工作事实和相关复合事务；runtime 向任一 local/remote timeline gateway 提交 structured presentation record 前，必须保证 `inlinePayload` 的 JSON UTF-8 bytes 不超过 49,000，真实 append failure 继续传播。Long-term Memory provider 同时拥有长期记忆 store 与 retriever；保留 SQLite provider 只承载 attachment reservation/blob、task trajectory、todo、user question activity 等明确列举的本地 stores（audit 已移出 SQLite，由顶层 `GatewayBindings.audit` 的 write-only `AuditEventStoreGateway` 独立承载）。LOCAL 部署从 `workspaceRoot` 派生 `working-memory.sqlite`、`long-term-memory.sqlite` 和 `nextagent.sqlite` 三个独立文件，不读取旧单库、不双写、不运行时 fallback。当前附件上传稳定基线包含统一暂存上传流程（阶段 1 temp upload + 阶段 2 submit-finalize，所有部署模式相同）、`ChatUploadConfigProvider` 按 deploymentMode 分离 LOCAL/REMOTE 实现（REMOTE 模式 fingerprint 动态检测配置文件变更）、文件内容安全校验（文件名正则、magic bytes 交叉验证、zip 炍弹防护 ≤512MB、zip slip 防护）、per-user 累计配额（200 文件/500MB）和频率限制（500 次/小时）、`BlobStoreGateway` 扩展 `copyBlob`/`getBlobMetadata`/`listBlobs`/`deleteBlob`（`storeBlob` 改为接收 `localFilePath`）、runtime 物化附件到 run-scoped temp 目录并通过 `ToolExecutionContext.attachmentPaths` 和 sandbox `FILE_PATHS` 传递给 Skill tool、`AttachmentContextEvidence` 暴露 safe metadata（`fileName`/`mediaType`/`sizeBytes`，不含 `storageRef`）、context engine 两种模式都跳过 blob content 读取只渲染元数据。REMOTE 模式 `BlobStoreGateway` remote 实现待隔离环境提供。当前附件 intake 稳定基线还包含 markdown 附件强制接受：`.md`/`.markdown` 扩展名跳过 `matchFileExtension` 扩展名白名单校验，仍受 magic bytes 交叉验证、zip 炍弹/zip slip 防护、配额和频率限制约束，使大文本以 markdown 附件而非超长 Composer 文本提交。
当前 workflow 稳定基线包含 agent-core routing 的 workflow 执行分支、`agent-workflow` 物理包、单实例内存态 `WorkflowExecutionService`、启动期本地 recipe 加载、WORKFLOW capability 发现、六类节点 handler（gateway / parallel-gateway / capability / interaction / knowledge / llm）以及 workflow pending-input 桥接。Workflow Capability 节点只消费统一调用边界的最终结果；节点 retry 只下沉为该逻辑调用内部的额外 attempts，最终失败不再被第二层重放，而是进入显式 exception，无匹配分支时 Workflow 失败，取消直接中断。合法 `NODE_WAITING` 使用 `SUCCEEDED + WORKFLOW_NODE_WAITING` 控制结果表达。workflow 不拥有 request lifecycle、cancel、checkpoint、terminal commit 或 pending input store——这些仍归 `agent-runtime`；workflow 经 runtime-owned `AgentRunStatePort` 与 observer 投影与 runtime 协作。首版不实现 distributed scheduling、snapshot/resume/recovery、rollback/degrade 和 durable workflow history。跨模块协作与 deferred 范围见 `architecture/workflow-execution-and-routing.md` 与 `modules/agent-workflow.md`。

当前会话生命周期稳定基线包含用户主动删除会话能力。删除通过 `DELETE /api/v1/sessions/:sessionId` 进入 runtime/session 边界，按 trusted owner scope 和 trusted Agent scope 校验目标 session，并在 gateway-local 单一事务中物理删除 session 主路径事实及 annotation/share 等从属事实。删除不会隐式 cancel 非 terminal run，也不引入回收站或软删除 retained state。

当前会话派生稳定基线包含从已持久化、可见、可渲染的 assistant message 派生 child session。派生复制 source session 从开头到 anchor 的 canonical durable message prefix，并在 child 内重写 message/session/request refs、初始化 child active context v0、记录窄化 fork source metadata；对应 display runs 的 durable timeline events 被重映射为 child-owned `FORK_SNAPSHOT`，只服务过程历史查询。它不复制 source RequestRun、checkpoint、pending input、tool state 或 parent active context。实时完成的 assistant 回复通过 request/root message id 路由解析到唯一 durable assistant message后复用同一 message-anchor fork 语义。

当前对话分享稳定基线使用 ops hash 权限白名单语义。Share creation 请求体 `allowedOps` 为长度 1 的 string 数组或 null：null 表示公开分享，任何人凭 `shareId` 可查看且后端不校验 ops；非 null 数组元素为创建者 ops 集合的 SHA-256 hash。前端在调用创建或查看 API 前对完整 ops 数组执行确定性 hash 变换（去重 + 字典序排序 + `JSON.stringify` + SHA-256 + lowercase hex），打乱顺序或包含重复元素的相同 ops 集合产生相同 hash。查看者（remote 模式）通过 `X-Viewer-Ops` header 传递自身 ops 的 SHA-256 hash（长度 1 的数组），后端校验 `storedHash === viewerHash` 相等：只有 ops 集合完全相同的用户才能通过校验，取代了子集判断语义。Local 模式下查看者不携带此 header，后端视为无 ops。该权限门槛同时作用于 Share creation Web API contract 和 Shared conversation view Web API contract。

当前架构测试门稳定基线包含 source-level Vitest + Playwright 行为契约。测试门以真实 API 行为为准验证功能、兼容性、可观测性和 UI 交互，不用假设值强行覆盖真实返回码、SSE-only transport 或 trusted identity 产品路径。

当前 E2E 稳定基线还包含 `P1/P2` 联合场景门槛。`ts-e2e-p1-p2-scenario-gate` 只接收真实 product process、真实 transport、真实 persistence 和真实 orchestration 的黑盒场景，以 activated/planned/excluded 三态 inventory 管理准入；当前 activated 清单固定覆盖 extension governance、long-term memory、routing child-agent、human pending input、workflow routing 和 conversation share 六类联合场景，并要求每个 case 保持唯一 owner gate 与安全 evidence 输出。

当前框架效果外部评测稳定基线包含 HarnessBench 评测能力。系统以 `node tests/harnessbench/run.mjs` 作为唯一标准全量评测入口，在任务执行前解析 HarnessBench Git commit（完整 40 位提交哈希）、NextAgent Git commit、模型标识和该 HarnessBench commit 的完整 task catalog，写入不可变全量评测清单（每个 task id 恰好出现一次，状态为 `execute` 或 `unsupported`）。每个 `execute` task 使用当前工作树构建的 NextAgent local runtime，通过公开的会话、请求和 stream 行为提交任务并等待 terminal result；`unsupported` task 以 0 分形成终态结论，但不计入 `frameworkEffectScore` 的 `scoringDenominator`。系统在第一个计分 task 前验证真实模型 provider 与 credential 可用，每个 `taskScore > 0` 的 task 必须从 HarnessBench usage proxy 取得至少一次成功上游模型请求和大于 0 的总 token 用量；grader provider/credential/model id 从显式安全引用解析并在第一个计分 task 前验证鉴权与评分返回结构。输出包含逐任务终态结论、完整计分运行的 `frameworkEffectScore`、评分覆盖缺口、跨 adapter 轮次归并的安全诊断、模型输出上限观测、显式总体的互斥计分统计、有界恢复行为、定向回归能力和 schema version 4 可追溯报告；已知 stream 等待失败以闭集原因码区分，并可在同一 accepted run 上按 cursor 续接 idle-close stream。该能力不属于发布门禁默认阻断，不定义发布阈值；系统 MUST NOT 修改 `packages/**`、公共契约、产品默认 Agent 或 HarnessBench task/oracle/评分实现来使任务通过，且报告 MUST NOT 泄露 prompt、模型输出、credential 或其他敏感信息。

当前插件开发诊断稳定基线包含跨部署统一诊断产物输出和离线轨迹查看器。`DeveloperDiagnosticArtifactSink` 在 LOCAL、REMOTE 和后续受支持部署模式中默认可写，`agent-log` 是 developer diagnostic artifact 物理 writer 的唯一 owner，使用 deployment-neutral 名称 `createDeveloperDiagnosticArtifactWriter` 创建独立 `agent-local-file-roll` lazy physical handle（首条合法记录触发 active destination，无记录时无文件副作用），不与 operational writer 共享 destination、buffer、maintenance state 或 lifecycle；`agent-app` 在公共 composition 中使用调用方显式提供的 factory 或默认 `agent-log` writer，不读取 `deployment.mode` 决定能力。已接受记录写入直接位于 `paths.logDirectory` 的独立 NDJSON 文件族（`nextagent-plugin-diagnostic` 专属前缀，不创建子目录），每个物理记录包含 `schemaVersion=1`、`recordedAt`、宿主绑定的 `pluginId`、`artifactType`、可信运行坐标和 `payload`；该文件族不与 operational log、audit 或 metrics 共享 active destination、selector、maintenance state 或 retention lifecycle，按 daily boundary 或 30 MiB 轮转、gzip closed segment、最多 10 个 committed archive 和 3 天 elapsed retention。插件诊断轨迹离线查看器作为单个本地 HTML 文件离线运行，使用者选择一份本地 developer diagnostic artifact NDJSON 文件后，查看器按 `(sessionId, requestId)` 精确有序组合识别全部执行轨迹，以确定顺序呈现事件流程、阶段核心指标（`BEFORE_PLANNING`/`AFTER_MODEL_RESULT`/`BEFORE_CAPABILITY_INVOKE` 各自唯一映射）和原始记录详情；查看器不依赖 NextAgent 服务、不发起网络请求、不写入持久存储，字符串作为文本显示不作为 HTML 执行，非法行只降级自身并报告行号与稳定原因。包含官方 `developer-hook-trace` 插件的本地运行包在 `plugin.json` 和 `index.js` 同级位置包含 `trace-viewer.html` 伴随文件，该 HTML 可独立打开，插件 loader 不读取或执行它。

官方 `agent-router-plugin` 提供模型驱动路由策略：显式路由未先行决定时，插件通过 plugin API `1.2` factory host 的 closed runtime services 独立完成当前 Agent 候选解析（enabled 显式 Skill/Workflow bindings 与治理可用性的交集）、optional builtin `Rag` 预筛（`topK` 1–10，默认 5）、prompt 解析（framework well-known purpose `AGENT_ROUTING_SELECTION`，无 Agent override 时使用插件内置默认提示词）和当前 Agent 初始模型一次无 Tool 终选；结果只能是一个 Skill、一个 Workflow 或 no-match，依赖失败安全拒绝。prompt template assembly 通过唯一 `PromptTemplateResolverPort` 公共 resolver（closed `RESOLVED | NOT_FOUND`）服务 router 与其它 model-facing consumer。backend-capable 本地 runtime 包默认携带该 artifact 但不声明、不激活，operator 需显式配置。
当前 Task Channel 稳定基线提供面向后台服务系统的 HTTP/JSON 机机契约。以 runtime equestId 为外部 	askId、以 runtime sessionId 为独立会话坐标，通过流式 SSE（/api/v1/stream-task 系列，SSE 直接作为 response body）和异步 callback（/api/v1/async-tasks 系列，JSON 控制响应 + callback 推送）两条独立路由树交付任务生命周期事件。channel 创建 session 后 submit 失败时 best-effort 清理 orphan session（共享 helper cleanupOrphanSession 由 gent-channel-common 提供）。POST /api/v1/tasks/query 支持批量对账恢复（maxItems=20）。channel 层过滤 BACKGROUND_TASK_STARTED/COMPLETED/FAILED 和 OUTPUT_GUARD_BLOCKED 四个事件类型不推送给消费者。TaskEventType 枚举保留 23 个值穷尽映射不变。callback 使用专用 TaskCallbackDeliveryPort（固定 POST JSON schema + 可信 URL policy），不得演化为通用 HTTP executor。eportEvents 参数（ALL/TERMINAL）控制 callback 事件范围，事件过滤引挚暂不实现，当前行为等同 ALL。traceparent header 透明传入但不解析，数据传递到 runtime/capability 出站单开 change 处理。ileContent.url remote intake 保持 deferred。RuntimeSessionPort.getRequestSummary 返回类型含 	erminalResult 字段，用于终态结果数据返回。

Web UI 消费方契约（23 种 channel event 的 UI 状态映射，其中 22 种来自 canonical timeline projection、safeResult.kind × 呈现矩阵、4 种 durable pending input kind × 渲染矩阵、reconnect/replay 状态阶梯、SafeError code/category → 失败卡片映射、message history 与 run event history 的组合）由 `openspec/designs/architecture/conversation-ui-state.md` 整合，只引用、导航或摘要现有 specs，不重复定义状态机、API schema、数据 owner 或接口语义。UCD 设计表达文档（用户画像、旅程、整体视觉框架、容器与组件层级、边界状态与文案、样例验证、功能全景、动态行为、集成方定制指南等 28 篇）位于 `docs/ucd/`，作为 UCD 设计人员的设计表达层，非 OpenSpec 基线，不定义契约。

普通 Agent Web 对 `DEGRADATION_NOTICE`、`CONTEXT_COMPACTED` 和前端兼容 `HOOK_DEGRADED` 使用集中、固定且本地化的事实性业务语言。处理受限与 Hook 兼容提示采用 warning 语义，上下文整理采用 info 语义；任意 payload 文本不进入普通标题或基础摘要，显式安全技术码默认收起。durable 系统过程事件在 live 与 history 中保持相同语义，transport notice、短暂整理动画和 Hook 兼容提示保持 live-only，请求终态继续由独立 terminal presenter 呈现。


本地 sandbox 在维持受信 root layout、超时、取消和入口校验的同时，不修改调用方既有文件或目录的宿主权限元数据；需要强文件系统隔离的部署使用 REMOTE/PaaS sandbox 平台。

ToolSearch 默认发现当前 Agent/run 中受治理的延迟能力；默认可见 Tool 和 Skill 继续直接可用，搜索命中仅在当前请求的后续模型 step 激活。

## 范围

- 仓库根目录承载 TS 后端 workspace、后端 package、后端测试和后端构建工具；同仓 `frontend/agent-web` 前端源码可以存在，但后端只能消费其构建后的 `@nextagent/agent-web` npm 包产物。
- `openspec/specs/` 承载归档后的稳定行为契约。
- `openspec/designs/` 承载归档后的稳定设计事实。
- active change 的设计先写在 `openspec/changes/<change>/design.md`，归档后再提炼到稳定设计文档。

## 当前基线范围外

- 不定义未被稳定 spec 覆盖的通用前端页面行为、浏览器状态管理或前端路由设计；已进入稳定 spec 的 agent-web host modes、AICOConfig 定制（不含 Capability 业务名称）与 active Agent package `portal-ability-config` 的入口开关（`cron-tasks-enabled`、`long-term-memory-management-enabled`、`knowledge-import-enabled`、`full-process-enabled`，默认 `true`，仅明确 `false` 关闭对应入口；`full-process-enabled` 只隐藏“完整过程”按钮，不移除执行详情）、PIU 注入、对话标注图标状态与收藏列表还原语义按对应前端契约维护。
- 不定义 remote/IAM 认证协议、public gateway auth contract、非 localhost 本地认证暴露、reverse proxy/TLS secure-cookie 部署规则或 server-side auth session store。
- 不定义动态插件加载、运行时热插拔、远端实现包加载、第三方包分发协议、完整本地运行包打包/升级、任意历史消息编辑、browser attachment edit、批量编辑、超出当前浏览器附件队列与既有 intake contract 的附件产品能力、多实例 recovery、真实 sandbox 平台容器/进程隔离、远端 AgentRegistry 执行、继承父上下文的 subagent 执行、长期记忆 sharing/publish/fork 的批量迁移、remote complete-service memory protocol、context assembly 自动记忆注入或多实例 durable memory scheduler。

## 稳定基线

- 架构契约：`openspec/specs/ts-backend-architecture/spec.md`
- 核心契约：`openspec/specs/ts-core-contracts/spec.md`
- 最小 Agent 内核：`openspec/specs/ts-minimal-agent-kernel/spec.md`
- 会话历史搜索：`openspec/specs/session-history-search/spec.md`
- 当前会话 preview/navigation：`openspec/specs/session-conversation-preview/spec.md`
- 跨会话 Activity 感知：`openspec/specs/cross-session-activity-awareness/spec.md`
- Agent Web Composer 交互：`openspec/specs/agent-web-composer-interaction/spec.md`
- Agent Web Composer 输入截断与引导：`openspec/specs/agent-web-composer-input-limit/spec.md`
- Agent Web 浏览器附件队列：`openspec/specs/agent-web-attachment-composer/spec.md`
- 会话标题自动生成：`openspec/specs/session-title-generation/spec.md`
- 会话标题手工更新：`openspec/specs/session-title-update/spec.md`
- 最新问题编辑重提：`openspec/specs/request-edit-resubmit/spec.md`
- 会话派生：`openspec/specs/session-fork-from-message/spec.md`
- 本地配置认证：`openspec/specs/ts-local-configured-auth/spec.md`
- Web channel IR surface：`openspec/specs/web-channel-ir-surface/spec.md`
- Guardrail 网关：`openspec/specs/guardrail-gateway/spec.md`
- 本地 Skill source：`openspec/specs/local-skill-source/spec.md`
- Extension registration：`openspec/specs/extension-registration/spec.md`
- Agent-scoped plugin composition：`openspec/specs/agent-scoped-plugin-composition/spec.md`
- 插件开发诊断产物：`openspec/specs/plugin-developer-diagnostic-artifacts/spec.md`
- 插件诊断轨迹查看器：`openspec/specs/plugin-diagnostic-trace-viewer/spec.md`
- 会话 lane 调度：`openspec/specs/session-lane-scheduling/spec.md`
- 请求取消：`openspec/specs/request-cancel/spec.md`
- 请求重试：`openspec/specs/request-retry/spec.md`
- 对话标注：`openspec/specs/conversation-annotation/spec.md`
- 运行状态可见性：`openspec/specs/ts-run-status-visibility/spec.md`
- 本地 runtime recovery：`openspec/specs/local-runtime-recovery/spec.md`
- Runtime recovery 幂等保护：`openspec/specs/runtime-recovery-idempotency-guard/spec.md`
- Web SSE/WS transport：`openspec/specs/ts-web-sse-ws-transports/spec.md`
- Stream resume/replay：`openspec/specs/ts-stream-resume-replay/spec.md`
- Stream/history consistency：`openspec/specs/ts-stream-history-consistency/spec.md`
- Fullstack packaging 边界：`openspec/specs/fullstack-packaging-boundary/spec.md`
- 配置网络连通性（IPv6/双栈监听与出站）：`openspec/specs/network-connectivity/spec.md`
- TESTClaw 二进制包黑盒测试框架：`openspec/specs/testclaw-test-framework/spec.md`
- TS 契约测试门禁：`openspec/specs/ts-contract-test-gate/spec.md`
- Alpha E2E gate：`openspec/specs/ts-e2e-alpha-kernel-gate/spec.md`
- Product journey E2E gate：`openspec/specs/ts-e2e-product-journey-gate/spec.md`
- Security E2E gate：`openspec/specs/ts-e2e-security-gate/spec.md`
- Resilience E2E gate：`openspec/specs/ts-e2e-resilience-gate/spec.md`
- Release package E2E gate：`openspec/specs/ts-e2e-release-package-gate/spec.md`
- P1/P2 Scenario E2E gate：`openspec/specs/ts-e2e-p1-p2-scenario-gate/spec.md`
- HarnessBench 框架效果评测：`openspec/specs/harnessbench-evaluation/spec.md`（外部框架效果评测，固定 HarnessBench 基线，`frameworkEffectScore`，非发布门禁默认阻断）
- TS 系统集成验证门禁：`openspec/specs/ts-system-integration-validation-gate/spec.md`（TestClaw 独立执行 122 个 activated 用例，对候选运行包和外部 package artifacts 做黑盒系统集成与 E2E 验证，不复用源码测试结果）
- E2E 业务流验证：`openspec/specs/e2e-business-flow/spec.md`
- E2E Spec SHALL 验证：`openspec/specs/e2e-spec-shall/spec.md`
- E2E 并发验证：`openspec/specs/e2e-concurrency/spec.md`
- E2E 非功能验证：`openspec/specs/e2e-non-functional/spec.md`
- E2E UI 交互验证：`openspec/specs/e2e-ui-interaction/spec.md`
- Agent Web 主内容页面布局：`openspec/specs/agent-web-page-layout/spec.md`
- Agent Web Pending Input 响应面：`openspec/specs/agent-web-pending-input-ui/spec.md`
- Agent Web 普通 assistant Markdown：`openspec/specs/agent-web-assistant-markdown-rendering/spec.md`
- Agent Web Mermaid 渲染：`openspec/specs/agent-web-mermaid-rendering/spec.md`
- Agent Web Turn Run Graph：`openspec/specs/agent-web-turn-run-graph/spec.md`
- 大内容 offload / replacement：`openspec/specs/large-content-references/spec.md`（baseline 由 `add-ts-large-content-references` 建立；8 个增量 requirement 落在 `openspec/specs/context-engine/spec.md`；oversized textual capability-result 的 externalize 目标为 execution workspace 文件，经 `read` 工具分页读回）
- 大内容分页读回：`openspec/specs/large-content-readback/spec.md`（模型经现有 `read` + `file_path` 分页读回外部化工具结果；`read` 豁免 externalize；owner-scope 经 execution workspace resolver 强制）
- Agent 包装配：`openspec/specs/agent-package-assembly/spec.md`
- Routing constraint validation：`openspec/specs/routing-constraint-validation/spec.md`
- Capability 统一调用与失败处置：`openspec/specs/capability-catalog/spec.md`
- Agent Tool loop 收敛与前缀接纳：`openspec/specs/tool-loop/spec.md`
- 模型调用与 canonical Tool choice：`openspec/specs/model-invocation-contract/spec.md`
- 文件操作 Tool：`openspec/specs/file-operation-tools/spec.md`
- 命令与脚本 Tool：`openspec/specs/command-script-tools/spec.md`
- Workflow 执行契约：`openspec/specs/workflow-contracts/spec.md`
- Workflow RAG 检索 gateway：`openspec/specs/workflow-rag-gateway/spec.md`（workflow knowledge 节点专用 RAG gateway port，与 rag-tool 的 `RagRetrievalGateway` 平行；承载 per-index `indexType`/`vsTopN`/`esTopN`/`filters`，local 降级 + remote 透传 + composition 独立接线）
- Prompt template assembly：`openspec/specs/prompt-template-assembly/spec.md`
- Invoked Agent discovery：`openspec/specs/invoked-agent-discovery/spec.md`
- Agent tool：`openspec/specs/agent-tool/spec.md`
- API-backed Tool source：`openspec/specs/api-backed-tool-source/spec.md`
- ToolSearch：`openspec/specs/tool-search-tool/spec.md`
- AskUserQuestion tool：`openspec/specs/ask-user-question-tool/spec.md`
- AskUserQuestion trigger policy：`openspec/specs/ask-user-question-trigger-policy/spec.md`
- Authorization pending input：`openspec/specs/authorization-pending-input/spec.md`
- Confirmation pending input：`openspec/specs/confirmation-pending-input/spec.md`
- Question pending input：`openspec/specs/question-pending-input/spec.md`
- Human pending input core：`openspec/specs/human-pending-input-core/spec.md`
- Human pending input timeout：`openspec/specs/human-pending-input-timeout/spec.md`
- Human handoff：`openspec/specs/human-handoff/spec.md`
- RAG Tool：`openspec/specs/rag-tool/spec.md`
- RAG knowledge governance：`openspec/specs/rag-knowledge-governance/spec.md`
- 电信双语输出：`openspec/specs/telecom-bilingual-output/spec.md`
- Bash tool：`openspec/specs/bash-tool/spec.md`
- 文件读取、写入和编辑：`openspec/specs/file-operation-tools/spec.md`
- 文件名和内容搜索：`openspec/specs/file-search-tools/spec.md`
- 会话删除：`openspec/specs/session-delete/spec.md`
- Runtime metrics：`openspec/specs/agent-runtime-metrics/spec.md`
- Trace/log linking：`openspec/specs/trace-log-linking/spec.md`
- Agent 执行轨迹：`openspec/specs/agent-execution-trajectory/spec.md`
- OTel observability adapter：`openspec/specs/otel-observability-adapter/spec.md`
- OTLP trace export：`openspec/specs/otel-trace-export/spec.md`
- TS 架构测试门：`openspec/specs/ts-architecture-test-gate/spec.md`
- 长期记忆核心：`openspec/specs/memory-core/spec.md`
- 记忆配置：`openspec/specs/memory-configuration/spec.md`
- 记忆工具：`openspec/specs/memory-tools/spec.md`
- Task trajectory 学习输入层：`openspec/specs/task-trajectory/spec.md`
- 记忆提取：`openspec/specs/memory-extraction/spec.md`
- 记忆老化：`openspec/specs/memory-aging/spec.md`
- 长期记忆导入和导出：`openspec/specs/long-memory-import-export/spec.md`
- 长期记忆 Web 管理：`openspec/specs/long-memory-web-management/spec.md`（immersive Shell 内记忆管理内容区，13 个 REST 端点含批量新增委托 management port，身份来自可信 resolver，记忆只读投影单独隐藏绝对路径）
- Lifecycle hook execution：`openspec/specs/lifecycle-hook-execution/spec.md`
- Risk policy enforcement：`openspec/specs/risk-policy-enforcement/spec.md`
- Skill resource access / execution file roots：`openspec/specs/skill-resource-access/spec.md`
- Sandbox 执行运行时：`openspec/specs/sandbox-runtime/spec.md`
- Sandbox deny-by-default 安全兜底：`openspec/specs/sandbox-deny-by-default-adapter/spec.md`
- Skill tool 执行与披露：`openspec/specs/skill-tool/spec.md`
- Skill 列表查询 API：`openspec/specs/web-skill-catalog/spec.md`
- Skill 选择组件行为：`openspec/specs/skill-selector-ui/spec.md`
- Web 命令幂等：`openspec/specs/ts-web-command-idempotency/spec.md`
- AICOConfig 配置契约：`openspec/specs/aico-config-contract/spec.md`
- AICO PIU 注入：`openspec/specs/aico-piu-injection/spec.md`
- AICO 布局模式：`openspec/specs/aico-layout-mode/spec.md`
- AICO 展示控制：`openspec/specs/aico-display-control/spec.md`
- Agent Web 答案投诉反馈：`openspec/specs/agent-web-complaint-feedback/spec.md`
- Workflow 事件历史：`openspec/specs/workflow-event-history/spec.md`
- 架构设计：`openspec/designs/architecture/ts-backend-architecture.md`
- Pending Input 生命周期设计：`openspec/designs/architecture/pending-input-lifecycle.md`
- Agent plugin composition：`openspec/designs/architecture/agent-plugin-composition.md`
- Plugin 安全治理：`openspec/designs/architecture/security-and-governance.md`
- Capability SPI：`openspec/designs/architecture/capability-spi.md`
- Agent plugin SDK：`openspec/designs/modules/agent-plugin-sdk.md`
- Agent-scoped startup plugin composition ADR：`openspec/designs/adr/agent-scoped-startup-plugin-composition.md`
- Fullstack packaging 设计：`openspec/designs/architecture/fullstack-packaging-boundary.md`
- 配置边界与网络连通性设计：`openspec/designs/architecture/configuration-boundary.md`
- Agent Web host modes 与 AICOConfig 设计：`openspec/designs/architecture/agent-web-host-modes.md`
- Web UI 消费方契约整合（conversation-ui-state）：`openspec/designs/architecture/conversation-ui-state.md`；UCD 设计表达文档位于 `docs/ucd/`
- Agent Web 模块职责：`openspec/designs/modules/agent-web.md`
- AICOConfig validation ADR：`openspec/designs/adr/aico-config-handwritten-validation.md`
- AICOConfig no-hot-reload ADR：`openspec/designs/adr/aico-config-no-hot-reload.md`
- 测试架构与 TESTClaw 关系：`openspec/designs/architecture/testing.md`
- Runtime 边界：`openspec/designs/architecture/runtime-boundaries.md`
- Runtime recovery：`openspec/designs/architecture/runtime-recovery.md`
- Web stream transport 和 projection：`openspec/designs/architecture/web-stream-transports.md`、`openspec/designs/architecture/stream-projection.md`
- Conversation process history：`openspec/designs/architecture/conversation-process-history.md`
- Remote service call：`openspec/designs/architecture/remote-service-call.md`
- 本地认证边界：`openspec/designs/architecture/authentication-boundary.md`、`openspec/designs/architecture/local-auth-session.md`、`openspec/designs/architecture/web-auth-local.md`
- Owner scope 和安全边界：`openspec/designs/architecture/owner-scope-security.md`
- 对话分享（受控跨 scope 只读查看）：`openspec/specs/conversation-share/spec.md`、`openspec/designs/adr/owner-scope-controlled-exception-share-viewing.md`
- 共享会话视图：`openspec/specs/shared-conversation-view/spec.md`
- 可观测边界：`openspec/designs/architecture/observability-boundaries.md`
- 核心契约设计：`openspec/designs/architecture/core-contracts.md`
- Capability SPI 设计：`openspec/designs/architecture/capability-spi.md`
- 长期记忆架构：`openspec/designs/architecture/memory.md`
- Prompt template assembly 设计：`openspec/designs/architecture/prompt-template-assembly.md`
- Skill 调用与资源披露：`openspec/designs/architecture/skill-invocation-and-disclosure.md`
- RequestRun 领域模型：`openspec/designs/architecture/request-run.md`
- Workflow 执行与路由：`openspec/designs/architecture/workflow-execution-and-routing.md`
- 模块职责：`openspec/designs/modules/*.md`
- 技术栈 ADR：`openspec/designs/adr/0001-ts-backend-stack.md`
- Prompt template 完整选择 ADR：`openspec/designs/adr/prompt-template-complete-selection.md`
- Memory tools 边界 ADR：`openspec/designs/adr/memory-tools-boundary.md`
- Task trajectory 学习输入 ADR：`openspec/designs/adr/task-trajectory-learning-input.md`
- Large tool result workspace readback ADR：`openspec/designs/adr/large-content-workspace-readback.md`
- Memory extraction 边界 ADR：`openspec/designs/adr/memory-extraction-boundary.md`
- Memory aging lifecycle ADR：`openspec/designs/adr/memory-aging-state-lifecycle.md`
- Capability provider contribution registration ADR：`openspec/designs/adr/capability-provider-contribution-registration.md`
- 用户问题活动持久化：`openspec/specs/user-question-activity/spec.md`
- 高频问题查询 API：`openspec/specs/frequent-question-api/spec.md`
- 高频问题前端组件：`openspec/specs/high-frequency-question-ui/spec.md`
- 输入联想查询 API：`openspec/specs/question-association-api/spec.md`
- 输入联想前端面板：`openspec/specs/question-association-ui/spec.md`
- 导航：`openspec/designs/spec-to-design-map.md`

## 分类问题推荐

分类问题推荐是面向电信网络运维场景的静态预设问题快捷选择能力。分类问题数据以 JSONL 文件形式部署在 `agents/{agentId}/resource/category-question-{locale}.jsonl`，运行时加载到内存，通过 `GET /api/v1/category-questions` API 暴露给前端。前端在输入框上方以与 Skill chip 完全一致的渲染逻辑展示一级分类 chip，点击后弹出 modal 展示该分类下的具体问题，用户点击问题块后将问题写入输入框。本次为后续高频问题组件和输入联想能力奠定数据基础（`fixed` 字段、问题 hash 标识）。

## 高频问题推荐与用户问题活动

高频问题推荐是基于用户行为数据动态排序的常用问题快捷选择能力。系统通过 `user_question_activity` SQLite 表持久化 owner-scoped + agent-scoped 的问题级用户行为（pin 状态、提问频率、最后提问时间）。用户每次提交请求时自动增长 `ask_frequency`（fire-and-forget，不阻断主流程）；用户可通过 `POST /api/v1/user-questions/pin` 主动收藏问题到常问列表（无 unpin API，达上限时先进先出淘汰）。问题标识使用 `SHA-256(question_text)` hash，与分类问题内存 Catalog 中的 hash 算法一致。

`FrequentQuestionService` 位于 `agent-app` composition，合并排序 5 层来源：fixed 静态问题 → pinned 问题 → high-frequency 问题 → 剩余静态问题 → 空列表时前端 fallback 到 i18n 硬编码默认问题。前端通过 `GET /api/v1/frequent-questions` 获取动态排序列表，用户消息 BubbleActions 提供「添加到常问」图标（`FolderAddOutlined`），超长问题（>2000 字符）截断存储并提示用户。

`FrequentQuestionPort` 还承载输入联想能力 `listQuestionAssociations`：用户在输入框打字时（300ms debounce），前端调用 `GET /api/v1/question-association?keyword=xxx` 获取联想结果。联想采用三层排序（pinned > high-frequency > static，static 合并 fixed/非 fixed），cap 级联填充（10/5/5），case-insensitive 子串匹配，top 20 截断。每条结果带 `source` 来源标签（纯视觉）。联想面板与斜杠命令面板互斥，空关键词不触发。关键词过滤在 service 层 in-memory 完成，不引入 gateway 查询。
