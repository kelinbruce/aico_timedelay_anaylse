## ADDED Requirements

### Requirement: IR 路由分类与认证隔离

当 IR surface 注册在 `/api/v1/ir` 之下时，路由分类 SHALL 把 `/api/v1/ir/**` 请求导向一个基于 header 的 identity resolver（`createTaskIdentityResolver`），并 SHALL NOT 对这些路由应用本地 cookie 认证。`/api/v1/**` 下的 ER 路由（不含 IR 前缀）SHALL 继续使用本地 cookie 认证，并 SHALL NOT 接受基于 header 的 identity。

两条认证路径 SHALL NOT 交叉接受。缺少必需 header 的 IR 请求 SHALL 在任何 runtime 调用之前被拒绝。缺少有效 cookie 的 ER 请求 SHALL 在任何 runtime 调用之前被拒绝。两种拒绝都 SHALL NOT 产生持久副作用。

#### Scenario: IR 路由绕过 cookie 认证
- **WHEN** 一个请求到达 `/api/v1/ir/**`，带有有效的 identity header 但没有 cookie
- **THEN** 基于 header 的 resolver MUST 产生一个可信的 IdentityContext
- **AND** MUST NOT 应用本地 cookie 认证

#### Scenario: ER 路由拒绝仅 header 认证
- **WHEN** 一个请求到达某个 ER `/api/v1/**` 路由，带有 identity header 但没有有效 cookie
- **THEN** 本地 cookie 认证 MUST 拒绝该请求
- **AND** MUST NOT 对 ER 路由使用基于 header 的 resolver

#### Scenario: 缺失 IR header 时在 runtime 之前被拒绝
- **WHEN** 一个请求到达 `/api/v1/ir/**`，缺少 `x-tenant-id` 或 `x-subject-id`
- **THEN** channel MUST 返回一个安全的 401
- **AND** MUST NOT 调用任何 runtime port 或创建任何持久状态
