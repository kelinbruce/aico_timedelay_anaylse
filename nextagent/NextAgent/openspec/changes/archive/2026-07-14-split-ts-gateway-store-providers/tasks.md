## 1. Gateway contracts

- [x] 1.1 在 `agent-contracts/gateway` 定义完整的 `WorkingMemoryGatewayBindings`，包含本 change 指定的 11 个 stores，并补充 shape contract test。
  验证：`npm run test:contract -- --runInBand` 或仓库等价 contract test 命令，断言字段完整且非 optional。
  来源：`Gateway stores have one capability provider owner`、design decision 2。
- [x] 1.2 定义完整的 `LongTermMemoryGatewayBindings`，确保 store 与 retriever 只能作为同一 binding 提供，并补充 shape contract test。
  验证：`npm run test:contract -- --runInBand` 或仓库等价 contract test 命令。
  来源：`Long-term Memory owns storage and retrieval consistency`、design decision 2。
- [x] 1.3 将保留 stores 收缩为 `SqliteGatewayStoreBindings`，删除原通用 `GatewayStoreBindings`/`stores` contract 和 compatibility alias。
  验证：`npm run build`；contract test 断言保留 binding 只含规格列举的 7 个 public stores。
  来源：`Gateway stores have one capability provider owner`、design decision 2。
- [x] 1.4 更新 `GatewayAdapterKind` 与 `GatewayBindings` 顶层字段，使 `working-memory`、`long-term-memory` 和 `sqlite` 分别映射到唯一 binding key。
  验证：`npm run build`；gateway contract tests。
  来源：`Validation follows deterministic rule order`、design decisions 1-2。

## 2. Provider registry and composition

- [x] 2.1 将 provider resolution 改为按每个 selected entry 的 `deploymentMode + adapterKind` 精确匹配，并按 provider identity 聚合后各调用一次 `create`。
  验证：运行 `packages/agent-app` gateway composition tests，覆盖同一 deployment mode 下三个 persistence providers 同时成功解析。
  来源：`Gateway registry resolves selected providers per gateway entry`、design decision 3。
- [x] 2.2 实现 missing、ambiguous、deployment mismatch 和 unsupported adapter 的 fail-closed 校验。
  验证：negative composition tests 实际构造零匹配、双匹配、mode mismatch 和 unsupported kind，并断言启动失败及 safe error code。
  来源：`Gateway registry resolves selected providers per gateway entry`、`Validation follows deterministic rule order`。
- [x] 2.3 实现 capability binding 完整性、unselected binding 和重复顶层 binding conflict 校验。
  验证：negative composition tests 实际返回缺字段、额外 binding 和重复 binding，并断言 ready 前失败。
  来源：`Provider bindings are capability-complete and implementation-neutral`、design decision 3。
- [x] 2.4 在 `agent-app` 从三个已校验 bindings 显式构造内部 `AppGatewayStores`，删除 `Required<GatewayStoreBindings>`、额外属性 cast 和 facade 逃逸。
  验证：`npm run build`；composition tests；code review 检查 public exports 不包含内部 aggregate。
  来源：`Provider bindings are capability-complete and implementation-neutral`、design decision 2。
- [x] 2.5 更新 local/remote reference provider binding assembly 和 close lifecycle，使每个 provider 只创建 selected capabilities 并保留独立 readiness evidence。
  验证：local/remote gateway provider tests，断言 unselected factory 不执行且所有 selected provider 只关闭一次。
  来源：`Gateway registry resolves selected providers per gateway entry`、质量属性“审计/可追溯性”。

## 3. Trusted configuration and paths

- [x] 3.1 在 frozen `SystemPaths` 中从 `workspaceRoot` 派生 `workingMemorySqliteFile` 和 `longTermMemorySqliteFile`，保留 `sqliteFile` 给保留 provider。
  验证：`packages/agent-app` path/config tests 断言三个绝对路径精确位于 `data/system`。
  来源：`Built-in defaults and user application config compose into two frozen roots`、design decision 6。
- [x] 3.2 拒绝用户 config 对任一内部 SQLite 路径的覆盖，并将三个文件父目录纳入 execution/shared-root overlap 校验。
  验证：negative config tests 分别提交三个 path 字段和 overlap/symlink case，断言 safe fail closed。
  来源：`Built-in defaults and user application config compose into two frozen roots`、质量属性“安全”。
- [x] 3.3 更新 default gateway selection 为 LOCAL `working-memory`、`long-term-memory`、`sqlite` 及既有必要 entries，并更新 frozen snapshot/schema validation。
  验证：config tests 覆盖省略 gateway section 与显式默认 entries 结果一致。
  来源：`Gateway configuration is loaded and stabilized during startup`。
- [x] 3.4 更新 test composition、local runtime package 和 lifecycle cleanup，为每次测试创建并清理三个隔离 SQLite 文件。
  验证：相关 composition/lifecycle tests；测试结束后断言三个文件句柄均已关闭并可删除。
  来源：design decisions 4、6，质量属性“可测试性”。

## 4. Working Memory local provider

- [x] 4.1 创建 `SqliteWorkingMemoryCore`、完整 store bundle 和只支持 `working-memory` 的 local provider factory。
  验证：Working Memory provider unit test 断言 11 个 stores 完整、readiness 正确且 close 幂等。
  来源：`Gateway stores have one capability provider owner`、design decisions 1、4。
- [x] 4.2 将 requestRuns、messages 和 timeline 的 SQL、row mapping、幂等锚点及 terminal composite transaction 迁入 Working Memory core。
  验证：terminal commit characterization/fault tests 断言全成功或全回滚，无部分可见结果。
  来源：`Working Memory preserves request and session transaction boundaries`。
- [x] 4.3 将 sessions、activeContext、sessionForks、conversationAnnotations 和 conversationShares 的 SQL、row mapping 和复合事务迁入 Working Memory core。
  验证：session create/fork/annotation/share tests；session cascade fault test 断言 annotation/share 与 session 同事务删除。
  来源：`Working Memory preserves request and session transaction boundaries`、design decision 5。
- [x] 4.4 将 attachments metadata、checkpoints 和 pendingInputs 的 SQL、row mapping、恢复/CAS 行为迁入 Working Memory core。
  验证：attachment metadata、checkpoint recovery、pending-input suspend/resume tests。
  来源：`Gateway stores have one capability provider owner`、design decision 5。
- [x] 4.5 为 Working Memory schema 建立 table inventory 测试，断言不得出现 long-term-memory 或保留 SQLite 业务表。
  验证：integration test 查询 `sqlite_schema`，对 forbidden table 集合逐项断言不存在。
  来源：`Local capability providers use isolated SQLite ownership`。

## 5. Long-term Memory and retained SQLite providers

- [x] 5.1 创建 `SqliteLongTermMemoryCore`、store/retriever bundle 和只支持 `long-term-memory` 的 local provider factory。
  验证：Long-term Memory provider unit test 断言 store/retriever 完整、同 core 且 close 幂等。
  来源：`Long-term Memory owns storage and retrieval consistency`、design decisions 1、4。
- [x] 5.2 将 long-term-memory rows、lifecycle writes、FTS/index、fallback 和 retrieval SQL 迁入 Long-term Memory core，并保持 owner/agent scope。
  验证：memory core、retrieval、FTS fallback、scope isolation tests。
  来源：`Long-term Memory owns storage and retrieval consistency`、质量属性“可靠性/恢复”。
- [x] 5.3 建立 `SqliteResidualGatewayCore`/stores/provider，只暴露 attachmentReservations、blobs、trajectory、todo、userQuestionActivity 和 audit。
  验证：保留 SQLite provider tests；TypeScript contract 确保不再暴露已迁移 stores。
  来源：`Gateway stores have one capability provider owner`、design decision 4。
- [x] 5.4 为 Long-term Memory 和保留 SQLite 文件建立 table inventory tests，分别断言只包含 owner tables 且没有跨 owner schema。
  验证：integration tests 查询两个文件的 `sqlite_schema` 并实际断言 forbidden tables 不存在。
  来源：`Local capability providers use isolated SQLite ownership`。
- [x] 5.5 保持 attachment metadata 与 blob/reservation 分阶段写、幂等和 rollback 补偿行为，不新增跨 provider transaction。
  验证：运行 `agent-attachment-runtime` intake/cleanup characterization tests，覆盖 blob 已写但 metadata 保存失败的回滚场景。
  来源：design decision 5、风险“attachments 与 blob/reservation 分库”。

## 6. Integration and architecture verification

- [x] 6.1 补充 LOCAL 三 provider 端到端 composition test，证明 app consumers 获得完整 stores 且 provider readiness 可追溯。
  验证：`packages/agent-app` composition integration tests。
  来源：`Gateway stores have one capability provider owner`、质量属性“审计/可追溯性”。
- [x] 6.2 补充 provider isolation negative tests，证明 `sqlite` 不会在 Working Memory/Long-term Memory 缺失时充当 fallback。
  验证：启动仅配置 `sqlite` 的 test app，断言 ready 前失败。
  来源：`Validation follows deterministic rule order`。
- [x] 6.3 补充三文件首次启动和任一文件初始化失败 tests，证明不读取旧单库且不会回退或合并 ownership。
  验证：local integration tests 使用空 workspace 和不可创建目标文件，分别断言三文件布局与 fail closed。
  来源：`Local capability providers use isolated SQLite ownership`、迁移计划。
- [x] 6.4 运行并补齐 runtime terminal、session lane、retry/edit、recovery、pending input 和 session delete characterization tests。
  验证：相关 package tests 与 `tests/agent-kernel` 定向测试全部通过。
  来源：`Working Memory preserves request and session transaction boundaries`、验证门禁。
- [x] 6.5 运行并补齐 memory write/retrieval/extraction/maintenance tests，证明 provider 拆分不改变 memory core 行为。
  验证：`agent-memory` 及相关 memory package tests 全部通过。
  来源：`Long-term Memory owns storage and retrieval consistency`。
- [x] 6.6 增加 architecture assertions，禁止领域 packages import local/remote provider private paths，并禁止三个 SQLite core 实例共享连接、文件、transaction object 或跨 owner composite transaction。
  验证：`npm run lint:architecture`；negative fixture 实际引入 forbidden dependency 并断言规则失败。
  来源：`Provider bindings are capability-complete and implementation-neutral`、design decision 4。

## 7. Final gates

- [x] 7.1 运行 workspace build 并清理本 change 产生的未使用 exports、casts 和兼容 facade。
  验证：`npm run build`；`git diff --check`。
  来源：proposal breaking scope、实现质量门禁。
- [x] 7.2 运行全部 unit tests，确认三个 provider 下产品路径无行为回退。
  验证：`npm test`。
  来源：proposal 影响范围、minimal kernel non-regression。
- [x] 7.3 运行全部 contract 和 architecture tests。
  验证：`npm run test:contract`；`npm run lint:architecture`。
  来源：验证门禁、design verification map。
- [x] 7.4 严格验证全部 OpenSpec artifacts。
  验证：`openspec validate --all --strict`。
  来源：规格优先门禁。
- [x] 7.5 push 前执行 `$nextagent-code-review`，覆盖 Frozen core contract、Architecture boundary、Minimal kernel、Security、OpenSpec consistency 和 Clean Code；P0/P1 必须修复并重新检视。
  验证：模型语义检视结论为 PASS 或 PASS WITH FOLLOW-UP，记录可追踪的 P2 follow-up。
  来源：AGENTS.md Push 门禁。

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，归档前按 proposal/design 的 Baseline Promotion Plan：

- 同步 `gateway-store-provider-ownership`、`gateway-configuration` 和 `app-config-schema` stable specs。
- 更新 `openspec/overview.md` 中 capability 与存储实现解耦的长期背景。
- 更新 `core-contracts.md`、`runtime-boundaries.md`、`memory.md` 和 `configuration-boundary.md`。
- 更新 `agent-app.md`、`agent-platform-gateway-local.md` 和 `agent-platform-gateway-remote.md`。
- 更新 `openspec/designs/spec-to-design-map.md` 的导航和验证入口。
- 不新增 ADR；检查长期文档未重复定义 binding shape、store owner 或事务语义。
