## 设计范围

| Function | 目标变化 | delta spec | 设计章节 |
|---|---|---|---|
| `FN-10.32 管理插件开发诊断产物` | 将 active destination 从 writer 构造期延迟到首条合法记录写入期，同时保持历史文件 lifecycle 有界，并收敛无配置开关的状态语义 | `plugin-developer-diagnostic-artifacts` | [FN-10.32 管理插件开发诊断产物](#fn-1032-管理插件开发诊断产物) |

## FN-10.32 管理插件开发诊断产物

### 目标与规范依据

插件诊断 sink 继续默认可写，active destination 仅由首条合法记录触发；无历史成员且无记录的应用生命周期不产生文件，已有历史成员继续受有界 maintenance 管理，且不新增配置开关。

#### 本 Function 的目标 Requirements

canonical spec：`plugin-developer-diagnostic-artifacts`

- `MODIFIED`：`开发诊断记录使用独立的短期产物文件族`
- `MODIFIED`：`产物写入具有有界容量和生命周期`
- `MODIFIED`：`本地状态只暴露有界安全证据`
- `MODIFIED`：`原始调测内容与主输出面隔离`

### 当前实现

- `agent-app` 的同步和异步 composition 都会创建一个 `DeveloperDiagnosticArtifactWriter` 对象，并将其作为宿主 sink 提供给插件；该默认可写能力和 `developerDiagnosticArtifactWriterFactory` override seam 已稳定，不依赖 `deployment.mode`。
- `DeveloperDiagnosticArtifactWriter` 构造函数立即调用 `createLocalFileRoll(...)`，所以 writer 对象一经创建就异步构造物理 handle。
- `createLocalFileRoll(...)` 构造 `pino-roll` destination 时立即创建当天 active segment，并安排 startup maintenance；即使从未调用 `emit(...)`，旧的非 active segment 也会进入压缩流程。
- `start()` 等待构造期 handle；`emit(...)` 在完成记录序列化后等待同一 handle 并 enqueue；`flush()` 和 `close()` 同样使用该 handle。
- 当前 unit tests 覆盖合法写入、输入拒绝、容量策略、过载、destination 不可用、maintenance failure 和幂等关闭，但没有覆盖“零记录生命周期不创建文件”和首次并发初始化边界。
- 配置校验已拒绝 `developerDiagnostics`，但 stable spec 的状态与原始内容隔离 Requirements 仍残留 `DISABLED` 和 system config 输出开关措辞，与默认可写 sink 的稳定目标不一致。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 无已接受记录时不创建该文件族成员 | writer 构造立即创建 physical handle 和 active segment | physical handle 初始化时机过早 |
| 无历史成员且无已接受记录时不产生空压缩产物 | handle 构造创建空 active segment，后续启动会压缩该空文件 | active destination 与 maintenance lifecycle 耦合 |
| 当前进程没有新记录时历史成员仍遵守保留期限 | maintenance 只能随 destination handle 启动 | 需要不创建 destination 的共享 maintenance lifecycle |
| 第一条合法记录只初始化一个 handle 并保持现有返回语义 | 当前 handle 只有构造期单例路径，没有 lazy/concurrent first-write 路径 | 需要进程内共享的单次 lazy 初始化 |
| 非法或超限记录不产生物理文件副作用 | 序列化先于 handle await，但 handle 已在构造期创建 | 需要把 handle 创建移到序列化成功之后 |
| start/status/flush/未写入 close 无文件副作用，close 后 emit 不重新打开 | start/flush/close 均引用已创建 handle；没有“关闭但从未初始化”的私有状态 | 需要闭合 lazy handle 与关闭竞争语义 |

### 修改方案

唯一实施路径保留 `agent-app → DeveloperDiagnosticArtifactWriter → agent-local-file-roll` 的 owner 和调用边界，在共享轮转层复用同一 maintenance 实现，并由 `agent-log` writer 管理无 destination 与完整 handle 的单向切换：

1. `DeveloperDiagnosticArtifactWriter` 保存可选、进程内共享的 handle promise，不在构造函数中调用 `createLocalFileRoll(...)`。私有 `ensureHandle()` 在需要写入首条已通过序列化和容量校验的记录时以单次赋值创建该 promise；并发首次 `emit(...)` 复用同一 promise，不创建平行 destination。
2. `agent-local-file-roll` 从现有 roll handle 中提取单一 maintenance controller，并公开无 active destination 的 maintenance handle。两种 handle 复用相同 selector、reconciliation、压缩、retention、archive count、事件和定时调度，不复制扫描实现。
3. `start()` 创建无 destination 的 maintenance handle；它只处理已经存在的精确所属成员。`status()` 保持纯内存读取，`flush()` 在完整 handle 不存在时直接完成。
4. `emit(...)` 先检查 closed，再执行现有 `serializeRecord(...)`。`INVALID_RECORD` 和 `RECORD_TOO_LARGE` 继续直接返回，不创建完整 handle；合法记录关闭无 destination maintenance handle，再以共享 lazy promise 创建完整 roll handle，避免两个 scheduler 并存。初始化失败继续映射为 `OUTPUT_UNAVAILABLE`，成功后使用现有 `appendLine(...)` 和返回映射。
5. writer 使用私有 closed flag。`close()` 先标记 closed，再关闭已经存在或正在创建的 maintenance/full handle，并保持幂等；close 后任意 `emit(...)` 直接以 `OUTPUT_UNAVAILABLE` 丢弃，不执行序列化或创建 handle。
6. `agent-app` composition 和插件 host sink wiring 不修改。writer 对象仍默认装配，插件 API、配置 schema、Agent activation、物理记录 schema 和固定 file policy 均保持不变。

私有状态使用 writer 自有字段表达，不进入公共 contract：

| `isClosed` | maintenance handle promise | full handle promise | 允许的行为 |
|---|---|---|---|
| `false` | 不存在 | 不存在 | 构造后 status/flush 不创建文件；start 或首条合法 emit 进入下一状态 |
| `false` | 存在 | 不存在 | start 已挂载无 destination maintenance；首条合法 emit 先关闭它再创建唯一 full handle promise |
| `false` | 任意 | 存在 | emit/flush 复用 full handle promise；完整 handle 单独拥有文件 lifecycle |
| `true` | 任意 | 任意 | close 复用同一 close promise并关闭任一 maintenance/full handle；emit 不得序列化、创建或写入 handle |

选择 writer 内 lazy handle 而不是新增配置开关或预扫描 Agent activation：sink 的默认可写契约不变，动态 Agent assembly 和任意插件提交路径不需要被 composition 预判，同时改动仅限现有物理 writer owner。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 性能/容量 | `产物写入具有有界容量和生命周期` | 没有合法记录时不分配 destination，但复用共享 maintenance controller 持续维护历史成员；首次合法记录后切换到既有完整机制 | 无历史成员且零记录时无文件/压缩副作用；历史成员仍按期维护；首次及并发首次 emit 只创建一个完整 handle |
| 安全 | `本地状态只暴露有界安全证据`、`原始调测内容与主输出面隔离` | 状态查询不触发文件；不新增输出开关；非法/超限记录不触发物理 destination | 初始 `AVAILABLE` 不创建文件；未知配置仍 fail closed；敏感 payload 隔离保持 |

## 验证策略（Verification Strategy）

- foundation 行为测试覆盖无 destination maintenance handle 不创建 active segment、会压缩既有 closed source、持续执行 retention，并在切换或关闭时停止 scheduler。
- writer 行为测试覆盖构造、start、status、flush 和未写入 close 均不调用 full handle factory；无历史成员时不产生文件，存在历史成员时 start maintenance 仍保持有界生命周期，并覆盖首次合法 emit 创建文件和写入记录。
- unit boundary 测试覆盖非法 JSON、超限记录和 close 后任意输入不触发 full handle；并发首次合法 emit 断言只创建一个完整 handle且两条记录均沿既有 enqueue 结果返回。
- 既有 writer unit tests 继续覆盖固定 file policy、过载恢复、destination unavailable、maintenance failure 和幂等关闭，防止 lazy 初始化改变失败映射。
- composition/contract 回归确认默认 sink、配置拒绝和 Plugin host shape 未变化；architecture lint 确认没有新增 production consumer 或依赖反转。
- OpenSpec strict validation 与语义检视覆盖 canonical Requirement operation、Function 映射、无配置开关和唯一实施路径。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/plugin-developer-diagnostic-artifacts/spec.md`：修改四个 Requirements，补充首条合法记录触发和无记录无文件副作用。
- `openspec/designs/functions/D10-二次开发与平台集成/D10.1-扩展与插件/FN-10.32-管理插件开发诊断产物.md`：刷新描述、处理过程、结果和物理产物边界规格。
- Feature：无；用户价值和 Function 组成不变。
- `openspec/overview.md`：把 developer diagnostic artifact writer 描述收敛为 lazy physical handle。
- `openspec/designs/architecture/agent-plugin-composition.md`：更新默认 writer 装配与 lazy physical handle 的边界说明。
- `openspec/designs/modules/agent-log.md`：记录 writer 对首条合法记录按需创建独立 handle。
- `openspec/designs/modules/agent-local-file-roll.md`：记录无 active destination maintenance handle 与完整 roll handle 复用同一 maintenance controller 的边界。
- ADR：无；不引入新的跨模块技术决策。
- `openspec/designs/spec-to-design-map.md`：无导航变化。

## 风险与取舍（Risks / Trade-offs）

- 无 destination maintenance handle 仍会扫描既有精确所属成员并产生必要的压缩或删除；这不是空产物副作用，而是保证潜在敏感历史内容遵守既有保留期限。无历史成员时扫描不创建 active segment 或 archive。
- 首条合法 `emit(...)` 需要等待异步 handle 初始化，首条记录相较后续记录多一次 destination 创建开销。sink 本身已经是 async contract，初始化失败仍使用既有稳定 reason code，且后续记录复用同一 promise。

## 待确认问题（Open Questions）

无。
