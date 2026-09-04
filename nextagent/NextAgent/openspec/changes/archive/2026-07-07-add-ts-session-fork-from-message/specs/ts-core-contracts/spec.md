## ADDED Requirements

### Requirement: Session Fork 公共契约

核心 contract SHALL 通过既有 owner subpath 定义公共 session fork 契约。面向 runtime 的 fork command/result MUST 属于 `agent-contracts/runtime`，作为 runtime session facade 的一部分。Session 域的 fork notice read model 和会话分页投影 MUST 属于 `agent-contracts/session`。Fork active context selection request/result 和 port MUST 属于 `agent-contracts/context`。持久化 DTO、fork source record、prefix 查询和 composite write 请求 MUST 属于 `agent-contracts/gateway`。共享 id 和 durable scalar vocabulary MUST 继续来自 `agent-common`。

本变更扩展了必需的公共 TypeScript contract 面。受影响 runtime、context 和 gateway port 的实现与测试替身 MUST 更新新方法或专用 fork port 接线，实现才能编译通过。

公共 Web/channel 投影 MUST 只暴露安全的子会话 metadata 和可选 `forkNotice`。它 MUST NOT 暴露 gateway `*Record` 值、raw fork source record、parent timeline ref、checkpoint ref、raw prompt、raw provider error、stream delta，或正常会话消息投影之外的复制消息内容。

#### Scenario: 契约拥有唯一 owner
- **WHEN** 实现 package 交换 fork command、result、fork notice、fork active context selection、fork source 持久化或 composite write 数据
- **THEN** 每个被交换的值 MUST 来自其所属的 `agent-contracts` subpath 或 `agent-common`
- **AND** 实现 package MUST NOT 为跨 package 用途定义私有平行 fork DTO
- **AND** `agent-channel-web` MUST NOT 导入 gateway fork record 或 gateway 查询 DTO

#### Scenario: Runtime session facade 暴露 fork command
- **WHEN** Web channel 接受一个 fork 请求
- **THEN** 它 MUST 调用一个 runtime 拥有的 session fork command
- **AND** runtime MUST 在委托给 session 或 gateway 协作者之前解析可信 Agent Scope
- **AND** runtime MUST 通过注入的 `agent-contracts/context` port 消费 fork active context selection，而不是直接导入 `agent-context-engine` 实现
- **AND** 客户端请求体 MUST NOT 提供或覆盖 `tenantId`、`subjectId`、`agentId`、子会话 id、子消息 id 或 fork source metadata

#### Scenario: Runtime request fork command 只解析一个 live-completion 锚点
- **WHEN** Web channel 接受一个以源 request/root message id 为键的 fork 请求
- **THEN** 它 MUST 调用一个 runtime 拥有的 request fork command，只携带 identity context、源 session id、源 request id 和幂等 key
- **AND** runtime MUST 在调用正常 message-anchor fork command 之前把该 request id 解析为一条持久化的已完成 assistant message
- **AND** 该 command MUST NOT 携带源 run id、客户端提供的子 id、复制的消息、fork source metadata、timeline ref 或 checkpoint ref
- **AND** runtime MUST 安全拒绝缺失、未完成或歧义的 request-to-assistant-anchor 解析

#### Scenario: 公共 fork notice 是窄化的
- **WHEN** 子会话响应包含 fork notice
- **THEN** 公共 DTO MUST 只包含源 session id 和源会话标题快照
- **AND** 公共 DTO MUST NOT 包含 source anchor message id、child anchor message id、幂等 key、fork 创建时间戳、parent run id、checkpoint id、timeline sequence 或 gateway row metadata

### Requirement: Fork Source Metadata 契约

核心 contract SHALL 为 session fork 可追溯性定义一个 durable fork source metadata 事实。内部 fork source 事实 MUST 携带子会话 id、源会话 id、source anchor message id、child anchor message id、源会话标题快照、可信 owner scope、可信 Agent Scope 和创建时间戳。每个字段 MUST 有具体理由：源会话 id 打开来源，源标题快照渲染稳定的 notice 文本，source anchor message id 记录来源和幂等坐标，child anchor message id 决定 notice 可见性，owner/agent scope 强制隔离，创建时间戳支持 audit 和诊断。

源会话标题快照 MUST 是 fork 创建时捕获的 session 域规范化标题：源标题存在时做 trim，标题缺失或 trim 后为空时使用 `Untitled session`。Runtime/session 代码 MUST NOT 把 Web `displayTitle` 用作内部 contract 字段。

Fork source 事实 MUST NOT 携带 raw prompt、raw provider error、stream delta、完整复制内容、parent active context snapshot、timeline event、checkpoint payload、pending input payload 或 tool 状态。

#### Scenario: 内部 fork source 捕获最小来源信息
- **WHEN** fork composite write 成功
- **THEN** gateway 持久化 MUST 为子会话保存一条 fork source 事实
- **AND** 该事实 MUST 包含 `sourceSessionId`
- **AND** 该事实 MUST 包含 `sourceSessionTitleSnapshot`
- **AND** 该事实 MUST 包含 `sourceAnchorMessageId`
- **AND** 该事实 MUST 包含 `childAnchorMessageId`
- **AND** 该事实 MUST 包含可信 owner scope 和 Agent Scope

#### Scenario: Fork source 不是公共 DTO
- **WHEN** Web channel 投影 session 或会话数据
- **THEN** 它 MUST NOT 直接返回内部 fork source 事实
- **AND** 它 MUST 从内部事实和子会话状态推导公共 fork notice

### Requirement: 安全的子消息投影

核心 contract SHALL 要求 runtime/session fork 物化在 gateway 持久化之前、fork active context selection 之前，通过安全的子消息投影产生复制的子消息。该投影 MUST 覆盖复制消息的 `content`、metadata、replacement evidence、summary metadata、`ContentRef` 和 backing ref。它 MUST 在源消息 ref 对显示或模型可见行为仍然必要时把其重映射为子消息 id，MUST 移除或拒绝源 run/checkpoint/timeline ref、raw provider 字段、parent invocation lineage 和其他 runtime 专属 ref。已知类型化 metadata MUST 按其字段语义显式处理。未知 metadata 仅当不包含源 run id、checkpoint ref、timeline ref、raw provider 字段、parent invocation lineage、源执行路径、host path 或执行绑定 ref 时 MAY 被保留。包含任何此类源绑定/runtime 专属值的未知 metadata MUST 使 fork 物化安全失败，MUST NOT 被静默复制。

持久化的 attachment/artifact/blob-backed ref 仅当其属于 owner+agent scope 且子会话可访问时，MAY 被保留、复制或重映射。普通 workspace 文件引用仅当已能通过同一 owner+agent workspace 策略被子会话访问时 MAY 被保留。执行绑定 ref，包括 `tool-results/<refId>`、源 run workspace 路径、session 临时/生成输出根、`.nextagent` temp/cache/log/test-output 路径、host tmp/cache/log/test-output 路径和 provider invocation scratch 路径，MUST NOT 被原样复制进子消息。如果此类 ref 出现在复制消息的 content、metadata 或 backing ref 中，runtime MUST 把内容提升为 owner+agent scope 的持久化存储并把子消息重写为子会话可访问的 durable ref，或在持久化之前使 fork 失败。首版提升 MUST 只支持能通过既有可信源 workspace/sandbox/resolver 边界解析为字节的规范化 `tool-results/<refId>` ref。如果 runtime 只能观察到源执行路径、host path、临时/生成输出路径、tmp/cache/log/test-output 路径或无法识别的执行绑定 ref 形状，它 MUST 在子会话持久化之前安全失败，MUST NOT 为 fork 引入通用 host 文件读取 port。

提升 MUST NOT 把 `BlobRef` 或 host 文件系统路径暴露为子消息内容、公共 DTO、模型可见上下文、safe error、audit 细节或结构化日志字段。`BlobStoreGateway` 保持为不透明字节存储，MUST NOT 拥有提升可见性、session/message 绑定或 artifact/content resolver 语义。

#### Scenario: 投影覆盖 content 和 metadata
- **WHEN** runtime 准备复制的子消息
- **THEN** 投影 MUST 同时检查消息 content 和 metadata
- **AND** 投影之后子消息 MUST NOT 包含源执行 workspace 路径或源 runtime id
- **AND** gateway composite write MUST 接收已完成投影的复制子消息

#### Scenario: 执行绑定 ref 需要持久化提升
- **WHEN** 一条复制消息的 content、metadata 或 backing ref 中包含执行绑定 ref
- **THEN** runtime MUST 把被引用内容提升为 owner+agent scope 的持久化存储并重写子消息
- **OR** 在创建子会话之前以安全错误使 fork 物化失败

### Requirement: Fork 提升暂存契约

核心 contract SHALL 要求执行绑定 fork 提升使用内部的、owner+agent scope 的提升 metadata 生命周期，而不是运行期文件系统暂存目录。Runtime/session fork 物化 MUST 只通过既有 workspace/sandbox/resolver 边界读取源执行绑定内容，MUST 把字节传递给拥有它的持久化内容/提升边界。它 MUST NOT 直接读取任意 host 路径、移动源执行文件，或在 gateway/content owner port 之外写入子会话可见文件。

提升字节 MAY 通过 `BlobStoreGateway` 存储，但权威可见性事实 MUST 是内部提升 metadata，至少有 `STAGED`、`COMMITTED` 和 `ABORTED` 状态，以及稳定的目标坐标，例如 fork attempt、源 session/message、目标子 session/message 和被提升内容的 id。子消息 MUST 通过子会话可访问的 `ContentRef` / 被提升内容 id 引用被提升内容，而不是通过 `BlobRef`。

Gateway fork/提升 contract MUST 提供 runtime fork 物化所需的最小生命周期操作：把一次提升暂存为 `STAGED`，为失败的物化 abort 已暂存的提升，以及从定期维护中清理过期的 staged/aborted 残留。提升 commit MUST NOT 作为 runtime 可调用的 gateway 操作暴露；gateway-local MUST 只在 fork composite write 事务内把匹配的提升标记为 `COMMITTED`。Stage 请求 MUST 携带可信 owner scope、Agent Scope、fork attempt id、源 session/message 坐标、目标子 session/message 坐标、ref 类型、字节、MIME 类型和大小。Stage 边界 MUST 生成被提升内容 id，在 `ForkPromotedContentRecord` 中返回它，并在写入提升 metadata 之前拒绝不一致的字节大小 metadata。调用方 MUST NOT 提供提升的 `promotedContentId`、`status`、时间戳或内部 `BlobRef`；stage 边界拥有 blob 持久化和 metadata 创建。如果 blob 持久化成功但 metadata 创建失败，stage 边界 MUST 在返回安全失败之前 best-effort 删除刚创建的 blob。`BlobStoreGateway` 保持只是不透明字节存储；提升 metadata 拥有可见性和子目标坐标。

定期清理 MUST 是内部维护操作，不是 Web/session API。其请求 MUST 只携带清理时钟和保留窗口，MUST NOT 接受调用方提供的 owner/session/message 过滤器或状态覆盖。Gateway-local 在删除 blob 或收敛 metadata 时 MUST 使用每条提升 metadata record 上存储的 owner+agent scope。

只有 `COMMITTED` 提升 metadata MAY 被正常 content/artifact resolver 路径解析。`STAGED` 和 `ABORTED` 提升对会话读取、模型上下文组装、Web/channel 投影、safe error、audit/log 细节和正常 list/read API MUST 保持不可见。定期清理 MAY 把过期的 staged 提升标记为 aborted。对 `ABORTED` 提升，blob 缺失或 blob 删除成功 MUST 删除提升 metadata；blob 删除失败 MUST 使 `ABORTED` metadata 保持不可解析，并可被后续清理运行重试。首版清理资格 MUST 基于提升 `createdAt` 加上清理 job 的保留窗口；contract MUST NOT 要求或暴露按 record 的 `expiresAt`、`CLEANED` 状态或 `cleanupCompletedAt` 字段。

Gateway contract MAY 为已提交的提升字节暴露一个窄化的 metadata 感知读取，但该读取 MUST 要求可信 owner scope、Agent Scope、目标子会话 id、目标子消息 id 和被提升内容 id。它 MUST NOT 暴露内部 `BlobRef`，`promotedContentId` MUST NOT 可通过通用 `BlobStoreGateway.loadBlob` 路径读取。

#### Scenario: 提升暂存 metadata 拥有可见性
- **WHEN** runtime 在 fork 物化期间提升一个执行绑定 ref
- **THEN** stage 边界 MAY 把字节存储为不透明 blob
- **AND** 一条提升 metadata record MUST 把该 blob 绑定到 owner scope、Agent Scope、fork attempt、目标子 session/message 和状态
- **AND** 在提升 metadata 变为 `COMMITTED` 之前，正常 resolver 路径 MUST 把该内容视为不可用
- **AND** 已提交的字节 MUST 保持通过提升 metadata 解析，而不是把被提升内容 id 当作通用 blob ref

#### Scenario: 提升 commit 绑定到 fork composite write
- **WHEN** 某个带有已暂存提升的 fork attempt 的 composite write 成功
- **THEN** gateway-local MUST 在持久化子会话、复制消息、active context 和 fork source 的同一本地事务中把匹配的目标提升标记为 `COMMITTED`
- **AND** composite write 之前或期间的失败 MUST 使已暂存提升保持不可见并同步尝试将其标记为 `ABORTED`；定期清理只重试该 abort 路径留下的残留

#### Scenario: Stage 失败不产生有索引的孤儿歧义
- **WHEN** 提升 stage 存储 blob 字节但在 `STAGED` metadata 被持久记录之前失败
- **THEN** stage 操作 MUST 在子会话持久化之前返回安全失败
- **AND** 它 MUST best-effort 删除刚创建的 blob
- **AND** 正常 fork 清理 MUST NOT 把未索引的孤儿 blob 当作成功的暂存结果

#### Scenario: 定期清理只收敛不可见残留
- **WHEN** fork-提升清理 job 运行
- **THEN** 它 MUST 只选择早于 job 保留截止时间的 `STAGED` 或 `ABORTED` 提升
- **AND** 它 MUST NOT 选择或修改 `COMMITTED` 提升
- **AND** blob 删除失败 MUST 使该提升保持不可解析，并可被后续清理运行重试

#### Scenario: 子消息不暴露存储 ref
- **WHEN** 一个已暂存提升被重写进复制的子消息
- **THEN** 复制的子消息 MUST 只包含子会话可访问的 `ContentRef` 或被提升内容 id
- **AND** 它 MUST NOT 包含 `BlobRef`、源执行路径、host 绝对路径或 provider scratch 路径

#### Scenario: Gateway-local 不拥有提升读取
- **WHEN** gateway-local 收到一个 fork composite write 请求
- **THEN** 复制消息 MUST 已包含子会话可访问 ref 或不含执行绑定 ref
- **AND** gateway-local MUST NOT 读取源 workspace 文件、解析 `tool-results/<refId>`、提升执行绑定内容或检查消息内容来决定提升语义

### Requirement: Fork Prefix 查询契约

Gateway contract SHALL 提供一个 owner+agent scope 的内部 prefix 查询，返回从会话起点到 source anchor message 为止的完整 canonical durable 源消息 prefix。该查询 MUST NOT 使用公共会话投影过滤器，例如隐藏消息过滤或 capability-result 过滤。实现 MAY 内部分批读取，但 MUST NOT 语义上截断返回的 prefix。Runtime 使用注入的复制消息数、复制内容字节数、提升 ref 数和被提升字节数上限，拥有 fork 资源预检决策。如果完整 prefix 无法在当前操作资源预算内加载，fork 物化 MUST 在子会话持久化之前安全失败。

#### Scenario: Prefix 查询返回完整 canonical prefix
- **WHEN** runtime 通过一个合格的 source anchor 请求源 prefix
- **THEN** gateway MUST 以 canonical 顺序返回截至该锚点的全部 durable 源消息 record
- **AND** 结果 MUST 包含 fork 投影和 active-context selection 所需的隐藏 replacement、capability-result 和 summary 协议 record
- **AND** 结果 MUST NOT 被公共会话分页或过滤器缩短

#### Scenario: Prefix 查询无法在预算内完成
- **WHEN** 完整 prefix 无法在当前操作资源预算内安全加载
- **THEN** fork 物化 MUST 返回安全失败
- **AND** runtime MUST NOT 以部分 prefix 继续

#### Scenario: Runtime 拥有 fork 资源预检
- **WHEN** 复制消息数、复制内容字节数、提升 ref 数或被提升字节数超过注入的 runtime fork 上限
- **THEN** runtime MUST 在 gateway composite write 之前返回安全的资源耗尽失败
- **AND** Web 客户端 MUST NOT 能提供或覆盖这些上限
- **AND** context-engine 和 gateway-local MUST NOT 为该 fork 做出独立的容量策略决策

### Requirement: Fork Composite Gateway 写入

Gateway contract SHALL 为 fork 物化提供单一 composite write。该 composite write MUST 原子地创建或按幂等锚点返回子会话、持久化复制的子消息、初始化子 active context 项、保存 fork source metadata 并返回创建的子会话事实。该 composite write MUST 使用可信 owner scope 和 Agent Scope，且在 gateway-local 实现中 MUST 在一个本地数据库事务内完成。

Composite write 请求 MUST 接收来自 runtime/session/context owner 的已决定业务事实，包括已完成投影的复制子消息。Gateway-local MUST NOT 决定哪些源消息合格、复制哪个 prefix、哪些消息模型可见、notice 是否显示、request id 如何按语义分组，或在持久化所提供 record 之外执行绑定 ref 如何被提升。

Composite write 结果 MUST 返回已持久化的子 `SessionRecord` 和一个 `replayed` 标志。`replayed=false` 表示当前事务创建了 fork 事实。`replayed=true` 表示同一 scoped 幂等锚点之前已成功提交，gateway 返回了原始子会话。失败的尝试 MUST NOT 写入成功的幂等锚点，MUST NOT 作为子会话被重放。

#### Scenario: Composite write 原子成功
- **WHEN** runtime 以已校验的子会话、复制子消息、子 active context ref 和 fork source metadata 调用 fork composite write
- **THEN** gateway MUST 在一次原子写入中持久化全部所提供的 fork 事实
- **AND** gateway MUST 返回带 `replayed=false` 的已持久化子会话结果
- **AND** 写入任一部分失败时，MUST NOT 有部分子会话可见

#### Scenario: Composite write 锚定幂等
- **WHEN** 同一 owner+agent+sourceSession+sourceAnchor+idempotencyKey 的 fork write 被重放
- **THEN** gateway MUST 返回首个子会话结果并带 `replayed=true`
- **AND** gateway MUST NOT 复制已复制的消息、active context 项或 fork source metadata

#### Scenario: Gateway 不拥有 fork 业务决策
- **WHEN** gateway 收到一个 fork composite write 请求
- **THEN** 请求 payload MUST 已包含子会话 record、复制子消息 record、子 active context message id 和 fork source metadata
- **AND** gateway MUST NOT 检查消息内容来决定锚点资格
- **AND** gateway MUST NOT 解析、提升或重写执行绑定 ref
- **AND** gateway MUST NOT 通过读取 parent 当前 active context 推导子 active context

### Requirement: 子 Active Context 初始化契约

核心 contract SHALL 提供显式的 `agent-contracts/context` port 路径，用于从复制的子消息中选择新建 fork 子会话的 active context。Runtime MUST 通过依赖注入调用该 selector。Selector 实现由 `agent-context-engine` 拥有；`agent-runtime` MUST NOT 直接导入 `agent-context-engine` 实现 package。所选 ref 随后由 gateway composite write 持久化为一个 `ActiveContextView`，其状态属于 owner+agent scope 且子会话 scope，其 `activeContextVersion` 初始化为 `0`，其项有序且只引用既有的子消息。该初始化 MUST 是 fork 物化的一部分，MUST NOT 以留空 active context、首次提交时扫描完整子历史或复制 parent active context 项 ref 的方式近似替代。

Fork active context selector MUST 复用正常上下文组装使用的 context-engine 既有 prior-history candidate selection helper。Fork 专属选择逻辑限于校验和截取复制的子输入语料：`copiedMessages` MUST 是截至 `childAnchorMessageId` 的 canonical 复制子消息，selector MUST 拒绝缺失锚点、重复 message id、混合的子会话 id、锚点之后的 record，以及在安全子消息投影之后仍残留在输出 ref 或 metadata ref 中的任何 parent/source 消息 ref。Fork 专属选择 MUST NOT 引入第二套独立维护的完整可见 turn、context compression summary、tool-use/capability-result 配对、隐藏 replacement 排除或孤儿片段排除的解释。

Selector 输出 MUST 只包含 canonical 顺序的子消息 id。在安全子消息投影之后仍保留的复制 context compression summary metadata ref MUST 引用复制子 prefix 中存在的子消息 id；否则选择 MUST 失败。当某个复制 summary 覆盖更早的复制子消息时，selector MUST 保持 summary 替换语义：为模型可见性选择子 summary 消息，并把被覆盖的原始 ref 从子 active context 中排除。Fork active context 初始化 MUST 是确定性的，MUST NOT 调用 model provider、运行 context compression 或创建新 summary；既有 summary 只作为复制的子消息参与。

#### Scenario: Fork active context selector 是注入的
- **WHEN** runtime 物化一个 fork 出的子会话
- **THEN** runtime MUST 调用注入的 `ForkActiveContextSelectionPort`
- **AND** selector 输入 MUST 包含复制的子消息，而不是 parent 消息或 parent active context 项
- **AND** runtime MUST NOT 直接导入 `agent-context-engine` 实现代码

#### Scenario: 初始化只使用子 ref
- **WHEN** fork 物化初始化子 active context
- **THEN** 每个 active context 项 MUST 引用一条 `sessionId` 为子会话 id 的消息
- **AND** active context 项序号 MUST 确定且从零连续
- **AND** 子 active context 状态 `activeContextVersion` MUST 初始化为 `0`
- **AND** parent 消息 id MUST 被拒绝或使校验失败

#### Scenario: 复制 summary 通过子 ref 保持模型可见
- **WHEN** 复制 prefix 包含一条被选入子 active context 的 context compression summary 消息
- **THEN** 被选择的 active context 项 MUST 引用子 summary 消息 id
- **AND** 保留的任何 summary metadata ref MUST 引用子消息 id
- **AND** active context MUST NOT 同时包含被该 summary 覆盖的子消息 id
- **AND** summary 资格 MUST 遵循正常上下文组装使用的同一 context-engine prior-history helper

#### Scenario: Selector 拒绝非 prefix 或被 parent 污染的输入
- **WHEN** fork active context selection 收到的复制消息带有缺失锚点、重复 message id、混合的子会话 id、parent 消息 ref 或子锚点之后的任何 record
- **THEN** 选择 MUST 失败
- **AND** fork 物化 MUST NOT 持久化子 active context

#### Scenario: 复用共享的 prior-history 选择
- **WHEN** 复制 prefix 包含 prior-history candidate、summary、tool-use/capability-result 配对、隐藏 replacement 或孤儿片段
- **THEN** selector MUST 使用正常上下文组装使用的同一 context-engine prior-history candidate selection helper
- **AND** fork 专属校验 MUST 在持久化之前拒绝非 prefix、混合子会话或被 parent 污染的输入
- **AND** 保留的消息 ref MUST 保持 canonical 顺序并使用子消息 id

#### Scenario: Fork active context 初始化不是模型操作
- **WHEN** fork 物化初始化子 active context version `0`
- **THEN** 它 MUST NOT 调用 model provider、summary 生成、compaction 或正常的当前请求组装
- **AND** 为模型可见性选择的任何复制 summary MUST 已存在于复制子 prefix 中

#### Scenario: 空 active context 不是可接受的 fork 结果
- **WHEN** 源 prefix 包含模型可见的 prior history
- **THEN** fork 物化 MUST 以被选择用于模型可见性的复制子消息 ref 初始化子 active context
- **AND** 返回一个带有复制历史但没有继承 active context 的子会话 MUST 被视为 fork 失败

#### Scenario: 既有 active context append 契约保持兼容
- **WHEN** 正常消息 append、terminal commit 或 compaction 在 fork 物化之外运行
- **THEN** 既有 active context append 和 compaction 契约 MUST 继续保持行为不变
- **AND** fork 初始化路径 MUST NOT 替换非 fork 写入的正常 append/compaction 语义
