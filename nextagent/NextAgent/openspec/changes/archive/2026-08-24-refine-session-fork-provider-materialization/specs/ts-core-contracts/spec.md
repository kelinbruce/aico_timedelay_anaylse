## REMOVED Requirements

### Requirement: Session Fork Public Contracts

**Reason**：该 Requirement 把完整 prefix query、预构造 child composite write 和 Runtime 编排固化为公共 fork contract，与 provider-owned prepare 和原子创建入口冲突。

**Migration**：使用 `session-fork-from-message` 中的“会话派生 Runtime facade 保持可信窄入口”、“会话派生 gateway 公开准备与原子创建入口”和“会话派生失败使用唯一安全错误契约”；Runtime command/result owner、Web→Runtime 窄入口、trusted scope 与 session projection 保持，request anchor 改由统一prepare/fork操作解析并新增端到端optional signal，完整prefix与预构造child低层操作不再公开。`ForkActiveContextSelectionPort`继续归`agent-contracts/context`；既有`ForkPromotionContentResolverPort`由Runtime按prepare清单继续消费，不迁移到gateway或REMOTE contract。

### Requirement: Fork Source Metadata Contract

**Reason**：fork source 的最小溯源事实继续成立，但标题快照和 source/child anchor metadata 现在由 provider-owned application transaction 产生，不再由 Runtime 组装后交给 composite write。

**Migration**：使用 `session-fork-from-message` 中新增的“会话派生来源元数据保持窄化”；public fork notice 继续由 canonical spec 中未修改的“Fork Notice Projection”定义。

### Requirement: Safe Child Message Projection

**Reason**：安全投影行为继续成立，但由 Runtime 在 gateway write 前完成的 owner 和调用顺序不再成立，且该黑盒行为应归属于会话派生 Function 的 canonical spec。

**Migration**：使用 `session-fork-from-message` 中完整重述的“Child Session Inherits Prefix And Model-Visible Context”和“Fork Failure Is Atomic And Safe”。

### Requirement: Fork Promotion Staging Contract

**Reason**：promotion staging仍是完整派生的一部分，但不再由Runtime先读取完整prefix并预构造child坐标；它改为只处理provider prepare清单中的source ref，最终commit仍由`forkSession`完成。

**Migration**：使用 `session-fork-from-message` 中的“会话派生 gateway 公开准备与原子创建入口”以及完整重述的“Child Session Inherits Prefix And Model-Visible Context”和“Fork Failure Is Atomic And Safe”；`stageForkPromotion`、`abortForkPromotions`、committed content read与scheduled cleanup继续保留，stage绑定prepare attempt与source ref并只返回不含`BlobRef`的receipt，`ForkPromotedContentRecord`与status转为provider-private，规范化tool-result content由NextAgent可信resolver读取，`forkSession`原子提交matching promotions。

### Requirement: Fork Prefix Query Contract

**Reason**：完整 prefix 语义继续成立，但调用方不再通过公共 gateway query 取得完整 records，也不再拥有派生容量预检。

**Migration**：使用 `session-fork-from-message` 中的“会话派生跨 provider 边界使用有界协调材料”和完整重述的“Child Session Inherits Prefix And Model-Visible Context”。

### Requirement: Fork Composite Gateway Write

**Reason**：原子写入和幂等语义继续成立，但公共请求不再接收调用方预构造的 child session、copied messages、active context refs 和 fork source metadata。

**Migration**：使用 `session-fork-from-message` 中的“会话派生 gateway 公开准备与原子创建入口”以及完整重述的“Fork Idempotency”、“Fork Failure Is Atomic And Safe”和“Fork atomically materializes child-owned process history”。

### Requirement: Child Active Context Initialization Contract

**Reason**：child active context 的确定性选择和 version `0` 初始化行为继续成立，但由 Runtime 在 gateway write 前调用 selector 的固定编排边界不再成立。

**Migration**：使用 `session-fork-from-message` 中完整重述的“Child Session Inherits Prefix And Model-Visible Context”；普通 active context append 与 compaction contract 保持不变。
