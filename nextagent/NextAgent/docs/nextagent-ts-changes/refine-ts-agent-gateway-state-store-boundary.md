# refine-ts-agent-gateway-state-store-boundary

规划入口：[P5 — 分布式与并行执行](../roadmap/p5-distributed-parallel.md)

状态：blocked
类型：contract refinement change
主要 owner：`agent-contracts/gateway`
依赖：`establish-ts-backend-architecture`、`establish-ts-core-contracts`、现有gateway configuration/store ownership基线和已归档的`refine-session-fork-provider-materialization`；2026-08-21需求方确认会话派生change先实施，本change须在其归档后rebase再恢复实施

目标：
- 平台集成方通过同一个 Agent Gateway 装配入口获得智能体依赖；其中 StateStore 完整承载 agent 运行状态的持久化和查询，上层模块不需要区分 LOCAL 与 REMOTE provider。
- 公共契约按能力组语义组织持久化接口：`state-store`（运行状态 + todo 状态）、`long-term-memory`、`user-interaction-stores`（attachmentStore + userQuestionActivityStore）、`blob-store`（对象存储）、`task-trajectory`（任务轨迹）；`sqlite`/`working-memory` 作为 adapter kind 移除。
- LOCAL 模式使用同节点共享文件系统上的 SQLite，足以验证多实例正确性，不承诺生产级本地集群能力。
- REMOTE 模式只定义外部 Agent Gateway provider 必须满足的契约、注入和一致性校验；完整 REMOTE Agent Gateway 实现由仓库外团队交付，本仓保留空实现与实现无关 conformance 契约。
- 活动 OpenSpec change 位于 `openspec/changes/refine-ts-agent-gateway-state-store-boundary/`（proposal/design/specs×2/tasks，`openspec validate --all --strict` 通过）。

规格输入：
- Agent Gateway 是智能体外部依赖的完整抽象，StateStore、RAG、Sandbox、IdentityProvider 等是其组成部分；本 change 只收敛 StateStore。
- StateStore 只负责持久化和查询，不拥有调度、任务认领、租约续期、取消、抢占、重试、故障接管或事件投递控制。
- Runtime 继续拥有 request lifecycle、scheduler、same-session lane、cancellation、checkpoint、terminal commit 和 canonical timeline。
- 文件与 workspace 继续通过普通本地文件路径访问；REMOTE 部署由平台把类 S3 对象存储以 FUSE 或 mount 方式挂载到容器，不纳入 StateStore。

契约输入：
- 调整 `agent-contracts/gateway` 的 Agent Gateway 聚合，使 StateStore 作为完整 binding 暴露。
- StateStore 内继续复用 capability-specific store/query ports，不新增通用 `get(store, key)`、通用 JSON record store 或万能 repository。
- provider selection、readiness 和 conformance contract 必须能验证完整 StateStore 绑定和外部 REMOTE provider 注入。
- Gateway public port 保持 async contract；写入继续遵循 `Record + write options`、CAS、锚点事实幂等和 composite transaction 规则。

实现约束：
- `agent-platform-gateway-local` 提供 LOCAL StateStore 的 SQLite 实现，并允许同节点多个进程共享同一数据文件和数据根目录。
- `agent-app` 只按配置选择并注入完整 Agent Gateway binding，不直接判断某个业务 store 是本地还是远端。
- 当前仓库不得包含 REMOTE Agent Gateway 的生产实现、远端持久化服务 client 编排或替代性内存实现；可保留外部 provider SPI、schema、注入入口和 conformance fixtures。
- 删除或收敛现有 `agent-platform-gateway-remote` 产品实现时，必须保持其他已归档 Agent Gateway 子能力的公共边界可由外部 provider 实现。

非目标：
- 不实现 runtime HA、任务租约、故障接管、跨实例取消或重连事件策略。
- 不实现 REMOTE StateStore 服务、完整 REMOTE Agent Gateway、负载均衡器、分布式文件系统或对象存储 driver。
- 不把可重建的进程缓存、Capability 实例缓存或临时推荐结果持久化。
- 不修改 RAG、Sandbox、IdentityProvider 等其他 Agent Gateway 子能力的业务语义。

验收要点：
- 使用同一 LOCAL 配置启动两个进程时，两者查询到相同的 session、message、timeline、checkpoint 和其他已纳入 StateStore 的持久化事实。
- 使用 REMOTE 配置但未注入外部 provider 时，启动确定性失败并给出安全诊断；仓库不会静默回退到本地或内存实现。
- contract/conformance 测试能够对 LOCAL provider 和外部 REMOTE provider fixture 执行同一组 StateStore 行为断言。
- 架构测试阻止 runtime/channel 直接依赖 SQLite、REMOTE client 或 provider 私有实现。

并行边界：
- 本 change 独占 `agent-contracts/gateway` 顶层 bindings、gateway configuration/store ownership specs 和 gateway composition 的结构调整。
- 本 change 在`refine-session-fork-provider-materialization`实施和归档期间保持blocked；恢复前必须rebase并保留其最终`SessionForkStoreGateway`、LOCAL实现与conformance行为。
- 不得与任何同时修改 `GatewayBindings`、provider selection 或 REMOTE deployment entrypoint 的 change 并行。
- Runtime HA、session affinity/reconnect 和 failure takeover changes 必须在本 change 归档后开始，不得在本 change 中提前实现。
