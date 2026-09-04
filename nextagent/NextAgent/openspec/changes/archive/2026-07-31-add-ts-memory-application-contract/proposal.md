## 背景与问题（Why）

长期记忆 Web 路由当前直接接收并调用 `LongTermMemoryGatewayBindings`，使 `agent-channel-web` 同时承担 HTTP transport、记忆操作编排、Gateway DTO 转换和 Record projection。该调用方式违反 Channel 不直接调用 Gateway 的稳定架构边界，也会把持久化/远端服务契约泄漏到最外层 adapter。

群内评审已确认唯一合适路径：

```text
agent-channel-web
  -> agent-contracts/channel.LongTermMemoryManagementPort
  -> agent-memory application service
  -> agent-contracts/gateway long-term memory ports

agent-app 仅负责 composition/wiring
```

因此本 change 在现有 `agent-contracts/channel` subpath 中补充长期记忆管理端口，不新增 `agent-contracts/memory`，也不修改 Gateway 已冻结的 12 个公开操作。

## 变更范围（What Changes）

- **BREAKING**：在 `@nextagent/agent-contracts/channel` 中新增 `LongTermMemoryManagementPort` 及其 management command/query/view/result。该公开契约调整已按群内评审意见确认。
- `LongTermMemoryManagementPort` 精确定义 save、list、manual save、get、delete、mutate、search、detail、publish、unpublish、list published、copy published 12 个方法，不增加 count、batch 或兼容别名。
- management DTO 与 Gateway Request、Query、Record、write options 分层；Channel contract 不导入或重导出 `agent-contracts/gateway` 类型。
- `agent-memory` 提供 application service，实现 management port，并在边界内映射 Store、Retriever、Sharing Gateway contract。
- `agent-channel-web` 只依赖 `agent-contracts/channel` 的 management port，负责 HTTP schema、可信 scope 注入、请求取消连接、safe error/status 和 public DTO projection；不得接收或调用长期记忆 Gateway。
- `agent-app` 使用 selected Gateway bindings 构造 application service，并把 management port 注入 Web Channel；不承载记忆业务判断、DTO 映射或 Gateway 调用。
- 保持现有 Web URL、method、response envelope 和前端交互不变；`tenantId`、`userId`、`agentId` 由 Channel 从可信 scope 投影，不从 Gateway Record 穿透。
- 为 12-method surface、DTO/Record 隔离、Channel forbidden import、scope、取消、错误和 composition 增加 contract/architecture/route tests。
- 不实现 REMOTE HTTP adapter，不修改数据库表，不修改 extraction、dreaming、aging、sharing 或检索算法。

## Capability 影响（Capabilities）

### 新增 Capability

- `long-term-memory-management-contract`：定义 Channel-facing 长期记忆管理 port、DTO、scope、取消、错误和 composition 行为。

### 修改的 Capability

- `ts-core-contracts`：在已有 `agent-contracts/channel` owning subpath 中增加 `LongTermMemoryManagementPort`，并明确 management DTO 不复制或泄漏 Gateway persistence contract。
- `ts-backend-architecture`：固定 `Channel -> channel contract management port -> agent-memory application service -> Gateway` 的唯一依赖方向，并禁止 Channel 直连 Gateway。

`long-memory-web-management` 继续定义 Web 页面和 REST 行为，本 change 只修正其后端跨模块调用边界。

## 影响范围（Impact）

- `packages/agent-contracts`：扩展 `src/channel/index.ts` 和既有 `./channel` export；不新增 contract subpath。
- `packages/agent-memory`：新增长期记忆 management application service 和 Gateway mapper。
- `packages/agent-channel-web`：路由依赖切换为 `LongTermMemoryManagementPort`，删除长期记忆 Gateway imports 和 Record projection。
- `packages/agent-app`：构造 application service并注入 management port。
- `tests/contract`、`tests/architecture` 和 Web route tests：覆盖公开端口、scope、映射和禁止依赖。
- 运维配置、数据库 schema、外部 API YAML、Web URL 和部署参数不变。

## 冻结契约确认门禁

群内已确认长期记忆 Gateway 公开接口调整无问题，并对本次长期记忆管理边界给出明确结论：公开端口放在 `agent-contracts/channel`，`agent-memory` 实现 application service，Gateway 保持下层 port，`agent-app` 仅负责 composition/wiring。

确认记录保存在 `references/frozen-long-term-memory-management-contract-confirmation.md`。实现和最终 review 必须与该唯一调用链一致；任何重新新增 `agent-contracts/memory`、Channel 直连 Gateway 或把业务映射放进 `agent-app` 的方案都需要重新群内确认。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/long-term-memory-management-contract/spec.md`：新增长期记忆 management port 的稳定行为契约。
- `openspec/specs/ts-core-contracts/spec.md`：归并 channel subpath 的新增公开端口和 Gateway 分层规则。
- `openspec/specs/ts-backend-architecture/spec.md`：归并唯一依赖方向和 Channel 禁止直连规则。

长期背景与设计：
- `openspec/overview.md`：补充长期记忆 Web 管理通过 Channel-owned management port 调用的稳定事实。
- `openspec/designs/architecture/memory.md`：归并 management port、application service、Gateway 映射和 scope/cancellation。
- `openspec/designs/architecture/core-contracts.md`、`ts-backend-architecture.md`：归并 channel subpath surface 和依赖方向。
- `openspec/designs/modules/agent-contracts.md`、`agent-memory.md`、`agent-channel-web.md`、`agent-app.md`：归并各模块职责和消费关系。
- `openspec/designs/spec-to-design-map.md`：增加 capability 导航。
- ADR：无；本 change 使用已确认的现有 contract/application/gateway/composition 分层。

验证入口：
- `openspec validate add-ts-memory-application-contract --strict` 和 `openspec validate --all --strict`。
- contract、service、route、composition 和 architecture negative tests。
- `npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`。
- `$nextagent-code-review` 和群内确认记录。
