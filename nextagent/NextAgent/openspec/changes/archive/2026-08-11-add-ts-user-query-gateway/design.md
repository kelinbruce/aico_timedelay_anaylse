## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-10.5 集成外部系统` | 注册可由 LOCAL 与 REMOTE provider 实现的用户查询 Gateway，LOCAL 默认提供确定性结果 | `gateway-configuration` | `FN-10.5 集成外部系统` |
| `FN-8.15 管理长期记忆` | 共享知识结果补充可选发布者用户名，并在查询失败或缺失时回退稳定用户标识 | `long-memory-web-management` | `FN-8.15 管理长期记忆` |

## `FN-10.5 集成外部系统`

### 目标与规范依据

平台集成方通过现有启动期 Gateway provider selection 注册同一用户查询契约；LOCAL 默认部署无需外部依赖，REMOTE 部署在显式选择后必须提供有效实现。

#### 本 Function 的目标 Requirements

canonical spec：`gateway-configuration`

- `ADDED`：`用户查询 Gateway 提供稳定公共契约`
- `ADDED`：`用户查询 Gateway 通过正式 adapter 注册`

### 当前实现

- `agent-contracts/gateway` 定义 `GatewayAdapterKind`、`GatewayProvider`、`GatewayBindings` 以及现有 Gateway ports。单一 port 如 `guardrail`、`watermark`、`sandbox` 直接作为顶层 binding；只有 Working Memory、Long-term Memory 和 SQLite 多端口集合使用聚合 bindings。
- `agent-app` 在 `component-config.ts` 和 runtime schema 中维护配置可选择的 adapter kind 集合；`validation.ts` 构造冻结 selection snapshot，并在 gateway section 缺失时应用 LOCAL 默认 entries。
- `gateway-composition.ts` 按 deployment mode 与 adapter kind 为每个 selected entry 解析恰好一个 provider，校验 provider 返回的 binding，合并不同 provider 结果，并在 binding 缺失、未选择或冲突时阻止 ready。
- `agent-platform-gateway-local` 的通用 LOCAL provider 负责多个无独立持久化生命周期的 LOCAL adapters；默认 LOCAL provider 集合已经通过 entrypoint 注入 app composition。
- 当前没有用户查询 contract、`user-query` adapter、`GatewayBindings.userQuery`、LOCAL 默认实现或相关 contract/composition 测试。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 平台集成方使用统一 contract 实现用户查询 | 没有公开用户查询 port 或 runtime schema | 需要新增最小 request/result/record、schema 和异步 port |
| `user-query` 参与正式 selection、readiness 和 conflict 校验 | adapter kind、配置注册和 binding merge 中没有该能力 | 需要扩展既有 adapter kind 与顶层 binding 映射，不建立第二套注册入口 |
| LOCAL 缺省即提供确定性用户名 | 默认 LOCAL 配置和 provider 不包含用户查询 | 需要在既有 LOCAL provider 中按 selection 创建无状态实现 |
| REMOTE 可由产品集成方实现 | provider SPI 可以注入扩展，但没有可选择的用户查询 binding | 需要冻结公共契约和 provider handoff；本仓不实现远端 transport |

### 修改方案

1. 在 `agent-contracts/gateway` 增加 spec 定义的用户查询 types、runtime schemas 和 `UserQueryGateway`。该 port 独立定义并直接挂在 `GatewayBindings.userQuery`；不创建只有一个成员的 `UserGatewayBindings`，也不修改三类 persistence bindings。
2. 在 contracts 与 app config 的 `GatewayAdapterKind` 稳定集合中同步加入 `user-query`，并扩展配置 runtime schema、registered adapter 校验和 contract fixtures。现有 selection snapshot shape 不变。
3. 在 `gateway-composition.ts` 的唯一 binding merge/validation 路径中加入 `userQuery`：selected entry 缺失 binding、provider 返回未选择 binding和多 provider 冲突继续使用现有安全错误语义。`selectedGatewayProviderEntries` 的通用筛选无需新增旁路。
4. 在 `agent-platform-gateway-local` 增加无状态 `createLocalUserQueryGateway`。实现只检查取消并按输入顺序映射所有目标标识为 `${subjectId}-name`；不访问文件、SQLite、网络或进程环境。通用 LOCAL provider 仅在分配到 `user-query` entry 时创建该 port，且不增加 close 资源。
5. 在缺省 LOCAL gateway entries 中增加 `local-user-query`，由现有 `createLocalGatewayProvider` 提供。REMOTE deployment 只有显式选择并注入 REMOTE provider 才能获得 binding；本仓不增加 reference remote adapter、endpoint 解析或认证配置。
6. 通过 gateway contract、配置 contract、composition 和 LOCAL provider 测试覆盖 schema 边界、默认选择、binding 完整性、未选择 binding、冲突、取消和确定性映射。实现继续使用既有 public exports，不增加 private-path import。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 安全 | 无新增黑盒质量目标；`用户查询 Gateway 提供稳定公共契约` 的功能性安全边界 | Owner Scope 只来自可信调用方；结果限制为请求目标集合；诊断不记录用户名或 provider payload | 越界结果、未知字段和未经选择 binding 的 negative tests |
| 可靠性/恢复 | 无新增黑盒质量目标；`用户查询 Gateway 通过正式 adapter 注册` 的启动行为 | selected adapter 缺失或冲突时 fail before ready，REMOTE 不动态回退 LOCAL | provider 缺失、deployment mismatch 和 binding conflict tests |
| 可测试性 | 无新增黑盒质量目标；两个新增 Requirements | LOCAL 映射无外部依赖，remote 接入只需实现稳定 port；schemas 可独立验证 | contract fixtures、fake provider 和取消测试 |

## `FN-8.15 管理长期记忆`

### 目标与规范依据

共享知识使用者在保留发布者稳定标识的前提下看到可读用户名；用户查询的普通失败不得使已可用的共享知识内容失败，取消仍遵守 management 请求的取消语义。

#### 本 Function 的目标 Requirements

canonical spec：`long-memory-web-management`

- `ADDED`：`共享知识展示发布者用户名`

### 当前实现

- `LongTermMemorySharingGateway.listPublishedLongTermMemory` 返回 `SharedMemorySummaryPage`，每项包含 `ownerSubjectId`，不包含用户名。
- `agent-memory` 的 `createLongTermMemoryManagementService` 调用 sharing Gateway，并同步把每项投影为 `PublishedLongTermMemoryManagementView`；该 view 当前只增加 `sourceMemoryId` 和 `ownerSubjectId`。
- `agent-app` 在 channel composition 中构造长期记忆 management service，当前只注入 Store、Retriever、Sharing 和可选 Guardrail Gateway。
- `agent-channel-web` 把 `ownerSubjectId` 投影为 Web alias `ownerUserId`；前端 `SharedMemorySummary` 只包含 `ownerUserId`，列表和详情直接显示该字段。
- 现有 management 取消 helper 在 Gateway 调用前检查 signal；共享知识列表当前没有第二个可取消的慢边界。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| management result 同时保留发布者标识和可选用户名 | Channel management view 只有 `ownerSubjectId` | 需要新增 optional `ownerUserName`，不把 Gateway Record 泄漏到 channel contract |
| 每页发布者批量、去重解析 | list published 只调用 Sharing Gateway | 需要在 application service 中基于可信 scope 调用 selected `UserQueryGateway` 并投影结果 |
| 普通查询失败回退，取消终止 | 当前统一 `invoke` 会把依赖错误作为 operation 错误 | 需要为用户名补充建立明确的成功、普通失败和取消分支 |
| Web 与前端优先显示用户名 | Web DTO 和前端只认识 `ownerUserId` | 需要增加 optional wire/view 字段并统一回退展示 |

### 修改方案

1. 在 `agent-contracts/channel` 的 `PublishedLongTermMemoryManagementView` 增加 optional `ownerUserName`。required `ownerSubjectId` 和 `LongTermMemoryManagementPort` method 集合保持不变；channel contract 不 import gateway types。
2. `LongTermMemoryManagementServiceDependencies` 增加 optional `userQuery`，由 `agent-app` 从冻结的 `GatewayBindings.userQuery` 注入。业务映射仍只在 `agent-memory`，`agent-app` 不解析用户结果，Channel 不直连 Gateway。
3. `listPublishedLongTermMemory` 先完成既有 sharing 查询。页面为空时直接返回；非空时按页面顺序对 `ownerSubjectId` 去重，以原 query 的可信 `identityContext.tenantId`、`identityContext.subjectId` 和当前 signal 调用一次 `queryUsers`。当前 Web 页面上限不超过用户查询 contract 的 10000 项边界，因此不引入分片、并发或缓存。
4. 用户查询成功时建立 `subjectId -> userName` 的只读映射，并只为命中项投影 `ownerUserName`。普通 `SafeError` 或 adapter 抛出非取消错误时返回原页面且省略用户名；category 为 `CANCELED`、signal 已取消或取消异常时返回既有 management cancellation SafeError。不得记录用户名、共享记忆正文或原始 provider error。
5. `agent-channel-web` 把 management view 的 optional 字段投影为同名 Web 字段 `ownerUserName`，并继续把稳定标识投影为 required `ownerUserId`。前端 service contract 增加 optional 字段；列表和详情只使用 `ownerUserName ?? ownerUserId`，其它操作继续以 memory id 和既有 scope 工作。
6. 通过 application service、channel route 和 frontend component 测试覆盖成功、去重、部分缺失、普通失败、取消、空页、用户名优先和 ID 回退。既有 publish/unpublish/copy、分页、排序、计数和脱敏路径保持不变。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 可靠性/恢复 | 无新增黑盒质量目标；`共享知识展示发布者用户名` 的功能性降级行为 | 用户名是非关键展示增强，普通失败回退稳定 ID；取消不被降级为成功 | SafeError、throw、取消和部分结果测试 |
| 安全 | 无新增黑盒质量目标；`共享知识展示发布者用户名` 的可信 scope 约束 | 目标集合只来自已授权共享页面，Web 只增加用户名，不暴露额外用户属性或原始错误 | owner scope 传递、结果字段和错误泄漏 tests |
| 可测试性 | 无新增黑盒质量目标；`共享知识展示发布者用户名` | Gateway 作为显式依赖，fake port 可覆盖全部分支；UI 使用单一回退表达式 | service、route 和 frontend 测试保持同一语义 |

## 跨 Function 协作与端到端流程

`FN-10.5` 的修改方案负责在启动期生成唯一、冻结且通过 readiness 的 `GatewayBindings.userQuery`。`FN-8.15` 的修改方案只消费该 binding，不重新读取 gateway 配置或构造 adapter。端到端路径为：gateway source selection → trusted provider creation → binding validation/merge → app composition 注入 management service → shared page owner resolution → channel DTO projection → frontend username-or-id 展示。

LOCAL 缺省配置总能提供用户查询 binding。REMOTE 配置只有在产品集成方同时部署并注册 remote provider 后才能选择 `user-query`；缺少 provider 在启动期失败。运行期普通查询失败只影响用户名投影，取消则终止当前 management 请求。

## 验证策略（Verification Strategy）

- unit/contract：验证用户查询 schema、LOCAL 映射、取消、结果顺序和缺省/越界输入。
- configuration/contract：验证 `user-query` 属于稳定 adapter 集合、LOCAL 默认 selection 完整、REMOTE provider 缺失不回退。
- composition/integration：验证 binding merge、missing/unselected/conflict negative cases，以及 app 只把冻结 port 注入 management service。
- application service：验证页面 owner 去重、可信 scope、成功投影、部分缺失、普通失败回退、取消和空页。
- channel contract：验证 Web response 保留 required `ownerUserId` 并只增加 optional `ownerUserName`，Gateway types 不泄漏。
- frontend unit：验证列表与详情用户名优先和 ID 回退，既有共享操作不受影响。
- architecture：验证跨 package 仅使用 public exports，Channel 不直连 Gateway，`agent-app` 不承担用户结果映射。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/gateway-configuration/spec.md`：合并 `user-query` contract、adapter selection 和 LOCAL default Requirements。
- `openspec/specs/long-memory-web-management/spec.md`：在先归档 `add-ts-long-memory-manage` 后，合并共享知识发布者用户名 Requirement。
- `openspec/designs/functions/D10-二次开发与平台集成/D10.2-集成与定制/FN-10.5-集成外部系统.md`：补充用户查询 adapter 的输入、结果和关键规格。
- `openspec/designs/functions/D8-数据与记忆/D8.2-记忆/FN-8.15-管理长期记忆.md`：在前置 change 建立该 Function 后补充发布者展示规格。
- `openspec/designs/features/D10-二次开发与平台集成/D10.2-集成与定制/F-10.5-集成外部系统.md`：补充用户查询 provider 集成价值。
- `openspec/designs/features/D8-数据与记忆/D8.2-记忆/F-8.2-长期记忆.md`：补充共享知识发布者可读展示。
- `openspec/overview.md`：无。
- `openspec/designs/architecture/core-contracts.md`：补充用户查询 Gateway 公共契约与 binding 边界。
- `openspec/designs/modules/agent-contracts.md`、`agent-platform-gateway-local.md`、`agent-memory.md`、`agent-app.md`、`agent-channel-web.md`、`agent-web.md`：同步各模块长期职责与验证入口。
- ADR：无。
- `openspec/designs/spec-to-design-map.md`：增加两个 stable specs 与受影响 architecture/modules/tests 的导航。

## 风险与取舍（Risks / Trade-offs）

- 用户名是可变展示值，不持久化到共享记忆事实；每次列表查询都可能访问用户查询 Gateway。通过页面级批量查询控制调用次数，当前 change 不增加缓存失效语义。
- 共享知识 public DTO 增加 optional 字段，对既有客户端保持向后兼容；TypeScript exhaustive fixtures 需要同步更新。
- REMOTE adapter 不在本仓交付。若产品配置先启用 `user-query` 而外部 provider 尚未部署，启动会按设计失败；发布顺序必须先部署 provider，再启用 selection。
- `long-memory-web-management` 仍位于已完成但未归档的前置 change。当前 change 可以实现和验证，但归档必须严格按前置 change在先的顺序执行。

## 迁移与回滚（Migration / Rollback）

LOCAL 默认配置与 provider 在同一版本发布，不存在数据迁移。REMOTE 发布顺序为：先发布实现新 contracts 版本的 provider，再在产品 gateway source 中启用 REMOTE `user-query`，最后启动新应用版本。回滚时先移除 REMOTE selection，再回滚 provider；共享知识 public DTO 的 optional `ownerUserName` 缺失时前端自动回退 `ownerUserId`。回滚不修改任何共享记忆数据。

## 待确认问题（Open Questions）

- 无。`agent-contracts/gateway` 与 `agent-contracts/channel` 的公共契约变更已于 2026-08-08 完成群内确认，记录见 `references/agent-contracts-confirmation.md`。
