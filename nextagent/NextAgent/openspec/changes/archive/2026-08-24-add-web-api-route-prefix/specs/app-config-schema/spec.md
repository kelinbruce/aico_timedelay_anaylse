## ADDED Requirements

### Requirement: channel.routePrefix 配置公共路径前缀 P

`app composition config` 的 `channel` 组 SHALL 暴露可选字段 `routePrefix`，作为 NextAgent 自身暴露的全部 Web API 路由（主 Web channel、memory、auth-local、IR、health）的统一公共前缀 `P`。`P` 追加在固定 `/api/v1` 段之前，不替换 `/api/v1`：API 形态 `${P}/api/v1/...`。`P` 只影响 Web API 挂载，不改动页面入口、SPA 路由与静态资源托管（仍在根 `/`）。

`routePrefix` MUST 满足：以 `/` 开头，不以 `/` 结尾（单个 `/` 表示"无前缀"，允许），不包含 `..`、`//` 或空段，仅使用 `[A-Za-z0-9/_-]` 字符，长度不超过 64。startup validation MUST 在 ready 之前一次性校验 `routePrefix`，校验失败 MUST 产生阻断性 safe 配置诊断并阻止 ready。`routePrefix` 缺省时 MUST 取默认值 `/`（无前缀），使既有部署零迁移：API 仍在 `/api/v1/...`。

`routePrefix` 冻结后 MUST 进入 `DefaultSystemConfig.channel` 投影，供 app composition 透传给 Web channel、memory、auth-local 与 IR 路由注册；runtime request lifecycle MUST NOT 重新读取或修改 `routePrefix`。`routePrefix` MUST NOT 影响出站外部调用地址（model `baseUrl`、task callback `allowedOrigins`、gateway `endpoint`、rag indexes 等），这些保持各自配置独立。

前端 MUST 通过构建期 `import.meta.env.PREFIX_PATH` 解析同一 `P`（构建阶段注入，固化进产物）；前后端解析的 `P` MUST 一致才能联通，不一致时前端请求将命中 404。

**迁移**：原 `routePrefix: /api/v1` 的语义已从"API 挂载前缀"改为"公共前缀 P"。既有写 `/api/v1` 的配置在新语义下会产生 `/api/v1/api/v1/...` 双重前缀，MUST 迁移为 `/`（无前缀）或目标业务前缀。

#### Scenario: 默认前缀保持既有行为
- **WHEN** startup 校验的配置源未提供 `channel.routePrefix`
- **THEN** 冻结的 `DefaultSystemConfig.channel.routePrefix` MUST 为 `/`
- **AND** 所有 Web API 路由 MUST 挂载在 `/api/v1/...`
- **AND** 页面与静态资源 MUST 挂载在 `/`
- **AND** 既有客户端调用 `/api/v1/...` MUST 不受影响

#### Scenario: 自定义前缀生效（追加，不替换 /api/v1）
- **WHEN** startup 校验的配置源提供 `channel.routePrefix: /svcA`
- **THEN** 冻结的 `DefaultSystemConfig.channel.routePrefix` MUST 为 `/svcA`
- **AND** 主 Web channel、memory、auth-local、health 路由 MUST 挂载在 `/svcA/api/v1/...`
- **AND** IR channel MUST 挂载在 `/svcA/api/v1/ir/...`
- **AND** `/api/v1/...` 路径 MUST 不再命中上述 API 路由（404）
- **AND** 页面与静态资源 MUST 不受影响（仍在根 `/`）

#### Scenario: 非法前缀被拒绝
- **WHEN** startup 校验的配置源提供 `channel.routePrefix` 值含尾斜杠（非单个 `/`）、`..`、`//`、空段或非法字符
- **THEN** startup validation MUST 产生阻断性配置诊断
- **AND** 系统 MUST NOT 进入 ready 状态

#### Scenario: 出站外部调用不受前缀影响
- **WHEN** `channel.routePrefix` 配置为非默认值
- **THEN** model provider `baseUrl`、task callback `allowedOrigins`、gateway `endpoint`、rag indexes 等出站配置 MUST 保持各自独立值
- **AND** 系统 MUST NOT 把 `routePrefix` 拼接到上述出站地址
