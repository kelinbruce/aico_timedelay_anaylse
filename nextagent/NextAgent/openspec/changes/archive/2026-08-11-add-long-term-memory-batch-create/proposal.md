## Why

长期记忆管理用户需要从表格一次导入多条网络术语、运维偏好和用户特征。当前 `main` 只有逐条新增接口，而导入界面需要批量提交；若由浏览器逐条模拟，网络中断后的结果边界、逐项幂等和部分成功统计都无法形成统一的服务端契约。现在补齐批量新增边界，才能使导入/导出能力在 `main` 基线上可实际使用，并继续受可信身份、内容安全和个人设定记忆容量约束。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- 为已认证的管理调用方提供一次提交 1 至 100 条长期记忆的批量新增能力。
- 每条记录独立校验、独立执行内容安全准入和幂等写入，并返回可核对的成功数、失败数及成功记忆标识。
- 保持 Owner Scope、Agent Scope、50 条个人设定记忆上限和安全错误投影与逐条新增一致。

**非目标：**

- 不增加批量删除、批量修改、服务端文件上传或服务端导出接口。
- 不修改现有逐条新增、查询、搜索、共享和访问统计语义。
- 不允许浏览器提供或覆盖可信 Owner Scope、Agent Scope。

## What Changes

- 新增 `POST /api/v1/memory/long-term-mem/batch`，接收 1 至 100 个新增条目，并由服务端注入可信 scope。
- 新增批量新增的 Channel management contract 和 Store Gateway contract；每个条目使用自己的可选幂等键，缺省置信度为 `1`。
- 批量调用采用部分成功语义：单项校验、内容安全、容量或持久化失败只计入该项失败；请求级 schema、可信 scope 或存储不可用错误使整个调用安全失败。
- 返回 `successCount`、`failCount` 和按成功处理顺序排列的 `memoryIds`，且两个计数之和等于输入条目数。

## Feature 影响（Features）

### 修改的 Feature

- `F-8.2 长期记忆`：长期记忆写入从仅支持逐条管理新增扩展为同时支持有界批量新增，仍复用相同的身份、安全、容量和持久化保证。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-8.5 长期记忆 search/list/detail/count/state transition` → canonical spec `specs/memory-core/spec.md`
  - 功能边界：新增 1 至 100 条长期记忆的有界批量写入输入、逐项结果和失败语义。
  - 系统质量属性：安全、性能/容量、可靠性/恢复、可测试性。
  - 映射说明：`memory-core` 是 canonical spec；本 change 同时触及 legacy spec `long-term-memory-management-contract` 中 Channel 管理端口和 route 数量边界，不新增 Function 映射。

## 影响范围（Impact）

- 管理界面导入可消费稳定的批量新增 REST API；既有逐条新增调用方不受影响。
- 公共 contract、Web schema/route、长期记忆 application service、local Gateway 和对应 contract/characterization 测试需要同步。
- 批量输入会增加单请求处理量，但单批被限制为 100 条，并顺序执行安全准入和写入，避免无界并发压力。
