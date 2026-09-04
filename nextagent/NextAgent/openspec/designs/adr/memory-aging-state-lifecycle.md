# Memory 老化状态生命周期

## 状态（Status）

Accepted

## 背景与现状（Context）

长期记忆需要保留和质量控制，但新增第二张归档表、一个 `DELETED` 保留状态或模型驱动的生命周期决策会扩大存储和状态复杂度。

## 决策（Decision）

保留的 memory 使用单一 canonical record，`LongTermMemoryState = ACTIVE | ARCHIVED`。自动老化使用确定性的 `decay -> delete` 循环。置信度衰减在置信度归零时归档条目。保留过期通过核心 gateway 物理删除已归档条目。被 pin 的条目豁免于自动生命周期变更。

已归档复活不由 L1 搜索命中触发。只有 owner 授权的 L2 详情访问可以复活保留的已归档 record，且本地复活是围绕既有 retriever/store gateway port 的 helper，不是新的 gateway contract。

## 结果（Consequences）

该设计保持生命周期状态小且易于测试。它在第一版基线中牺牲了丰富的归档历史和跨进程的持久老化幂等性。这些能力需要未来的 OpenSpec change 来定义显式锚点事实、恢复语义和验证。
