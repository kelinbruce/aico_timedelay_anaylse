## 背景与问题（Why）

当前分支新增了 Cron 创建、删除和列表能力，但任务只保存在 `agent-capability` 进程内 `Map`，进程重启后丢失，也没有到期触发、可信回调或 request lifecycle 接入。该实现无法满足电信网络智能体对周期巡检、告警复核和维护窗口任务的可靠性、隔离、审计与恢复要求，也尚未经过 OpenSpec 定义。

NextAgent 的部署既可能使用本地 SQLite，也可能把基础设施能力交给客户侧 gateway。Cron 任务因此需要统一的稳定 contract，并由两种 adapter 实现相同行为：LOCAL 模式由本地 durable store 和 scheduler 管理；REMOTE 模式由 gateway 调用外部 Cron 服务持久化和调度，外部服务到期后通过受信回调通知 NextAgent 执行。无论模式如何，Cron backend 只拥有调度事实，不得直接拥有 Agent request lifecycle 或接受模型提供的身份与 Agent scope。

## 变更范围（What Changes）

- 定义单一 `Cron` Tool 及其 `action=create|list|delete` 的 schema、safe result、scope、幂等、列表和删除语义，并通过既有 capability invocation boundary 暴露。
- 用 `agent-contracts/gateway` 中稳定的 async Cron gateway port 替换 `agent-capability` 私有进程内 store contract；任务 Record 显式携带可信 Owner Scope、Agent Scope、session、schedule、prompt、状态和版本。
- LOCAL 模式使用专用 SQLite 表持久化 Cron task，并由本地 scheduler 发现到期任务、生成幂等 trigger fact，再调用受信 callback port。
- REMOTE 模式由 gateway adapter 调用外部 Cron 服务完成任务创建、查询、删除和调度；外部服务通过受认证、可重放防护的 callback 输入回传 task/trigger 标识，NextAgent 必须从持久化事实恢复 scope 与 prompt，不信任 callback 覆盖身份、Agent 或执行内容。
- callback 经 `agent-app` composition 转换为 runtime command，创建新的 request execution；`agent-runtime` 继续拥有 acceptance、same-session lane、cancellation、terminal commit 和 canonical timeline，Cron backend 不直接调用 Agent core/model/capability。
- 为 local 和 remote 两条路径增加 contract/integration 测试，并增加模型调用 `Cron(action=create) -> Cron(action=list) -> Cron(action=delete)` 以及到期回调执行的 e2e 测试。
- 日志、metric、trace、audit 只记录 task/trigger 的稳定引用、状态和安全原因，不记录 prompt、模型输出、credential、raw callback 或高基数字段。
- 当前分支中的进程内 `createInMemoryCronTaskPort` 仅可作为测试 fixture；不得作为产品默认实现。
- **BREAKING**：无。该能力尚未进入稳定基线；本 Change 在合入前收敛其 public contract。

## Capability 影响（Capabilities）

### 新增 Capability

- `cron-tools`: 定义模型可调用 Cron Tool、durable task、local/remote 调度、可信回调与 runtime execution 行为。

### 修改的 Capability

- `builtin-tool-framework`: 增加受控 `cronTasks` gateway 依赖及 Cron Tool 注册、schema validation 和 safe execution 约束。
- `gateway-configuration`: 增加 Cron task adapter 的 LOCAL/REMOTE 选择、必需 binding 和 fail-fast 语义。
- `ts-minimal-agent-kernel`: 增加由 Cron trigger 创建新 request execution 的 acceptance、session lane、terminal commit 与非回归语义。

## 影响范围（Impact）

- `agent-contracts/gateway`：Cron task/trigger Record、write/query option、gateway port 与 callback contract。
- `agent-platform-gateway-local`：专用 SQLite 表、scoped uniqueness、CAS/trigger claim 与本地 scheduler。
- `agent-platform-gateway-remote`：外部 Cron service client adapter、安全错误映射和 callback 验证边界。
- `agent-capability`：三个内置 Tool 改为消费稳定 gateway port，删除产品路径内存 owner。
- `agent-runtime`：复用现有 command acceptance，不新增第二套 lifecycle；提供 Cron trigger 到 submit command 的受信适配。
- `agent-app`：按 gateway selection 装配 Cron port、callback handler 和 scheduler lifecycle。
- 配置：复用 gateway provider selection；若选择 Cron adapter 但 binding 缺失则启动失败。
- 测试：schema/unit、gateway contract、SQLite recovery、remote adapter、callback replay/scope negative case、architecture 与 e2e。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/cron-tools/spec.md`：新增 Cron Tool、持久化、调度、回调和执行行为。
- `openspec/specs/builtin-tool-framework/spec.md`：补充 `cronTasks` 受控依赖。
- `openspec/specs/gateway-configuration/spec.md`：补充 Cron adapter selection/binding。
- `openspec/specs/ts-minimal-agent-kernel/spec.md`：补充 Cron trigger 创建 request execution 的主路径约束。

长期背景：
- `openspec/overview.md`：补充周期性电信运维任务能力及 local/remote 部署影响。

设计视图：
- `openspec/designs/architecture/cron-task-execution.md`：主承载 task/trigger 状态、local/remote 流程、数据 ownership、安全、幂等、恢复与接口语义。
- `openspec/designs/modules/agent-capability.md`、`agent-contracts.md`、`agent-platform-gateway-local.md`、`agent-platform-gateway-remote.md`、`agent-runtime.md`、`agent-app.md`：补充职责、非职责与 contract 消费关系。
- `openspec/designs/adr/cron-scheduling-boundary.md`：记录“Cron backend 只拥有调度、runtime 拥有执行生命周期”及双 adapter 决策。
- `openspec/designs/spec-to-design-map.md`：增加 `cron-tools` 到上述架构、模块、ADR 和验证入口的导航。

验证入口：
- Cron Tool schema/unit tests 与 gateway contract tests。
- local SQLite restart/recovery、claim 幂等和 remote callback replay/scope 安全测试。
- Cron Tool Calling 及触发执行 e2e。
- `npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`。
- `openspec validate --all --strict`。
