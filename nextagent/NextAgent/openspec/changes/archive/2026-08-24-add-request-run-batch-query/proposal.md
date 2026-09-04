## Why

平台集成方在 REMOTE 部署中通过 Working Memory gateway 提供 RequestRun 数据。当前公共契约只能按单个 `runId` 查询；当一次业务操作需要解析多个运行记录时，调用方只能发起 N 次远端请求。多选对话分享会触发这一行为，选中项较多时容易达到 AgentMemory 的接口限流阈值，导致分享创建或查看失败。

系统需要提供有界、可分页的 RequestRun 批量查询契约，使平台集成方能够在一次 gateway 调用中解析同一可信 scope 下的一组运行记录，并保持 LOCAL 与 REMOTE provider 的一致行为。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- 平台集成方可按一组 `sessionId`、一组 `runId` 或二者交集分页查询 RequestRun。
- 查询始终受可信 Owner Scope 和 Agent Scope 隔离，结果具有稳定顺序，单页最多返回 100 条。
- LOCAL gateway 实现该分页语义；外部 REMOTE adapter 通过同一公共契约完成后续适配。

**非目标：**

- 不新增 Web API，也不改变创建分享或查看分享的公开响应结构、错误码和 copied run anchor 回退语义。
- 不修改对话分享或其他现有业务调用方；调用方迁移到批量 gateway 由后续独立 change 定义。
- 不改变单条 `loadRun` 的行为，也不迁移 runtime lifecycle 中天然按单个运行读取的调用点。
- 不在 NextAgent remote reference provider 中定义 AgentMemory 私有 endpoint、wire DTO、鉴权或重试策略；这些继续由部署方注入的 REMOTE binding 负责。

## What Changes

- **BREAKING**：Working Memory 的 `RequestRunStoreGateway` 新增必需的分页批量查询操作。REMOTE provider 实现方必须实现该操作后才能满足完整 binding contract。
- 新批量查询允许使用非空 `sessionIds`、非空 `runIds` 或同时使用二者；同时使用时仅返回两个过滤集合的交集。
- 查询接受 `offset` 和 `limit`，其中 `offset` 必须为非负安全整数，`limit` 必须为 `1..100`；非法查询必须在访问数据前显式失败。
- 查询结果返回当前页记录、请求分页参数和是否存在下一页，并采用确定性顺序。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-8.1 持久化运行数据` → `specs/gateway-store-provider-ownership/spec.md`
  - 功能边界：Working Memory gateway 新增 scoped RequestRun 批量分页查询，LOCAL 与 REMOTE provider 对过滤、排序、分页和校验提供一致结果。
  - 系统质量属性：安全、性能/容量、可靠性/恢复、可测试性。
  - 映射说明：`gateway-store-provider-ownership` 是该 legacy Function 的现有 canonical spec；本 change 只触及该 spec。

## 影响范围（Impact）

- 平台集成方：位于外部仓库的 REMOTE Working Memory adapter 需要同步实现新增必需操作；未升级的实现将无法满足新 contract。
- 外部 AgentMemory：获得一次处理多个 RequestRun 过滤条件的公共 gateway contract；具体业务调用方迁移不在本 change 范围。
- 公共 Web API 与配置：无变化。
- 代码与测试：gateway contract、LOCAL SQLite adapter 及相关 wrapper/测试替身受到影响；本仓库不修改或模拟外部 REMOTE adapter 实现。
