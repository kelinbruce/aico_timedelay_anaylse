## MODIFIED Requirements

### Requirement: 会话历史支持按问题相关文本和活动时间搜索

系统 SHALL 通过现有 `GET /api/v1/sessions` 会话列表接口支持受控搜索。该接口 SHALL 接受 `q`、`createdFrom`、`createdTo`、`offset` 和 `limit` 查询参数。

`createdFrom` 和 `createdTo` SHALL 使用整数 epoch millis，并按会话活动时间进行闭区间过滤。这里的活动时间指会话列表已经公开展示和排序使用的最后活动时间：内部事实为 `updatedAt`，Web 输出投影为 `lastActivityAt`。二者必须同时出现或同时缺省；只提供其中一个时，Web API SHALL 返回请求校验错误。`createdFrom` MUST 小于或等于 `createdTo`。系统 SHALL NOT 设置隐藏的默认时间范围；只有用户显式选择完整日期范围时才应用时间过滤。用户选择的开始和结束范围最大为固定 90 天；前端 SHOULD 在 DatePicker 中禁用超过该跨度的日期，Web API MUST 拒绝超过 90 天减 1 毫秒的 epoch millis 范围作为后端数值兜底。

结果 SHALL 按会话活跃时间排序：`updatedAt` 降序，同一活跃时间下按 `sessionId` 升序稳定排序。

#### Scenario: 按活动时间闭区间过滤

- **GIVEN** owner scope 和 Agent scope 下存在三个会话，其最后活动时间分别早于、位于、晚于请求时间范围
- **WHEN** 客户端请求 `GET /api/v1/sessions?createdFrom=<from>&createdTo=<to>&offset=0&limit=20`
- **THEN** 响应 MUST 只包含 `updatedAt >= from` 且 `updatedAt <= to` 的会话
- **AND** 结果排序仍 MUST 使用 `updatedAt` 降序、`sessionId` 升序

#### Scenario: 创建时间命中但活动时间越界的会话被排除

- **GIVEN** owner scope 和 Agent scope 下存在一个会话，其 `createdAt` 位于请求时间范围内，但 `updatedAt` 晚于请求时间范围
- **WHEN** 客户端请求 `GET /api/v1/sessions?createdFrom=<from>&createdTo=<to>&offset=0&limit=20`
- **THEN** 响应 MUST NOT 包含该会话
- **AND** 系统 MUST 以列表可见的最后活动时间而不是创建时间决定是否命中
