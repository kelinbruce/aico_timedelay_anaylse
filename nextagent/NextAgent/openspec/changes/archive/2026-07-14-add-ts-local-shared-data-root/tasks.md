## 1. Contract 和 workspace policy vocabulary

- [x] 1.1 扩展 `agent-contracts/agent-assembly`、`agent-contracts/runtime`、`agent-contracts/gateway` 中的 execution root kind vocabulary，新增 LOCAL-only `sharedData` root kind，并固定 canonical logical path `shared-data`、access `read`。
  验证：`npm run test:contract -- --run tests/contract/core-contracts.test.ts`；新增或更新 contract assertions 覆盖 `sharedData` root kind、logical path、read-only shape 和非 LOCAL 不可生效边界。
  来源：`agent-package-assembly` / `Workspace Resolution And Package Validation Are Compile-Time Preconditions`；design 决策 1。

- [x] 1.2 更新 Agent assembly composition，使只有 LOCAL deployment mode 的 runtime-facing `workspacePolicy.roots` 包含 logical `sharedData` root，且不包含物理路径、deployment mode、lifecycle 或 request/run facts；REMOTE/PaaS composition 遇到 `sharedData` 必须 fail closed。
  验证：`npm test -- --run packages/agent-app/tests/*assembly*.test.ts tests/contract/core-contracts.test.ts`；测试断言非法 `sharedData` access/path fail closed，REMOTE/PaaS 下 `sharedData` fail closed。
  来源：`agent-package-assembly` / `Workspace Resolution And Package Validation Are Compile-Time Preconditions`；design 决策 2。

## 2. App path 派生与 runtime resolver

- [x] 2.1 在 `agent-app` runtime paths 中派生 `sharedDataRoot=<workspaceRoot>/shared-data`，启动时创建或确保目录存在，并校验它不与 `execution/`、`data/`、sqlite parent、system skills、agents 或 provider-private roots 重叠。
  验证：`npm test -- --run packages/agent-app/tests/system-config.test.ts tests/contract/gateway-configuration-contracts.test.ts`；negative case 实际配置重叠路径并断言 fail closed。
  来源：`local-shared-data-root` / `Local shared data root SHALL expose stable read-only shared inputs`；design 决策 2。

- [x] 2.2 扩展 `ExecutionWorkspaceResolver.resolve(...)` input 和实现，使 LOCAL mode 为 `sharedData` root 输出 `physicalPath=<workspaceRoot>/shared-data`、`logicalPath=shared-data`、`access=read`，并保持 `defaultCwd=scopeBase`。
  验证：`npm test -- --run packages/agent-runtime/tests/execution-workspace-resolver.test.ts`；断言 LOCAL view 包含 sharedData root 且不改变 workspace/temp scope keys。
  来源：`skill-resource-access` / `Accepted run SHALL derive scoped execution file roots and expose them by need`；design 决策 3。

- [x] 2.3 明确 REMOTE/PaaS mode 不从本地 host 派生 `shared-data` root；实现必须 fail closed，不能 omit root 后继续运行，并用测试固定该行为。
  验证：`npm test -- --run packages/agent-runtime/tests/execution-workspace-resolver.test.ts`；negative case 断言 remote policy 包含 `sharedData` 时 resolver 抛错且不返回 view。
  来源：`local-shared-data-root` / `Local shared data root SHALL expose stable read-only shared inputs`；design 决策 3。

## 3. WorkspaceFilePort 和 builtin 文件工具

- [x] 3.1 扩展 `WorkspaceFilePort` root-aware path normalization 和 root selection，仅当 resolver view 包含 LOCAL `sharedData` root 时支持 `shared-data/...` 解析到该 root；Read/Glob/Grep 可读，Write/Edit 对该 root fail closed，REMOTE/PaaS 缺少 root 时访问必须 fail closed。
  验证：`npm test -- --run packages/agent-capability/tests/read-capability.test.ts packages/agent-capability/tests/glob-capability.test.ts packages/agent-capability/tests/grep-capability.test.ts packages/agent-capability/tests/write-capability.test.ts packages/agent-capability/tests/edit-capability.test.ts`；包含 shared-data read positive 和 write/edit negative cases。
  来源：`local-shared-data-root` / `Local shared data root SHALL expose stable read-only shared inputs`；`skill-resource-access` / `File access SHALL use two-layer checking`；design 决策 4。

- [x] 3.2 将 LOCAL `sharedData` read-only root 纳入 `WorkspaceFilePort.sandboxFilesystem(context)`，并确保 REMOTE/PaaS 不输出该 root，且 `.nextagent` Skill projection narrowing 逻辑不把 shared-data 当成 systemResources 或 generated skill root。
  验证：`npm test -- --run packages/agent-capability/tests/python-capability.test.ts packages/agent-capability/tests/skill-resource-projection.test.ts`；测试断言 sandbox filesystem 包含 sharedData read root 且 `.nextagent` 未被整体暴露。
  来源：`skill-resource-access` / `Dynamic execution SHALL use deployment-mode-specific sandbox enforcement`；design 决策 4。

- [x] 3.3 增加路径安全 negative tests，覆盖 `shared-data/../data/system/nextagent.sqlite`、drive-qualified path、URI-like path、空路径、链接逃逸和 raw host absolute path。
  验证：`npm test -- --run packages/agent-capability/tests/path-security.test.ts packages/agent-capability/tests/read-capability.test.ts packages/agent-capability/tests/glob-capability.test.ts`。
  来源：`local-shared-data-root` / `Shared data path safety SHALL match execution root safety`；design 质量属性：安全。

## 4. Local sandbox 与 Bash/Python 执行

- [x] 4.1 扩展 local restricted sandbox path argument translation，使 `python shared-data/scripts/diagnose.py` 的脚本参数可映射到 `sharedData` root，同时保留绝对路径、`..` 和非授权 root 的拒绝行为。
  验证：`npm test -- --run packages/agent-platform-gateway-local/tests/restricted-local-sandbox.test.ts`；positive case 执行 shared-data Python 脚本，negative case 拒绝 traversal/host path。
  来源：`local-shared-data-root` / `Shared data scripts SHALL execute only through explicit interpreter paths`；design 决策 5。

- [x] 4.2 增加 Bash capability tests，覆盖 `python shared-data/scripts/diagnose.py --case shared-data/cases/alarm.json` 通过 sandbox dependency 提交，且 Bash 不把 `shared-data` 解析为命令搜索路径。
  验证：`npm test -- --run packages/agent-capability/tests/bash-capability.test.ts`。
  来源：`bash-tool` / `Bash Is Workspace Scoped And Network CLI Is Denied`；design 决策 5。

- [x] 4.3 增加 Python tool tests，覆盖 Python snippet 显式读取 `shared-data/...` 的 sandbox request 行为，并断言 `shared-data` 不被注入 `PYTHONPATH` 或隐式 import search path。
  验证：`npm test -- --run packages/agent-capability/tests/python-capability.test.ts packages/agent-platform-gateway-local/tests/restricted-local-sandbox.test.ts`。
  来源：`python-tool` / `Python tool executes only through sandbox gateway`；`local-shared-data-root` / `Shared data scripts SHALL execute only through explicit interpreter paths`。

- [x] 4.4 确认 local sandbox read-only root protection 覆盖 `sharedData` root，写入 `shared-data/` 的脚本必须失败或被只读保护拦截；不宣称 OS 级强隔离。
  验证：`npm test -- --run packages/agent-platform-gateway-local/tests/restricted-local-sandbox.test.ts`；code review 检查日志/文档不宣称普通 local process 强隔离。
  来源：`skill-resource-access` / `Dynamic execution SHALL use deployment-mode-specific sandbox enforcement`；design 决策 6。

## 5. 架构约束和整体验证

- [x] 5.1 增加或更新 architecture/contract tests，确保 `sharedData` root 只在 LOCAL mode 通过 app/runtime resolver 和 WorkspaceFilePort/sandbox filesystem 生效，Bash/Python 不维护私有 root allowlist，且 `agent-capability` 不直接解释 app raw config。
  验证：`npm run lint:architecture`；必要时补充 `tests/architecture/*.test.ts` source assertions。
  来源：design 决策 1、4、5；AGENTS 架构边界。

- [x] 5.2 运行 change 级和全量 OpenSpec 验证。
  验证：`openspec validate add-ts-local-shared-data-root --strict`；`openspec validate --all --strict`。
  来源：proposal / 验证入口；所有 delta specs。

- [x] 5.3 运行实现相关测试集合，确认 shared-data 能力未破坏既有 workspace、Skill resource、temp、Bash/Python failure semantics。
  验证：`npm run build`；`npm test -- --run packages/agent-runtime/tests/execution-workspace-resolver.test.ts packages/agent-app/tests/system-config.test.ts packages/agent-capability/tests/read-capability.test.ts packages/agent-capability/tests/glob-capability.test.ts packages/agent-capability/tests/grep-capability.test.ts packages/agent-capability/tests/write-capability.test.ts packages/agent-capability/tests/edit-capability.test.ts packages/agent-capability/tests/bash-capability.test.ts packages/agent-capability/tests/python-capability.test.ts packages/agent-platform-gateway-local/tests/restricted-local-sandbox.test.ts`；`npm run test:contract`。
  来源：design 验证映射；全部行为约束。

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，在归档前根据 proposal/design 的“归档前更新基线”处理：

- 同步 `openspec/specs/local-shared-data-root/spec.md`。
- 同步 `openspec/specs/skill-resource-access/spec.md`、`agent-package-assembly/spec.md`、`bash-tool/spec.md`、`python-tool/spec.md`。
- 按需更新 `openspec/overview.md`。
- 按需更新 `openspec/designs/architecture/runtime-boundaries.md` 和 `skill-invocation-and-disclosure.md`。
- 按需更新 `openspec/designs/modules/agent-app.md`、`agent-runtime.md`、`agent-capability.md`、`agent-platform-gateway-local.md`。
- 新增或更新 `openspec/designs/adr/local-shared-data-root.md`。
- 更新 `openspec/designs/spec-to-design-map.md`。
- 检查长期文档没有重复定义同一 root vocabulary、路径 owner、sandbox filesystem contract 或 shared-data 执行语义。
