## 背景和现状（Context）

当前分支已实现三个 Cron Tool、cron 表达式校验和进程内 `Map` store，并在 `agent-app` 创建单例后注入 capability subsystem。它没有 OpenSpec 基线、durable gateway contract、到期 scheduler、callback transport 或 runtime execution 接线。这是明确的 implementation-vs-spec gap：现有代码只能验证 Tool CRUD 形状，不能作为产品路径。

现有架构已有 gateway provider selection、SQLite gateway-local、remote adapter、scheduled maintenance lifecycle、标准 runtime submit command 和 same-session lane。设计需要复用这些边界，同时区分“应用内部 maintenance job”与“用户创建且会启动 Agent request 的 Cron task”。相关方包括 capability/tool、runtime、gateway provider、本地数据库、客户侧 Cron 服务和运维安全配置。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 单一 Cron Tool 通过 `action=create|list|delete` 和同一稳定 gateway contract 在 LOCAL/REMOTE 部署中获得同形 CRUD 行为。
- Cron trigger 可恢复、幂等、安全地进入标准 request lifecycle。
- Owner Scope、Agent Scope、session 和 prompt 只从可信持久化事实恢复。
- local restart、remote callback retry 和应用 shutdown 都有确定行为与测试入口。

**非目标：**

- 不实现通用 workflow scheduler、分布式作业编排、日历语义、时区 UI 或任意 webhook 平台。
- 不让 Cron backend 拥有 Agent core/model/capability invocation 或 terminal commit。
- 不新增独立于 gateway selection 的第二套 provider 配置框架。
- 首版不迁移进程内任务，因为当前实现未进入稳定产品且没有 durable 数据可迁移。

## 设计决策（Decisions）

### 1. 稳定 contract 归 `agent-contracts/gateway`

新增 `CronTaskGatewayPort`，采用 async 方法并接收 `AbortSignal`（本地原子事务完成后不承诺中途 abort）。写入使用 `CronTaskRecord + write options`；查询使用 scoped request。task record 包含 `taskId`、可信 owner fields、`agentId`、`sessionId`、cron、prompt、recurring、status、created/updated time 与 version。`idempotencyKey` 和 `expectedVersion` 属于 write options，不进入 Record。

另定义 composite `claimCronTrigger`：以 `(owner scope, agentId, taskId, scheduledAt)` 作为业务锚点，在单事务内创建唯一 trigger fact并按 recurring 规则推进 task。返回 `CronTriggerRecord`。这避免 runtime 层先查后写产生重复执行。

放弃让 `agent-capability` 自己定义 store，因为持久化 contract 不能由 Tool implementation 所有；放弃 generic records store，因为 task/trigger 是主路径业务事实。

### 2. LOCAL 与 REMOTE adapter 同形同策

LOCAL 使用 `cron_tasks` 与 `cron_triggers` 专用表。local scheduler 只扫描 due task 并调用 `claimCronTrigger`；claim 成功后调用 app 注入的 `CronTriggerDeliveryPort`。扫描间隔固定 1 秒用于首版 e2e，查询批量上限固定 100；一轮处理满 100 时立即安排下一轮，不把 task id 写入日志。

REMOTE adapter 将同一 gateway port 映射到客户侧 Cron service client。远端服务拥有 durable schedule 与 delivery retry，本地不启动扫描 scheduler。vendor request/response 在 adapter boundary runtime validation，raw error 映射为稳定 safe error。

放弃复用 `ScheduledMaintenanceGatewayPort`，因为它只注册进程内 maintenance callback，没有用户 task CRUD、durable trigger 或 remote callback 语义。

### 3. callback 只传引用，不传执行权威数据

定义 transport-neutral `CronTriggerCallbackHandler` 输入：`taskId`、`triggerId`、`issuedAt`、`nonce` 和认证 envelope。web route 若存在只负责 schema/auth projection。认证采用 app 配置的 secret reference 解析后验证 HMAC-SHA256；允许时钟偏差 5 分钟，nonce/trigger replay 由 durable trigger acceptance anchor 拦截。callback 不允许 prompt/identity/agent/session 字段。

handler 通过 gateway 读取 trigger 与 task，验证 ACTIVE/CLAIMED 状态和双 scope 后构造内部 delivery。LOCAL scheduler 也调用同一 handler 的 trusted delivery 方法，因此两种模式共享 acceptance 逻辑。

callback 不携带可信 Owner/Agent Scope，因此增加唯一受控 `loadTriggerDelivery(taskId, triggerId)` composite read 作为认证后的 scope bootstrap。该查询只能在 HMAC 与 freshness 验证成功后调用，并一次返回 task/trigger pair；handler 必须校验二者 tenant、subject、agent、session、task id 一致，拒绝 missing、deleted、非 CLAIMED 或 scope mismatch。未认证 transport 输入不得直接调用该 port。这个例外不允许 callback 提供或覆盖任何 scope，也不扩展普通主路径的 unscoped data access。

### 4. runtime 仍是 request lifecycle 唯一 owner

app composition 把合法 delivery 转为现有 `SubmitRequestCommand`，使用 task 绑定 session 与持久化 prompt，并从 assembly registry 解析 task `agentId` 的当前可执行版本。提交后以 composite gateway write 记录 trigger 对应 `requestRunId`；同一 trigger 的重复提交通过 acceptance idempotency key 返回首次结果。Cron transport 不直接依赖 agent-core/model。

对于已删除 task 的迟到 callback，不执行并返回稳定 gone/ignored 结果。对于 runtime 暂时失败，trigger 保持可重试状态；remote service 可重投，local scheduler 在下一轮重投未绑定 run 的 claimed trigger。

### 5. Capability 与产品路径

Cron Tool 改为消费 `CronTaskGatewayPort` 的窄适配，不再拥有 scope record。`createInMemoryCronTaskPort` 移到 test fixture 或删除；产品 composition 必须从 gateway bindings 获得 Cron port。Cron Tool 继续经过现有 capability catalog、schema、risk policy 与 safe error mapping。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | callback HMAC、5 分钟 freshness、durable replay anchor；scope/prompt 从持久化事实恢复；日志不含 prompt/raw vendor error | callback negative contract tests、redaction tests、code review |
| 性能/容量 | local 每秒扫描、每批 100；专用 due/status index；remote 不在本地扫描 | SQLite query integration test、100+ due task batching test |
| 可靠性/恢复 | task/trigger durable；事务 claim；trigger acceptance 幂等；restart 后重投未绑定 run trigger | restart、duplicate callback、crash-window integration tests |
| 可维护性 | 单一 gateway contract、两 adapter、共享 delivery handler；不复用语义不符的 maintenance port | dependency-cruiser、architecture tests、semantic review |
| 可测试性 | clock、id generator、Cron service client、delivery port 可注入；本地 SQLite 使用临时文件 | unit/contract/integration/e2e |
| 审计/可追溯性 | task/trigger/requestRun 稳定引用和安全状态可关联；prompt 不进入 telemetry | observability assertions、e2e timeline assertions |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| Tool schema、scope 与 safe dependency | 2.1-2.3 | agent-capability Cron tests |
| durable gateway contract 与 scoped idempotency | 1.1-1.3 | contract tests |
| LOCAL SQLite restart、batch 与 claim | 3.1-3.3 | gateway-local integration tests |
| REMOTE adapter validation/error mapping | 4.1-4.2 | gateway-remote tests |
| HMAC/freshness/replay/scope | 5.1-5.3 | callback contract/security tests |
| 标准 runtime lifecycle、same-session、terminal | 6.1-6.3 | kernel characterization + e2e |
| local/remote selection fail-fast | 7.1-7.2 | configuration contract/architecture tests |
| Tool Calling 与到期执行产品路径 | 8.1-8.2 | release e2e tests |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/cron-tools/spec.md` 主承载；三个修改 capability 只承载各自新增行为。
- 架构和跨模块设计：`openspec/designs/architecture/cron-task-execution.md` 主承载 Record、port、状态/幂等、local/remote flow 和 callback 接口语义。
- 模块设计：受影响模块文档只记录职责、非职责、依赖和实现入口，不重复状态机。
- ADR：`openspec/designs/adr/cron-scheduling-boundary.md` 主承载双 adapter 与 lifecycle ownership 取舍。
- 导航：`openspec/designs/spec-to-design-map.md` 连接 spec、architecture、modules、ADR 与测试。

## 风险与取舍（Risks / Trade-offs）

- [外部服务至少一次投递造成重复] -> durable trigger anchor 与 runtime acceptance idempotency 双层保护。
- [claim 后进程崩溃] -> trigger 保留 CLAIMED 且未绑定 run，重启扫描/远端重投继续 delivery。
- [每秒扫描带来 SQLite 压力] -> due/status 复合索引、批量 100；规模增长时可只替换 adapter，不改变 Tool contract。
- [使用当前 Agent version 可能与创建时配置不同] -> task 绑定 agentId 而非冻结 assembly；每次独立 request 在 acceptance 时固化当时版本，符合“未来周期任务使用当前发布配置”的产品语义。
- [callback secret 轮换] -> credential resolver 支持当前与前一 secret 的短期重叠由部署配置完成，contract 不暴露 secret。

## 迁移计划（Migration Plan）

1. 先合入 contract、LOCAL tables 与 adapter，默认产品 composition 使用 LOCAL durable gateway。
2. 再合入 remote adapter/callback route；只有显式 remote selection 才启用。
3. 删除产品路径 `Map` store，只保留测试 fixture。
4. 回滚时停止 scheduler/callback intake，再回滚应用；SQLite 表保留，不做破坏性 down migration。当前进程内任务不迁移。

## 归档前更新基线（Baseline Promotion Plan）

- specs：合并 `cron-tools` 及三个 capability delta。
- `openspec/overview.md`：记录周期运维任务与两种部署模式。
- `openspec/designs/architecture/cron-task-execution.md`：提炼稳定跨模块流程、contract、state/idempotency、安全与恢复。
- modules：更新 agent-contracts、agent-capability、gateway-local、gateway-remote、agent-runtime、agent-app。
- `openspec/designs/adr/cron-scheduling-boundary.md`：记录 scheduler/backend 与 runtime owner 分离决策。
- `openspec/designs/spec-to-design-map.md`：补导航和验证入口。

## 待确认问题（Open Questions）

无。首版容量、callback freshness、local scan 与 batch 数值已在本设计收敛。

## Addendum: eager Cron disclosure

`Cron` is a default operational control Tool, not a search-discovered integration. Its Tool definition therefore declares `disclosurePolicy.mode=EAGER`. The checked-in LOCAL default system configuration selects the SQLite-backed `cron-tasks` gateway so the eager descriptor is executable at startup. Tool availability remains dependency-gated: deployments that omit the Cron adapter keep the descriptor unavailable and filtered from the model surface. This changes neither ToolSearch's generic metadata-query contract nor Cron's gateway, scope, or persistence boundaries.

## Addendum: Cron safe observation and audit projection

Cron 不新增 runtime timeline event vocabulary。Tool create/delete 在 durable gateway mutation 成功后，由 `agent-capability` 的窄适配器向 app 提交只包含可信 owner/agent/session/requestRun scope、operation 和 task reference 的 mutation fact；`agent-app` 仅调用 `agent-observability` 拥有的 Cron observation adapter，不自行构造 observation shape。trigger delivery 在 runtime acceptance 与 trigger binding 成功后，从 authoritative request-run store 读取 acceptance 时固化的 `agentVersion`，再发出包含 task、trigger、requestRun 和 session stable refs 的 observation。

Audit projector 显式映射 `CRON_TASK_CREATED`、`CRON_TASK_DELETED` 和 `CRON_TRIGGER_ACCEPTED`，允许 create/delete/trigger acceptance 使用其 authoritative requestRun；attributes 仅投影稳定 task/trigger/session reference、operation、outcome、agentVersion 和 safe reason。prompt、模型输出、raw callback、credential、vendor error 与路径既不进入 mutation fact，也不进入 observation/audit。projection 为 advisory，失败不得改变 Cron CRUD、delivery 或 terminal commit 结果。

## Addendum: Cron LUI safe result projection

Cron 的普通 JSON 结果继续使用 canonical `CAPABILITY_RESULT_DELTA`，不使用面向 CLIP 结构化消息的 `TOOL_STRUCTURED_DELTA`。`agent-channel-common` 按 `capabilityId=Cron` 和 `action=create|list|delete` 生成 action-aware safe projection；create/delete 只暴露稳定 task 引用及必要状态，list 最多暴露 50 个 task 的 id、cron、humanSchedule、recurring，并附带真实总数和截断状态。task prompt 来自 Tool 参数和 durable execution content，不进入 LUI stream projection。未知 action 或缺少必需字段时 projection fail closed，保留 capability lifecycle 事件但不复制 raw result。

## 长期基线刷新计划

本节将旧模板的“归档前更新基线”归一为可审计的归档门禁；以下均为**归档前待执行**，不表示 stable baseline 已刷新。

- **Function：**以 `FN-10.9-Cron工具` 为唯一用户可见行为 owner；若本 change 增加的行为不能被该 Function 的既有边界完整表达，先在同一能力域新增一个单一职责 Function，再更新 `openspec/designs/functions/index.md`，不得把实现细节直接写入 Function。
- **Stable spec：**将 delta Requirement 合并至 `openspec/specs/builtin-tool-framework/spec.md`、`openspec/specs/cron-tools/spec.md`、`openspec/specs/gateway-configuration/spec.md`、`openspec/specs/ts-minimal-agent-kernel/spec.md`，逐条核对 Requirement 标题、MUST/SHALL 语义、场景、迁移和 metadata；不得以 `--skip-specs` 绕过同名 Requirement 重叠。
- **长期设计：**先执行本 design/proposal 已列出的“归档前更新基线”设计 owner；再在 `openspec/designs/spec-to-design-map.md` 为上述 stable spec 写入该 Function、实际承载的 architecture/module/ADR 与验证入口。若现有 map 无该 spec 行，先创建该行，而非把 change-local design 当作长期设计。
- **归档判定：**Function、stable spec、长期设计和 map 四端均完成 diff 审阅且 `openspec validate --all --strict` 通过后，才允许归档；任一端无法唯一归属时保留 active 并标记阻塞。
