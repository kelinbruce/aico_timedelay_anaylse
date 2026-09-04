## Function
- **所属 Function**：`FN-8.2 检索和写入记忆`
- **Function 变更类型**：MODIFIED
- **spec 角色**：主规格

## MODIFIED Requirements

### Requirement: 主动召回的 L2 读取有界、响应取消且全有或全无

`UserQueryMemoryRecallService` MUST 在单次 L1 检索返回的全部候选上执行 L2 详情读取；候选数量受 L1 的 `limit=10` 限制。服务 MUST 将并发读取数限制为最多 `3` 个，MUST NOT 对 L1 或 L2 发起重试。父请求取消或任一 L2 失败后，服务 MUST 停止分发尚未开始的 L2 调用，并在所有已开始调用结束后返回无上下文结果。底层 gateway 不支持取消在途调用时，服务 MUST NOT 将取消后完成的结果返回给调用方。

服务 MUST 使用安全、稳定的结果原因区分 L1 与 L2：L1 未命中继续使用既有 `NO_MATCH`；L1 取消或失败分别为 `L1_SEARCH_CANCELED`、`L1_SEARCH_FAILED`；L2 取消或失败分别为 `L2_DETAIL_CANCELED`、`L2_DETAIL_FAILED`。任一 L2 调用发生超时、取消、不可用、权限拒绝、结果校验失败或其他失败时，服务 MUST 停止分发尚未开始的 L2 调用，并在所有已开始调用结束后仅返回无上下文结果。服务 MUST NOT 返回部分 L2 结果，MUST NOT 以缺失条目外的详情形成模型输入。L1 未命中时，服务 MUST 不发起 L2 调用并返回无上下文结果。

**需求类别**：功能性需求

#### Scenario: L1 未命中可定位且不读取 L2
- **GIVEN** L1 未返回候选记忆
- **WHEN** 服务完成本次主动召回
- **THEN** 服务 MUST 返回 `NO_MATCH`
- **AND** 服务 MUST NOT 调用 L2 详情读取

#### Scenario: L1 与 L2 失败可区分
- **GIVEN** 主动召回正在执行
- **WHEN** L1 搜索失败或 L2 详情读取失败
- **THEN** 服务 MUST 分别返回 `L1_SEARCH_FAILED` 或 `L2_DETAIL_FAILED`
- **AND** 返回结果 MUST NOT 包含原始异常、Query 或记忆内容

## Function 变更汇总

### 输出
- **变更类型**：修改
- **目标内容**：主动召回在保持 L1 未命中既有结果码的前提下，区分 L1 失败或取消、L2 失败或取消；任一结果仍不注入部分上下文。
- **依据 Requirements**：`主动召回的 L2 读取有界、响应取消且全有或全无`
