## 背景与问题（Why）

Local 模式下，`paths.workspaceRoot` 目前是运行态总根目录，实际 builtin 文件工具和 Bash/Python sandbox 访问的是 `workspaceRoot/execution/<scopeKey>/workspace/`。开发者或运维人员把电信诊断样例、网络拓扑、告警导出、脚本等公共输入文件直接放到 `workspaces/` 根目录后，模型通过 Read/Glob/Grep/Bash/Python 读取时会因为不在当前 execution workspace root 内而失败；只有手工复制到派生的 `execution/<scopeKey>/workspace/` 后才能访问。

这个行为保持了 Agent Scope 和 Owner Scope 隔离，但 local 使用体验不清晰：公共、只读、跨会话复用的输入资料没有稳定入口。把 `workspaces/` 根直接暴露给工具会把 `execution/`、`data/` 等 runtime/system 目录放进工具边界，破坏当前安全和职责划分；每次请求前导入文件又会增加不必要的操作复杂度。

本变更新增 local-only `shared-data/` 公共共享数据根，作为开发和本地运维诊断场景下的稳定只读输入区，解决公共数据和公共 Python 诊断脚本可复用问题，同时不改变隔离工作区的写入边界。

## 变更范围（What Changes）

- 在 local deployment mode 下，系统 SHALL 在 `paths.workspaceRoot/shared-data/` 派生一个公共共享数据根。
- 只有 `deployment.mode=LOCAL` 时，`shared-data/` SHALL 以逻辑路径 `shared-data/` 暴露给 Read/Glob/Grep 以及 Bash/Python sandbox filesystem，访问权限为 read-only。
- `workspace/` 仍是 Agent 隔离读写工作区；`shared-data/` 不承载模型或工具输出，不参与 terminal commit、tool-result offload、temp 或 generated skill 写入。
- Bash/Python 只允许通过显式路径访问 `shared-data/...`。Python 脚本执行支持 `python shared-data/scripts/foo.py` 或 Python tool 内部 sandbox 路径引用；系统 MUST NOT 把 `shared-data` 加入 `PATH`、`PYTHONPATH` 或可执行搜索路径。
- `shared-data/` 只属于 local runtime 共享输入能力。remote/PaaS sandbox 不因此获得新的共享 host path 语义；本 change 不定义任何远端共享数据能力。
- 写入、编辑和普通 workspace output 继续只允许在 `workspace/`、`temp/` 或既有受控 generated skill root 内发生；对 `shared-data/` 的 write/edit MUST fail closed。
- 路径安全继续拒绝绝对路径、盘符路径、URI、`..`、符号链接逃逸和未授权 root 访问。
- 本变更不新增公共 Web API。若 UI/CLI 需要展示 `shared-data` 路径，只能作为 local diagnostic/display fact，不改变模型可写能力。

## Capability 影响（Capabilities）

### 新增 Capability
- `local-shared-data-root`: 定义 local-only `shared-data/` 公共只读共享输入根、逻辑路径、访问权限、安全边界和验证要求。

### 修改的 Capability
- `skill-resource-access`: 执行 workspace view 和 sandbox filesystem 需要包含 local-only read-only `shared-data/` root，并保持 `.nextagent` Skill projection narrowing。
- `agent-package-assembly`: `AgentWorkspaceRootPolicy` 和 runtime-facing workspace policy 需要支持 `sharedData` root kind，且不得把物理 `shared-data` 路径写入 assembly。
- `bash-tool`: Bash sandbox 路径参数语义需要允许显式 `shared-data/...` 文件路径，禁止把 `shared-data` 作为 PATH 或隐式 executable authority。
- `python-tool`: Python snippet/script sandbox 需要允许显式读取或执行 `shared-data/...` Python 脚本，并禁止写入或隐式 import/search path 扩展。

## 影响范围（Impact）

- `agent-contracts/agent-assembly`：扩展 workspace root kind vocabulary，新增 `sharedData` root kind 和 canonical logical path 约束；该 root 只能由 local app composition 放入 runtime-facing assembly。
- `agent-contracts/runtime`：扩展 `ExecutionWorkspaceRootView` root kind。
- `agent-contracts/gateway`：扩展 `SandboxFilesystemRootKind` root kind。
- `agent-runtime`：local execution workspace resolver 派生 `shared-data` physical root；remote/PaaS mode 遇到 `sharedData` root 必须 fail closed，不能 omit 后继续运行。
- `agent-app`：runtime paths 需要建立并校验 `workspaceRoot/shared-data`，确保不与 `data/`、`execution/`、system skills、agents 或 sqlite path 重叠。
- `agent-capability`：WorkspaceFilePort 支持 `shared-data/` read/glob/grep root，write/edit fail closed；sandbox filesystem layout 传递 read-only root。
- `agent-platform-gateway-local`：Python path argument translation 允许 `shared-data/...` 映射到 read-only root；不添加 PATH/PYTHONPATH。
- 测试：需要 contract、unit、architecture/negative tests 覆盖 root kind、路径拒绝、只读、sandbox 显式脚本执行和 remote 非目标行为。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/local-shared-data-root/spec.md`：新增 local-only shared data root 行为契约。
- `openspec/specs/skill-resource-access/spec.md`：补充 execution workspace view 和 sandbox filesystem 对 `shared-data/` read-only root 的稳定行为。
- `openspec/specs/agent-package-assembly/spec.md`：补充 `workspacePolicy.roots` 对 `sharedData` root kind 和 logical path 的 contract。
- `openspec/specs/bash-tool/spec.md`：补充 Bash 对 `shared-data/...` 显式脚本/文件参数的 sandbox 访问边界。
- `openspec/specs/python-tool/spec.md`：补充 Python 对 `shared-data/...` 显式读取和脚本执行边界。

长期背景：
- `openspec/overview.md`：记录 local 模式下 shared data root 解决公共诊断资料复用问题；不记录实现步骤。

设计视图：
- `openspec/designs/architecture/runtime-boundaries.md`：补充 local shared data root 与 execution workspace、runtime data、Agent/Owner Scope 隔离关系。
- `openspec/designs/architecture/skill-invocation-and-disclosure.md`：补充 shared data 对 builtin file/sandbox capability 的只读披露边界。
- `openspec/designs/modules/agent-app.md`：补充 app-owned path derivation 和 path overlap validation 职责。
- `openspec/designs/modules/agent-runtime.md`：补充 resolver 派生 local sharedData root 的职责。
- `openspec/designs/modules/agent-capability.md`：补充 WorkspaceFilePort 和 sandbox filesystem preparation 消费 sharedData root 的职责。
- `openspec/designs/modules/agent-platform-gateway-local.md`：补充 local sandbox 对 shared-data path argument 的映射职责。
- `openspec/designs/adr/local-shared-data-root.md`：记录选择 read-only shared root 而非开放 `workspaces/` 根或 per-request import 的长期取舍。
- `openspec/designs/spec-to-design-map.md`：新增 `local-shared-data-root` 到相关 architecture/module/ADR 的导航。

验证入口：
- `npm run test:contract`
- `npm test -- --run packages/agent-runtime/tests/execution-workspace-resolver.test.ts packages/agent-capability/tests/read-capability.test.ts packages/agent-capability/tests/glob-capability.test.ts packages/agent-capability/tests/grep-capability.test.ts packages/agent-capability/tests/python-capability.test.ts packages/agent-platform-gateway-local/tests/restricted-local-sandbox.test.ts packages/agent-app/tests/system-config.test.ts`
- `npm run lint:architecture`
- `openspec validate add-ts-local-shared-data-root --strict`
- `openspec validate --all --strict`
