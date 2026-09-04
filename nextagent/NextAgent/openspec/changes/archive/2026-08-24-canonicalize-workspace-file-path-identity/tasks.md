## 0. OpenSpec 与架构前置门禁

- [x] 0.1 完成 change 的 Function/spec 映射、目录架构评审和受约束自然语言检视；完成后 proposal、specs、design、tasks 可作为唯一实施依据
  来源：proposal `Function 影响`；design `设计范围`、`待确认问题`
  验证：已运行 `npx.cmd --yes @fission-ai/openspec@latest validate canonicalize-workspace-file-path-identity --strict`（通过）并按 `$nextagent-skill-review` 完成语义检视（PASS WITH NOTE，无阻塞项、无 `agent-contracts` 变更）

## 1. `FN-3.2 编译智能体装配`

- [x] 1.1 先新增目录策略编译测试，覆盖 `.`、普通目录、已知 root、workspace 保留名称、缺省/空集合与非法路径；实施前确认新 canonical 断言失败
  来源：`FN-3.2 编译智能体装配` + `Agent 装配编译 root-qualified 文件目录权限` + `普通目录配置编译到 workspace`、`省略与显式空集合保持不同语义`、`缺省与显式空写目录保持兼容语义`、`保留显式特殊 root`、`非法目录阻断受影响 Agent 装配`
  验证：已运行 `npx.cmd vitest run --config vitest.config.release.ts tests/agent-kernel/config-assembly.test.ts --maxWorkers=1`；新增 canonical 断言按预期失败（收到 `diagnostics`/`.`，期望 `workspace/diagnostics`/`workspace`），另有 5 个与本 change 无关的存量失败

- [x] 1.2 修改 Agent workspace file policy 编译，使目录值 root-qualified 且保持既有缺省/显式空集合权限；完成后 runtime assembly 不再携带 `.` 或普通裸目录
  来源：`FN-3.2 编译智能体装配` + `Agent 装配编译 root-qualified 文件目录权限`；design `FN-3.2 编译智能体装配 / 修改方案`
  验证：已运行 `npx.cmd vitest run --config vitest.config.release.ts tests/agent-kernel/config-assembly.test.ts --maxWorkers=1 -t "workspace file authority"`；4 个目标用例通过、63 个未选用例跳过

## 2. `FN-5.3 读写编辑文件`

- [x] 2.1 先新增 Read/Write/Edit characterization 与目标行为测试，覆盖 bare/workspace 同物理文件、canonical 输出、跨 alias snapshot 和并发 identity、显式 Skill 读取与 protected-root 负例；实施前确认目标断言失败
  来源：`FN-5.3 读写编辑文件` + `文件操作工具使用 execution view 默认根` + `bare path 与显式 workspace path 指向同一文件`、`路径别名共享快照身份`、`workspace 中的保留名称必须显式限定`、`默认根不扩大受保护目录权限`；`显式 Skill resource 读取独立于 workspace 目录权限` + 两个 Scenarios
  验证：已运行 `npx.cmd vitest run --config vitest.config.release.ts packages/agent-capability/tests/read-capability.test.ts packages/agent-capability/tests/write-capability.test.ts packages/agent-capability/tests/edit-capability.test.ts packages/agent-capability/tests/skill-resource-projection.test.ts --maxWorkers=4`；新增 canonical output、alias snapshot 和 descriptor 断言按预期失败，Skill projection 空目录权限用例通过

- [x] 2.2 修改文件路径解析与 legacy workspace 入口，使 bare path canonicalize 到真实 workspace root，删除 synthetic executionView，并让已验证 Skill path 独立于 workspace directory match；完成后三个文件工具共享 canonical target
  来源：`FN-5.3 读写编辑文件` + `文件操作工具使用 execution view 默认根`、`Write Uses Trusted Agent-Scoped Directory Authority`、`显式 Skill resource 读取独立于 workspace 目录权限`；design `FN-5.3 读写编辑文件 / 修改方案`
  验证：已运行 `npx.cmd vitest run --config vitest.config.release.ts packages/agent-capability/tests/read-capability.test.ts packages/agent-capability/tests/write-capability.test.ts packages/agent-capability/tests/edit-capability.test.ts packages/agent-capability/tests/skill-resource-projection.test.ts --maxWorkers=4`；4 个文件通过，77 个用例通过、8 个按平台/条件跳过

- [x] 2.3 更新 Read/Write/Edit 模型描述与 workspace prompt，使其准确说明 workspace alias、canonical output 和 Skill 精确资源 root；完成后描述不再承诺 execution-view bare path 与 Bash/Python 同目标
  来源：`FN-5.3 读写编辑文件` + `workspace 是推荐的持久化写入目录` + `工具说明解释默认 workspace 与规范结果`；proposal 非目标 Bash/Python cwd
  验证：上述 Read/Write/Edit descriptor 用例通过；workspace prompt 明确文件工具 bare alias 与 Bash/Python cwd 语义分离，待 4.1 运行 prompt integration 验证

## 3. `FN-5.4 搜索文件`

- [x] 3.1 先新增 Glob/Grep 目标行为测试，覆盖省略 path 仅搜索 workspace、bare/qualified 同 search target、root-qualified 输出、显式 Skill subtree 与未授权 special root 负例；实施前确认新断言失败
  来源：`FN-5.4 搜索文件` + `文件搜索工具使用 execution view 默认根` + `缺省路径覆盖授权 execution view`、`默认搜索跳过未授权系统资源`、`bare 搜索路径映射到 workspace`、`显式搜索有效 Skill projection`、`显式 Skill 路径拒绝 scope 越权`；`Glob Has A Strict Pattern And Path Contract`、`Grep Has A Strict Pattern And Path Contract` + `最小合法输入使用全部 effective Read roots`；`Glob Uses Agent-Scoped Read Authority`、`Grep Uses Agent-Scoped Read Authority` + 授权/拒绝 Scenarios
  验证：实施前运行目标用例，22 个旧路径输出/默认搜索断言按预期失败；实现后目标命令 3 个文件通过，50 个用例通过、6 个按平台/条件跳过

- [x] 3.2 修改默认 search target 和遍历前缀，省略 path 仅消费 canonical workspace authority，显式 Skill path 继续独立验证并共享全局预算；完成后不再存在 `.` execution root 搜索分支
  来源：`FN-5.4 搜索文件` + 全部 MODIFIED Requirements；design `FN-5.4 搜索文件 / 修改方案`
  验证：已运行 `npx.cmd vitest run --config vitest.config.release.ts packages/agent-capability/tests/glob-capability.test.ts packages/agent-capability/tests/grep-capability.test.ts packages/agent-capability/tests/skill-resource-projection.test.ts --maxWorkers=3`；3 个文件通过，50 个用例通过、6 个按平台/条件跳过

## 4. 跨 Function 集成与迁移

- [x] 4.1 验证 compiled canonical authority 经真实 ExecutionWorkspaceResolver 被 Read/Write/Edit/Glob/Grep 一致消费，且不修改 sandbox cwd、公共 contracts 或 scope root 派生
  来源：`FN-3.2`、`FN-5.3`、`FN-5.4`；design `跨 Function 协作与端到端流程`、`跨 Function 质量属性设计`
  验证：相关 config、workspace file、prompt 与 E2E 路径用例已运行；本 change 的 169 个相关用例通过，真实 resolver 的 E2E 已执行到 canonical `workspace/...` 成功结果。`npm run test:contract` 为 364 通过、2 个因其他 change 缺失 YAML 失败；`npm run lint:architecture` 的依赖和 manifest 检查通过、299 个 architecture 用例通过，1 个 Bash 旧字符串断言失败；均与本 change 无关

- [x] 4.2 生成可重复安装的本地 runtime 包并记录 artifact 路径与校验值，供人工业务验证；不得 push、创建 PR 或修改长期基线
  来源：用户要求；proposal `影响范围`；design `迁移与回滚`
  验证：已运行 `npm.cmd run pack -- dist/pack nextagent-canonical-workspace-paths-20260811 with-frontend skip --stage-default-agent`；runtime workspace rebuild、前端多宿主构建、artifact assembly、归档与 extracted-package self-check 均通过。产物 `nextagent-canonical-workspace-paths-20260811-win32-x64.zip`，23,989,800 bytes，SHA-256 `694562B769D0F111CFC5B76B67804535EDA70D1310978FEA7CC394E2853437BB`。因真实模型环境返回 `MODEL_INTERNAL_ERROR`，先独立运行并记录 smoke 失败后使用 `skip` 避免重复执行

## 5. Change 整体验证

- [x] 5.1 执行 OpenSpec、构建、相关测试、contract 和 architecture 门禁并记录任何仓库既有失败；只有本 change 相关门禁通过时才视为本地验证完成
  来源：proposal `影响范围`；design `验证策略`
  验证：当前 change 严格校验通过；全量 OpenSpec 238 通过、8 个既有项失败。`npm run build` 被 `agent-workflow` 既有 6 个 TS18048 阻断，但打包脚本独立 runtime/frontend rebuild 通过。`npm test` 为 156 个文件通过、1 个 `agent-model` 既有授权断言失败（1966/1967 tests 通过）。contract 为 45/46 文件通过，失败源于缺失 `add-long-term-memory-batch-create` reference。architecture 为 48/49 文件通过，失败源于 Bash 旧字符串断言。当前 change 相关 OpenSpec、类型、测试、打包与自检均通过

## 归档前更新基线检查（非实施任务）

实现和本地验证完成后，归档流程按照 design 的“长期基线刷新计划”归并 stable specs、Functions、Features、architecture、modules 与 spec-to-design-map；在用户完成本地包验证并决定提交 PR 前，不执行归档或长期基线更新。
