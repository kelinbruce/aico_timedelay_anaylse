## Function

- **所属 Function**：`FN-10.5 集成外部系统`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: 用户查询 Gateway 提供稳定公共契约

`agent-contracts/gateway` MUST 定义 `UserQueryGateway` 及其 runtime schemas。`UserQueryGateway.queryUsers` MUST 接收 `UserQueryRequest` 和可选 `AbortSignal`，并返回 `UserQueryResult | SafeError`。`UserQueryRequest` MUST 包含作为可信授权上下文的 `tenantId`、当前调用者 `subjectId`，以及 `targetSubjectIds`；`targetSubjectIds` MUST 是包含 1..10000 个互不重复 `SubjectId` 的数组。`UserQueryResult.users` MUST 是 `UserProfileRecord` 数组，每项只包含 required `subjectId` 和 required `userName`；`userName` MUST 是 1..256 个 Unicode code point 的非空字符串。请求和结果 schema MUST 拒绝未知字段。

结果中的每个 `subjectId` MUST 来自本次 `targetSubjectIds`，MUST NOT 重复，并 MUST 按目标标识在请求中的相对顺序返回。Gateway MAY 省略不存在或调用者无权查看的目标用户；省略时 MUST NOT 通过错误、占位字段或诊断泄漏该用户是否存在。Gateway 收到已取消 signal 时 MUST 返回 category 为 `CANCELED` 的 presentation-safe `SafeError`，且 MUST NOT 返回部分成功结果。Gateway 的结果、`SafeError` 和安全诊断 MUST NOT 包含未请求用户、credential、token、原始 provider payload 或未经授权的用户属性。

**需求类别**：功能性需求

#### Scenario: 批量查询返回有序用户结果

- **WHEN** 调用者在可信 Owner Scope 下查询三个互不重复的目标用户标识
- **THEN** Gateway MUST 返回请求目标集合的一个有序子集
- **AND** 每个返回项 MUST 只包含对应 `subjectId` 和合法 `userName`

#### Scenario: 缺失用户不泄漏存在性

- **WHEN** 至少一个目标用户不存在或调用者无权查看
- **THEN** Gateway MUST 从 `users` 中省略该目标用户
- **AND** 其它已授权目标用户仍按请求相对顺序返回

#### Scenario: 拒绝越界或重复目标集合

- **WHEN** `targetSubjectIds` 为空、超过 10000 项、包含重复标识或包含未知字段
- **THEN** runtime schema validation MUST 拒绝该请求
- **AND** Gateway operation MUST NOT 被执行

#### Scenario: 查询被取消

- **WHEN** `queryUsers` 观察到已取消的 `AbortSignal`
- **THEN** Gateway MUST 返回 category 为 `CANCELED` 的 presentation-safe `SafeError`
- **AND** MUST NOT 返回部分用户结果

### Requirement: 用户查询 Gateway 通过正式 adapter 注册

稳定 `GatewayAdapterKind` 集合 MUST 包含 `user-query`。`GatewayBindings` MUST 以 optional `userQuery?: UserQueryGateway` 暴露该单一 Gateway port，MUST NOT 为该单一 port 增加一层只包含它的聚合 bindings，也 MUST NOT 把它放入 Working Memory、Long-term Memory 或 SQLite bindings。

当 frozen gateway selection 包含 selected `user-query` entry 时，受信 provider MUST 声明支持同 deployment mode 的 `user-query` 并返回非空 `GatewayBindings.userQuery`。provider 缺失、binding 缺失、provider 返回未选择的 `userQuery`，或多个 provider 返回 `userQuery` 时，composition MUST 在 ready 前以安全配置错误失败。系统 MUST NOT 在运行期切换 adapter 或在 REMOTE selection 失败时回退到 LOCAL 实现。

当 source configuration 完全省略 `gateway` section 时，LOCAL 默认 gateway entries MUST 包含 `gatewayId=local-user-query`、`gatewayKind=user-query`、`deploymentMode=LOCAL`。LOCAL provider MUST 为每个请求的目标标识返回 `userName="${subjectId}-name"`，并 MUST 保持请求顺序。REMOTE provider 的 transport、认证 header、wire DTO 和 provider 错误映射不属于本契约；REMOTE selected `user-query` 仍 MUST 满足同一 `UserQueryGateway` 输入、输出、取消和安全语义。

**需求类别**：功能性需求

#### Scenario: 省略 Gateway 配置时获得 LOCAL 用户查询

- **WHEN** LOCAL source configuration 完全省略 `gateway` section
- **THEN** frozen gateway selection MUST 包含 LOCAL `user-query` entry
- **AND** merged `GatewayBindings.userQuery` MUST 可用

#### Scenario: LOCAL 用户名是确定性映射

- **WHEN** LOCAL `UserQueryGateway` 查询目标 `subject-a` 和 `subject-b`
- **THEN** 结果 MUST 依次包含 `subject-a-name` 和 `subject-b-name`
- **AND** 不得访问外部用户服务或写入用户数据

#### Scenario: REMOTE selection 缺少 provider

- **WHEN** frozen gateway selection 包含 REMOTE `user-query` entry
- **AND** 没有恰好一个同 deployment mode 的 provider 声明支持该 adapter
- **THEN** startup MUST 在 ready 前失败
- **AND** MUST NOT 使用 LOCAL 默认实现继续启动

#### Scenario: Provider 返回未选择或冲突 binding

- **WHEN** provider 返回未分配给它的 `userQuery`，或多个 provider 同时返回非空 `userQuery`
- **THEN** composition MUST 在 ready 前以安全 binding 错误失败
- **AND** MUST NOT 任意选择或覆盖 binding

## Function 变更汇总

### 输入

- **变更类型**：修改
- **目标内容**：集成配置可以选择 `user-query`，用户查询调用接收可信调用者 scope 和一个有界、无重复的目标用户标识集合。
- **依据 Requirements**：`用户查询 Gateway 提供稳定公共契约`、`用户查询 Gateway 通过正式 adapter 注册`

### 输出

- **变更类型**：修改
- **目标内容**：用户查询集成返回请求目标集合中已授权用户的稳定标识和用户名；LOCAL 默认部署返回确定性用户名，REMOTE 部署返回符合相同公共契约的结果。
- **依据 Requirements**：`用户查询 Gateway 提供稳定公共契约`、`用户查询 Gateway 通过正式 adapter 注册`

### 处理过程

- **变更类型**：修改
- **目标内容**：系统在启动期选择并校验用户查询 adapter，运行期只调用冻结的有效 binding，并在取消、非法输入或未授权目标出现时产生确定且不泄漏的可观察结果。
- **依据 Requirements**：`用户查询 Gateway 提供稳定公共契约`、`用户查询 Gateway 通过正式 adapter 注册`

### 结果

- **变更类型**：修改
- **目标内容**：合法用户查询返回有序结果；selected adapter 的 provider 或 binding 不完整时应用在 ready 前失败，REMOTE 不回退 LOCAL。
- **依据 Requirements**：`用户查询 Gateway 提供稳定公共契约`、`用户查询 Gateway 通过正式 adapter 注册`

### 规格

- **规格项**：用户查询 adapter
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：`user-query` 在启动期完成 LOCAL 或 REMOTE 单一 adapter 选择；LOCAL 默认启用，REMOTE 缺失时不回退 LOCAL
- **依据 Requirements**：`用户查询 Gateway 通过正式 adapter 注册`
