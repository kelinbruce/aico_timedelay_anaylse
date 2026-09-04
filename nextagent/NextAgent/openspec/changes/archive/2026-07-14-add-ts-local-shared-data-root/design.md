## 背景和现状（Context）

当前 local 模式下，`paths.workspaceRoot` 是运行态总根。`agent-app` 从它派生 `runtimeWorkspaceRoot=<workspaceRoot>/execution`，`agent-runtime` 再按 Agent Scope、Owner Scope、session/run facts 派生 `execution/<scopeKey>/workspace/`、`.nextagent/`、`temp/<runKey>/` 等执行 root。builtin Read/Glob/Grep/Write/Edit 和 Bash/Python sandbox 都应通过 resolver-backed `ExecutionWorkspaceView` 访问这些 root。

这个设计保证了 Agent/Owner 隔离，但公共本地输入没有稳定位置。用户把电信诊断样例、告警导出、拓扑文件或诊断脚本放到 `workspaces/` 根时，工具不会读取该目录；把文件复制到 `execution/<scopeKey>/workspace/` 才能访问。直接暴露 `workspaces/` 根会把 `execution/`、`data/`、sqlite、日志和系统目录纳入模型可见边界；每次请求导入又让 local 场景过重。

本设计在不改变隔离 workspace 写入语义的前提下，新增 local-only 共享输入根 `shared-data/`。

## 目标和非目标（Goals / Non-Goals）

**目标：**
- 为 local 模式提供稳定公共共享输入目录：`<workspaceRoot>/shared-data/`。
- 以逻辑路径 `shared-data/` 暴露给 root-aware file tools 和 sandbox filesystem。
- 保持 `shared-data/` read-only，允许读取公共数据和通过显式解释器执行 Python 脚本。
- 保持所有物理路径由可信 app/runtime 组合派生，不写入 runtime-facing assembly。
- 保持输出写入边界在 `workspace/`、`temp/` 或既有 generated skill root 内。

**非目标：**
- 不把 `paths.workspaceRoot` 根暴露给模型或工具。
- 不引入 per-request import/seed 机制。
- 不提供公共读写共享目录。
- 不把 `shared-data` 加入 `PATH`、`PYTHONPATH`、Python import search path 或 executable search path。
- 不支持直接执行 `shared-data` 中的任意二进制、shell 脚本或 shebang 脚本。
- 不为 remote/PaaS 定义共享 host path 或远端对象存储投影。
- 不新增 Web API；UI/CLI 展示路径属于后续可选产品体验。

## 设计决策（Decisions）

### 1. 选定方案：新增 root kind `sharedData`

唯一实现路径是扩展现有 execution root 模型，新增 root kind `sharedData`，canonical logical path 为 `shared-data`，access 固定为 `read`。它与 `workspace`、`systemResources`、`temp`、`generatedSkills` 同属 root vocabulary，但只能在 `deployment.mode=LOCAL` 的 app composition 中进入 runtime-facing assembly。resolver 只在 LOCAL 输出该 root；REMOTE/PaaS 遇到 `sharedData` 必须 fail closed。`WorkspaceFilePort` 和 sandbox filesystem preparation 只消费 resolver 已输出的 root，不自行启用 shared-data。

放弃方案：
- **开放 `workspaces/` 根**：会暴露 runtime/system data，破坏 scope 隔离和路径安全。
- **每次请求导入**：安全边界清晰但 local 使用成本过高，且会复制大数据集。
- **把 shared data 放到每个 `workspace/`**：重复数据、污染 Agent 隔离工作区，并让公共数据和模型输出混在同一 owner。
- **只在 Bash/Python 特判路径**：会让 Read/Glob/Grep 与 sandbox 可见性不一致，违反同形同策。

### 2. 物理路径由 `agent-app` 派生和校验

`agent-app` 的 runtime path composition 增加 `sharedDataRoot = resolve(workspaceRoot, "shared-data")`。启动校验必须保证它位于 normalized `workspaceRoot` 内，且不与 `execution/`、`data/`、sqlite parent、`configRoot/skills`、`configRoot/agents` 或 provider-private roots 重叠。app composition 负责创建目录或在首次访问前确保目录存在。

`AgentAssembly.workspacePolicy` 只承载 logical root policy：`{ kind: "sharedData", logicalPath: "shared-data", access: "read" }`。该 root policy 只能由 LOCAL app composition 放入 runtime-facing assembly；REMOTE/PaaS composition 发现该 root 必须 fail closed。它不得承载物理路径、deployment mode、lifecycle 或 request/run facts。

### 3. `agent-runtime` resolver 派生 local shared root

`ExecutionWorkspaceResolver.resolve(...)` 增加对 `sharedData` root kind 的处理：
- LOCAL：`physicalPath = <workspaceRoot>/shared-data`，`defaultCwd` 仍为 `scopeBase`。
- REMOTE/PaaS：不从本地 host 派生 sharedData physical root。若 policy 里包含 `sharedData`，resolver 必须 fail closed，不能 omit root 后继续运行，也不能把 host path 塞进 remote view。

为了让 resolver 能在 LOCAL 派生 `shared-data`，其 input 需要获得 app-composed `sharedDataRoot`。这是 runtime infrastructure fact，不进入 `AgentAssembly`；REMOTE/PaaS input 即使携带该字段也不能启用 sharedData。

### 4. `agent-capability` 统一路径消费

`WorkspaceFilePort` 扩展 root vocabulary，但只消费 resolver 在 LOCAL view 中输出的 `sharedData` root：
- `normalizeModelPath()` 识别 `shared-data/...`。
- `selectRoot()` 将 `shared-data` 映射到 `sharedData` root。
- Read/Glob/Grep 允许读取该 root。
- Write/Edit 对该 root fail closed，因为 access 是 `read`。
- `sandboxFilesystem(context)` 将 `sharedData` read-only root 传递给 sandbox layout，但不把它当作 `.nextagent` Skill projection，也不参与 generated skill cleanup。

`workspacePolicy.files.readDirectories/writeDirectories` 继续只约束 `workspace/` 内部路径，不应用于 `shared-data/`。`shared-data/` 的授权来自 root policy 和 read-only access。

### 5. local sandbox 仅支持显式路径参数

`agent-platform-gateway-local` 的 `pathArgumentMatchesFilesystem(...)` 扩展允许 `shared-data/...` root-qualified path 映射到对应 read-only root。Python direct execution 的首个脚本参数可翻译为物理路径，后续参数保持字符串；脚本内读取 `shared-data/...` 依赖 cwd=`scopeBase` 加 root 目录可见或强 sandbox backend 的 root mapping。

不新增 PATH/PYTHONPATH 注入。`sanitizedEnvironment()` 继续只保留当前受控 env。`shared-data/scripts/diagnose.py` 只能通过 `python shared-data/scripts/diagnose.py` 执行；`diagnose.py` 不会通过 shared-data 搜索成功。

### 6. 只读 enforcement 是双层

第一层由 `WorkspaceFilePort` 和 path translation 拒绝写入。第二层由 sandbox filesystem layout 标记 `access: "read"`，local restricted adapter 继续对 read-only roots 做 best-effort ACL/chmod 保护。设计不宣称普通 local Python 进程具备强 OS 级恶意代码隔离；强隔离仍需 remote/PaaS 或未来本地容器 backend。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | `shared-data` 只读、local-only、root-qualified；不开放 `workspaceRoot` 根，不暴露 `data/`、`execution/`、sqlite、日志或 host absolute path；拒绝 traversal、绝对路径、URI、链接逃逸；不加入 PATH/PYTHONPATH。 | contract tests、workspace file path tests、restricted local sandbox negative tests、architecture tests |
| 性能/容量 | 不做 per-request copy；共享大文件不重复进入每个 execution workspace。读取仍受现有 max text bytes、glob scan budget、stdout/stderr cap 约束。 | read/glob/grep unit tests、现有 size/budget tests |
| 可靠性/恢复 | `shared-data` 是外部手工维护输入，不参与 terminal commit、recovery、cleanup 或持久化状态推进；缺失文件只产生 safe file not found/degraded result。 | file-tool unavailable/not-found tests、sandbox failure mapping tests |
| 可维护性 | 复用 root vocabulary、resolver、WorkspaceFilePort、sandbox filesystem layout；不在 Bash/Python 各自维护平行路径策略。 | dependency-cruiser architecture lint、contract tests、code review |
| 可测试性 | root 派生、路径 normalization、read/write 权限、sandbox path translation 都可用临时目录 deterministic 测试。 | `execution-workspace-resolver.test.ts`、read/glob/grep/write/python/bash sandbox tests |
| 审计/可追溯性 | 审计和日志只记录 root kind、逻辑路径摘要、状态、safe reason 和 byte counts；不记录物理 shared-data host path 或文件内容。 | observability/logging assertions、code review 检查点 |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| local `shared-data/` root 派生为 read-only `sharedData` root kind | 1.1, 2.1 | contract tests、`execution-workspace-resolver.test.ts` |
| assembly policy 只承载 logical root，不承载物理路径 | 1.1 | `tests/contract/core-contracts.test.ts` 或 agent-package-assembly tests |
| app path validation 防止 shared-data 与 runtime/system dirs 重叠 | 2.1 | `packages/agent-app/tests/system-config.test.ts` |
| Read/Glob/Grep 可读取 `shared-data/...` | 3.1 | `read-capability.test.ts`、`glob-capability.test.ts`、`grep-capability.test.ts` |
| Write/Edit 不能写 shared-data | 3.1 | `write-capability.test.ts`、`edit-capability.test.ts` |
| sandbox filesystem 传递 read-only sharedData root | 3.2 | `python-capability.test.ts` 或 sandbox port unit tests |
| Bash/Python 显式执行 shared-data Python 脚本 | 4.1 | `restricted-local-sandbox.test.ts`、`bash-capability.test.ts` |
| shared-data 不进入 PATH/PYTHONPATH/import search | 4.1 | `restricted-local-sandbox.test.ts`、`python-capability.test.ts` |
| remote/PaaS 不暴露 local host shared-data 且遇到 sharedData fail closed | 2.1 | resolver contract test/code review |
| OpenSpec change 可验证 | 5.1 | `openspec validate add-ts-local-shared-data-root --strict`、`openspec validate --all --strict` |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/local-shared-data-root/spec.md` 主承载 shared-data 的 local-only/read-only/explicit script 行为；`skill-resource-access`、`agent-package-assembly`、`bash-tool`、`python-tool` 承载各自既有 capability 的变更后契约。
- 架构和跨模块设计：`openspec/designs/architecture/runtime-boundaries.md` 主承载 shared-data 与 workspaceRoot/execution/data 的边界；`openspec/designs/architecture/skill-invocation-and-disclosure.md` 承载 file/sandbox capability 披露边界。
- 模块设计：`agent-app`、`agent-runtime`、`agent-capability`、`agent-platform-gateway-local` 模块文档分别承载 path derivation、resolver、WorkspaceFilePort/sandbox preparation、local sandbox path argument mapping。
- ADR：`openspec/designs/adr/local-shared-data-root.md` 记录 read-only shared root 相比开放 workspaceRoot 或 per-request import 的长期取舍。
- 导航：`openspec/designs/spec-to-design-map.md` 增加 `local-shared-data-root` 到相关设计和验证入口。

## 风险与取舍（Risks / Trade-offs）

- [local sandbox 不是强隔离] -> 文档和测试保持 best-effort 表述；不宣称普通本地 Python 阻止所有 host 访问。
- [shared-data 可能被用户放入敏感文件] -> 只作为 local 公共共享输入区，并在 docs/diagnostics 中提示不得放 credential；日志不泄露内容和物理路径。
- [remote 行为容易被误解] -> specs 明确 local-only，remote 不从 host path 派生。
- [root vocabulary 扩展触达多包 contract] -> 通过 contract tests 和 architecture lint 固定唯一 root kind，不做各工具私有特判。

## 迁移计划（Migration Plan）

无数据迁移。发布后 local 用户可以把公共数据放入 `<workspaceRoot>/shared-data/`。既有 `execution/<scopeKey>/workspace/` 文件继续可读写，`workspaceRoot` 根目录下非 `shared-data` 的手工文件仍不自动暴露。回滚时删除或忽略 `shared-data` root kind 即可，用户文件留在磁盘但不再通过工具可见。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/local-shared-data-root/spec.md`：归档新增 capability 行为。
- `openspec/specs/skill-resource-access/spec.md`：归档四 root execution model、local shared-data read-only root、sandbox filesystem 映射。
- `openspec/specs/agent-package-assembly/spec.md`：归档 `sharedData` root kind contract。
- `openspec/specs/bash-tool/spec.md`：归档显式 shared-data Python script path 支持和非 PATH 语义。
- `openspec/specs/python-tool/spec.md`：归档 Python shared-data 显式读取、不注入 PYTHONPATH/import path。
- `openspec/overview.md`：提炼 local shared input 背景。
- `openspec/designs/architecture/runtime-boundaries.md`：提炼 runtime root 边界。
- `openspec/designs/architecture/skill-invocation-and-disclosure.md`：提炼 capability exposure 边界。
- `openspec/designs/modules/agent-app.md`、`agent-runtime.md`、`agent-capability.md`、`agent-platform-gateway-local.md`：提炼模块职责。
- `openspec/designs/adr/local-shared-data-root.md`：记录长期取舍。
- `openspec/designs/spec-to-design-map.md`：更新导航。

## 待确认问题（Open Questions）

无。
