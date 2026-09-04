# add-ts-runtime-failure-takeover

规划入口：[P5 — 分布式与并行执行](../roadmap/p5-distributed-parallel.md)

状态：blocked
类型：contract refinement + implementation change
主要 owner：`agent-runtime`
依赖：`add-ts-runtime-multi-instance-consistency` 和 `add-ts-session-affinity-reconnect-replay` 归档；如新增或调整 `agent-contracts` public Record、port、enum 或 export，必须先完成群内确认

目标：
- 活动实例异常退出后，健康实例能够从最近一次持久化安全边界接管未完成任务，避免任务永久卡住、重复终态或未受控重复副作用。
- 实例计划关停时停止接受新任务，尽量完成当前不可中断操作并持久化安全进度，使部署平台摘流量后其他实例可以继续服务。
- 客户端在故障后可以读取已持久化事件并继续下一轮对话；不承诺故障瞬间 token 流无缝迁移。

规格输入：
- 只有当前 fencing identity 的执行者可以提交 checkpoint、timeline、side-effect result 和 terminal facts；陈旧执行者恢复运行时必须被拒绝。
- 接管必须从合法 execution cursor/checkpoint 恢复，并服从现有 capability replay policy、idempotency guard 和 terminal commit 规则。
- 无法证明副作用可安全重放时，系统必须进入可诊断的失败或待人工处置状态，不得静默重复执行。
- 计划关停必须具有 readiness/drain 可观察结果，供外部部署平台停止路由新请求；路由控制仍由平台负责。
- workspace 在 REMOTE 部署中由平台以 FUSE/mount 提供共享路径；Runtime 继续按本地文件 API 工作，并用持久化执行权隔离并发写入。

契约输入：
- 复用多实例一致性 change 的 durable claim、lease、fencing、control intent 和 RequestRun facts，只补齐 takeover/recovery 所需的最小状态与查询。
- Runtime 解释 lease expiry、recovery eligibility、resume cursor 和 replay policy；StateStore 只执行原子 claim/CAS、查询和 composite writes。
- health/readiness public projection 只表达实例是否可接收新工作，不暴露租约、worker registry、内部地址或 Session 路由拓扑。

实现约束：
- 故障恢复必须复用现有 local runtime recovery 和 idempotency guard，不建立第二套恢复引擎。
- LOCAL 故障注入使用同节点、共享 SQLite 和共享数据根目录的两个进程；REMOTE provider 只通过外部 conformance fixture 验证。
- abrupt crash、lease expiry、takeover、stale writer、duplicate side-effect risk 和 planned drain 必须形成端到端可重复测试。
- 外部负载均衡器只消费 health/readiness 并负责摘流量、重新路由；当前仓库不实现 LB adapter 或控制面。

非目标：
- 不迁移 token 级 live stream、进程堆栈、模型 provider connection 或 subscriber。
- 不实现外部 StateStore 自身的 HA、复制、备份、负载均衡或灾难恢复。
- 不实现容器编排、服务发现、Session affinity 或 LB 配置。
- 不实现分布式文件系统或对象存储 client；只消费平台已挂载的本地路径。

验收要点：
- 实例 A 在 accepted 后、Capability 前后、checkpoint 后和 terminal commit 竞争窗口异常退出时，实例 B 均得到唯一且符合 replay policy 的接管结果。
- A 恢复或网络分区解除后，其旧 fencing identity 无法覆盖 B 已提交的 checkpoint、timeline 或 terminal facts。
- 非幂等副作用缺少安全恢复证据时不被重复执行，并产生安全、可审计、可诊断的规范失败结果。
- 计划关停时 readiness 先转为不可接收新任务，当前任务在预算内完成安全点提交或释放执行权，随后其他实例可继续处理。
- 客户端故障重连只能恢复持久化事件，但下一轮请求能够恢复完整能力；测试不依赖真实负载均衡产品。

并行边界：
- 本 change 独占 runtime recovery/takeover、drain lifecycle 和相关 fencing 状态推进。
- 不得与同时修改 local runtime recovery、execution cursor、capability replay policy、terminal commit 或 RequestRun 状态机的 change 并行。
- Workflow distributed execution 必须消费本 change 已归档的 takeover/fencing 语义，不得提前定义平行 worker recovery 协议。
