# NextAgent TS Change Roadmap V2

本文档是后续书写 TS 后端 OpenSpec change 的总入口。它保留全局规则、整体范围、change 索引、扩展候选和一致性检查；每个 change 的详细输入维护在 `docs/nextagent-ts-changes/<change-id>.md`。

## 使用规则

1. 书写新的 OpenSpec change 时，先读取本文档中的整体规则和索引，再打开 `docs/nextagent-ts-changes/<change-id>.md` 获取该 change 的详细输入。
2. 已存在的架构和核心契约 change 是本文档的基础约束，不在具体实施 change 中重复定义。
3. 本文档和 `docs/nextagent-ts-changes/` 是后续 change 写作的规划入口；OpenSpec change 正文只描述 TS 后端目标状态。
4. 如果某个实施 change 需要修改已冻结核心契约，必须先提出 contract refinement change。
5. 每个实施 change 必须能独立交付，并有用户可见目标或系统可验证目标。

## 当前测试特性树补齐排序

当前测试特性树缺口的版本计划入口为：[NextAgent 测试特性树能力补齐版本计划](./NextAgent测试特性树能力补齐版本计划.md)。该计划基于 `docs/NextAgent测试特性树.md` 的 2026-07-09 快照和当前 active change 状态重新排序；它只作为 roadmap 的测试追溯视图，不替代 `openspec/specs/`、active change artifact 或本文档的长期 change 索引。

| 版本计划 | 排序目标 | Roadmap 承载 |
|---|---|---|
| V0 当前收尾版 | 完成已覆盖能力的验证、归档和 stable baseline 同步，避免继续按旧快照登记缺失 | Task channel、Cron、长期记忆管理、OTel trace export 等 active changes |
| V1 测试可提测版 | 补齐 P0 规格空白，使测试特性树中不可测项具备权威断言来源 | 上下文缓存、流控、性能 SLO、remote AgentLink、集群部署结论 |
| V2 Workflow 闭环版 | 补齐 workflow 可路由、产品过程可恢复、可复盘闭环 | `persist-ts-refresh-stable-completed-turns`、`add-ts-workflow-orchestration-policy`、路由目标 refinement；审计级全节点历史由 blocked 的 `add-ts-workflow-event-history` 后续重设 |
| V3 策略与容量版 | 固化数量上限、fallback、subagent、hook、Skill 渐进加载和多 Agent 共部署规则 | 既有能力 refinement changes |
| V4 厂商与生态版 | 补齐具体模型协议、北斗/审计服务和系统资源指标 adapter | provider、observability、audit adapter changes |
| V5 分布式运行版 | 支撑多实例一致性、会话亲和重连、故障接管、分布式 workflow 和并行执行 | `P5 — 分布式与并行执行` |

## Change 准入和状态

### 准入原则

1. 架构 change 定边界。
2. 核心契约 change 定接口。
3. 最小内核 change 跑通目标态问答主流程。
4. 能力组只用于规划和排序，不能默认等同于一个实施 change。
5. 实施 change 必须小到可以由一个 owner 团队独立设计、开发和验证。
6. 纯共享规则、纯中间机制或只能作为其他功能前置条件的内容，不单独成为实施 change。
7. 实施 change 必须能独立交付，并有用户可见目标或系统可验证目标。
8. 配件 change 基于已冻结契约并行补实实现。
9. 新增或增强能力按独立 OpenSpec change 推进。

### 实施 change 判定标准

- 能独立交付：完成后系统行为、可用能力、可替换实现或质量门禁有明确增量。
- 有用户可见目标或系统可验证目标：可以通过黑盒行为、contract test、integration test、resilience test 或 architecture gate 验证。
- 有单一主要 owner：主要写入模块清晰，其他模块只做必要接入。
- 不只是共享规则：如果只是合法性规则、命名约定、cursor 形态、内部字段或中间接口，应放入所属能力组说明、核心契约或相关实施 change。
- 不只是另一个 change 的前置准备：如果完成后无法独立验收，应与实现该行为的 change 合并。
- 能说明主要 owner、依赖和不应触碰的边界。
- 能写出 SHALL/MUST 级别的行为要求。
- 关键设计选择不会留到实现阶段再决定。

需求清单用于覆盖检查，不作为开发顺序主轴。

### Change 正文写作规则

- OpenSpec change 只描述 TS 后端目标状态。
- 不得写入实现来源、迁移过程、翻译过程、历史实现路径或参考已有实现的措辞。
- 不得使用 `translate-*`、`migrate-*`、`java-parity-*`、`legacy-*` 等以过程命名的 change id。
- proposal 必须从 actor 或系统黑盒使用者视角说明问题、目标、范围和影响，不得用 package、owner、port、DTO、
  私有调用链、SDK API、文件路径或实现步骤代替需求；公共契约变化只描述调用方可观察边界。
- proposal 必须明确 Function 是新增还是修改；OpenSpec capability 等同 Function，新 Function 必须且只能对应一个 `specs/<capability>/spec.md`。
  Feature 只在用户价值、黑盒边界、Function 组成或用户可依赖质量保证变化时声明新增、修改或移除。
- design 首章必须以紧凑的“设计范围”说明每个受影响 Function 的目标变化、delta specs 和设计章节；
  精确 `spec → Requirement` 映射放在对应 Function 的“目标与规范依据”中。每个 Function 再按
  “目标与规范依据 → 当前实现 → GAP 分析 → 修改方案”给出唯一实施路径；跨 Function 共享流程只描述一次。
- 归档前长期基线刷新计划由 design 唯一承载，proposal 不列长期文档文件清单。
- tasks 必须以 Function 为主要分组并在组内保持“目标行为测试 → 实现 → Function 验证”的依赖顺序；
  契约确认、跨 Function 集成/迁移和整体验证单独分组。tasks 必须可执行，不得只是泛化检查清单。
- specs 只写可验证行为契约。
- no-op、minimal、real、deferred 的范围不得混淆。
- 并行开发边界必须清晰，避免多个团队争夺同一主流程 ownership。

### 状态定义

| 状态 | 含义 |
|---|---|
| `active` | change 已存在或正在维护，后续 change 只能引用其稳定边界。 |
| `complete` | change 已完成；如已归档，归档目录承载实施过程文档，roadmap 继续保留其稳定基线索引。 |
| `ready` | 规格目标足够明确，可以直接起草 proposal/design/spec/tasks。 |
| `assumption-ready` | 可以起草，但需要在 proposal/design 中显式固化默认假设。 |
| `clarify` | 规格前需要先澄清关键产品或设计决策。 |
| `blocked` | 规格目标可以成立，但当前不得实施；必须等列明的前置 change 归档或冲突解除后再推进。 |
| `candidate` | 当前只是扩展候选 change，创建前需要重新审查拆分、范围、owner 和验收目标。 |
| `not-planned` | 明确不纳入首版本且当前不作为后续规划能力；仅保留文档记录，不能起草为实施型 OpenSpec change。 |

## Change 输入模板

每个实施 change 按以下结构维护：

```md
### `<change-id>`

状态：
类型：
主要 owner：
依赖：

目标：
- ...

规格输入：
- MUST/SHOULD 级别的行为约束。

契约输入：
- 依赖的核心对象、port、event、DTO、枚举。

实现约束：
- 实现团队必须遵守的边界和规则。

非目标：
- 明确不做的内容。

验收要点：
- contract test、integration test、resilience test、security test 或黑盒验收点。

并行边界：
- 不得修改哪些契约或侵入哪些 owner 模块。
```

## 串行底座

截至 2026-06-01，串行底座已完成；已归档 change 继续保留在本索引中，作为后续 change 必须继承的稳定基线。

| Change | 状态 | 目标 | 详情 |
|---|---|---|---|
| [`establish-ts-backend-architecture`](nextagent-ts-changes/establish-ts-backend-architecture.md) | complete | 建立 TS 后端 workspace、package topology、runtime、channel、本地 Web auth endpoint adapter、core、context、gateway、capability、observability 和 app composition 的架构边界；local auth 作为可选 composition package 只由 local 产品入口显式组装。 | [详情](nextagent-ts-changes/establish-ts-backend-architecture.md) |
| [`establish-ts-core-contracts`](nextagent-ts-changes/establish-ts-core-contracts.md) | complete | 冻结最小问答内核和后续并行配件开发所需的核心 contract。 | [详情](nextagent-ts-changes/establish-ts-core-contracts.md) |
| [`ship-ts-minimal-agent-kernel`](nextagent-ts-changes/ship-ts-minimal-agent-kernel.md) | complete | 基于核心契约跑通目标态问答主流程。 | [详情](nextagent-ts-changes/ship-ts-minimal-agent-kernel.md) |

## 全局已确认设计决策

本节记录所有后续 change 都必须继承的已确认设计决策。除非提出 contract refinement change，实施 change 不得重新定义这些边界。

### 核心契约导出边界

规格输入：
- `agent-common` 是独立 foundation package，承载 shared ids、基础 value object、JSON value、时间/幂等键、IdentityContext、RequestLocale/RequestLanguage、SecretReference、AgentError/SafeError 安全错误形态，以及跨 runtime、gateway、session/history、recovery、observability、channel projection、app configuration、assembly 和 capability 边界共同消费的基础 enum。
- `agent-common` 不得依赖 `agent-contracts`；`agent-contracts` 依赖并复用 `agent-common` 的 foundation contracts。
- `agent-contracts` 是核心边界契约 public namespace，按架构 owning module 暴露 runtime、channel、session、attachment、context、model、capability、core、gateway、observability、app 等模块边界 DTO、enum、schema skeleton 和 port。
- 每个 public contract 必须有唯一 owning export surface；foundation contract 归 `agent-common`，boundary contract 归具体 `agent-contracts/*` subpath。
- 稳定 subpath export 包括：runtime、channel、session、attachment、context、model、capability、core、gateway、observability、app、system-reminder。
- `system-reminder` 作为独立 owning subpath 承载 SR 类型枚举、角色映射、收集器和包装器端口；它跨越 context-engine（管道）、core（软终止）和 runtime（通知队列）的横切关注点，不归属于任何单一既有模块。
- 不新增 `agent-contracts/common` owning module；identity、timeline、checkpoint、pending-input、hook、sandbox、content、errors、configuration、feedback 等概念不得作为 reserved alias 或概念分类单独 owning subpath，除非后续架构 change 增加独立 owning module。
- enum 归属不按“是否是 enum”统一放入 common，而按共享语义判断：跨多个核心模块共享、语义稳定、且不是单一业务领域私有状态的系统级 durable vocabulary 归 `agent-common`；单一业务边界 vocabulary 留在对应 `agent-contracts/*` subpath；只为持久化 Record 形态存在的值使用 gateway-owned record value type。
- `RunStatus`、`TerminalCommitState`、`TimelineEventType`、`CheckpointTriggerReason`、`CapabilityKind`、`CapabilityProviderKind`、`CapabilityReplayPolicy` 和 `CapabilityInvocationStatus` 归 `agent-common`。
- root `agent-contracts` 可以 re-export 稳定 public contract；实现包应优先从 owning module import。
- subpath export 代表各模块 public surface 和依赖边界，不是装饰性 namespace；实现包不得把 root `agent-contracts` 当作无边界类型池使用。
- 实现包不得通过 adapter-private DTO、数据库 schema、provider SDK 类型、本地路径布局或其他实现包暴露跨模块契约。
- 领域对象归其业务 owning module；read-model query 归提供该 read model 的业务 module；logical gateway port、gateway write/request DTO、gateway-specific result type 和 dynamic execution gateway port 归 gateway module。
- `CheckpointPayload`、pending input、hook lifecycle 和 runtime timeline 归 `agent-contracts/runtime`；`ContentRef`、`ArtifactMetadata` 和 `Feedback` 归 `agent-contracts/session`；`ErrorNormalizer` 归 `agent-contracts/observability`；app configuration contract 归 `agent-contracts/app`。
- gateway Record 可以使用 `agent-common` 中的系统级 durable vocabulary，但不得引用上层业务领域 subpath 的 enum/DTO；session、attachment、pending-input、content 等业务领域字段使用 gateway-owned record value type，领域模块负责 DO/read model 与 Record 的映射、值域一致性和校验。
- 接口或 port 的归属必须按模块依赖方向和调用边界判断，不按默认实现所在包判断；调用方需要依赖的抽象放在调用方所属边界或稳定 contract 边界，实现类放在 provider/implementation package，通过 app composition 注入。
- 后续 change 新增 public contract 时，必须先选择 owning export module；除非新增独立领域边界，否则不得新增 export module。

实现约束：
- 具体实施 change 不得在 runtime、channel、session、context、model、capability、gateway、observability 或 app package 中重新定义已冻结 public contract。
- contract refinement change 必须同步更新 owning export module、contract tests 和 architecture boundary tests。
- 新增 port 或移动 port 归属前，必须验证 package 依赖图不会形成循环依赖、向上依赖或实现包依赖实现包的跨层绕行。
- `agent-channel-web-auth-local` 是 local configured authentication 的独立 composition package；`agent-channel-web` 不得依赖它，local 产品入口必须显式 import/register，remote/IAM 产品入口不得 import/register、bundle 或暴露它；local auth 可选化必须通过不同产品入口和不同依赖图实现，不得通过单一入口中的运行时 `if` 或目录探测实现；非 local 产物必须对 local auth route、cookie/challenge 处理逻辑和相关产物执行 tree-shaking 或等价裁剪；首阶段不引入运行时动态插件系统或热加载。Agent-scoped startup plugin composition 只能由 `add-ts-agent-scoped-plugin-composition` 定义为启动期、配置激活、Agent 作用域冻结的受控装配机制。
- 首版本地认证收紧为 localhost-only local auth：默认只支持本机浏览器访问；配置修改通过 env/file 或配置文件重启生效；不提供页面修改认证配置、多用户管理、注册、密码修改、remember-me、refresh token 或服务端认证 session store；不支持 query parameter 传长期认证票据。

### 核心标识、身份和错误

规格输入：
- 不引入 `CorrelationId`、`CorrelationContext` 或额外 `DiagnosticId`。故障定位交给 trace、结构化日志、审计日志和业务标识。
- 请求尚未进入 runtime 的失败不额外提供报障 ID；如后续需要客户支持闭环，必须单独提出 change。
- owner scope 不使用独立 `OwnerScope` DTO，明确使用 `tenantId` 和 `subjectId` 字段。
- `IdentityContext` 保持三字段：`tenantId`、`subjectId`、`displayName`。不加入 `locale`、`language`、role、权限列表或用户画像字段。
- 关键跨边界业务 id 使用 `agent-common` 中的 branded 类型，包括 `TenantId`、`SubjectId`、`SessionId`、`MessageId`、`RequestRunId`、`CapabilityId`、`CapabilityInvocationId`、`ArtifactId`、`AttachmentId`、`CheckpointId`、`PendingInputId`、`AgentId`、`AgentVersion`、`RequestContextId`、`IdempotencyKey`。
- `BlobRef` 使用 branded string，但它不是业务 id，而是只可由 `BlobStoreGateway` 解析的 opaque 内容存储引用。
- 不把所有 `string` 都封装成自定义类型；branded id 只用于关键跨边界业务标识和幂等键。
- `SecretReference`、基础 capability enum、runtime/recovery/timeline durable enum 和错误契约都归 `agent-common`；错误契约拆成内部 `AgentError` 和外部 `SafeError`。
- `AgentErrorCategory` 使用 `VALIDATION`、`AUTHORIZATION`、`POLICY_DENIED`、`NOT_FOUND`、`CONFLICT`、`UNAVAILABLE`、`TIMEOUT`、`CANCELED`、`INTERNAL`。
- `AgentError` 是内部 throw/catch 标准错误形态，包含 `code`、`message`、`category`、`retryable`、`safeDetails?`、`cause?`。
- `SafeError` 是跨 API、stream、capability result、audit 和 log boundary 的安全 DTO，字段为 `code`、`message`、`category`、`retryable`、`safeDetails?`。
- 所有 unknown error 必须通过 `ErrorNormalizer.normalize(error: unknown): SafeError` 后才能跨边界输出。
- `cause`、`stackTrace`、`timestamp`、`errorId`、raw provider error、raw model/tool input、local path 和 credential 不进入 `SafeError`。
- `SafeError` 不得把 raw exception、raw prompt、raw model output、raw tool args/result、raw content 或 raw secret 暴露到客户端、日志、stream 或 audit。

实现约束：
- 业务定位字段必须通过 request/session/message/run/timeline/audit event 传递，不得用泛化 correlation 对象承载。
- 身份信息必须来自可信 boundary，不得信任客户端 payload 自报身份。

### 时间和序列化边界

规格输入：
- TS 边界时间类型使用 `EpochMillis = Brand<number, "EpochMillis">`，表示 Unix epoch 起算的 UTC 毫秒数。
- `EpochMillis` 只用于 wire、persistence、audit、metric、stream 和其他序列化 contract 边界。
- runtime 内部事件或执行对象可以使用 `Date` 或受控 clock，并在进入边界 DTO 前转换为 `EpochMillis`。
- 日历型业务规则不得用 `EpochMillis` 表达；需要按地区日期、时间或时区计算时，后续 contract 必须显式建模 local date、local time 和 time zone。

实现约束：
- `RunTimelineEvent` 是 runtime 内部事件，`createdAt` 使用 `Date`。
- `StreamEnvelope` 是客户端 wire DTO，`createdAt` 使用 `EpochMillis`。

### Locale、语言和 secret

规格输入：
- `RequestLocale` 是核心上下文中的用户语言/区域化输入事实，使用 BCP 47 locale 字符串，例如 `zh-CN`、`en-US`。
- `RequestContext`、`ContextAssemblyRequest` 和 `ContextAssembly` 只携带 `locale`，不携带 `language`。
- `RequestLanguage` 使用 `ZH`、`EN`、`MIXED`。`AUTO` 只能作为解析策略，不作为核心语言枚举值；`RequestLanguage` 仅作为从 `locale` 或用户输入派生出的内部/兼容枚举，用于 capability filtering、标题规则等窄场景。
- 回答语言默认跟随用户主语言，并保留电信术语原始表达。
- `SecretReference` 归 `agent-common`，只表达 secret 来源，取值只能是 `env:` 或 `file:` 引用。
- raw secret value、inline secret、`direct:` 和 `none` 哨兵值不得进入产品配置、日志、stream、audit、metric 或 model context。
- 如果引用内容使用 `ENC(...)` 或等价加密 envelope，解析和解密属于 secret resolver 或 adapter 实现能力，不属于 `SecretReference` grammar。

实现约束：
- 解密密钥必须来自独立 secret source。
- provider、remote gateway、redis 等凭据都通过 secret reference 或 resolver 边界处理。

### Timeline 和 Stream

规格输入：
- `RunTimelineEvent` 使用 `eventId`、`sessionId`、`runId`、`rootMessageId`、`requestContextId`、`sequence`、`type`、`inlinePayload`、`contentRef?`、`createdAt`。
- `RunTimelineEvent` 不包含 `agentResponseRef` 或 `safeSummary`。
- `RunTimelineEvent` 同时作为 agent/core authoring event 和 runtime canonical timeline event；runtime 在接收时填充或复写 `eventId`、`sessionId`、`runId`、`rootMessageId`、`requestContextId`、`sequence` 和 `createdAt`。
- 进入持久化、stream、replay、audit 关联或 terminal commit 后的 canonical timeline event 必须具备 runtime-owned 字段。
- agent/core 不得依赖自己传入的 runtime-owned 字段被保留。
- `StreamEnvelope` 使用 `eventId`、`sessionId`、`requestId`、`runId?`、`requestContextId?`、`sequence`、`eventType`、`timelineEventRef?`、`transportHints`、`payload`、`createdAt`。
- `StreamEnvelope.requestId` 表示当前用户请求的 root message id；不重复暴露 `rootMessageId`。
- 从 timeline 投影时，`requestId` 来自 `RunTimelineEvent.rootMessageId`，`runId` 来自 `RunTimelineEvent.runId`，`requestContextId` 来自 `RunTimelineEvent.requestContextId`，`timelineEventRef` 指向来源 `RunTimelineEvent.eventId`。
- `StreamEnvelope.eventId` 是 stream event 自身 id，不要求复用来源 timeline event id。
- `StreamEnvelope.payload` 是经 channel 投影、脱敏和转换后的用户可见 payload，不要求等同于 timeline `inlinePayload`。
- `StreamEnvelope.terminal` 不作为顶层字段，按 `eventType` 派生。
- `StreamEnvelope.error` 不作为顶层字段，错误由 failure event payload 或后续 payload schema 承载。
- `StreamEnvelope.cursor` 不作为顶层字段，replay 由 sequence 或 transport 层策略处理。
- `TimelineSequence` 是 session timeline 游标，使用 JS safe integer 范围内的非负整数；canonical event sequence 从 1 开始，`lastSeenSequence=0` 表示调用方尚未接收任何事件。
- timeline sequence 在单个 session 内单调递增，不按 run 重置，不允许回绕、取模或复用。
- 多实例部署下，同一 session 内并发产生的 timeline event 不得获得重复 sequence，也不得以破坏 sequence 顺序的方式对外发布；契约不规定具体协调机制。
- `RuntimeTimelinePort.stream(request)` 是 channel 读取 runtime timeline 的核心接口，返回 `AsyncIterable<RunTimelineEvent>`。
- `RuntimeTimelineStreamRequest` 使用 `sessionId`、`lastSeenSequence`、`requestId?`、`runId?`；`lastSeenSequence` 表示调用方最后成功接收的 timeline sequence。
- `RequestAccepted` 使用 `sessionId`、`requestId`、`runId`、`attempt`，不包含 stream cursor 或 timeline sequence 字段。
- runtime stream 返回同一 session 下 `sequence > lastSeenSequence` 的可恢复事件和后续 live 事件；`requestId` 和 `runId` 只作为过滤条件。
- Delta timeline event 不要求持久化；每个 delta event 必须携带当前 delta stream 的累计全量。
- replay 可以从 `lastSeenSequence` 之后最近的可恢复 event 继续，不要求补齐每一个 sequence。
- `RunTimelineEventStoreGateway.listEvents` 必须按 `sessionId + afterSequence` 查询，可选按 `requestId`、`runId` 过滤，不得只按 run 级 sequence 查询。
- stream replay 恢复运行过程事实；历史对话展示以 visible `SessionMessage` 为最终内容事实来源，不通过 timeline event 重建最终会话内容。
- `HOOK_OUTCOME_APPLIED` 和 `POLICY_APPLIED` 是 timeline-only event，首版不进入用户可见 `StreamEventType`。

实现约束：
- Web channel 只投影 runtime timeline，不拥有执行事实。
- Stream resume/replay 必须基于 runtime canonical timeline、lastSeenSequence 和可恢复 replay 语义。
- gap 或 delta 不可恢复时，必须通过 stream notice 或等价 safe outcome 触发 history refresh，而不是让 channel 使用私有持久化 event/message 规则重建状态。

### Session Store 和历史读取

规格输入：
- Gateway 命名优先使用 `SessionStoreGateway`、`SessionMessageStoreGateway`、`ActiveContextStoreGateway`、`RequestRunStoreGateway`、`CheckpointStoreGateway`、`PendingInputStoreGateway` 和 `FeedbackStoreGateway`。
- `SessionStoreGateway` 必须提供 `loadSession(request)`、`listSessions(request)`、`saveSession(request)`。
- `listSessions` 使用 `SessionHistoryRecordQuery`，返回 `SessionHistoryRecordPage`；session service 再映射为 `SessionHistoryQuery/Page` read model。
- `SessionHistoryEntry` 至少包含 `sessionId`、`displayTitle`、`lastMessagePreview`、`lastRequestStatus`、`lastActivityAt`、`hasInFlightRequest`。
- Gateway port 使用 gateway-owned `*Record` persistence DTO/PO，不直接接收或返回 `RequestRun`、`SessionMessage`、`RunTimelineEvent`、`RequestAttachment`、`CheckpointPayload`、`PendingInput`、`Feedback` 等领域 DO；领域模块负责 DO/read model 与 Record 的映射。
- `SessionMessageStoreGateway` 必须提供 `saveMessage(request)`、`loadMessage(request)`、`listConversationMessages(request)`、`listCurrentRequestMessages(request)`、`hideMessage(request)`。
- `ActiveContextStoreGateway` 必须提供 `loadActiveContext(request)`、`appendItem(request)` 和 `commitCompaction(request)`；`appendItem` 与 `commitCompaction` 使用 `activeContextVersion` 做 optimistic conflict detection。
- `listConversationMessages` 使用 `SessionConversationRecordQuery`，返回 `SessionConversationRecordPage`；领域 session service 再映射为 `SessionConversationPage`。
- `listCurrentRequestMessages` 使用 `CurrentRequestConversationRecordQuery`，返回 `SessionConversationRecordPage`；query 必须携带 `tenantId`、`subjectId`、`sessionId`、`rootMessageId`、`runId`、`includeHidden`、`offset`、`limit`。
- `SessionHistoryRecordQuery`、`SessionConversationRecordQuery`、`CurrentRequestConversationRecordQuery`、active context request、message lookup/write request 必须显式携带 `tenantId`、`subjectId`，这是 owner-scope 安全收紧。
- `hideMessage` 是 `SessionMessage` visibility 的唯一变更入口；request 必须携带 `tenantId`、`subjectId`、`messageId`、`reason`、`hiddenByContextId: RequestContextId` 和 `idempotencyKey`，不携带 `hiddenAt`。
- `hiddenAt` 由 store 使用受控时钟写入；`saveMessage` 不得修改已存在 message 的 visibility 字段；hide 是单向操作，不提供 unhide。
- 已隐藏 message 的重复 hide 必须幂等返回当前持久化 `SessionMessageRecord`，并保留首次隐藏的 `hideReason`、`hiddenAt` 和 `hiddenByContextId`；message 不存在返回 `undefined`。
- 默认历史查询排除 hidden message，显式 `includeHidden=true` 才返回；`visible=false` 只影响会话历史默认视图，模型可见上下文仍由 active context view 控制。

实现约束：
- 客户端历史会话列表不得直接使用底层 session 表查询模型泄露 adapter 私有字段。
- 客户端查看历史对话必须由 session service 把 `SessionConversationRecordQuery/Page` 映射为 `SessionConversationQuery/Page` message read model，不直接使用低层 `listMessages` 形态。
- runtime/context/core 读取一次 request/run 范围内的消息必须通过 `CurrentRequestConversationRecordQuery` 读取 record 后映射，避免 retry/edit 场景只按 rootMessageId 混淆不同 run。
- 历史过程增强复用 `RunTimelineEventStoreGateway.listEvents` 和 stream 投影规则，不通过 timeline event 重建最终回答内容。

### Run Timeline Event Store

规格输入：
- canonical timeline event 的持久化和查询使用 `RunTimelineEventStoreGateway`。
- `appendEvent` 使用 `RunTimelineEventAppendRequest`，返回 `RunTimelineEventRecord`；runtime 负责 `RunTimelineEvent` 与 `RunTimelineEventRecord` 的映射。
- `listEvents` 使用 `RunTimelineEventRecordQuery`，返回 `RunTimelineEventRecord[]`。
- `RunTimelineEventRecordQuery` 必须携带 `tenantId`、`subjectId`、`sessionId`、`afterSequence`、`limit`，并可选携带 `requestId`、`runId`。
- `RunTimelineEventStoreGateway` 是 runtime timeline durable fact 边界，不得用 execution trace store、channel replay buffer 或 live hub 代替。

### Agent-Core 和 Runtime 执行边界

规格输入：
- `Agent` 是 runtime 调用 agent-core 的核心接口，签名为 `execute(run, context, timeline, signal): Promise<void>`。
- `run` 是 runtime 创建并拥有的 `RequestRun`。
- `context` 是本次请求的 `RequestContext`。
- `RequestContext` 承载可恢复执行坐标，字段为 `requestContextId`、`sessionId`、`rootMessageId`、`runId`、`identityContext`、`locale`、`agentId`、`agentVersion`、`agentAssemblyRef`、`activeStepId?`、`nextLifecycleStage`、`currentToolBatchMessageId?`、`toolCallStates`、`flowVariables`、`agentTurnIndex`。
- `LifecycleStage` 归 `agent-contracts/runtime`，表达 runtime-owned request lifecycle 中可执行 hook、checkpoint、recovery 或 terminal boundary 的稳定阶段；hook 只消费该 vocabulary，不重新拥有 stage 定义。
- `RequestContext` 不包含 `attempt`、`deadlineAt` 或 `messageRefs`；`attempt` 和 `deadlineAt` 以 `RequestRun` 为事实源，当前 request/run 消息通过 `SessionMessageStoreGateway.listCurrentRequestMessages(CurrentRequestConversationRecordQuery)` 读取 record 后映射。
- `locale` 是核心上下文中唯一的用户语言/区域化输入事实，用于模型 prompt 中的回答语言、日期、数字、货币、单位和用户可见文案区域化；能力过滤、标题规则等窄场景需要的 `RequestLanguage` 从 `locale` 或用户输入派生。
- `nextLifecycleStage` 只表达 `BEFORE_MODEL_INVOKE`、`BEFORE_CAPABILITY_INVOKE`、`BEFORE_TERMINAL_EVENT` 等可恢复执行点；`currentToolBatchMessageId` 和 `toolCallStates` 只在 `BEFORE_CAPABILITY_INVOKE` 有效。
- `currentToolBatchMessageId` 指向当前 tool batch 的 assistant tool-use message；`ToolCallState` 字段为 `toolCallId`、`capabilityId`、`arguments`、`status`，其中 `arguments` 是结构化 `JsonObject`。
- `timeline` 是 `RunTimelineEventPort`，用于发布中间事件和最终 agent message。
- `signal` 是 `AbortSignal`，用于用户取消、超时或运行中断的执行链路控制。
- `RunTimelineEventPort.emit(event: RunTimelineEvent): Promise<void>` 表示 runtime 已接收该事件并按 timeline 规则处理。
- Agent 的最终回答必须通过 timeline 发布为 agent message 相关事件，不通过 `execute` 返回最终回答内容。
- `Agent.execute` 正常 resolve 表示执行完成；reject/throw 表示执行失败。
- runtime 根据 `Agent.execute` 的完成、失败、取消或 supersede 结果发布 runtime 终态事件。
- Agent 不得发布 `REQUEST_COMPLETED`、`REQUEST_FAILED`、`REQUEST_CANCELED` 或 `REQUEST_SUPERSEDED`。

实现约束：
- Agent-core 不拥有 RequestRun lifecycle、terminal commit 或 canonical replay 语义。
- Runtime 不通过 Agent 返回值获取最终回答内容；最终可见回答来自 timeline/message 事实。
- `AbortSignal` 不代表客户端 stream 断连；只有用户取消、超时或 runtime 中断等执行控制才应触发运行链路取消。
- Agent-core 和 Context Engine 不得依赖 `RequestContext.messageRefs`；模型上下文永远来自 active context view，工具轮后下一次模型调用需要看到当前 run 已产生消息时，runtime/session 必须在保存模型可见消息时同步维护 active context items。
- 恢复执行点参照当前运行逻辑重建：checkpoint 提供 `runVersion`、`triggerReason`、`lastSequence`、`activeContextVersion`、`flowVariables` 和与 `RequestContext` 同值的 `agentTurnIndex` 作为恢复边界和一致性校验点；runtime 从当前 run 的 persisted assistant tool-use message 和 capability result messages 重建 `currentToolBatchMessageId` 与 `toolCallStates`。

### 附件和 Blob 边界

规格输入：
- runtime command 和 `SessionMessage` 只保存 `attachmentIds: AttachmentId[]`，不保存附件名称、类型、大小、状态或存储引用副本。
- `AttachmentId` 是附件业务身份；`BlobRef` 是通用内容存储引用，不是业务 id，也不命名为 `BlobId`。
- `RequestAttachment` 是附件 metadata 的权威事实，至少包含 `attachmentId`、`sessionId`、`rootMessageId`、`runId?`、`agentId`、`fileName`、`mediaType`、`sizeBytes`、`storageRef: BlobRef`、`validationStatus`、`availabilityStatus`、`createdAt`。
- `AttachmentMediaType` 使用 `WORD`、`EXCEL`、`PDF`、`MARKDOWN`；TS 首版本地 release 只启用 Markdown，其他目标范围内类型返回明确 safe error，解析和上下文消费后置。
- `AttachmentValidationStatus` 使用 `PENDING`、`ACCEPTED`、`REJECTED`；`AttachmentAvailabilityStatus` 使用 `STAGED`、`AVAILABLE`、`UNAVAILABLE`。
- `AttachmentStoreGateway` 只管理 `RequestAttachmentRecord` metadata、validation/availability status 和 request/session/run 绑定；attachment runtime 负责 `RequestAttachment` 与 `RequestAttachmentRecord` 的映射。
- `BlobStoreGateway` 是附件、artifact、大 capability result、模型摘要和其他大对象共用的 opaque bytes store。
- `BlobRef` 只能由 `BlobStoreGateway.storeBlob` 返回，上层不得解析、拼接或把它当成本地路径、URL、bucket/key/version 结构使用。
- `BlobRef` 不得进入模型上下文、用户可见 stream、SafeError、audit 明细或结构化日志；用户可见名称、类型、大小和摘要必须来自对应 metadata。
- Runtime 接受请求前必须按 `tenantId`、`subjectId` 和 `attachmentIds` 查询权威 `RequestAttachment`，校验附件在当前 owner/request 可见范围内，且 `validationStatus=ACCEPTED`、`availabilityStatus=AVAILABLE`。
- Context Engine 生成附件 descriptor 或加载 Markdown 附件内容时，必须通过 `AttachmentId` 查询权威 `RequestAttachment`，不得信任 command、message metadata、模型输出或 capability 参数中的附件描述。
- 附件和 artifact 是并列 durable fact：附件表达用户输入文件生命周期，artifact 表达输出或大内容 metadata；两者可以通过 `ContentRef`、`ArtifactMetadata` 或业务 metadata 关联，但不得共享 id 或合并 store。

实现约束：
- 附件 cleanup 不得直接删除仍被 session message 引用的 metadata；可以删除 blob 并把 `availabilityStatus` 更新为 `UNAVAILABLE`，以保留历史、审计和上下文诊断所需的附件事实。
- 附件内容不得绕过 attachment runtime 或 BlobStore 直接进入 message、context、model、capability、stream、safe error 或 audit 明细。

### Context Assembly 和 Model Render

规格输入：
- `ContextAssemblyRequest` 只表达位置和意图：`sessionId`、`requestId`、`requestContextId`、`agentId`、`agentVersion`、`runId`、`stepId`、`locale`、`purpose`；其中 `requestId` 表示当前 root user request identity，不新增 `rootMessageId`。
- `ContextAssemblyRequest` 不携带 `historyRefs`、`attachmentRefs`、`capabilityDisclosureRefs`、`currentMessage`、`agentAssembly` 或 `budget`。
- `ContextAssembly` 不保存最终 model messages，最终 messages 在 render 后生成。
- `ContextAssembly` 不新增 `ContextMessage`，历史消息只保存从 active context view 选择出的 `selectedMessageRefs: MessageId[]`。
- active context view 是模型可见 message 引用表；`active_context_items` 一行保存一个 messageId，便于与 `session_messages` 联合查询；`messages` 保存完整原始消息和压缩生成的 summary message，保持 append-only；模型调用只读取 active context items，不直接读取全量 messages。
- `ActiveContextItem.ordinal` 只表达同一 active context view 内的稳定排序，由 `ActiveContextStoreGateway` 在 append 或 compaction commit 时生成/维护；不得来自客户端、channel、模型输出或 capability 参数；只要求同一 view 内唯一且按升序还原模型上下文，不规定具体编号策略。
- 压缩采用 prefix compact + recent tail：被压缩前缀生成一个 summary `SessionMessage`，新的 active context 用 summary message id 替换前缀并保留 recent tail 原顺序；无 tail 时退化为单个 summary。
- 提交压缩必须在同一事务或等价原子边界内写入 summary message、把压缩追溯信息写入 summary message metadata、替换 active context items 并递增 `activeContextVersion`；`activeContextVersion` 用于 checkpoint 恢复和多实例冲突检测。
- `activeContextVersion` 是 active context view 的 optimistic lock version；append 和 compaction commit 必须携带 `expectedActiveContextVersion`，版本不匹配时返回 version conflict，不得覆盖当前 active context。
- summary message metadata 是 `SessionMessage.metadata: JsonObject` 的 typed extension；所有字段必须是 JSON-compatible value，写入和读取时必须通过 schema/type guard 校验。
- `ContentRef.refType=MODEL_SUMMARY` 指向 summary `SessionMessage.messageId`，不指向独立 summary store。
- `ContextAssembly` 使用本次生成的 `SystemPrompt`，不使用 `SystemPromptSnapshot` 命名。
- 不新增 `CapabilityDisclosure`，使用 `visibleCapabilities: CapabilityDescriptor[]`。
- `ContextAssembly` 记录 `modelInfo`、`modelOptions`、`modelSelectionReason`，不保存完整 `modelProfile`。
- 暂不引入 `ContextSelectionDiagnostics`。
- 模型调用层消息命名为 `ChatMessage`，支持 `toolCalls` 和 `toolCallId`，不保留 `name`、`contentRefs`。
- `ChatMessage.toolCalls` 使用结构化 `ModelToolCall[]`，字段为 `toolCallId`、`toolName`、`args`。
- 单独定义 `RenderedModelInput`。
- `ThinkingOptions` 是结构化对象；`depth` 和 `budget` 不得同时出现。
- `ContextAssembly` 是 render 的输入，不是 `RenderedModelInput` 的组成部分。
- `RenderedModelInput` 是已渲染模型输入，只保留 `requestContextId`、`sessionId`、`rootMessageId`、`runId`、`stepId` 等最小执行坐标和模型调用所需字段。
- context selection、capability visibility、model selection reason、omitted/compaction reason 等审计或诊断信息必须在 assembly/render 生成时写入 timeline、audit event、structured log 或 observability metric，不通过 `RenderedModelInput` 传递。
- 全局模型清单和模型配置默认值由 `agent-model` 拥有；每个 `ModelProfile` 使用全局唯一 `modelId` 并以产品清单内的 `providerId=openai-compatible | model-gateway` 绑定已装配 adapter。Agent 通过 required non-empty ordered unique `AgentAssembly.modelIds` 和可选且必须属于该集合的 `defaultModelId` 激活模型；省略 default 时使用第一个 eligible id。`agent-app` 装配 raw config，`agent-core` 只消费 Context Engine selection result。
- 初始与 fallback 模型选择由 Context Engine 的唯一 async/cancellable selection port 独占；`ModelSelectionRequest` 复用既有 `identityContext` 并显式携带 accepted Agent fields，`mode` 只允许 `INITIAL | FALLBACK`。主 Agent loop、summary、memory extraction、suggested questions 和 workflow model nodes 都必须消费该 port。cross-model fallback 由 Core 通过 trusted reassembly 触发，Context Engine 必须针对新模型重新计算 prompt compatibility、扁平可选模型参数、context window budget 和 render。
- plugin policy inventory 中 `modelSelectionPolicy` 为 `RESERVED` 且 owner 为 `agent-context-engine`；`modelFallbackPolicy` 为 `RESERVED`，owner 明确拆分为 `agent-core` lifecycle gate 与 `agent-context-engine` fallback model selection。
- 进入 `ModelInvocationService` 前，owning caller 必须把 `RenderedModelInput` 转换为扁平 `ModelInvocationRequest`，并使用 accepted Agent 的 trusted invocation scope；run-bound orchestrator 必须把 owning `stepId` 的同一值作为 `operationId`，与 accepted run coordinates 原子写入 scope。
- `ModelInvocationRequest` 是封闭对象：required 顶层字段为 `invocationScope`、`modelId`、`messages` 和 `tools`；optional 顶层字段为 `temperature`、`maxOutputTokens`、`topP`、`topK`、`presencePenalty`、`frequencyPenalty`、`thinking`、`providerOptions`、正整数 `timeoutMs` 和非负整数 `maxRetries`。顶层 `stepId` 和 locale 被拒绝。
- `ModelInvocationScope` 是既有 `agent-contracts/model` contract 的单一 flat closed target shape：required fields 为 trusted `tenantId/subjectId/agentId/agentVersion/agentAssemblyRef/operationId`，optional `sessionId/requestId/runId` all-or-none。run-bound/background lifecycle 由可信调用路径决定，不由 scope shape 推断。`operationId` 只用于内部 correlation、observability 和 audit，不参与推理、选择、routing、授权、幂等或 retry。
- `agent-model` 从 global catalog 的 private binding 解析 provider adapter、访问配置与 transport。app-private `ModelCatalogQueryService` 是本 change 新增的 lazy safe-query boundary；available entry 的模型身份只位于 `configuration.modelId`，selection 原样复用该 frozen configuration。`providerOptions` 使用 trusted Agent 开发路径提供的 inner JSON，由 selected adapter 校验并与受治理字段保持隔离；顶层 `thinking` 是 reasoning input control 的唯一 authority，provider options 不接受重复 reasoning controls。
- owning caller 将 `RenderedModelInput` 投影为封闭 `ModelInvocationRequest`；调用模式由 `ModelInvocationService.complete(...)` 或 `ModelInvocationService.stream(...)` 方法表达。
- `ModelInvocationService` 提供 `complete(request, signal): Promise<ModelFinalResult>` 和 `stream(request, signal): AsyncIterable<ModelStreamDelta | ModelFinalResult>` 两个方法。
- `ModelFinalResult` 是封闭 provider-neutral 终态对象：required field 为 `content`，optional fields 为 `reasoning`、`finishReason`、`usage`、`toolCalls`、`providerResponseId` 和 `safeError`；模型身份只由对应 `ModelInvocationRequest.modelId` 持有。

实现约束：
- Context Engine 负责上下文选择、排序、预算和 render；caller 只提供 WHERE/WHY。
- render 阶段通过 active context view 得到模型可见 message id 序列，再通过不可变 message store/cache 按 id 读取 `SessionMessage`。
- `SystemPrompt` 和 `SystemPromptSection` 使用 stable/dynamic sections、cache boundary 和 section metadata 设计。

### Checkpoint

规格输入：
- `CheckpointTriggerReason` 归 `agent-common`，使用 `RUN_ACCEPTED`、`STEP_STARTED`、`CAPABILITY_BEFORE_CALL`、`CAPABILITY_AFTER_RETURN`、`CONTEXT_COMPACTED`、`TERMINAL_COMMIT_PENDING`、`TERMINAL_COMMITTED`、`TERMINAL_PENDING_COMMIT_TAKEOVER`。
- `LoadCheckpointRequest` 必须包含 `sessionId`、`rootMessageId`、`runId`，`runId` 必填。
- Checkpoint 持久化端口命名为 `CheckpointStoreGateway`，读取方法命名为 `loadCheckpoint(request)`，不使用 latest-checkpoint 语义命名。
- checkpoint payload 包含 `checkpointId`、`sessionId`、`rootMessageId`、`runId`、`requestContextId`、`runVersion`、`triggerReason`、`lastSequence`、`activeContextVersion`、`flowVariables`、`savedAt`。
- `flowVariables` 必须是 JSON-compatible map。
- checkpoint payload 不保存完整 `toolCallStates` 或 `messageRefs`；恢复时按 checkpoint 锚点从 persisted messages 重建 tool batch state。
- checkpoint write 包含 `idempotencyKey`。

实现约束：
- checkpoint 是恢复语义，不只是日志标签。
- 恢复判断必须区分 before-call、after-return、terminal pending commit takeover 等边界。
- 最小内核可以使用 no-op checkpoint provider，但主流程必须通过目标 `CheckpointStoreGateway` 发起调用。

### Lifecycle Hook

规格输入：
- Lifecycle hook 对开发者暴露 developer-facing `LifecycleHook` interface 和 `defineLifecycleHook(...)` helper；hook 启用复用现有 Agent package 配置入口 `agent.yaml.hooks`，并在启动期编译为 `AgentAssembly.hooks`。
- `defineLifecycleHook(...)` 返回满足 `LifecycleHook` interface 的单个 hook implementation object，本体只包含有明确消费者的字段：`hookId`、`kind`、`effects`、`supportedStages`、`failureMode`、`execute`，可选 `timeoutMs`、`configSchema` 和 startup-only `configure(config)`；`hookId` 是唯一稳定身份、绑定键、注册键、诊断标签和同序兜底排序键。
- `execute` 形态为 `(input: HookInput, signal?: AbortSignal) => HookResult | Promise<HookResult>`。
- `HookInput` 只包含运行期 boundary 和安全运行事实，不包含装配期 config。
- `LifecycleHookDefinition` 是 runtime-internal materialized contract，由 `LifecycleHook` implementation object 剥离 executable 后生成，描述 hook 的稳定声明：`hookId`、`kind`、`effects`、`supportedStages`、`timeoutMs?`、`configSchema?`、`failureMode`。
- `AgentAssembly.hooks` 描述当前 Agent 如何启用、关闭或收窄 hook：`hookId`、`enabled?`、`disabled?`、`stages?`、`order?`、`timeoutMs?`、`config?`；hooks entry 不携带独立 `agentId`，Agent Scope 来自 containing `AgentAssembly`。
- hooks entry 可以收窄 `stages`、为 `CUSTOM` hook 提供 `order.priority` / `order.before` / `order.after`、覆盖 `timeoutMs` 或提供 `config`，但不得修改 `kind`、`effects`、`failureMode` 或 hook 支持边界；`SYSTEM` hook entry 不得覆盖 order；hook manifest、plugin manifest 或系统配置不得声明 Agent activation 数据。
- hook identity、kind、effects、supported stages、failure mode、order、timeout、config schema、configure 和 execute 只来自 `defineLifecycleHook(...)` 返回的 `LifecycleHook` implementation object；本 change 不定义 hook 目录配置、manifest 加载或目录扫描路径，开发者 hook 贡献由后续 plugin composition change 承载。
- `config` 是 Agent 对该 hook 的 per-Agent 装配配置；若 hook 定义提供 `configSchema`，assembly compiler 必须在启动期校验，并只在启动期传给 `configure(config)` 或等价闭包创建。runtime 不得在运行期通过 `HookInput` 传递 config，也不得从 `config` 合成 outcome、mutation、stage 或启用状态。
- `CUSTOM` hook 只有被当前 run 固化 `agentId` / `agentVersion` / `agentAssemblyRef` 对应的 `AgentAssembly.hooks` 显式 enabled 后才生效；entry `enabled` 省略表示启用，`enabled=false` 禁用该 custom entry。
- `SYSTEM` hook 默认对所有 Agent 生效，不要求每个 Agent 显式绑定；开发者可以在当前 Agent 的 `agent.yaml.hooks` 中通过 `enabled=false` 或 `disabled=true` 显式关闭该 system hook；`enabled` 和 `disabled` 冲突必须 assembly compile 失败。
- `maxHooksPerStage` 是 framework-owned startup setting，默认 16；按当前 Agent 每个 lifecycle stage 的 effective hook 总数计数，包含未禁用 system hook 和已启用 custom hook，不计入 disabled 或 stage narrowing 后不生效的 hook；超限时 Agent assembly compile fail closed，runtime 不截断、不降级。
- `HookEffect` 使用 `OBSERVE`、`TRANSFORM`、`CONTROL`；`effects` 是非空、去重集合，同一个 hook 可以同时声明观察、修改当前 effective boundary、影响 protected operation 继续/终止。
- 完整 hook 能力由 `effects` 派生执行策略：只有 observe-only hook 进入并行 observe group，任何包含 `TRANSFORM` 或 `CONTROL` 的 hook 进入串行 impact group。
- `HookFailureMode` 使用 `CONTINUE`、`FAIL`，只处理 hook 自身超时、异常、不可用或返回非法结果。
- `CONTINUE` 表示记录 `HookInvocationEvent(status=TIMEOUT|FAILED)` 后主流程继续；`FAIL` 表示记录事件后按请求失败路径终止。
- hook 正常返回的 `DENY`、`BLOCK`、`PEND` 是控制 outcome，不受 `failureMode` 控制。
- `HookKind` 使用 `SYSTEM`、`CUSTOM`；`SYSTEM` 表示框架内置且默认生效，执行优先级整体高于当前 Agent `CUSTOM` hooks；`SYSTEM` hook 组内顺序由框架内置 definition 的显式 `order.priority` 或等价 order 约束定义，`failureMode` 必须为 `FAIL`。
- `LifecycleStage` 覆盖 request accept、planning、model invoke、model result、capability invoke、capability result、context compact before/after、terminal event，startup hook registry、Agent activation 和 runtime execution 必须支持同一份 9 stage vocabulary。
- Hook contract 复用 runtime-owned `LifecycleStage`；hook definition/binding 不重新定义 lifecycle stage vocabulary。
- `HookOutcome` 使用 `PASS`、`SKIP`、`DENY`、`BLOCK`、`PEND`。
- observe-only hook 只允许 `PASS` 或 `SKIP`，不得返回 mutation、pending intent 或 lifecycle-changing outcome。
- 声明 `TRANSFORM` effect 的 hook 可以在 `PASS` 时携带当前 stage 合法 mutation，`SKIP` 表示不适用且不得携带 mutation。
- `TRANSFORM` 的开发者可见目标是当前 stage 的有效输入、有效输出或 context 事实：`BEFORE_*` 改对应节点 effective input / safe options，`AFTER_*` 改 downstream effective projection，context compact stage 改 effective context input/output，terminal stage 改 effective terminal safe summary / safe failure requirement。
- 声明 `CONTROL` effect 的 hook 允许 `PASS`、`SKIP`、`DENY`、`BLOCK` 或 stage-limited `PEND`；若 lifecycle-changing outcome 与 mutation 同时出现，runtime 以 outcome 为准并忽略 mutation。
- hook 开发者入口必须使用 canonical `execute`、`effects`、`outcome` 和 stage-specific mutation；runtime 先校验 canonical contract 再执行。
- 不能安全解释为非空 `OBSERVE` / `TRANSFORM` / `CONTROL` effects 集合、stage mutation owner 或 canonical outcome 的输入必须 fail closed；开发者可见输入收窄必须有明确的安全、恢复、审计或执行确定性收益。
- 不引入 purpose/mutation-permission 双枚举；TS 使用 `effects` 表达副作用权限集合，约束以 Agent 绑定、effects 和 stage-specific boundary/mutation 校验为主。
- `HookInput` 只包含 `hookId`、`agentId`、`agentVersion`、`stage`、`boundary` 和安全运行事实；不包含装配期 `config`。
- `HookResult` 只表达 runtime 必须处理的控制信号和边界修改：`outcome?`、`pendingInputIntent?`、`mutation?`、`safeReason?`、`error?`。
- core contracts 中的 `HookBoundary` 和 `BoundaryMutation` 是统一基类语义，不携带通用 `payload` 或 `patch` 字段；具体 stage boundary/mutation 类型由 `add-ts-lifecycle-hook-execution` 和 `complete-ts-lifecycle-hook-capabilities` 定义。
- `mutation` 缺省代表 no-op，不定义 `NoopMutation`。
- `outcome=PASS` 表示 hook 已执行且允许继续，`outcome=SKIP` 表示 hook 已进入但自行判断不适用于当前 run；两者都允许流程继续。
- `outcome=DENY` 表示治理拒绝，`outcome=BLOCK` 表示条件不满足或执行保护阻断，runtime 停止后续 impact hook 和主流程，且应携带 `safeReason`。
- `outcome=PEND` 表示挂起等待条件满足，runtime 停止后续 impact hook 和主流程，并基于 `PendingInputIntent` 创建真正的 `PendingInput`。
- `outcome=DENY`、`BLOCK` 或 `PEND` 与 mutation 同时出现时，runtime 以控制信号为准，不应用 mutation。
- 通用 `PolicyPort` 不进入核心契约；risk、routing、context budget 和 model selection policy 由后续具体 change 定义各自接口。

实现约束：
- observe-only hook 的观察行为由 hook 自己完成，runtime 只负责并行有界调用、忽略控制输出、记录 HookInvocationEvent 和观测降级。
- 通用 hook input 不混放 RequestRun 对象、requestContextId 引用、tenantId 或 subjectId；stage 相关数据必须由对应 `HookBoundary` 显式承载。
- hook 不得直接修改 runtime state，只能返回当前 stage 允许的 `BoundaryMutation`。
- runtime 必须校验 mutation 与当前 lifecycle stage boundary 匹配后才能应用。
- effective boundary 由 runtime 应用合法 mutation 后产生，不由 hook 返回为权威状态。
- 包含 `TRANSFORM` 或 `CONTROL` effect 的 impact hook 先执行 `SYSTEM` group，再执行 `CUSTOM` group；system group 按框架内置显式 order；custom group 构建同 stage impact hook graph，把 `order.before` / `order.after` 作为约束，并用 `(priority if present else declarationOrdinal, declarationOrdinal, hookId)` 作为 stable topological sort comparator；mutation 应用后再进入下一个 impact hook。裸数字 order、枚举 slot、跨 kind 目标、未知目标、非同 stage 目标和循环依赖 fail closed。
- 只允许 observe-only hook 并行执行；会影响流程或修改 boundary 的 hook 不得并行执行，也不定义并行 mutation 或 outcome 合并规则。
- observe-only hook 不得控制流程或修改边界；若返回 `DENY` / `BLOCK` / `PEND`、pending intent 或 mutation，必须记录诊断并忽略这些控制结果和修改请求。
- 每次 hook 执行必须产生 `HookInvocationEvent`，记录 requestRunId、sessionId、requestId、agentId、agentVersion、hookId、stage、kind、effects、execution strategy、status、时间、outcome、safe reason/error 和 mutation summary；其中 `requestId` 表示当前 root user request identity。
- `HookInvocationEvent` 是结构化观测事件，不是核心业务持久化对象，也不是 canonical timeline event；首版输出结构化日志和指标，可以发送到 audit sink，但不提供查询 API。
- 每次 hook invocation 不默认写入 timeline；只有 hook outcome 改变 request lifecycle 时才写入 timeline-only `HOOK_OUTCOME_APPLIED`，首版不新增对应 `StreamEventType`。
- risk policy 执行结果如需形成执行事实，写入 timeline-only `POLICY_APPLIED`，首版不新增对应 `StreamEventType`。
- `mutationSummary` 由 runtime 生成：无 mutation 时不填；有 mutation 时只记录 mutation 类型或稳定 kind 以及被修改字段名，不记录字段值、完整 boundary、完整 mutation、模型消息、工具参数、工具结果、附件内容或 secret。

## Roadmap 分阶段计划

各路标版本的详细计划已拆分到 [docs/roadmap/](./roadmap/README.md)，便于按阶段跟踪进展。本文档保留全局规则、长期架构决策、准入规则、并行开发矩阵和一致性检查。

| 阶段 | 详细计划 | 跟踪重点 |
|---|---|---|
| UCD 能力差距交付 | [ucd-capability-delivery.md](./roadmap/ucd-capability-delivery.md) | 将 UCD 设计快照映射为可认领的 ready change、依赖受控的 blocked change、候选决策和已关闭项；不替代 P0-P5 release scope |
| Alpha E2E 回归 Gate | [alpha-e2e-regression-gate.md](./roadmap/alpha-e2e-regression-gate.md) | 串行底座最小问答内核 E2E 回归保护 |
| P0 — 首版本地发布 | [p0-local-release.md](./roadmap/p0-local-release.md) | 首个可运行、可验证、可交付的本地 TS 后端版本 |
| P1 — 业务自定义/扩展机制 | [p1-business-extension.md](./roadmap/p1-business-extension.md) | 业务自定义、扩展机制、长期记忆、路由、Pending Input 和质量门禁 |
| P2 — 正式版 | [p2-formal-release.md](./roadmap/p2-formal-release.md) | 正式版堵塞修复、任务工具、周期任务和 workflow 基础能力 |
| P3 — Workflow 执行范式 | [p3-workflow-execution.md](./roadmap/p3-workflow-execution.md) | Workflow 生产硬化、长期记忆后续和执行核心扩展 |
| P4 — 完成整体能力出口 | [p4-capability-exit.md](./roadmap/p4-capability-exit.md) | 安全策略扩展、前端扩展、服务间 channel、远端 Agent 和开发体验 |
| P5 — 分布式与并行执行 | [p5-distributed-parallel.md](./roadmap/p5-distributed-parallel.md) | Agent Gateway/StateStore 边界、多实例一致性、会话亲和重连、故障接管、分布式 workflow 和并行执行 |
| 待规划模块 | [backlog.md](./roadmap/backlog.md) | 尚未归入具体里程碑、后续需要排序进入 P0-P5 的能力和 change |

## 并行开发矩阵

截至 2026-06-01，串行底座已完成；以下“可开始条件”主要用于新增或后续 change 的前置判断，而不是表示当前仍未满足。

| 能力组或 change | 可开始条件 | 集成条件 | 主要冲突风险 |
|---|---|---|---|
| [UCD-P1 交付并行组](roadmap/ucd-capability-delivery.md#可认领并行组-ucd-p1) | 对应卡片状态为 `ready` 或已建立独立 OpenSpec 的 `active`，当前实现基线、契约变化与依赖已核对 | `refine-ts-session-activity-stream-boundary`先冻结execution/activity两类流边界，之后Session activity由`agent-session`拥有进程内派生并经channel/frontend投影；todo change保持独立，共享i18n资源按认领说明协调写入区 | 未确认前置stream contract就实现Activity、重复创建已吸收的frontend-only run-awareness、让frontend复制runtime lifecycle、多个成员争夺同一主流程文件 |
| [UCD-P2 后续串行组](roadmap/ucd-capability-delivery.md#在建依赖与后续串行组-ucd-p2) | thinking foundation 合入并归档，history/process 冲突面和 owner boundary 已释放 | thinking/history 与 process activity 按依赖顺序验证；content safety、workflow pending-input 等未决项先在 UCD-P3 完成契约/产品澄清，不得只等待依赖后直接实施 | 在依赖未完成时复制 projection/state model，或让 frontend 接管 runtime/pending-input/security authority |
| [`establish-ts-core-contracts`](nextagent-ts-changes/establish-ts-core-contracts.md) | 架构基线稳定 | 自身验证通过 | 契约过宽或过早定义实现细节 |
| [`ship-ts-minimal-agent-kernel`](nextagent-ts-changes/ship-ts-minimal-agent-kernel.md) | 核心契约完成 | 端到端问答通过 | 主流程膨胀，递归实现配件 |
| 请求控制能力组 | 核心契约完成 | 最小内核 runtime 稳定 | 改写 command ownership |
| Stream Resume 和历史一致性能力组 | 核心契约完成 | timeline 和 channel stream 稳定 | 破坏 canonical timeline |
| [`persist-structured-delta-aggregation`](../openspec/changes/archive/2026-08-22-persist-structured-delta-aggregation/)（已归档） | `TOOL_STRUCTURED_DELTA` 识别、stream projection、ordinary Message-first 与统一 Working Memory timeline gateway contract 已同步为 stable；公共 flush 删除已确认，四个 Function 与长期设计已完成归档复审 | 非 Workflow 增量按 `(runId, toolCallId)` 隔离、有界聚合；`CAPABILITY_RESULT` Message 成功后由 Runtime 私有 flush 有退出条件的过渡 presentation snapshot；history 对同一 run/tool 只选择 Event snapshot 或 legacy Message fallback；所有 direct/fallback record 在 gateway 前不超过 49,000 UTF-8 bytes并显式投影 `truncated`；Workflow inner product 保持 Event-owned；方案二以后把 final presentation 收编到同一 Message 时删除 ordinary Event body；下一步由 #823 先收敛 terminal Message-first，再由 `replace-degradation-notice-with-completion-limitations` rebase | 冻结过渡 Event 为长期正文 owner、把私有 flush 暴露为 Core/Runtime 公共 contract、依赖 provider 生成全局唯一 `toolCallId`、跨 run 串组或串 Owner Scope、Message 失败留下 completed orphan snapshot、history 双呈现、accumulator 无界、对象 content 被字符串化、remote 50KB 拒绝、静默截断、吞掉持久化故障，或把截断误建模为 degradation/completion limitation |
| [`fix-terminal-message-first-capacity`](../openspec/changes/fix-terminal-message-first-capacity/)（active，Issue #823） | 已归档 `persist-structured-delta-aggregation` 并合入 main；架构目标与 frozen `AgentRunStatePort.setCapabilityTerminalAnswer(run, context, {content})` 必选 additive refinement 已确认；补充确认 direct model 硬字符上限从 150,000 收窄为真实可提交的 50,000 个 UTF-16 code units，保持带标记截断后成功；`AgentExecutionOutcome` 保持冻结，修订规格与测试后重新执行门禁 | LLM Executor 与 Capability Executor 是仅有结果生产者；模型正文恰好 50,000 字符原样成功，首次超限由 Agent Core 生成总长不超过 50,000 的带标记正文并 `REQUEST_COMPLETED`，Runtime 只对绕过 producer 保护的原始超限正文 fail closed；仅 Direct Workflow 和非 agentic ApiCall 成功 direct-terminal 路径通过 runtime-owned Capability terminal handoff 交付结果，普通结果保持既有 `PLAIN_TEXT` 答案显示，超过 50,000 字符时复用既有 `tool-results` workspace preview/ref；terminal Assistant Message 是唯一回答 body owner，Event body-free 且不超过 49,000 UTF-8 bytes；live/history/Task/Cron 使用同一 committed projection；前端仅修正带可信 Workflow correlation 的 structured `ANSWER` owner，使其进入现有执行过程区域且不与 terminal Message 重复进入答案区，ordinary structured `ANSWER` 不变；超长 terminal `PERSISTED_PREVIEW` 只在答案区转换为本地化的部分内容说明、原始字符数与有界 preview，不显示 reason/ref/内部路径/Read 指令；不新增公共字段、组件、样式或全文交互；真实 commit failure 不发布 fallback；归档后成为 `replace-degradation-notice-with-completion-limitations` 前置，#821 接管 `MODEL_TEXT_LIMIT_EXCEEDED` 的 completion limitation carrier 与本地化标记呈现，但不重做容量阈值和截断算法；#748、#827、#828、#844 Workflow executor 统一与 #846 BlobStore 权威存储保持独立 | 让正常 LLM 50,001 字符在 Runtime 整体失败、给 LLM 增加 workspace 外置或 replacement metadata、继续使用不可提交的 150,000 字符模型上限、继续用 final `LLM_CONTENT_DELTA` 伪装 Capability 结果、修改 `AgentExecutionOutcome` 返回正文、把 handoff 扩大到其他 Capability/Model Loop/Workflow-as-Tool、增加 contentType/origin/来源标签或新前端公共分支、在 terminal 层新建截断/BlobStore/文件机制、Message 超限、live 全文与 history preview 分叉、改变边界内 Workflow/ApiCall 最终答案正文或其他过程呈现、要求刷新后才出现答案、新增前端公共字段/组件/样式/全文交互、改变 ordinary PIU/structured `ANSWER` 投影、前端读取 workspace 或自动展开全文、恢复 Event 第二正文或 fallback、修改 Workflow inner Event-owned 边界、把 PIU Answer、structured owner 重构、timeline retry、前端失败治理、Workflow 内部 executor 重构或披露配置偷渡进 #823，或把本地 rejecting-provider 白盒测试冒充 remote E2E |
| [`refine-session-thinking-presentation-contract`](nextagent-ts-changes/refine-session-thinking-presentation-contract.md) | UCD目标已确认；前序run-anchor已归档；same-event final snapshot、runId event API和fork snapshot方案完成OpenSpec重写；committer已确认R1-R8 | Message错误增量已撤销；final `LLM_THINKING_DELTA`持久化、声明式persistence、run-scoped event endpoint、shared safe projection、fork child-owned snapshot和最小frontend兼容验证通过 | 把thinking重新建模为message/assistant part，持久化partial delta，新增runtime segment状态机，建立source lineage read-through，复制可操作runtime state，或让event进入模型上下文 |
| [`establish-conversation-process-history-continuity`](nextagent-ts-changes/establish-conversation-process-history-continuity.md) | 前序event vertical slice完成、归档并合入`main` | Frontend history hydration、message/event join、live/history reconciliation、ProcessPanel状态机和三宿主旅程验证通过 | thinking/tool丢失或重复、final answer从event重建、live/history分叉、折叠误删entry，或重新争夺后端contract |
| 附件能力组 | 核心契约完成 | attachmentIds 接入 request acceptance，AttachmentStoreGateway 和 BlobStoreGateway 可用 | 附件绕过受控引用 |
| Context Assembly 能力组 | 核心契约完成 | 最小 context engine 可替换 | policy 分散到多个模块 |
| System Reminder 能力组 | Context Assembly 管道稳定（`budgetPlan`、`compressionEvidence`、`CapabilityCatalog` 可用） | v1 管道可替换，v2 各 Producer 前置 change 完成 | SR 管道修改 runtime lifecycle 或 session message 契约 |
| Capability 能力组 | [`add-ts-capability-core-governance`](nextagent-ts-changes/add-ts-capability-core-governance.md) 完成 | source changes 可接入 catalog | 多套能力执行语义 |
| [`unify-capability-failure-disposition`](nextagent-ts-changes/unify-capability-failure-disposition.md) | 2026-08-03 已完成 frozen Capability timeout 语义群内确认；2026-08-04 已完成 `CapabilityInvocationRequest.maxRetries` additive refinement 群内确认，相关人员同意字段表示额外 retry 次数、缺省值为 `1`、默认总 attempt 上限为 `2`，且 Workflow retry 次数只下沉到统一边界内部；2026-08-06 已确认 Agent 对除取消外的最终 Capability 失败反馈模型，由模型选择下一步，不再按重复错误局部终止；只有明确 `REQUIRE_AUTHORIZATION` 是授权控制，普通 `AUTHORIZATION` SafeError 按一般失败处理；2026-08-07 已完成三组 frozen contract 群内确认：`ToolChoice` / `ModelInferenceOptions.toolChoice` additive refinement 及 Skill metadata 同形复用（类型名不得带 `Model`）、clean 删除 `AgentRuntimeSettings.maxToolIterations` 并新增 `maxTurns/maxToolCallsPerTurn`、runtime 同组删除 `RoutingConstraints.maxToolCalls` 与 planning-hook `maxRounds/maxCalls` 并只在 `RequestContext`/checkpoint 增加同一个 `agentTurnIndex`；normal/finalizing 由 index 与 accepted `maxTurns` 推导，不保留 alias、phase 或 migration window；以当前分支已同步的 `main` 代码与 stable OpenSpec 为实施基线，active change 不作为实施前置；同 Requirement 或行为不变量冲突由后合入者基于届时最新 stable 与代码消解 | `agent-capability` 统一执行边界、可由可信调用方限制且缺省为一次的安全同参 retry、Workflow retry 次数下沉、20 个 first-party Tool、Agent 对全部非取消最终失败的完整模型反馈；`maxTurns` 缺省 50 且按 accepted `RequestRun` 成为唯一 logical loop-count bound，pause/resume/recovery 保持同一 turn coordinate，达到上限后恰好一次保留 Tool descriptors 且 `toolChoice=NONE` 的模型收尾；`maxToolCallsPerTurn` 缺省 30、有效域 1..100，只保存顺序前缀并按统一 preflight、治理、执行和配对规则处理，超限尾部不保存不执行并反馈 requested/admitted/omitted counts 后继续 loop；空 Tool 名称不再有独立 recovery counter；profile/Prompt/Skill patch/trusted request/Hook 的 canonical `ToolChoice` 合并；明确 authorization pending 和 lifecycle hook 控制保真、ordinary admitted batch 调用前失败零执行，以及 Agent/Assembly/Runtime/Model/Context/Prompt/Skill/Hook/Recovery/Workflow/terminal/history/frontend 验收和完整门禁通过；归档前对照最新 stable 审计自身 delta，并记录仍存活冲突 change 的后合入责任 | 多个模块争夺 retry owner、Capability retry 上限绕过安全门禁或与 Workflow 节点重试相乘、Capability 最终失败被 Workflow 节点重放、普通授权错误被误判为 pending control、明确 authorization pending 或 lifecycle hook 控制被误写为模型失败、同批 admitted 调用前失败后仍执行兄弟调用、生产调用仍存在失败处置旁路、达到 `maxTurns` 后仍执行 Tool、recovery 重置 turn、finalizing logical turn 超过一次、Tool-call 超限或空名称提前终止、孤立 message pair、request/Hook 仍可覆盖 Agent-owned loop limits、model-only 继续清空 tools、`providerOptions` 建立平行 tool choice，或后合入 change 静默覆盖已合入行为 |
| [`refine-openai-compatible-model-adapter`](nextagent-ts-changes/refine-openai-compatible-model-adapter.md) | 模型 invocation/config/context-window/stream/fallback/routing/prompt/error 基线已归档；模型目录、选择、调用 binding、Gateway model information、唯一 `modelId`/`providerId`、封闭扁平调用 schema、开放但保留字段受控的 provider options、同模型 retry、通用 optional `FetchGateway` composition、best-effort usage、真实 background scope、production `NextAgentApp` 只保留含 frozen 模型配置/evidence 的 immutable `systemConfig` 公共投影并删除 `modelProfileRegistry/productModelProviderKind`、timeline/workbench canonical identity、observability 高基数 identity non-projection、model metric `provider_kind` label 删除，以及 RESERVED policy owner 已形成唯一目标；2026-07-28 已确认原范围继续有效，2026-07-29 已对 ready/assembly publication/primary health 前零 Gateway metadata I/O、lazy resolution/single-flight/freeze、产品 `providerId` 清单、catalog/selection configuration 同形复用、selection scope/mode、Prompt model scalar 和 thinking 单一 authority 完成补充群内确认，全员同意且无异议；2026-07-30 需求方确认 fetch 是可供后续 REST consumer 复用的运行环境能力、当前 change 只装配给模型且不建立 header policy；2026-07-31 需求方确认 Agent assembly 直接以 frozen `systemConfig.modelProfiles` 校验模型引用，删除 configured ids/membership，保留既有 `ModelCatalogQueryService` 名称且 app-facing model ports 只包含 catalog query 与 invocation；同日进一步确认删除没有独立生命周期或消费者的 `ModelProfileRegistry`，Host 只读取 frozen `systemConfig` 且不建立第二份 registry/index；`add-ts-dev-agent-workbench` 必须先归档形成 stable 迁移来源 | `agent-app` 直接以 frozen `systemConfig.modelProfiles` 校验 startup/hot-reload Agent assembly 模型引用；`agent-model` 成为 lazy global catalog/query 与 provider adapter owner；产品 provider id 为 `openai-compatible | model-gateway`；ready 前只冻结 system model definitions/private binding 并发布已知 Agent activation，primary health 不解析 Gateway metadata，Gateway metadata 由首次 Context selection、显式 post-ready deep model-provider health 或其他 safe `list/get` 查询按需解析，失败按 model 冻结为 `UNAVAILABLE`；available entry 只在 resolved configuration 中携带 `modelId`，selection 原样复用；Context Engine 通过 app-private `ModelCatalogQueryService` 获得唯一 query/selection 路径并服务 main/summary/memory/session/workflow initial/fallback selection，Core 编排 cross-model fallback gate/evidence；app-facing model ports 恰好为 `ModelCatalogQueryService(list/get)` 与 `ModelInvocationService(complete/stream)`；app 保留配置解析、校验、派生、证据生成和装配，`NextAgentApp.systemConfig` 供可信 App Host 履行进程/宿主职责，production 不维护重复 `modelProfileRegistry`，内部功能模块接收窄投影；推荐服务为 terminal/Web 的实际模型调用建立 private operation identity；调用请求使用 selected `modelId`、trusted flat scope、动态输入、封闭扁平可选参数和可信内部 provider options；OpenAI-compatible 调用通过 AI SDK 6 标准路径完成 Chat Completions、thinking、tool call、同模型 recoverable retry、best-effort usage 与 safe failure；`agent-contracts/gateway` 拥有环境中立的 optional `FetchGateway`，app 在 Gateway bindings 完成后把它适配给当前模型 registration，LOCAL 缺失时使用平台默认 fetch，REMOTE 实现留在仓库外，其他 REST client 保持不变；observability 保留模型调用事实与 stable refs但不导出模型 identity，model metrics 不按 provider/model identity 分类；按 Requirement 以来源 `REMOVED` + 目标 `ADDED/MODIFIED` 原子迁入 Function canonical spec；contract/kernel/architecture 和完整后端门禁通过 | 与 extension-registration 的边界为 frozen system model definitions/assembly validation、lazy model catalog owner 与 contribution registration owner；与 app composition 的边界为模型 preparation/private injection 与 composition runner/scope/cleanup；与 context/fallback/memory/workflow 的边界为 Context Engine selection、Core fallback gate 和各 consumer 业务 lifecycle；provider options 由 selected adapter 校验且不重复顶层 thinking/reasoning authority，通用 fetch contract 由 Gateway 拥有并由 app composition 交给 consumer，当前 change 不迁移其他 REST client；runtime lifecycle、Agent Scope 和 Owner Scope 保持现有 owner |
| [`refine-ts-extension-registration`](nextagent-ts-changes/refine-ts-extension-registration.md) | `add-ts-builtin-tool-framework`、`add-ts-capability-source-configuration`、`add-ts-model-provider-configuration` 和 app config schema 稳定；如需新增 public provider vocabulary，必须先完成 contract refinement | Builtin capability、reserved provider 和 model adapter contribution 在启动期被确定性发现、校验、冻结并进入既有 catalog/model routing 主路径；新增贡献不需要编辑中心注册数组或 `agent-app` provider switch | 把启动期注册扩大成运行时热加载、任意目录扫描、import side-effect 自注册、插件依赖安装、provider SDK 类型泄漏或绕过 capability governance |
| [`shrink-agent-app-to-composition-root`](nextagent-ts-changes/shrink-agent-app-to-composition-root.md) | 架构基线、app config schema、capability/model/context/memory/workflow/observability/gateway/session 主边界稳定；可与 `refine-ts-extension-registration` 并行但只消费其 frozen registry/snapshot | `agent-app` 只保留配置加载、依赖注入和服务启动；memory extraction、workflow runtime adapter、context summary helper、observability mapping、capability sandbox/tool preparation、session question assist、health probe business checks 等由 owning package public factory 提供 | 调整 owner boundary 时改变 request lifecycle、让 owner package 反向依赖 `agent-app`、复制配置状态机、扩大 public contract、引入 DI container、新增第二套 sandbox adapter、让 `agent-session` 承担 model/capability/app implementation ownership 或把实现细节泄漏到 cross-package API |
| [`refine-agent-app-composition-pipeline`](nextagent-ts-changes/refine-agent-app-composition-pipeline.md) | `shrink-agent-app-to-composition-root`、`add-ts-app-config-schema`、`add-ts-local-runtime-package` 和 `refine-ts-fullstack-packaging-boundary` 已完成；`add-ts-runtime-operational-log-hardening`与`add-otlp-trace-export`实现已完成并形成稳定writer/trace基线，归档可滞后但不得再并行修改重叠装配路径；当前 app-local composition entry 与产品入口行为已有 characterization | Local/Remote/Test host只投影为标准product input，prepared/core无host/test discriminator；全部public factory只是facade且每次恰好进入唯一sync或async runner/唯一scope，两者共享prepared shape/core/package-private outcome，async是canonical full-capability path，public sync compatibility保留；config后只load/validate/freeze一次plugin snapshot并将hooks/policies/providers/diagnostics交给既有消费者；模块只接收窄投影；channel auth/frontend hosting profile正交；local-auth依赖只存在local typed contribution adapter；全部真实product/test/package/process/script surface有唯一owner；local package direct/dispatch只产生一次config fact并保持writer→trace与safe gateway/start evidence；37项test-host inputs不丢失；cron按selection→gateway→capability→runtime分层且无REMOTE-only preflight；Web/local/workbench/task/cron在channel stage完成；with-frontend只由唯一async runner在scope内、commit前typed finalization；composition failure逆序且至多一次cleanup | host/test discriminator渗入prepared/core、多于runner或facade嵌套scope、本change偷渡删除sync API、sync path静默降级async-only能力、plugin被延后到capability加载、snapshot重复或跨层贡献丢失、profile混叠、generic channel依赖local-auth实现、遗漏目录外host/test/package/process/script wiring、local package重复config/model/gateway/observability或丢失proof、test injection丢失、cron runtime prerequisite前置为readiness或未选分支误校验、非async runner或commit后product registration、host与runner重复cleanup、lifecycle input未分类、`app.start()` failure误纳入composition scope、遗漏active assembly/recovery/observability/public app projection |
| [`add-ts-skill-fork-execution`](nextagent-ts-changes/add-ts-skill-fork-execution.md) | `add-ts-skill-tool`、Skill manifest/source discovery、Skill resource access、model invocation 和 capability invocation boundary 稳定 | `context=fork` Skill 能在独立受控上下文中完成模型循环并以安全结果回流父 run | fork executor 拥有 runtime lifecycle、扩大工具权限、泄漏 Skill/source 私有路径或复制 model/tool loop 语义 |
| [`add-ts-runtime-host-agent-selection`](nextagent-ts-changes/add-ts-runtime-host-agent-selection.md) | Agent package assembly、app config schema、local/web auth boundary 和 session store Agent Scope 稳定 | 新 session/request 的 Agent Scope 由可信 host selection 固化；已有 session 坚持 `Session.agentId` | 把客户端 body/metadata 当作 Agent Scope、与 Agent 内部 routing 混淆、或让 runtime 做 workflow/model-loop 业务路由 |
| [`refine-ts-agent-identity-and-id-format`](nextagent-ts-changes/refine-ts-agent-identity-and-id-format.md) | 核心契约和最小内核已归档；Agent package assembly、lifecycle hook、capability catalog、local run/timeline store 边界稳定 | `agentAssemblyRef` 从 public contract 和主路径持久化事实中移除；AgentAssembly identity 统一为 `agentId + agentVersion`；系统生成 durable id 使用 TypeID；sequence 只能在 parent scope 下使用 | 破坏既有 RequestRun/RequestContext/gateway schema；持久化事实回读边界不清；把 sequence 误用成全局 ID；把随机 TypeID 误用成 idempotency key |
| [`add-ts-simple-agent-facade`](nextagent-ts-changes/add-ts-simple-agent-facade.md) | `add-ts-agent-package-assembly`、Runtime Configuration、Capability governance、Skill manifest 和模型配置边界稳定 | `SimpleAgent` 输入被编译为普通 Agent assembly 并通过 `app.run(agent)` 进入既有 runtime 主路径；默认 profile、工具和技能解析结果可解释且可验证 | facade 绕过 app composition、产生第二套配置方言、信任 raw tool/skill path、扩大 capability 权限或暴露 runtime 内部对象 |
| [`add-ts-dev-agent-workbench`](nextagent-ts-changes/add-ts-dev-agent-workbench.md) | runtime timeline listener、trace/log linking、agent execution trajectory、structured/runtime logging 和 local runtime package 机制稳定 | local runtime package 默认装配 dev workbench projector、dev-only query API 和自包含轻页；通过既有 facts + owner-owned minimal safe projection payload 做投影；不注册 observe-only hook、raw decorator、raw snapshot collector、raw buffer 或独立前端模块；生产打包不包含 route/API 或 workbench enrichment | 调测台反向改变 request lifecycle、terminal truth、canonical timeline、structured log/audit/metrics/trace/redaction policy；raw prompt/tool/model content 泄漏到生产观测面或稳定产品 API；把 dev workbench 混入生产打包或引入过重前端模块 |
| Agent Routing 能力组 | 最小内核完成 | routing policy 位于 Agent 内部 | channel/runtime 绕过 Agent 路由 |
| Human Pending Input 能力组 | 最小内核完成 | `PendingInputStoreGateway`、三对象契约和 answer 处理可持久化 | pending 生命周期被 channel 或 capability 私有化 |
| [`refine-ts-pending-input-timeout-contracts`](nextagent-ts-changes/refine-ts-pending-input-timeout-contracts.md) | stable pending input、RequestRun terminal commit与Agent Scope契约可用 | 全局due query被唯一Agent-scoped unresolved timeout fact query替换；覆盖future/due `PENDING`与未完成`TIMED_OUT`，contract/adapter/runtime consumer原子迁移 | 保留旧query形成双路径、把Owner目录当扫描前提、把due decision放入gateway、把cursor持久化或暴露给客户端 |
| [`fix-ts-pending-input-timeout-lifecycle`](nextagent-ts-changes/fix-ts-pending-input-timeout-lifecycle.md) | `refine-ts-pending-input-timeout-contracts` implementation与验证完成 | runtime单timer按durable deadline唤醒，在无外部流量时推进timeout并从partial failure恢复；timeout跳过terminal hook，activity与frontend只消费canonical结果 | 固定周期polling、frontend/activity接管timeout authority、per-pending timer、重复scheduler、跨Agent扫描或非幂等terminal重试 |
| InvokedAgent Execution 能力组 | Agent capability discovery 完成 | 子 Agent 执行结果可被父 run 安全消费 | 子执行污染父 run 事实边界 |
| [`add-ts-recurring-agent-tasks`](nextagent-ts-changes/add-ts-recurring-agent-tasks.md)（candidate re-scope） | `add-ts-cron-tools` implementation tasks 已完成、代码已入主干但 archive pending；以当前 Cron 调度和标准 runtime submit 为唯一增量基线，管理面与结果归属分别完成 [`add-cron-task-management-surface`](nextagent-ts-changes/add-cron-task-management-surface.md) 和 [`clarify-cron-result-session-navigation-policy`](nextagent-ts-changes/clarify-cron-result-session-navigation-policy.md) 的决策 | 后续 change 只增量消费既有 Cron gateway/scheduler/tool，不建立第二套 recurrence lifecycle；每个 change 有单一 owner 和独立验收 | 重建 scheduler/store/occurrence 语义、让 runtime 重新拥有 Cron scheduling、把管理 UI 与结果 context 策略混为一个 change、或让模型静默创建长期后台任务 |
| Sandbox Execution 能力组 | 核心契约完成 | sandbox gateway 可替换 | 动态执行绕过 sandbox gateway |
| Side-effect Idempotency 能力组 | [`add-ts-capability-idempotency-contract`](nextagent-ts-changes/add-ts-capability-idempotency-contract.md) 完成 | runtime recovery guard 接入恢复流程 | 非幂等 Tool 被恢复流程重复执行 |
| Policy Hooks 能力组 | 核心契约完成 | 系统内置 hook 可执行并审计；`complete-ts-lifecycle-hook-capabilities` 补齐 9 stage、observe/transform/control、并行 observe 和串行 impact 语义；risk policy 使用具体 change 接口执行 | hook/policy 拥有 runtime 状态、并行 impact hook 合并语义不清或形成插件生态膨胀 |
| [`add-ts-agent-scoped-plugin-composition`](nextagent-ts-changes/add-ts-agent-scoped-plugin-composition.md) | `add-ts-agent-package-assembly`、`add-ts-lifecycle-hook-execution`、`complete-ts-lifecycle-hook-capabilities`、`add-ts-risk-policy-enforcement` 和 Tool framework 边界稳定；`complete-ts-lifecycle-hook-capabilities` 必须先归档 | 插件 registry 在启动期按显式 system config 和本地插件目录冻结，host externals 只开放工具库白名单并由 `agent-app` 注入，Agent 配置激活结果只对当前 Agent 生效；Tool 贡献进入 capability discovery/catalog 主路径，policy 只替换白名单 extension point，hook 只贡献 `LifecycleHook` object 并复用完整 hook registry / `AgentAssembly.hooks` activation | 插件贡献绕过 Agent activation、capability governance、policy 白名单或 hook lifecycle 边界；把启动期装配扩大成动态加载、热加载、目录自动扫描、插件依赖安装、宿主 `node_modules` 任意复用或远端分发 |
| 本地状态 Gateway 能力组 | 核心契约完成 | app composition 可切换 gateway | 具体存储泄漏到上层 |
| [`refine-ts-fullstack-packaging-boundary`](nextagent-ts-changes/refine-ts-fullstack-packaging-boundary.md) | 架构基线完成且 `add-ts-local-runtime-package` 已定义运行包边界 | `backend-only` / `with-frontend` package profile、前端包消费边界和 route precedence 可验证 | 前端源码侵入后端实现、静态 fallback 吞掉 API/stream、profile 选择变成运行时探测 |
| [`refine-ts-runtime-recovery-execution-cursor`](nextagent-ts-changes/refine-ts-runtime-recovery-execution-cursor.md) | `add-ts-local-runtime-recovery`、`add-ts-runtime-recovery-idempotency-guard`、lifecycle hook execution 和 capability replay policy 稳定 | Runtime recovery 产出合法 execution resume context；Agent core 正常执行和恢复执行共享同一 execution cursor 推进语义 | recovery 判断散落到 core/tool-loop/risk policy、阶段恢复行为不一致、或把多实例 lease/takeover 偷渡进本 refinement |
| Observability 和 Audit 能力组 | 核心契约完成；[`add-agent-id-to-audit-event`](nextagent-ts-changes/add-agent-id-to-audit-event.md) 先行完成 `AuditEvent.agentId` contract refinement | audit writer 和 observability implementation 已接入；run-bound audit envelope 已携带可信 `agentId` | 业务模块自定义审计格式或把 SDK 类型泄漏到核心契约；`agentId` 从客户端请求体、模型输出或 capability 参数中读取 |
| [`add-ts-operational-log-hardening`](nextagent-ts-changes/add-ts-operational-log-hardening.md) | Structured logging、redaction policy、app config schema、local runtime package 和 metrics/health 稳定 | 运行日志按配置级别输出并安全落盘；runtime diagnostic 与 observation-derived entries 写入单 operational 文件并通过 `surface` 分面；异常 catch/fallback/degradation 有安全诊断；structured log 投影降噪；按大小 rotation，历史日志压缩，默认至少保留 7 天；写入失败、清理失败和潜在丢失均可观测 | 业务模块散落 ad hoc logger、日志包含敏感内容、吞掉异常、structured log 重复 metric/health/audit/trace 噪声、rotation 阻塞 request lifecycle、压缩/清理删除未过期日志、或把本地文件保留误当审计合规存储 |
| Answer Feedback 能力组 | 最小内核完成 | feedback 可持久化并关联 audit | feedback 改写历史或触发执行 |
| Session Title Management 能力组 | 最小内核完成 | session list 可显示持久化 title | 标题生成阻塞终态提交 |
| Bilingual Telecom Language 能力组 | prompt shaping 完成 | 输出语言和术语保留规则可验证 | 引入复杂语言检测服务 |
| [`add-ts-user-facing-i18n-contract`](nextagent-ts-changes/add-ts-user-facing-i18n-contract.md) | SafeError、安全诊断、Web/auth/stream projection、frontend hosting boundary 和 locale 传递稳定 | 客户端可见消息使用稳定 key + 安全参数 + fallback；前端按 locale 渲染 bundle，后端英文硬编码不再作为唯一展示来源 | 把 raw error/message/content/path/credential 放入翻译参数、让前端反推业务语义、把 locale 放进 identity、或让 SafeError fallback 语义与客户端展示 key 脱节 |
| Runtime Configuration 能力组 | 核心契约完成 | app composition 稳定 | 配置细节泄漏到 contract |
| Authentication / Local Auth 能力组 | Runtime Configuration 和 Secret boundary 完成 | local 产品入口显式组装 auth-local，remote/IAM 入口不打包 | 本地认证范围膨胀成完整用户管理或 LAN/公网认证系统 |
| Release Quality Gates | 首版必需 change 完成 | 硬门槛通过，容量基线有记录 | 发布门槛不明确或把基线误当 SLA |
| E2E Quality Gates | 对应产品能力和真实候选包可执行 | 产品旅程、security、resilience、release/package E2E evidence 可被 release qualification 消费 | mock 替代真实边界、用例重复归属或 E2E change 偷渡产品行为 |

## 创建前覆盖检查

每个新 change 创建前，必须检查：

- 是否依赖核心契约。
- 是否修改最小内核主流程 ownership。
- 是否能与其他 change 并行。
- 是否属于首版必需能力。
- 是否应作为配件补实，而不是重写主流程。
- 是否只描述目标状态。
- 名称是否只是能力组；如果是，必须继续拆成实施 change。
- 是否拥有单一主要 owner 和清晰写入边界。
- 是否有可独立验收的目标；如果只是共享规则或中间机制，应并入对应能力组或实施 change。
- 是否能独立交付；如果完成后没有用户可见行为、系统可验证行为或质量门禁增量，不应单独成 change。

## 生成后一致性确认

每个 TS backend OpenSpec change 生成后，必须完成以下一致性确认。确认结果记录在本次审查报告或目标 change artifact 中，不依赖额外迁移记录文件。

| 检查项 | 确认内容 | 常用证据 |
|---|---|---|
| Change 本身一致性 | proposal、design、specs、tasks 的 Function/capability、Requirement、Scenario、范围、非目标和验收任务一致；新 Function 与 spec 保持 1:1；OpenSpec strict validate 通过；change 本体不包含过程性表述或历史实现来源。 | `openspec validate <change> --strict`、Function-spec 映射、Requirement-to-task 对照、关键词扫描 |
| Change 和架构一致性 | 不突破 [`establish-ts-backend-architecture`](nextagent-ts-changes/establish-ts-backend-architecture.md) 中的 package、runtime ownership、channel projection、context ownership、gateway/adapter、capability、sandbox、observability 和 app composition 边界。 | 与架构 change 的 proposal/design/spec/tasks 对照 |
| Change 和前序 change 一致性 | 依赖顺序正确；不重新定义前序 change 已冻结的 contract；如果需要改变前序 contract，必须改为 contract refinement change 或显式修改前序计划。 | 本文档依赖、active changes、前序 change specs/design |
| Change 和 roadmap/release scope 一致性 | change 的首版/后置范围、依赖、owner、并行边界与本文档一致；不把已后置或明确不规划的能力混入首版 change。 | 本文档对应 change 小节、扩展候选和明确非目标 |
| Spec-to-task 可追踪性 | 每个关键 requirement 都能在 tasks 中找到实现或验证入口；tasks 不只是泛化检查清单，且没有只在 tasks 中出现、spec/design 未定义的行为目标。 | requirement-to-task 对照、tasks 分组、验证任务 |
| 目标态一致性 | change 本体不出现兼容性辅助信息、迁移来源或其他仓库参考；若发现新差异，先记录并澄清，不得把差异处理写成当前 change 的实现要求。 | 关键词扫描、artifact 交叉检查、审查结论 |

检查记录必须写清：

- change id。
- 检查日期。
- 各项结论：`pass`、`pass-with-note` 或 `blocked`。
- 发现的问题和处理结果。
- 已运行的校验命令。

如果任一项为 `blocked`，不得继续生成后续 change。
