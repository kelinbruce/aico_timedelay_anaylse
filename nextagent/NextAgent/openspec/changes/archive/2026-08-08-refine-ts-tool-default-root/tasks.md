## 1. `FN-5.3 读写编辑文件`

- [x] 1.1 为 Read、Write、Edit 建立 execution-view-relative 目标行为与安全失败测试；实施前运行并确认无 root 前缀路径用例在现状下失败
  来源：`FN-5.3` + `文件操作工具使用 execution view 默认根` + `无 root 前缀路径与 Bash 指向同一目标`、`显式 workspace 路径写入持久化目录`、`默认根不扩大受保护目录权限`；`workspace 是推荐的持久化写入目录` + `工具说明区分默认根与持久化目录`
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/read-capability.test.ts packages/agent-capability/tests/write-capability.test.ts packages/agent-capability/tests/edit-capability.test.ts`；实施前新增默认根断言至少一项失败，negative 与 descriptor 断言可重复执行
  记录：2026-07-31 实施前运行，新增 descriptor 与 `root.txt` 用例按预期失败；实施后相关套件通过。

- [x] 1.2 原子迁移 FN-5.3 被触及 Requirements：来源 `write-tool`/`edit-tool` 使用 `REMOVED`，目标 `file-operation-tools` 使用 `ADDED` 完整承载目标行为，来源未触及 Requirements 原位保留
  来源：design `存量 Requirement 迁移方案`、`FN-5.3 读写编辑文件 / 目标与规范依据`
  验证：`openspec validate refine-ts-tool-default-root --strict`；预期 change 有效，且 `rg -n "Write Input And Output Are Bounded|Write Uses Trusted Agent-Scoped Directory Authority|Edit Input And Output Are Bounded|Edit Rejects Targets Outside Authorized Write Directories" openspec/changes/refine-ts-tool-default-root/specs` 显示每项恰有来源 removal 与 canonical target 承载
  记录：2026-07-31 严格校验通过，四项 Requirement 均完成来源 removal 与 canonical target 承载。

- [x] 1.3 在 `WorkspaceFilePort` 共享解析路径中实现 known-root 优先的 execution view 默认根、完整逻辑路径 directory authority 与物理路径不投影；同步 Read、Write、Edit descriptor
  来源：`FN-5.3` + `文件操作工具使用 execution view 默认根`、`workspace 是推荐的持久化写入目录`、`Write Uses Trusted Agent-Scoped Directory Authority`、`Edit Rejects Targets Outside Authorized Write Directories`；design `FN-5.3 读写编辑文件 / 修改方案`
  验证：运行 1.1 的 Vitest 命令；预期全部通过，`notes.txt` 与 `workspace/notes.txt` 分别命中 scope 根和 durable root，`.` 授权仍拒绝 `.nextagent`、`shared-data`、绝对路径、父级和链接逃逸
  记录：2026-07-31 `workspace-file-extension-policy.test.ts` 13/13 通过；相关 Read/Write/Edit 与路径安全套件通过。

## 2. `FN-5.4 搜索文件`

- [x] 2.1 为 Glob、Grep 建立缺省 execution view 搜索、显式相对路径、全局结果和 protected-root 排除测试；实施前运行并确认 scope 根结果用例在现状下失败
  来源：`FN-5.4` + `文件搜索工具使用 execution view 默认根` + `缺省路径覆盖授权 execution view`、`默认搜索跳过未授权系统资源`；`Glob Uses Agent-Scoped Read Authority`、`Grep Uses Agent-Scoped Read Authority` + `授权目录被搜索`、`未授权目录被拒绝`
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/glob-capability.test.ts packages/agent-capability/tests/grep-capability.test.ts packages/agent-capability/tests/workspace-file-extension-policy.test.ts packages/agent-capability/tests/skill-resource-projection.test.ts`；实施前新增 scope 根断言至少一项失败，negative assertions 可重复执行
  记录：2026-07-31 实施前 scope 根搜索用例按预期失败；实施后 Glob/Grep、extension policy 与 Skill projection 套件通过。

- [x] 2.2 原子迁移 FN-5.4 被触及 Requirements：来源 `builtin-tool-framework`/`glob-tool`/`grep-tool` 使用 `REMOVED`，目标 `file-search-tools` 使用 `ADDED` 完整承载黑盒目标，来源混合 Requirement 的白盒约束进入 design，来源未触及 Requirements 原位保留
  来源：design `存量 Requirement 迁移方案`、`FN-5.4 搜索文件 / 目标与规范依据`
  验证：`openspec validate refine-ts-tool-default-root --strict`；预期 change 有效，且 `rg -n "Workspace File Dependency Supports Governed Discovery|Glob Has A Strict Pattern And Path Contract|Glob Uses Agent-Scoped Read Authority|Grep Has A Strict Pattern And Path Contract|Grep Uses Agent-Scoped Read Authority" openspec/changes/refine-ts-tool-default-root/specs` 显示每个被触及 Requirement 有来源 removal，黑盒目标仅由 canonical target 承载
  记录：2026-07-31 严格校验通过；混合 Requirement 的黑盒与白盒承载已按 design 收敛。

- [x] 2.3 复用 `WorkspaceFilePort` 搜索流程展开 execution view effective roots，首层排除 known logical roots并按当前 view 受控重入，同步 Glob、Grep descriptor/schema
  来源：`FN-5.4` + `文件搜索工具使用 execution view 默认根`、`Glob Has A Strict Pattern And Path Contract`、`Glob Uses Agent-Scoped Read Authority`、`Grep Has A Strict Pattern And Path Contract`、`Grep Uses Agent-Scoped Read Authority`；design `FN-5.4 搜索文件 / 修改方案`
  验证：运行 2.1 的 Vitest 命令；预期全部通过，缺省结果同时包含 scope 根与 `workspace/` 文件，并排除 `.nextagent`、shared-data、其他 run temp 和 symlink，全部 roots 共享既有单一容量预算
  记录：2026-07-31 相关 targeted 合集 9 个文件全部通过；Windows 下平台相关 Bash 用例按既有条件跳过。

## 3. 跨 Function 集成与迁移

- [x] 3.1 建立同一 accepted run 中 Bash 默认 cwd 与 Read、Write、Glob、Grep 的双向逻辑路径一致性集成测试，且 REMOTE view 不把 `/work` 当作宿主物理路径
  来源：`FN-5.3`、`FN-5.4` + design `跨 Function 协作与端到端流程`、`跨 Function 质量属性设计`
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/sandbox-execution-port.test.ts packages/agent-capability/tests/skill-resource-projection.test.ts packages/agent-capability/tests/read-capability.test.ts packages/agent-capability/tests/glob-capability.test.ts packages/agent-capability/tests/grep-capability.test.ts packages/agent-capability/tests/workspace-file-extension-policy.test.ts`；预期跨 Tool 访问同一文件、返回 execution-view-relative 路径且不出现 scopeBase 或宿主绝对路径
  记录：2026-07-31 resolver-backed REMOTE `/work` 用例通过；真实 Bash 双向用例已加入 POSIX gate，当前 Windows local gateway 按既有 contract 不支持 Bash，故该项平台跳过。

## 4. Change 整体验证

- [x] 4.1 完成后端构建、测试、contract、architecture 与 OpenSpec 全量门禁，并确认未修改 frontend 或 public contract
  来源：proposal `影响范围` + design `验证策略`
  验证：`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`openspec validate refine-ts-tool-default-root --strict`、`openspec validate --all --strict`；预期全部退出码为 0；`git diff -- frontend/agent-web packages/agent-contracts` 为空
  记录：2026-08-08 基于 `origin/main@c511cb117` 使用 Node 22.22.2 重放：`npm run build`、`npm test`、`npm run test:contract`（46 files / 364 tests）与本 change strict validation 通过；受影响范围 8 files / 141 tests 在允许 Unix socket 的环境中通过。`npm run lint:architecture` 的 dependency-cruiser 与 package manifest policy 通过，Vitest 292/293 通过，唯一失败是既有 `runtime-logging-boundary` 对 `packages/agent-capability/src/builtins/api-call-tool.ts` 的检查；全量 OpenSpec 308/311 通过，三个失败均为其他 active change `fix-conversation-preview-validation`、`fix-session-list-validation`、`fix-share-validation-error-messages` 缺少 delta。上述失败路径相对 `origin/main` 无差异；`git diff -- frontend/agent-web packages/agent-contracts` 为空，未修改 frontend 或 public contract。为恢复 main 后续变更引入的测试基线，另修正 Bash/shared-root 用例的当前结构化 argv 写法，并让不可写目录用例实际设置权限后再断言安全失败。
  刷新记录（2026-08-10）：基于 `origin/main@5485cef50` 使用 Node 22.22.2 重放，当前 change strict validation 通过；受影响范围在非受限环境为 8 files / 141 tests 全部通过，且 `git diff -- frontend/agent-web packages/agent-contracts` 为空。受限环境根测试为 151 files passed / 3 failed / 1 skipped，失败均来自 listen `EPERM`、metric timeout 或浏览器启动权限；contract 的 listen `EPERM`/timeout 同属环境限制。最新 main 的 `npm run build` 另有未触达的 memory route test 类型错误，已复用 [#693](https://gitcode.com/gdd_hw/NextAgent/issues/693) 并指派 `xubaojian`；architecture logging 失败由 [#706](https://gitcode.com/gdd_hw/NextAgent/issues/706) 跟踪，三个无 delta OpenSpec 失败由 [#707](https://gitcode.com/gdd_hw/NextAgent/issues/707) 跟踪。用户同意这些已归因、已跟踪的 main baseline 不阻断本次归档；该接受不表述为全量门禁退出码均为 0。

## 归档前更新基线检查（非实施任务）

实现和验证完成后，归档流程按照 design 的“长期基线刷新计划”归并两个 canonical specs、四个 legacy specs、FN-5.3、FN-5.4、F-5.2、相关 architecture/module 文档和 spec-to-design-map；检查长期文档不重复定义路径 contract、owner 或 root authority。
