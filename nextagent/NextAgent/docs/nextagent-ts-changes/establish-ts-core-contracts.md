# establish-ts-core-contracts

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：串行底座

状态：complete
类型：串行先导 change
主要 owner：核心契约 / runtime / gateway / capability / context
依赖：`establish-ts-backend-architecture`

目标：
- 冻结最小问答内核和后续并行配件开发所需的核心 contract。
- 冻结 `agent-common` foundation package，承载 shared ids、基础 value object、JSON value、时间/幂等键、IdentityContext、RequestLocale/RequestLanguage、SecretReference、AgentError/SafeError 安全错误形态，以及跨 runtime、gateway、session/history、recovery、observability、channel projection、app configuration、assembly 和 capability 边界共同消费的基础 enum。
- 冻结 `agent-contracts` 的 owning export modules：runtime、channel、session、attachment、context、model、capability、core、gateway、observability、app；不新增 `agent-contracts/common` owning module，也不为 identity、timeline、checkpoint、pending-input、hook、sandbox、content、errors、configuration 或 feedback 建立 reserved alias / 概念分类 owning subpath。
- 冻结 runtime command、Agent.execute、RunTimelineEventPort.emit、RuntimeTimelinePort.stream、RequestAccepted、pending input answer command 和 stream envelope 的稳定签名。
- 冻结 `SessionStoreGateway`、`SessionMessageStoreGateway`、`SessionHistoryRecordQuery/Page`、`SessionConversationRecordQuery/Page`、`CurrentRequestConversationRecordQuery` 和 `hideMessage(HideMessageRequest)`，作为历史会话列表、会话内对话读取、当前 request/run 消息读取和 message visibility update 的 gateway 持久化基础契约；session read model 由领域层映射为 `SessionHistoryQuery/Page`、`SessionConversationQuery/Page`。
- 冻结 `RequestRunStoreGateway`、`CheckpointStoreGateway`、`PendingInputStoreGateway`、`FeedbackStoreGateway` 的稳定命名。
- 冻结 `AgentAssemblyRegistry.active(agentId)` 和 `AgentAssemblyRegistry.require(agentId, agentVersion)`，作为 runtime-facing Agent assembly lookup boundary。

实现约束：
- 每个 public DTO、enum、schema skeleton 和 port 只能有一个 owning export module。
- foundation contract 归 `agent-common`；boundary DTO、enum、schema skeleton 和 port 归具体 `agent-contracts/*` subpath。
- `agent-common` 不得依赖 `agent-contracts`；`agent-contracts/*` 必须复用 `agent-common` 中的 shared id、value object、identity、locale/language、SecretReference、safe error shape 和跨边界基础 enum。
- enum 归属按共享语义判断：`RunStatus`、`TerminalCommitState`、`TimelineEventType`、`CheckpointTriggerReason`、`CapabilityKind`、`CapabilityProviderKind`、`CapabilityReplayPolicy` 和 `CapabilityInvocationStatus` 归 `agent-common`；单一业务边界 vocabulary 留在对应 subpath；只为持久化 Record 形态存在的值使用 gateway-owned record value type。
- `LifecycleStage` 归 runtime boundary；hook 只消费该 lifecycle vocabulary，不重新拥有 stage 定义。
- subpath export 代表各模块 public surface 和依赖边界，不是装饰性 namespace；实现包不得把 root `agent-contracts` 当作无边界类型池使用。
- 领域对象归其业务 owning module；read-model query 归提供该 read model 的业务 module；logical gateway port、gateway write/request DTO、gateway-specific result type 和 dynamic execution gateway port 归 gateway module。
- `CheckpointPayload`、pending input、hook lifecycle 和 runtime timeline 归 `agent-contracts/runtime`；`ContentRef`、`ArtifactMetadata` 和 `Feedback` 归 `agent-contracts/session`；`ErrorNormalizer` 归 `agent-contracts/observability`；app configuration contract 归 `agent-contracts/app`。
- gateway port 使用 gateway-owned `*Record` persistence DTO/PO，不接收或返回上层领域 DO；gateway Record 可以使用 `agent-common` foundation contract，但不得引用上层业务领域 subpath enum/DTO；session、attachment、pending-input、content 等业务字段使用 gateway-owned record value type；领域实现负责 DO/read model 与 Record 的映射，gateway adapter 只存取 Record。
- 接口或 port 的归属按模块依赖方向和调用边界判断，不按默认实现所在包判断；调用方需要依赖的抽象放在调用方所属边界或稳定 contract 边界，实现类放在 provider/implementation package，通过 app composition 注入。
- root `agent-contracts` 可以 re-export 稳定 public contract；实现包应优先从 owning module import。
- 实现包不得通过 private DTO、数据库 schema、provider SDK 类型、本地路径布局或其他实现包建立跨模块契约。

后续整理状态：
- 已有 active change，本文档后续只引用其稳定对象、port、event 和 DTO。
