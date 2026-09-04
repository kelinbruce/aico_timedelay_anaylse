## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-5.3 读写编辑文件` | Read、Write、Edit 的无 root 前缀路径统一从 execution view 根解释，并推荐将持久化产物写入 `workspace/` | `file-operation-tools`、`write-tool`、`edit-tool` | `FN-5.3 读写编辑文件` |
| `FN-5.4 搜索文件` | Glob、Grep 的缺省与无 root 前缀搜索统一覆盖受授权 execution view，并返回逻辑 execution paths | `file-search-tools`、`glob-tool`、`grep-tool` | `FN-5.4 搜索文件` |

## 存量 Requirement 迁移方案

| 来源 spec / Requirement | 目标 Function / canonical spec | 原子 delta | 其他行为与未触及 Requirements 处理 | 白盒落点 | stable spec 与导航影响 |
|---|---|---|---|---|---|
| `write-tool` / `Write Input And Output Are Bounded` | `FN-5.3` / `file-operation-tools` | 来源 `REMOVED` + 目标 `ADDED` | 未触及的 Write 并发、快照、原子替换和错误语义留在来源 spec | `FN-5.3` 的路径归一化与结果投影 | 归档时保留来源 spec，并把 Function 导航改为 canonical spec + legacy spec |
| `write-tool` / `Write Uses Trusted Agent-Scoped Directory Authority` | `FN-5.3` / `file-operation-tools` | 来源 `REMOVED` + 目标 `ADDED` | root access mode 与 Agent assembly authority 不变 | `FN-5.3` 的 execution-view-relative policy 判断 | 同上 |
| `edit-tool` / `Edit Input And Output Are Bounded` | `FN-5.3` / `file-operation-tools` | 来源 `REMOVED` + 目标 `ADDED` | 未触及的 snapshot、replace 和冲突语义留在来源 spec | `FN-5.3` 的路径归一化与结果投影 | 同上 |
| `edit-tool` / `Edit Rejects Targets Outside Authorized Write Directories` | `FN-5.3` / `file-operation-tools` | 来源 `REMOVED` + 目标 `ADDED` | 既有只读 root 禁写保持不变 | `FN-5.3` 的 directory/root 双重授权 | 同上 |
| `glob-tool` / `Glob Has A Strict Pattern And Path Contract` | `FN-5.4` / `file-search-tools` | 来源 `REMOVED` + 目标 `ADDED` | 未触及的 pattern、容量与降级语义留在来源 spec | `FN-5.4` 的搜索目标展开与路径投影 | 归档时保留来源 spec，并把 Function 导航改为 canonical spec + legacy spec |
| `glob-tool` / `Glob Uses Agent-Scoped Read Authority` | `FN-5.4` / `file-search-tools` | 来源 `REMOVED` + 目标 `ADDED` | Skill projection 验证与 extension policy 不变 | `FN-5.4` 的 effective roots 展开 | 同上 |
| `grep-tool` / `Grep Has A Strict Pattern And Path Contract` | `FN-5.4` / `file-search-tools` | 来源 `REMOVED` + 目标 `ADDED` | 未触及的 regex、输出模式与容量语义留在来源 spec | `FN-5.4` 的搜索目标展开与路径投影 | 同上 |
| `grep-tool` / `Grep Uses Agent-Scoped Read Authority` | `FN-5.4` / `file-search-tools` | 来源 `REMOVED` + 目标 `ADDED` | Skill projection 验证与 extension policy 不变 | `FN-5.4` 的 effective roots 展开 | 同上 |
| `builtin-tool-framework` / `Workspace File Dependency Supports Governed Discovery` | `FN-5.4` / `file-search-tools` | 来源 `REMOVED` + 目标 `ADDED`（按黑盒行为拆入三个目标 Requirements） | Glob 的受治理发现、authority 与逻辑输出由目标 spec 承载；共享 dependency、owner、traversal 和不暴露 host API 的白盒约束由本 design 承载；来源 spec 其他 Requirements 原位保留 | `FN-5.4` 的当前实现与修改方案 | 归档时保留来源 spec，移除该 Requirement，并更新 FN-5.4/spec-to-design-map 导航 |

来源和目标 spec 未被其他 active change 修改；本 change 不迁移上述来源 specs 中未触及的 Requirements。

## `FN-5.3 读写编辑文件`

### 目标与规范依据

本 Function 落实 proposal 中“同一相对路径在文件工具与 Bash、Python 间指向同一 execution view 目标”的黑盒结果，并保留 `workspace/` 的 durable 推荐语义。

#### 本 Function 的目标 Requirements

canonical spec：`file-operation-tools`

- `ADDED`：`文件操作工具使用 execution view 默认根`
- `ADDED`：`workspace 是推荐的持久化写入目录`
- `ADDED`：`Write Input And Output Are Bounded`
- `ADDED`：`Write Uses Trusted Agent-Scoped Directory Authority`
- `ADDED`：`Edit Input And Output Are Bounded`
- `ADDED`：`Edit Rejects Targets Outside Authorized Write Directories`

### 当前实现

- `WorkspaceFilePort` 是 Read、Write、Edit 的共享 owner，`normalizeModelPath` 先识别五个已知 logical roots，`selectRoot` 再把 `.` 和所有无 root 前缀路径映射到 `workspace` root。
- resolver-backed view 的 `workspace.physicalPath` 始终是当前 scope 的 `<scopeBase>/workspace`；LOCAL `defaultCwd` 是物理 `scopeBase`，REMOTE `defaultCwd` 是逻辑 `/work`，因此不能统一把 `defaultCwd` 当作宿主文件路径。
- `resolveTarget` 只在 `workspace` root 上用 `normalized.relativePath` 校验 `readDirectories`/`writeDirectories`；已知 root 由各自 access mode 和 Skill projection authorization 约束。
- 文件工具 descriptor 仍将路径描述为 workspace-relative，没有解释 execution view 默认根及 `workspace/` 推荐用途。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 无 root 前缀路径从 execution view 根解释 | `selectRoot` 将其映射到 `<scopeBase>/workspace` | 需要一个仅在 `WorkspaceFilePort` 内部使用的 execution view 根目标 |
| directory authority 使用 execution-view-relative 路径 | policy 只在 workspace root 内按 root-relative 路径判断 | 需要按完整逻辑 `modelPath` 统一判断，并在匹配后仍执行 known-root access 检查 |
| LOCAL/REMOTE 同形且不暴露物理路径 | REMOTE `defaultCwd=/work` 不是宿主物理路径 | 物理根必须从可信 workspace root 的父目录派生，输出仍使用逻辑路径 |
| `workspace/` 是推荐持久化目录 | descriptor 只称 workspace-relative | 需要同步 Read、Write、Edit 的模型说明和 schema 字段说明 |

### 修改方案

`agent-capability` 继续作为唯一 owner；不修改 `ExecutionWorkspaceView`、sandbox filesystem contract、resolver 或 public schema。

在 `workspace-file-port.ts` 内新增私有 `FileRootView` 联合类型：沿用 `ExecutionWorkspaceRootView`，并增加唯一的 `{ kind: "executionView"; logicalPath: "."; physicalPath: string; access: "readWrite" }` 分支。四个字段均 required、不可为 null；`physicalPath` 的 trusted source 是 resolver 已验证的 `workspace.physicalPath` 父目录，owner 是 `WorkspaceFilePort`，内部构造后通过 containment 校验使用，不持久化、不跨层映射。该对象只参与文件工具路径解析，不进入 Tool 输出、日志、gateway request 或公共 contract。该派生对 LOCAL 与 REMOTE 相同，不依赖 `defaultCwd` 的物理/逻辑差异。

路径选择采用唯一优先级：

1. `workspace/`、`.nextagent/`、`temp/`、`generated-skills/`、`shared-data/` 先选择既有 root；
2. `.` 与其他无 root 前缀路径选择私有 execution view 根；
3. 对全部目标使用完整 `modelPath` 检查 execution-view-relative `readDirectories`/`writeDirectories`；
4. directory match 成功后仍必须通过目标 root 的 access mode、Skill projection authorization、link containment 和 extension policy。

因此 `writeDirectories=["."]` 可授权 `notes.txt` 与 `workspace/notes.txt`，但不能授权 `.nextagent/...` 或 `shared-data/...` 写入。`writeDirectories=["workspace"]` 只授权显式 `workspace/...`。绝对路径、`..` 和非法 scheme 仍由 `normalizeModelPath` 在文件系统访问前拒绝。

Read、Write、Edit descriptor 统一说明无 root 前缀路径从 execution view 根解释，`workspace/...` 推荐用于跨 run 保留的产物，`temp/...` 用于当前 run 临时文件；现有输入输出字段不变。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 安全 | 无新增黑盒质量目标；依据 `文件操作工具使用 execution view 默认根` 的 negative scenarios | known-root 优先、完整逻辑路径 policy、root access mode 与 link containment 分层校验 | `.` 授权不得扩大系统资源、shared-data、绝对路径、父级和链接访问 |
| 可维护性、可测试性 | 无新增黑盒质量目标 | 所有文件操作复用一个 target resolver，不新增平行 adapter 或配置 | Read/Write/Edit 的路径与 descriptor 行为由共享测试和各 Tool 黑盒测试覆盖 |

## `FN-5.4 搜索文件`

### 目标与规范依据

本 Function 将缺省搜索与显式相对搜索统一为 execution-view-relative 语义，同时保证默认遍历不会把 scope 管理目录、其他 run 的临时目录或 scope 外数据纳入结果。

#### 本 Function 的目标 Requirements

canonical spec：`file-search-tools`

- `ADDED`：`文件搜索工具使用 execution view 默认根`
- `ADDED`：`Glob Has A Strict Pattern And Path Contract`
- `ADDED`：`Glob Uses Agent-Scoped Read Authority`
- `ADDED`：`Grep Has A Strict Pattern And Path Contract`
- `ADDED`：`Grep Uses Agent-Scoped Read Authority`

### 当前实现

- Glob、Grep 在省略 `path` 时将每个 effective `readDirectories` 直接交给 `resolveTarget`；缺省 policy 的 `.` 因而只搜索 workspace root。
- 显式无 root 前缀 `path` 同样落到 workspace root。搜索循环独立执行 symlink 跳过、depth、entry、byte、result 限额和全局排序。
- `temp` 的物理 root 带当前 run key；直接遍历物理 `<scopeBase>/temp` 会错误触及其他 run，因此 execution view 根不能被当作普通目录无条件递归。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 缺省搜索覆盖授权 execution view | 缺省 `.` 只搜索 workspace | 需要把 execution view authority 展开为普通 scope root与已知 logical roots |
| 不隐式遍历受保护或错误生命周期目录 | 普通根递归会进入 `.nextagent` 和 `temp/<other-run>` | execution view 根扫描必须在第一层跳过全部已知 logical root 目录，再按当前 view 的 root 映射单独纳入允许目标 |
| 结果保持一个全局预算、排序和去重 | 现有循环已支持多 roots，但 roots 仍是 workspace-relative | 需要仅替换 roots 解析，不复制 traversal 实现 |

### 修改方案

Glob、Grep 继续共享 `resolveSearchTargets` 和现有 traversal。私有 `ResolvedFileTarget` 增加两个 optional、不可为 null 的字段：`excludedTopLevelNames?: ReadonlySet<string>` 缺省为 `undefined`，仅 execution view 根搜索目标设置为当前 view 全部 root 的非空 `logicalPath` 集合，字符串使用规范化 `/` 逻辑路径且只取首段；`skipIfMissing?: boolean` 缺省为 `false`，仅缺省 `.` 展开的已知 root 目标设置为 `true`。trusted source 和 owner 均为 `WorkspaceFilePort`；前者只在 traversal depth 为 0 时过滤目录 entry，后者只允许缺省展开跳过尚未创建的 root，显式搜索缺失路径仍保持既有降级结果。两字段均不持久化、不进入输出。普通读写目标保持两字段缺省。

当 effective directory 为 `.` 时，解析器返回：

- execution view 根目标，首层排除 `workspace`、`.nextagent`、`temp`、`generated-skills`、`shared-data`；
- 当前 view 中存在且可读的 `workspace`、当前 run `temp`、`generated-skills` roots；
- 不默认加入 `.nextagent` 和 `shared-data`。二者继续只允许显式、受授权路径访问，避免“默认根”扩大系统资源或 scope 外共享数据可见性。

其他 configured directory 或显式 `path` 解析为恰好一个 execution-view-relative 目标；已知 root 使用其可信物理映射，无 root 前缀使用 execution view 根。展开后的 roots 按逻辑路径消除祖先/后代重复，再沿用现有单一 inspected-entry/read-byte/result 预算、全局排序和去重。Glob 的 root-qualified pattern 拆分保持不变，但无 root 前缀 pattern 相对于 execution view 各有效目标匹配。

descriptor 与 input schema 的 `path` 文案改为 execution-view-relative，并说明省略时搜索默认授权 execution view、`workspace/...` 为 durable 目录。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 安全 | 无新增黑盒质量目标；依据 `文件搜索工具使用 execution view 默认根` 的 negative scenarios | 首层排除 known roots、按可信 root 映射重新纳入、保留 symlink 与 authorization 校验 | 默认搜索不返回 `.nextagent`、shared-data、其他 run temp 或 scope 外链接 |
| 性能/容量 | 无新增黑盒质量目标；沿用 Glob/Grep 既有容量 Requirements | 多 root 仍共享一个 traversal/read/result budget | 新增 roots 不得把每个 root 的预算独立重置 |
| 可维护性、可测试性 | 无新增黑盒质量目标 | 只扩展共享 target 解析和 traversal entry filter | Glob/Grep 以同一 fixture 验证一致结果与边界 |

## 跨 Function 协作与端到端流程

`FN-5.3` 与 `FN-5.4` 共用 `WorkspaceFilePort` 的规范化、root 选择和 directory authority。Bash、Python 不改动：它们继续由 sandbox gateway 使用 execution view 默认 cwd。端到端验证用同一 accepted run 先由 Bash 在默认 cwd 生成文件，再由 Read、Glob、Grep 以无 root 前缀路径访问；反向路径则由 Write 写入默认根后由 Bash 从默认 cwd 读取。

## 跨 Function 质量属性设计（Cross-Function Quality Attributes）

| 质量属性 | 影响 Functions 与规范依据 | 共享或端到端机制 | 端到端验证 |
|---|---|---|---|
| 安全 | `FN-5.3` / `文件操作工具使用 execution view 默认根`；`FN-5.4` / `文件搜索工具使用 execution view 默认根` | 单一 target resolver 保证 known-root 优先、directory policy 与 root access mode 组合顺序一致 | 对操作和搜索同时验证绝对路径、父级、protected root、link 与物理路径不泄漏 |
| 可维护性、可测试性 | 两个 Function 均无新增黑盒质量目标 | 一个私有 execution view target abstraction 服务操作与搜索，Bash/Python contract 不复制 | 跨 Tool integration 断言同一逻辑路径指向同一文件 |

## 验证策略（Verification Strategy）

- unit：以 resolver-backed scope fixture 验证无 root 前缀、显式 `workspace/`、configured directory、known-root 优先、首层排除、逻辑结果投影和 descriptor 文案。
- contract/integration：在同一 accepted run 组合 sandbox Bash 与 WorkspaceFilePort，断言双向文件可见性以及 LOCAL/REMOTE 逻辑路径同形；不断言私有 synthetic root 的具体对象形状。
- negative：在文件系统访问前拒绝绝对路径、`..`、只读 root 写入和未授权 Skill projection；搜索跳过 symlink、`.nextagent`、shared-data 与其他 run temp，且失败结果不含物理路径。
- architecture/manual review：确认未修改 public contracts、resolver、gateway owner 或 sandbox authority，且所有 file tools 仍通过 `WorkspaceFilePort`。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/file-operation-tools/spec.md`：新增 canonical spec，并迁入本次触及的 Write/Edit Requirements。
- `openspec/specs/file-search-tools/spec.md`：新增 canonical spec，并迁入本次触及的 Glob/Grep Requirements。
- `openspec/specs/write-tool/spec.md`、`edit-tool/spec.md`、`glob-tool/spec.md`、`grep-tool/spec.md`：移除已迁移 Requirements，保留未触及 Requirements。
- `openspec/designs/functions/D5-Capability能力体系/D5.2-内置工具/FN-5.3-读写编辑文件.md`：刷新 canonical/legacy spec 导航、execution view 输入和结果。
- `openspec/designs/functions/D5-Capability能力体系/D5.2-内置工具/FN-5.4-搜索文件.md`：刷新 canonical/legacy spec 导航、缺省搜索范围和结果。
- `openspec/designs/features/D5-Capability能力体系/D5.2-内置工具/F-5.2-文件操作工具.md`：刷新 actor 可依赖的统一根与 durable workspace 推荐语义。
- `openspec/overview.md`：补充 root-aware 文件工具与 Bash/Python 共享 execution view 默认根，以及 `workspace/` durable 推荐语义。
- `openspec/designs/architecture/runtime-boundaries.md`、`skill-invocation-and-disclosure.md`：刷新 execution view 默认根与 root-aware 文件工具语义。
- `openspec/designs/modules/agent-capability.md`：刷新 `WorkspaceFilePort` 的默认根、directory policy 和搜索排除边界。
- `openspec/designs/adr/`：无；本次不新增长期技术选型。
- `openspec/designs/spec-to-design-map.md`：新增两个 canonical specs 的 Function、architecture、module 与验证导航，并保留 legacy specs 导航。

## 风险与取舍（Risks / Trade-offs）

- 这是有意的 breaking path change；旧 prompt 若省略 `workspace/` 会访问不同目标。通过 descriptor 明示 `workspace/...` durable 推荐并更新仓内测试/示例缓解，不提供双写或 fallback alias。
- execution view 根比 workspace 大，默认搜索候选增加。继续使用单一硬预算，并排除所有 known-root 物理目录后按当前 view 受控重入，避免容量与隔离失控。
- 从 workspace physical root 父目录派生 scope root依赖 resolver 的既有不变量。该派生仅在 capability 私有边界使用，并通过 LOCAL/REMOTE resolver-backed 测试锁定；若未来 root layout 改变，应由 resolver contract 另行显式提供，不在本 change 扩展 public contract。

## 待确认问题（Open Questions）

无。
