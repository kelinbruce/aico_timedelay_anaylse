# ADR: Session fork 复制持久前缀而不是运行时状态

## 状态（Status）

Accepted.

## 背景与现状（Context）

用户可见的 session fork 要求子对话从用户在源 session 中已经可以查看的内容开始，同时保持 fork 隔离。源 run 身份和可操作生命周期事实（如 RequestRun record、checkpoint、pending input、tool 状态、provider invocation 谱系和执行 workspace 路径）都限定在父 run/session 范围内，不能成为子的 runtime 事实。Message `runId` 也是既有的持久轮次分组和读取/分享选择 key，因此从被复制 message 中移除它会破坏继承轮次的读取。持久的用户可见过程 event 必须在源删除后仍可查看，但通过源谱系读取它们会把子的可用性和授权耦合到源上。

## 决策（Decision）

Fork 物化复制到所选 assistant 锚点为止的 canonical 持久源 message 前缀，将其重映射进新的子 session，并从被复制的子 message 初始化子 active context 版本 `0`。Runtime 拥有 fork 命令和安全的子 message 投影。Context-engine 拥有注入的 fork active-context 选择器并复用其内部 prior-history 候选 helper。Gateway-local 拥有范围前缀查询、fork composite 写入、fork 源事实和 fork 提升元数据生命周期。

被复制 message 的身份被重映射进子范围。对于被复制前缀中出现的每个不同源 `runId`，runtime 在内存中铸造一个新的子范围 run 锚点；来自同一源 run 的 message 共享该锚点，不同源 run 获得不同锚点，没有源 `runId` 的 message 仍然没有。该锚点仅作为被复制 message 的持久分组/读取 key 被持久化。它绝不等于或解析到某个源 run，且源到子的映射不被持久化或记录日志。

对每个被复制的展示 run，fork 还校验并物化其持久 timeline event 为子拥有的 `FORK_SNAPSHOT` 行，使用子 session/request/run/event 身份和子序列。快照 payload 省略源坐标、`requestContextId`、`contentRef` 和 runtime 专用引用。同一原子 composite 写入子 message、active context、fork 元数据、每个 run 的 `AVAILABLE | LEGACY_UNAVAILABLE` 快照状态和快照行。新建和递归的可用快照在源删除后仍可读取；升级期不可用 history 被显式报告，不做谱系透读或猜测。

子 run 锚点仍只是一个持久分组/history key。Fork 不为其创建任何 RequestRun、runtime 来源 timeline、checkpoint、pending-input 或 lane 事实。快照行是仅持久化的 history 事实，不是 runtime 生命周期事实：stream、resume、cancel、retry、edit、recovery 和活跃 run 查找都忽略它们，并继续把该锚点视为未找到 run，而范围化的 event-history facade 可以为呈现读取它们。
执行绑定的内容引用不按路径复制。如果被复制内容或元数据引用了 `tool-results/<refId>`、源 run workspace 路径、tmp/cache/log/test-output 路径或 provider scratch 引用，runtime 必须先通过 gateway/content 边界把字节提升为 owner+agent 范围的持久内容，并把子 message 重写为子可访问的提升后内容 id。如果提升、重写或 composite 物化失败，fork 原子失败且已暂存的提升被同步 abort。

## 结果（Consequences）

- 子 session 可以从被复制的可见 history 继续，而不继承源 run/timeline/checkpoint 状态。
- 子 session 保持独立的只读过程 history，不继承可操作 runtime 状态，也不依赖源保留。
- 继承的子轮次仍可通过既有基于 `runIds` 的对话分组和分享选择，而不引入第二个选择 contract。
- 被复制 message 的 `runId` 不意味着存在对应 RequestRun；runtime 生命周期消费者不得从 message 分组锚点推断 run 存在。
- `FORK_SNAPSHOT` 只能由 fork composite 创建；普通 timeline append 不能伪造快照来源。
- Fork 通知保持为窄读取模型投影，而不是对话 message 或谱系 API。
- Gateway-local 绝不读取宿主/源路径或决定投影语义；它只持久化已校验的 record 和提升元数据。
- 提升清理是 `STAGED`/`ABORTED` 内容的残留收集器，不得修改 `COMMITTED` 内容。
