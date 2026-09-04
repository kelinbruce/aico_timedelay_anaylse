## 背景和现状（Context）

当前 `AgentDefinition.workspaceFiles` 由 `agent-app` parser 校验，compiler 将 `readDirectories`、`writeDirectories`、`maxTextBytes` 编译到 runtime-facing `AgentAssembly.workspacePolicy.files`。`agent-capability` 的 `createWorkspaceFilePort` 按 accepted Agent/version 解析并缓存该策略，Read、Glob、Grep、Write、Edit 均通过同一个 `WorkspaceFilePort` 执行路径、目录、symlink 和文本大小约束。

现有策略没有文件后缀维度。把限制放在 Tool schema 会允许模型输入影响 authority；分别放到五个 Tool execute 方法会产生规则漂移，并让 Glob/Grep 成为文件名或内容泄露旁路。该变更涉及可信配置和 capability 安全边界，必须保持 Agent Scope 固化、兼容缺省配置、保持 frozen runtime-facing Agent contract 不变并提供可复现的 negative case。

当前代码与目标 spec 的 gap 是：Agent definition/parser、app-private policy compiler 和 `ResolvedWorkspaceFilePolicy` 均无 extension 字段，所有文件 Tool 仅执行目录授权。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 允许每个 Agent 独立配置读取类和写入类文件 Tool 可访问的最终文件后缀。
- 在 capability-owned `WorkspaceFilePort` 单点执行策略，覆盖 Read/Glob/Grep/Write/Edit，消除旁路。
- 保持未配置 Agent 的现有行为；明确区分缺省（unrestricted）与空数组（deny all）。
- 使用跨平台、低歧义、可黑盒验证的匹配语义，并在访问文件事实之前 fail closed。
- 保持 Write/Edit 既有 full-Read snapshot 不变量。

**非目标：**

- 不增加路径级黑白名单、MIME/content sniffing、magic-byte 检测、复合后缀或 glob 后缀规则。
- 不限制 Bash/Python 等 sandbox 内部的文件访问；它们继续由 sandbox filesystem authority 治理。本 change 仅约束内建文件 Tool Calling。
- 不改变目录、root、symlink、文件大小、分页、snapshot 和原子替换语义。
- 不把 extension authority 暴露为 Web API、runtime command、Tool input 或客户端 metadata。
- 不阻止 Skill projection、large-content externalization 等 capability 内部受信文件写入；这些产物被模型读取时仍受读取后缀策略约束。

## 设计决策（Decisions）

### D1. 读取和写入各使用一组可选 allowlist/denylist

现有 `WorkspaceFilesDefinition` 增加以下字段；`agent-app` 将其编译为私有 policy，通过按 Agent/version 精确解析的 provider 注入 `WorkspaceFilePort`，不写入 runtime-facing `AgentWorkspaceFilePolicy`：

```ts
readonly readAllowedExtensions?: readonly string[];
readonly readDeniedExtensions?: readonly string[];
readonly writeAllowedExtensions?: readonly string[];
readonly writeDeniedExtensions?: readonly string[];
```

每类操作按一个确定函数求值：

1. 后缀命中 denylist：拒绝。
2. 未命中 denylist 且 allowlist 为 `undefined`：允许。
3. allowlist 已配置：仅命中 allowlist 时允许，否则拒绝。

allowlist 与 denylist 均为 `undefined` 时 unrestricted；显式 `allowlist=[]` 时 deny all。denylist 优先保证黑名单中的后缀不会被同一策略的白名单重新授权。生产配置使用明确文本清单，例如 `.txt`、`.md`、`.yaml`、`.yml`、`.json`、`.log`。选择四个扁平字段而不是按五个 Tool 分别配置，既让 Read/Glob/Grep 共享读取 authority、Write/Edit 共享写入 authority，又不引入 frozen contract 字段。

读取与写入策略独立，compiler 不做隐式并集。新文件 Write 只需满足写入策略；覆盖已有文件的 Write 和 Edit 还必须先通过读取策略建立既有 full-Read snapshot。这样显式读取 denylist 不会被写入 allowlist 反向扩权。

### D2. 配置只接受规范形式，目标匹配大小写不敏感

parser 接受匹配 `^\.[a-z0-9]+$` 的唯一条目，拒绝大写、复合字符串 `.tar.gz`、glob、路径分隔符和重复项。严格输入避免多个配置写法表达同一 authority，便于审计和缓存比较。

目标路径先经现有 model path normalization 和 root resolution，再对 basename 使用 Node `extname` 取得最终后缀并执行 ASCII lowercase。`.env` 和 `README` 视为无后缀；`archive.tar.gz` 的后缀为 `.gz`；`CELL.JSON` 与配置 `.json` 匹配。既有路径安全规则仍先拒绝尾随点等非法路径语法，extension policy 不覆盖该拒绝。选择最终后缀精确匹配而不支持复合后缀/glob，是为了保持唯一、跨平台且不受文件内容影响的语义。

### D3. `WorkspaceFilePort` 是唯一 enforcement owner

`agent-app` 负责输入校验、私有 policy 编译和 provider composition；`agent-contracts/agent-assembly` 保持不变；`agent-capability` 的 workspace-files 实现负责运行期 enforcement。Tool descriptor 和 Tool input schema 不增加字段。

`ResolvedWorkspaceFilePolicy` 为四个 optional 数组分别保存预构建的 `ReadonlySet<string>`，保留 allowlist 的 `undefined` 与空集合差异；缺省 denylist 可归一为共享空集合。新增纯函数按 D1 顺序解析最终后缀并判定授权。Read/Write/Edit 在 `resolveTarget` 后、任何 `stat`/snapshot/content access 前调用；Glob/Grep 在候选 Dirent 已知为文件后、加入结果或打开文件前调用。

该策略应用于所有模型可调用文件 Tool 的文件目标，包括 `workspace/`、只读 `shared-data/` 和已授权 `.nextagent/skills/...` 资源。内部 `projectSkillResources`、externalizer 等不经过上述 Tool 操作的方法，不调用 extension guard。

### D4. 拒绝形态复用既有安全结果

Read 对未授权后缀返回既有 `FILE_UNAVAILABLE` degraded result，保持与缺失/越权文件不可区分。Write/Edit 返回 `CAPABILITY_PATH_REJECTED` authorization failure，但将该特定 extension-policy 拒绝标记为可恢复，使 tool loop 把安全错误 observation 交给模型并继续下一轮；其他路径越权仍保持 terminal authorization failure。检查必须早于存在性、snapshot 和字符串匹配。Glob 静默省略未授权文件，Grep 在读取和扫描预算计数前跳过未授权候选。

For a recoverable Write/Edit extension-policy rejection, `agent-core` SHALL also emit the existing `CAPABILITY_RESULT_DELTA` before `CAPABILITY_COMPLETED`, correlated with the rejected invocation by the same `toolCallId`. The result delta and completion projection SHALL contain only the existing safe failure projection (`status`, `safeErrorCode`, `safeErrorCategory`, and a non-sensitive `safeSummary` that identifies the failure as workspace extension-policy rejection); `agent-channel-common` and `agent-web` SHALL reuse their existing result projection path to attach that failure to the corresponding Tool Calling display. This is an emission-path correction only: it adds no stream event type, payload field, or frozen contract change.

不新增包含目标后缀、物理路径或 policy 内容的日志、metric、trace 或 safe details。现有 capability invocation 轨迹足以表明调用失败，不增加高基数观测字段。

### D5. Agent/version cache key 和配置生命周期不变

继续使用 `${agentId}:${agentVersion}` 缓存已解析 policy；新增集合随同现有目录和 size policy 一次解析。accepted run 通过 assembly registry 获取固化 Agent/version，禁止回退至 default route assembly。无 persistence 或迁移状态。

放弃的方案：

- 在每个 Tool schema 中增加 `allowed_extensions`：authority 可被模型控制，违反可信配置边界。
- 在 Tool wrapper 按 capability name 拦截：需要解析不同输入 shape，且无法在 Grep 打开文件前可靠过滤。
- 只约束 Read/Write/Edit：Glob/Grep 会泄漏未授权文件名或内容。
- MIME/content 检测：需要读取文件后才能授权，成本更高且无法安全处理新文件 Write。
- 仅提供 allowlist：无法满足运维显式排除少量高风险后缀、其余保持兼容的需求。
- 仅提供 denylist：无法表达严格最小权限模式。
- allowlist 优先：会使同时出现在 denylist 中的后缀重新获权，违反 deny 必须生效的不变量。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | authority 仅来自可信 Agent definition；denylist 始终优先；路径解析后、文件访问前执行；覆盖枚举和内容搜索旁路；拒绝不泄漏存在性、路径或内容；Agent/version cache 隔离 | parser/compiler negative tests、四种列表组合与冲突优先级测试、五个 Tool 黑盒 negative tests、跨 Agent cache test、模型语义 review |
| 性能/容量 | 每个直接操作增加一次 basename/extname 与 Set lookup；Glob/Grep 在打开文件前 O(1) 过滤，反而减少受限场景 I/O；列表随配置大小存在，但 parser 去重且 Agent 配置本身为受信有界工件，本 change 不新增独立容量上限 | capability unit tests；code review 确认 Set 在 policy resolution 时构建而非逐文件构建 |
| 可靠性/恢复 | policy 是不可变 assembly 事实，无持久化和部分提交；未配置保持兼容；Write/Edit 拒绝发生在 mutation 前，失败不产生 side effect | create/overwrite/edit 原文件不变断言、兼容性 characterization tests、`npm test` |
| 可维护性 | 单一 config shape、单一 runtime policy、单一 extension helper 和两类 authority，避免五套规则；不改变 Tool input contract | architecture lint、contract build、模型语义 review |
| 可测试性 | 最终后缀解析为纯函数；port 级测试可用临时 workspace 验证文件 I/O 是否发生；显式覆盖 undefined/empty/case/dotfile/multi-suffix | parser/compiler tests、read/write/edit/glob/grep tests、contract tests |
| 审计/可追溯性 | Agent definition 和 compiled assembly 可追溯配置来源；拒绝复用现有 capability outcome，不记录后缀或路径，避免高基数与敏感信息 | observability regression tests、review 确认无新 raw path/policy logging |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| 四个配置字段、规范格式、undefined/empty、重复项和 allow/deny 同值语义 | 1.1、1.2 | `agent-definition-parser` 与 compiler 单元测试；`npm run test:contract` |
| app-private policy 固化且不跨 Agent/version，frozen contract 不变 | 1.2、2.1 | contracts diff、composition tests、policy cache isolation test |
| deny-first 判定与读取/写入策略独立 | 2.1、2.2 | workspace policy resolution truth-table tests |
| Read 在访问前安全拒绝，大小写/无后缀/多后缀一致 | 2.3、3.1 | `read-capability.test.ts` 及 workspace port negative tests |
| Glob 不泄漏且过滤先于结果配额 | 2.4、3.1、3.4 | Glob 黑盒测试，包含超过结果上限的未授权候选 |
| Grep 不读取未授权文件且不计扫描预算 | 2.5、3.1、3.4 | Grep 黑盒测试和 inspected/read bytes 边界测试 |
| Write/Edit 在存在性与 snapshot 前拒绝且无 side effect | 2.6、2.7、3.3、3.4 | write/edit capability negative tests，断言错误码和文件未变 |
| extension-policy 拒绝作为 Tool observation 返回、投影到对应 Tool Calling result 且 Agentic loop 继续 | 2.3、2.6、2.7、3.6、3.7 | tool-loop 黑盒测试断言同一 `toolCallId` 的安全 result delta；前端 projection 测试断言错误挂载到对应 Tool Calling；拒绝后模型再次调用允许文件并完成 request |
| 内部文件操作不被阻止，模型读回仍受限 | 3.2 | Skill projection/large-content externalizer characterization tests |
| 架构、构建、全量回归和 OpenSpec 一致性 | 4.1、4.2 | build/test/contract/architecture/OpenSpec commands 与 semantic review |

## 文档承载决策（Documentation Ownership）

- 行为契约：各 delta 对应的 `openspec/specs/app-config-schema`、`agent-package-assembly`、`read-tool`、`glob-tool`、`grep-tool`、`write-tool`、`edit-tool` 是唯一行为主承载。
- 架构和跨模块设计：`openspec/designs/architecture/configuration-boundary.md` 主承载 trusted Agent config 到 runtime policy 的流转和安全边界。
- 模块设计：`openspec/designs/modules/agent-app.md` 主承载 parser/compiler 职责；`openspec/designs/modules/agent-capability.md` 主承载 `WorkspaceFilePort` enforcement 与内部操作边界。
- ADR：`openspec/designs/adr/workspace-file-extension-authority.md` 主承载 allowlist/denylist、deny-first、最终后缀、缺省兼容、读写策略独立与备选方案取舍。
- 导航：`openspec/designs/spec-to-design-map.md` 仅提供 spec、design 和验证入口映射，不重复规则。

## 风险与取舍（Risks / Trade-offs）

- [同一后缀同时进入 allowlist 和 denylist 容易让运维误判] -> 接受该配置以支持集中策略叠加，但固定 deny-first，并在配置文档和测试中明确冲突结果。
- [写入策略允许但读取策略拒绝，导致已有文件无法覆盖或 Edit] -> 保留显式最小权限，不做隐式扩权；用户文档明确已有文件写操作需要同时获得读取授权，新文件 Write 不受 snapshot 前置条件影响。
- [允许 `.txt` 后仍无法区分普通文本与敏感同后缀文件] -> 后缀策略是目录/root 策略上的附加最小权限，不替代目录隔离、owner scope 或内容安全；本期不引入读取后 MIME 检测。
- [启用策略后 tool-results、Skill scripts 或 generated Skill manifest 无法被模型读取/修改] -> 配置文档列出所需 `.txt`、`.md`、脚本后缀；内部产物生成不失败，读取拒绝清晰且可通过配置回滚。
- [大小写不敏感可能在 Linux 上把 `.JSON` 也视为 `.json`] -> 这是刻意选择的跨平台文件类型语义，避免同类文件通过大小写旁路。
- [把后缀字段放入 frozen `AgentWorkspaceFilePolicy` 会影响消费者] -> 后缀 policy 保持为 `agent-app`/`agent-capability` 私有结构，通过 composition provider 精确注入；`packages/agent-contracts` 零改动。

## 发布、兼容与回滚计划

1. 先发布 optional Agent definition 配置、私有 compiler/provider 和 port enforcement；所有现有 Agent 因字段缺省保持当前行为。
2. 运维按 Agent 逐步增加 denylist 或 allowlist；先用 denylist 排除少量高风险类型，再按需要启用 allowlist 最小权限，并在测试 Agent 验证 Read/Glob/Grep/Write/Edit 和 tool-results/Skill resource 路径。
3. 回滚单个 Agent 时移除四个字段即可恢复 unrestricted 后缀行为；代码回滚不需要数据迁移。

不涉及数据库、gateway persistence、session/run durable fact 或 API 状态。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/app-config-schema/spec.md`、`agent-package-assembly/spec.md`、`read-tool/spec.md`、`glob-tool/spec.md`、`grep-tool/spec.md`、`write-tool/spec.md`、`edit-tool/spec.md`：合入可验证行为。
- `openspec/overview.md`：提炼 Agent workspace 文件类型最小权限背景。
- `openspec/designs/architecture/configuration-boundary.md`：提炼 config → assembly policy → capability enforcement 流程和 authority 边界。
- `openspec/designs/modules/agent-app.md`：记录配置校验、规范化和编译职责。
- `openspec/designs/modules/agent-capability.md`：记录统一 extension guard、五个 Tool 消费关系和内部操作例外。
- `openspec/designs/adr/workspace-file-extension-authority.md`：保留 D1、D2、D3 的长期决策和被放弃方案。
- `openspec/designs/spec-to-design-map.md`：更新 capability 到上述文档、测试与命令的导航。

## 待确认问题（Open Questions）

无。

## 长期基线刷新计划

本节将旧模板的“归档前更新基线”归一为可审计的归档门禁；以下均为**归档前待执行**，不表示 stable baseline 已刷新。

- **Function：**以 `FN-5.3-读写编辑文件` 为唯一用户可见行为 owner；若本 change 增加的行为不能被该 Function 的既有边界完整表达，先在同一能力域新增一个单一职责 Function，再更新 `openspec/designs/functions/index.md`，不得把实现细节直接写入 Function。
- **Stable spec：**将 delta Requirement 合并至 `openspec/specs/agent-package-assembly/spec.md`、`openspec/specs/app-config-schema/spec.md`、`openspec/specs/edit-tool/spec.md`、`openspec/specs/glob-tool/spec.md`、`openspec/specs/grep-tool/spec.md`、`openspec/specs/read-tool/spec.md`、`openspec/specs/write-tool/spec.md`，逐条核对 Requirement 标题、MUST/SHALL 语义、场景、迁移和 metadata；不得以 `--skip-specs` 绕过同名 Requirement 重叠。
- **长期设计：**先执行本 design/proposal 已列出的“归档前更新基线”设计 owner；再在 `openspec/designs/spec-to-design-map.md` 为上述 stable spec 写入该 Function、实际承载的 architecture/module/ADR 与验证入口。若现有 map 无该 spec 行，先创建该行，而非把 change-local design 当作长期设计。
- **归档判定：**Function、stable spec、长期设计和 map 四端均完成 diff 审阅且 `openspec validate --all --strict` 通过后，才允许归档；任一端无法唯一归属时保留 active 并标记阻塞。
