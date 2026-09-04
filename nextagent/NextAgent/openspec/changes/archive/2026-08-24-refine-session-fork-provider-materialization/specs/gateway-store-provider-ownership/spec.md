# gateway-store-provider-ownership Specification Delta

## Function

- **所属 Function**：`FN-8.1 持久化运行数据`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## MODIFIED Requirements

### Requirement: Working Memory preserves request and session transaction boundaries

Working Memory provider SHALL 作为 request/session 工作事实和必要恢复状态的单一一致性 owner。terminal commit 成功时，RequestRun terminal state、terminal message 和 terminal timeline event MUST 全部可见；失败时三者 MUST 不产生部分结果。session create、session fork 和 session cascade delete 的既有复合结果 MUST 保持其规格定义的 all-or-nothing 可见性；session delete 成功后，conversation annotations、shares 及其他 cascade facts MUST 一并不可访问。

对于 session fork，selected provider MUST 通过 `SessionForkStoreGateway.prepareFork` 在其持有源事实的边界内读取完整 WorkingMemory source facts并返回受服务端预算约束的 required content refs。调用方 MUST NOT 取得完整 source prefix 或预构造 child records；它只能通过既有可信 content resolver 读取 prepare 清单中的规范化 execution-bound refs，并通过同一 gateway 的 `stageForkPromotion` 暂存对应 bytes。selected provider MUST 在 `forkSession` 中重新校验 source 坐标和 staged refs，产生全部 child facts，并把 matching promotions 与 child 结果原子提交。LOCAL provider 与外部 REMOTE AgentMemory MUST 实现同一个 `SessionForkStoreGateway` contract；系统 MUST NOT 为两种部署暴露平行 contract。

**需求类别**：功能性需求

#### Scenario: Terminal commit succeeds

- **WHEN** runtime 提交一个 terminal result
- **THEN** RequestRun terminal state、terminal message 和 terminal timeline event MUST 全部提交
- **AND** 任一组成事实失败 MUST 使该次 terminal commit 不产生部分可见结果

#### Scenario: Session is deleted

- **WHEN** session cascade delete 成功
- **THEN** 该 session 归属的 conversation annotations、conversation shares 及其他既有 cascade facts MUST 全部不可访问
- **AND** 不得遗留仍可访问的 session share

#### Scenario: LOCAL provider 通过统一准备与创建操作完成派生

- **WHEN** LOCAL 部署依次调用 `prepareFork`、必要的 `stageForkPromotion` 和 `forkSession`
- **THEN** 调用方 MUST 通过 `forkSession` 获得完整、all-or-nothing 的 child 结果
- **AND** 调用方 MUST NOT 提交完整 prefix 或预构造 child records

#### Scenario: REMOTE AgentMemory 在服务端准备并派生

- **WHEN** REMOTE 部署调用 `SessionForkStoreGateway.prepareFork`
- **THEN** AgentMemory MUST 使用其持有的完整 source facts返回有界required content refs
- **AND** NextAgent MUST 只解析该清单并stage受预算约束的bytes，随后调用`forkSession`
- **AND** AgentMemory MUST 返回完整、all-or-nothing 的 child 结果
- **AND** NextAgent MUST NOT 回退到 LOCAL SQLite、传输完整 prefix 或选择另一套 fork contract

#### Scenario: REMOTE 不直接访问 NextAgent execution workspace

- **WHEN** source prefix 包含规范化 `tool-results/<refId>`
- **THEN** AgentMemory MUST 只把该ref及resolver所需可信坐标放入prepare清单
- **AND** NextAgent MUST 通过既有可信resolver读取内容并仅上传对应bytes，不上传路径或完整prefix
- **AND** source path、host path或未知execution-bound ref MUST 在child可见前返回canonical safe failure

## Function 变更汇总

### 描述

- **变更类型**：修改
- **目标内容**：运行状态 provider 对 session fork 提供统一准备、暂存和原子创建操作；LOCAL 与外部 REMOTE AgentMemory 通过同一 contract 在数据本地完成完整派生并返回原子结果。
- **依据 Requirements**：`Working Memory preserves request and session transaction boundaries`

### 输入

- **变更类型**：修改
- **目标内容**：session fork provider boundary 接收可信 owner scope、Agent Scope、source session、独立message/request anchor、幂等键、fork attempt及prepare清单对应的受预算bytes，不接收完整source prefix或预构造child records。
- **依据 Requirements**：`Working Memory preserves request and session transaction boundaries`

### 处理过程

- **变更类型**：修改
- **目标内容**：系统根据可信source坐标读取Working Memory provider已持有的完整源事实，返回有界ref清单，接收NextAgent通过可信resolver取得的对应bytes，并产生完整child结果；无法通过规范ref安全解析的路径或未知ref失败，部署模式不改变派生语义或原子性。
- **依据 Requirements**：`Working Memory preserves request and session transaction boundaries`

### 结果

- **变更类型**：修改
- **目标内容**：LOCAL 与 REMOTE 均由唯一 selected provider 原子产生完整 child facts，调用方不接触与历史长度相关的 materialization payload。
- **依据 Requirements**：`Working Memory preserves request and session transaction boundaries`

### 接口

- **变更类型**：修改
- **目标内容**：当前`WorkingMemoryGatewayBindings.sessionForks`继续使用`SessionForkStoreGateway`，其创建流程收敛为provider-owned `prepareFork`、既有promotion staging与`forkSession`；不新增LOCAL/REMOTE平行接口。
- **依据 Requirements**：`Working Memory preserves request and session transaction boundaries`
