## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-3.2 编译智能体装配` | 文件目录策略编译为 root-qualified canonical authority | `agent-package-assembly` | `FN-3.2 编译智能体装配` |
| `FN-5.3 读写编辑文件` | 普通文件别名统一为 workspace canonical identity，显式 Skill 资源保持独立受治理读取 | `file-operation-tools` | `FN-5.3 读写编辑文件` |
| `FN-5.4 搜索文件` | 缺省搜索仅覆盖 workspace，显式路径统一规范化并支持受治理 Skill subtree | `file-search-tools` | `FN-5.4 搜索文件` |

本 change 目录由 OpenSpec workflow owner 管理，只承载本次 active change 的 proposal、delta specs、design 和 tasks。其生命周期为 active → validate → implement → archive；不进入 TypeScript build artifact 或运行时加载路径，不改变部署包目录和运行时行为。该目录新增的架构评审结论为：职责、owner、生命周期、构建/打包影响和运行时影响均已在本段冻结，允许纳入版本控制。

## `FN-3.2 编译智能体装配`

### 目标与规范依据

Agent 开发者继续使用现有 `workspaceFiles` 配置形状，但运行时获得的是消除裸目录歧义的 canonical authority。缺省与显式空集合的既有权限差异保持不变。

#### 本 Function 的目标 Requirements

canonical spec：`agent-package-assembly`

- `ADDED`：`Agent 装配编译 root-qualified 文件目录权限`

### 当前实现

`agent-app` 的 `compileWorkspaceFilePolicy` 在装配期调用 `normalizeDirectories`。该函数只做路径语法规范化，保留 `.` 和普通无前缀目录；`writeDirectories` 缺省编译为 `['.']`，显式空数组保持为空，`readDirectories` 缺省保持 `undefined`。运行时 `workspace-file-port` 再次规范目录并将 `.` 解释为 execution view 根。

现有 `AgentWorkspaceFilePolicy` 已是 runtime-facing trusted source，不需要增加公共字段。目录数组的元素值属于内部编译结果，可直接切换为 canonical form。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| `.` 与普通目录编译到 workspace | 编译结果仍为 `.`、`diagnostics` | 同一配置在装配与执行阶段没有唯一含义 |
| 已知 root 与 workspace 同名目录可区分 | 现有规范化只保留输入文本 | `temp` 无法表达为“特殊 root”与“workspace 子目录”两种清晰身份 |
| 权限只编译一次并冻结 | runtime file port 再次解释 raw values | 执行层仍承担配置语义决策 |

### 修改方案

`agent-app` 保持配置 parser 和公共 `AgentWorkspaceFilePolicy` shape 不变，只修改 `normalizeDirectories` 的值映射：

| 输入目录 | canonical directory |
|---|---|
| `.`、`./`、`workspace`、`workspace/` | `workspace` |
| `diagnostics`、`./diagnostics` | `workspace/diagnostics` |
| `workspace/temp` | `workspace/temp` |
| `temp`、`.nextagent`、`generated-skills`、`shared-data` 及其后代 | 保持对应 root-qualified path |

语法校验先于映射执行；绝对路径、父级穿越、glob 和非法 segment 继续阻断装配。规范化后去重，保持首次出现顺序。`readDirectories` 缺省仍以 `undefined` 表示 runtime default，显式 `[]` 保持空；`writeDirectories` 缺省仍产生产品默认 workspace 权限，显式 `[]` 保持空。该方案不改变配置 schema、Agent Scope 选择或 registry refresh 行为。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 安全 | 无新增黑盒质量目标；功能性 Requirement `Agent 装配编译 root-qualified 文件目录权限` | 装配期一次性校验、规范化和冻结，不接受 request-sourced authority | 非法路径在装配发布前失败，显式空集合不被默认值覆盖 |
| 可维护性 | 无新增黑盒质量目标；同上 | 配置输入到运行时权限采用单一映射表 | 同类路径不出现多套 normalization |

## `FN-5.3 读写编辑文件`

### 目标与规范依据

普通工作文件不再因 bare path 与 `workspace/...` 产生两个身份；Skill 主路径继续使用激活消息注入的显式 projection root，并且 workspace 目录权限不误伤该读取能力。

#### 本 Function 的目标 Requirements

canonical spec：`file-operation-tools`

- `ADDED`：`显式 Skill resource 读取独立于 workspace 目录权限`
- `MODIFIED`：`文件操作工具使用 execution view 默认根`
- `MODIFIED`：`workspace 是推荐的持久化写入目录`
- `MODIFIED`：`Write Uses Trusted Agent-Scoped Directory Authority`

### 当前实现

`workspace-file-paths.normalizeModelPath` 对 known root 返回 root-qualified path，对 bare path 原样返回。`selectRoot` 因而为 bare path 合成 `executionView` root，其物理路径是 workspace root 的父目录；显式 `workspace/...` 选择 workspace root。`resolveTarget` 先校验 root access，再统一使用 `isInsideDirectories` 校验路径。

Read 将 `target.modelPath` 写入 `FileSnapshotStore`；Edit 以同一字段读取 snapshot。写并发锁使用 `target.absolutePath`。因此 bare 与 workspace-qualified path 当前通常指向不同物理文件，也形成不同 snapshot key；即使部署文件布局偶然使物理目标重合，也没有由 canonical identity 保证一致。

Skill projection 已有 committed manifest、projection key、完整性检查和 scope-local cache。当前 `resolveTarget` 在验证 Skill path 后仍要求它落入通用 `readDirectories`，使 `readDirectories=[]` 或 workspace-only policy 可能拒绝已验证 Skill resource。

legacy `workspaceDir` 测试入口把参数当作 `scopeBase`，再在其下创建 `workspace/`；既有测试通过 bare path 访问传入目录本身。这个兼容入口不是生产 runtime resolver，但需要同步改成“参数就是 workspace physical root”，才能与其命名和新语义一致。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| bare 与 workspace-qualified path 同一 identity | bare path 选择 executionView 父目录 | 物理文件、结果、snapshot key 不同 |
| 输出始终 root-qualified | bare 输入原样返回 | 下游不能稳定复用唯一逻辑路径 |
| Skill 显式读取独立于 workspace dirs | Skill 验证后仍做通用目录匹配 | workspace policy 会错误阻断合法 projection |
| protected roots 不被 workspace alias 扩权 | 通用目录 `.` 可匹配全部 execution view | `.` 的旧含义范围过宽 |

### 修改方案

`agent-capability` 的 path normalization 成为文件工具唯一 canonicalization 点：known root 继续保持；`.` 和 bare segments 直接生成 `modelPath=workspace[/...]` 与相对 workspace root 的 `relativePath`。删除 synthetic `executionView` root 和默认根的 top-level 排除逻辑，`selectRoot` 只选择 resolver 提供的真实 logical roots。

`resolveTarget` 的授权顺序固定为：路径语法与 canonicalization → root 可用性与 access mode → special-root authority → canonical directory authority → link/containment 和文件操作。全部普通 root 必须匹配 compiled canonical directory；systemResources 只允许验证通过的 Skill projection，并在通过后不再套用 workspace directory authority。`temp`、`generatedSkills` 和 `sharedData` 仍同时要求显式 root-qualified directory authority 与 root access mode，不因 workspace default 获权。

Read、Write、Edit 不需要单独改 snapshot 或 lock 数据结构：它们继续消费 `ResolvedFileTarget.modelPath` 和 `absolutePath`，canonicalization 后两个 alias 自然共享 snapshot key和物理锁身份。`FileSnapshotStore` 的 public shape 与 clearRun 生命周期不变。

legacy `workspaceDir` 入口将 `resolve(options.workspaceDir)` 作为 workspace root；其仅供测试/兼容使用的其他逻辑 roots 仍按既有方式位于该目录下，避免扩大迁移范围。生产 `ExecutionWorkspaceResolver` 保持不变。Bash/Python sandbox view、default cwd 和命令路径转换不修改。

工具 descriptor 与 workspace prompt 只同步目标行为：bare ordinary path 映射 workspace、返回 canonical path、Skill 使用注入的显式 resource root。描述不得声称 Bash/Python 的 bare path 与文件工具一致。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 安全 | 无新增黑盒质量目标；功能性 Requirements | 真实 root 选择、workspace 与 Skill authority 分支、既有 link/containment 检查 | workspace alias 不授权 special roots；无效/跨 scope Skill projection fail closed |
| 可靠性/恢复 | 无新增黑盒质量目标；`文件操作工具使用 execution view 默认根` | snapshot key 和物理锁统一消费 canonical target | alias 间 stale snapshot 和并发编辑保护一致 |

## `FN-5.4 搜索文件`

### 目标与规范依据

Glob/Grep 的省略路径语义固定为 workspace；其他 root 必须由模型通过明确的、受授权路径选择，尤其 Skill 搜索使用激活消息中的 resource root。

#### 本 Function 的目标 Requirements

canonical spec：`file-search-tools`

- `MODIFIED`：`文件搜索工具使用 execution view 默认根`
- `MODIFIED`：`Glob Has A Strict Pattern And Path Contract`
- `MODIFIED`：`Glob Uses Agent-Scoped Read Authority`
- `MODIFIED`：`Grep Has A Strict Pattern And Path Contract`
- `MODIFIED`：`Grep Uses Agent-Scoped Read Authority`

### 当前实现

Glob/Grep 省略 `path` 时调用 `resolveConfiguredSearchTargets(policy.readDirectories)`；当 `readDirectories` 缺省时 runtime policy 把 `.` 加入有效读取目录。`resolveSearchTargets('.')` 展开 execution root 及部分映射 root，再做合并和去重。Glob 还支持从 root-qualified pattern 拆出 Skill path；显式 `.nextagent/skills` 会展开全部 verified roots。

遍历层已有 symlink 跳过、深度、候选数量、结果数量、全局排序与截断预算。输出路径直接使用每个 search target 的 `modelPath` 前缀。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 省略 path 只搜索 workspace | `.` 可展开 execution view 与配置授权 root | 默认边界受配置和 root 集合影响，不可预测 |
| bare path 与 workspace path 同 target | bare path 从 execution root 解析 | 搜索位置和返回前缀不同 |
| Skill 只显式搜索 | root-qualified pattern 可显式搜索，默认 discovery 同时扫描 projection metadata | 需确保 discovery 仅用于授权解析，不把 Skill target加入默认 roots |
| root-qualified canonical output | bare target 输出裸路径 | 结果身份不稳定 |

### 修改方案

Glob/Grep 省略 `path` 时仍使用 compiled effective Read authority，但 runtime policy 的缺省目录改为 `workspace`，且 `resolveConfiguredSearchTargets` 只接收 workspace canonical directories。显式 path 统一经 `normalizeModelPath`；bare path 因而选择 workspace。显式 Skill path 的 verified root discovery、manifest integrity 校验和 bounded traversal 保留；通过验证后直接构造 Skill target，不进入 workspace directory comparison。

Glob 的 root-qualified pattern 拆分能力保留，因为它是现有显式 Skill 使用方式；未包含 root-qualified prefix 的 pattern 仍在缺省 workspace targets 内匹配。Grep 不新增 pattern 路径语法。两者继续共享现有全局预算、排序、去重、symlink 和错误映射。

删除 search target 中为 synthetic execution root 服务的 `excludedTopLevelNames` 和 `modelPath='.'` 分支。workspace root target 的 `modelPrefix` 固定为 `workspace`；pattern matching 仍相对于选择的 search directory，不要求调用方在 glob pattern 中重复 `workspace/`。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 安全 | 无新增黑盒质量目标；功能性 Requirements | 默认只枚举 workspace authority，special root 需要显式路径和独立校验 | 默认搜索不泄漏 Skill/temp/shared-data；未授权显式路径拒绝 |
| 性能/容量 | 无新增黑盒质量目标；功能性 Requirements | 保留单一全局 traversal/result budget，缩小默认 root 集合 | 多 workspace 子目录去重后仍共享预算 |

## 跨 Function 协作与端到端流程

`FN-3.2` 在 trusted Agent assembly boundary 产出 canonical directory authority；`FN-5.3` 与 `FN-5.4` 在 accepted run 中只消费该冻结值和 runtime resolver 提供的 roots。调用阶段不重新解释配置语法，也不从 Tool input 扩展权限。文件操作与搜索共享同一个 path canonicalization，因此输入 alias、结果路径、snapshot 身份和搜索前缀不能产生平行语义。

Skill projection authority 继续由既有 committed manifest 和 execution scope 验证提供；文件操作与搜索只在显式 Skill path 分支消费该事实。该跨 Function 关系不改变 Skill 激活、投影提交或 sandbox 执行流程。

## 跨 Function 质量属性设计（Cross-Function Quality Attributes）

| 质量属性 | 影响 Functions 与规范依据 | 共享或端到端机制 | 端到端验证 |
|---|---|---|---|
| 安全 | `FN-3.2`、`FN-5.3`、`FN-5.4` 的本 change 功能性 Requirements；无新增黑盒质量目标 | 装配期 canonical authority 与执行期 root/access/containment 校验分层，special roots 不继承 workspace alias 权限 | assembly → Read/Write/Edit/Glob/Grep contract 组合验证，包含绝对路径、穿越、protected root 和跨 scope Skill 负例 |
| 可靠性/恢复 | `FN-5.3` 的 `文件操作工具使用 execution view 默认根`；无新增黑盒质量目标 | 所有文件消费者共享 canonical model path，快照与锁不接受输入别名作为独立身份 | 跨 alias Read→Edit stale check、并发编辑和重复搜索结果验证 |

## 验证策略（Verification Strategy）

- unit：覆盖目录输入映射表、路径 canonicalization、known root 优先级和 containment helper。
- contract/characterization：覆盖 Agent assembly 缺省/显式空集合，Read/Write/Edit alias 输出与同文件行为，Glob/Grep 缺省 workspace、显式 workspace 与 Skill projection 行为。
- integration：使用真实 `ExecutionWorkspaceResolver` roots 验证 workspace 物理位置、canonical snapshot identity、Skill committed manifest 和 local/remote 逻辑结果一致。
- negative/security：实际触发绝对路径、父级穿越、protected root 写入、readDirectories 空集合 workspace 读取、无效或跨 scope Skill projection、symlink/junction 逃逸并断言在遍历或副作用前失败。
- architecture/review：确认不新增 `agent-contracts` shape、不修改 sandbox cwd、不由 capability 重新派生 scope roots，并确认新 OpenSpec 目录的 owner、生命周期和打包边界。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/agent-package-assembly/spec.md`：合入 canonical directory compile Requirement。
- `openspec/specs/file-operation-tools/spec.md`：合入 workspace identity 与 Skill 显式读取 delta。
- `openspec/specs/file-search-tools/spec.md`：合入 workspace default search 与 canonical output delta。
- `openspec/designs/functions/D3-Agent装配与主链路/D3.1-智能体装配/FN-3.2-编译智能体装配.md`：刷新文件目录编译规格。
- `openspec/designs/functions/D5-Capability能力体系/D5.2-内置工具/FN-5.3-读写编辑文件.md`：刷新默认路径、输入输出和规格。
- `openspec/designs/functions/D5-Capability能力体系/D5.2-内置工具/FN-5.4-搜索文件.md`：刷新默认搜索与 Skill 显式搜索规格。
- `openspec/designs/features/D3-Agent装配与主链路/D3.1-智能体装配/F-3.1-装配智能体.md`：刷新目录策略编译的用户可依赖结果。
- `openspec/designs/features/D5-Capability能力体系/D5.2-内置工具/F-5.2-文件操作工具.md`：刷新 workspace 文件身份与搜索边界。
- `openspec/overview.md`：无。
- `openspec/designs/architecture/configuration-boundary.md`：刷新 workspace file authority 的 canonical compile 语义。
- `openspec/designs/architecture/execution-workspace.md`：若现有对应文档存在则刷新文件工具 consumer 映射；否则不新增文件并归入现有最匹配架构文档。
- `openspec/designs/modules/agent-app.md`：刷新目录策略编译职责。
- `openspec/designs/modules/agent-capability.md`：刷新文件工具 canonicalization、Skill authority 和默认搜索职责。
- `openspec/designs/adr/`：无；本 change 不改变 execution root 物理架构或公共 contract。
- `openspec/designs/spec-to-design-map.md`：刷新三项 spec 的设计导航与验证入口。

## 风险与取舍（Risks / Trade-offs）

- 旧版本直接写在 `scopeBase` 根部的普通文件不再通过 bare path 可见。系统不做 fallback，避免同一路径按文件存在性切换身份；升级前通过运维清单识别并迁入 workspace。
- 普通文件输出新增 `workspace/` 前缀，依赖精确旧字符串的调用方和测试需要同步。输入仍接受 bare alias，降低模型和 Skill 迁移成本。
- 默认搜索范围缩小后，依赖省略 `path` 查找 Skill 或 temp 文件的提示词会无结果；激活消息已有精确 Skill root，描述与测试将引导显式搜索。
- legacy `workspaceDir` 测试入口物理解释变化可能暴露依赖旧 scopeBase 语义的测试。只调整测试/兼容入口，不改变生产 resolver；失败用例逐项迁移，不添加双重探测回退。
- 当前 snapshot store 是进程内 run-scoped 状态，本 change 只统一其 key，不新增持久化或 path-semantics version。回滚后同一进程内旧快照不可跨版本复用，部署应通过正常进程重启切换。

## 迁移与回滚（Migration / Rollback）

发布前先备份并检查 runtime execution scopes 中 workspace 外的普通业务文件；需要保留的文件迁入对应 `workspace/`。随后部署同一版本的 Agent 装配和文件工具实现，禁止只更新 descriptor 或只更新其中一个 Function。验证 canonical path、默认搜索和 Skill 显式读取后再开放业务流量。

若出现 workspace 文件不可达、合法 Skill 资源拒绝或安全回归，停止新请求并回滚完整本地包及进程；不得只回滚目录编译或单个工具。回滚恢复旧路径解释，但已写入 `workspace/` 的文件仍保留。通过回滚版本的 targeted tests 和受影响 scope 抽样读取确认状态。

## 待确认问题（Open Questions）

无。
