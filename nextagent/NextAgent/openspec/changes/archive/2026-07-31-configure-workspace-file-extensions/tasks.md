## 1. 配置与 Agent assembly contract

- [x] 1.1 扩展现有 `WorkspaceFilesDefinition` 和 Agent definition parser，接受可选 `readAllowedExtensions`、`readDeniedExtensions`、`writeAllowedExtensions`、`writeDeniedExtensions`，保留 allowlist 的 undefined/empty 差异，并拒绝格式非法或同数组重复条目。
  验证：运行 agent definition parser 定向 Vitest；测试实际提交四种合法列表组合；提交 `.JSON`、`json`、`.tar.gz`、`*`、`.`、含分隔符和同数组重复条目并断言编译失败；同一后缀位于 allowlist/denylist 时断言配置被接受。
  来源：spec `app-config-schema / Agent workspace file extension authority`；design D1、D2。

- [x] 1.2 在 `agent-app` 编译四个 optional allowlist/denylist 为私有 policy，并通过按 Agent/version 精确解析的 provider 注入 `WorkspaceFilePort`；保持 `AgentWorkspaceFilePolicy` 和其他 frozen contract 不变。
  验证：运行 assembly/compiler、composition 和 core contract 定向测试；`git diff -- packages/agent-contracts` 为空；`npm run build`。
  来源：spec `agent-package-assembly / Agent-scoped file extension policy compilation`；design D1、D5。

- [x] 1.3 更新默认 Agent fixture 和用户配置说明，展示 deny-only、allow-only、deny 优先、显式空 allowlist、读取/写入策略独立以及 `.txt`/`.md` 等内部产物读回注意事项，默认生产配置不启用新限制。
  验证：运行默认 Agent assembly/config 测试；检查示例能被真实 parser 接受且 default assembly 行为不变。
  来源：proposal 兼容性与运维影响；design 发布、兼容与回滚计划。

## 2. 统一 workspace file policy enforcement

- [x] 2.1 在 workspace-files policy resolution 中实现四个列表的预构建 `ReadonlySet` 与 deny-first 判定，并保持读取/写入策略独立，以 Agent/version 为 key 缓存 resolved policy。
  验证：运行 workspace policy truth-table tests，分别覆盖读取和写入的均缺省、deny-only、allow-only、allow+deny、同值冲突、显式空 allowlist；断言不同 Agent/version 不复用策略。
  来源：spec `agent-package-assembly / Agent-scoped file extension policy compilation`；design D1、D5。

- [x] 2.2 实现单一最终后缀授权 helper，在规范化目标上提供大小写不敏感、最终后缀精确匹配和无后缀判定。
  验证：运行 helper/port 单元测试，覆盖 `.json`、`.JSON`、`.tar.gz`、`.env`、`README`；另断言 `name.` 保持既有路径语法拒绝，不由 extension policy 改写。
  来源：spec `read-tool / Read file extension authorization`；design D2、D3。

- [x] 2.3 将读取 extension guard 接入 `readText`，保证未授权检查先于 stat/snapshot/content read，并返回既有 `FILE_UNAVAILABLE` 安全结果。
  验证：运行 `packages/agent-capability/tests/read-capability.test.ts` 与 port 定向测试；对存在和不存在的同名后缀目标断言结果不可区分、未建立 snapshot。
  来源：spec `read-tool / Read file extension authorization`；design D3、D4。

- [x] 2.4 将读取 extension guard 接入 `globFiles`，在可见结果计数和上限计算前省略未授权文件。
  验证：运行 Glob 定向测试；构造超过结果上限的未授权文件加一个授权文件，断言授权文件仍返回且未授权文件名不出现。
  来源：spec `glob-tool / Glob file extension filtering`；design D3、D4。

- [x] 2.5 将读取 extension guard 接入 `grepFiles`，在文件 open、扫描字节预算和匹配生成前跳过未授权文件。
  验证：运行 Grep 定向测试；让未授权文件包含匹配文本并占用足以触发预算的内容，断言不产生匹配且不阻止授权文件被扫描。
  来源：spec `grep-tool / Grep file extension filtering`；design D3、D4。

- [x] 2.6 将写入 extension guard 接入 `writeText`，在目标存在性、snapshot 和 mutation 前以 `CAPABILITY_PATH_REJECTED` 拒绝未授权目标。
  验证：运行 `packages/agent-capability/tests/write-capability.test.ts`；对已有/不存在未授权目标断言相同授权错误、无 `WRITE_REQUIRES_FULL_READ` 泄漏且文件系统无变化。
  来源：spec `write-tool / Write file extension authorization`；design D3、D4。

- [x] 2.7 将写入 extension guard 接入 `editText`，在目标存在性、snapshot、内容读取和字符串匹配前以 `CAPABILITY_PATH_REJECTED` 拒绝未授权目标。
  验证：运行 `packages/agent-capability/tests/edit-capability.test.ts`；对已有/不存在及匹配/不匹配未授权目标断言相同授权错误且原文件不变。
  来源：spec `edit-tool / Edit file extension authorization`；design D3、D4。

## 3. 跨路径兼容性与安全验证

- [x] 3.1 增加 Read/Glob/Grep 对 workspace、只读 shared-data 和已授权 Skill resource 使用同一后缀策略的黑盒测试。
  验证：运行 workspace-files、shared-data、skill-resource-access 定向测试；每个 root 均实际创建授权和未授权后缀文件并断言无旁路。
  来源：proposal 文件 Tool 范围；design D3。

- [x] 3.2 增加 Skill projection 与 large-content externalization 不受内部写入限制、但模型 Read 读回受限制的 characterization tests。
  验证：运行 Skill projection 与 `packages/agent-app/tests/large-content-externalizer.test.ts`；断言内部 `.txt`/resource 生成成功，受限 Agent 的 Read 返回 `FILE_UNAVAILABLE`，授权后可读。
  来源：proposal 内部非 Tool Calling 边界；design D3、风险与取舍。

- [x] 3.3 增加读取/写入策略独立且已有文件写操作仍要求 full-Read snapshot 的集成测试。
  验证：运行 read→write 和 read→edit 定向测试；配置 `readAllowedExtensions: [".log"]`、`writeAllowedExtensions: [".json"]`，断言新建 `.json` 可成功，已有 `.json` 无法建立 snapshot 因而不能覆盖或 Edit；同时允许读取 `.json` 后既有操作成功。
  来源：spec `agent-package-assembly / Agent-scoped file extension policy compilation`、`edit-tool / Edit requires independent read and write authorization`。

- [x] 3.4 增加四种列表组合、deny 优先、缺省全兼容和显式空 allowlist 的 negative tests。
  验证：运行五个文件 Tool 定向测试；均缺省时复现现有行为；deny-only 仅排除命中项；allow-only 仅接受命中项；allow+deny 对冲突项拒绝并由 allowlist 控制其余项；空读取 allowlist 时 Glob/Grep 无结果且 Read 不可用；空写入 allowlist 时 Write/Edit 均授权失败。
  来源：spec 各 capability 的 missing/empty 场景；design D1。

- [x] 3.5 检查新增失败路径和观测数据不记录目标路径、extension policy、文件存在性或内容。
  验证：运行 capability/observability 定向测试并断言日志、safe details、metric/trace 无原始路径、后缀列表和内容；模型语义 review 检查无法由静态断言覆盖的日志调用参数。
  来源：proposal 安全影响；design D4、质量属性“审计/可追溯性”。

- [x] 3.6 增加 extension-policy 拒绝不会终止 Agentic loop 的黑盒测试。
  验证：模型第一轮调用 Write/Edit 选择未授权后缀并收到 `CAPABILITY_PATH_REJECTED`，第二轮选择允许目标或生成最终回答；断言同一 request/run 未进入 terminal failure 且后续轮次被执行。
  来源：spec `write-tool / Rejected extension does not terminate the Agentic loop`、`edit-tool / Rejected extension can be corrected in the same loop`；design D4。

- [x] 3.7 Project recoverable Write/Edit extension-policy failures into the corresponding Tool Calling result without changing frozen contracts.
  验证：扩展 tool-loop 黑盒测试，断言每次拒绝均在 `CAPABILITY_COMPLETED` 前发出同一 `toolCallId` 的 `CAPABILITY_RESULT_DELTA`，只包含安全 status/code/category/safeSummary；扩展前端 projection 测试，断言实时错误显示在对应 Tool Calling 上且不显示原始路径、策略或内容。
  来源：spec `write-tool / Rejected extension is projected to the corresponding Tool Calling result`、`edit-tool / Rejected extension is projected to the corresponding Tool Calling result`；design D4。

## 4. 门禁与收尾

- [x] 4.1 运行相关包和仓库级验证，修复本 change 引入的所有失败。
  验证：`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`openspec validate --all --strict` 全部通过，并记录实际输出。
  来源：AGENTS.md 验证门禁；design Verification Map。

- [x] 4.2 使用 `$nextagent-code-review` 对实现 diff 做模型语义检视，覆盖 Frozen core contract、Architecture boundary、Minimal kernel non-regression、Security、OpenSpec consistency、Clean Code，并处理所有 P0/P1。
  验证：review 结论为 PASS 或 PASS WITH FOLLOW-UP；若为后者，在 tasks 或 issue 中记录每个 P2 follow-up owner 和验收路径。
  来源：AGENTS.md push gate；design 质量属性设计。

- [x] 4.3 清理本次改动产生的重复 helper、未使用字段/import、临时 fixture 和 debug logging，并核对所有任务均有实际验证证据后再勾选。
  验证：`git diff --check`、定向测试复跑、code review 逐项核对 touched files；不得仅以“测试通过”替代证据。
  来源：AGENTS.md 实现质量门禁；proposal 外科手术式范围。

- [x] 4.4 Re-run the focused backend/frontend tests, affected builds, strict OpenSpec validation, and model semantic review after the correlated failure-result projection change.
  验证：focused Vitest、后端 `npm run build`、前端 `npm run build`、`openspec validate configure-workspace-file-extensions --strict` 与 `$nextagent-code-review` 均通过；`git diff -- packages/agent-contracts` 为空。
  来源：AGENTS.md 验证门禁与 Frozen core contract 约束；design Verification Map。

## 归档前更新基线检查（非实施任务）

实现完成且验证通过后，归档前按 proposal/design 的 Baseline Promotion Plan：

- 合并七个 capability delta 到对应 `openspec/specs/` 基线。
- 更新 `openspec/overview.md` 的 workspace 文件类型最小权限背景。
- 更新 `openspec/designs/architecture/configuration-boundary.md`。
- 更新 `openspec/designs/modules/agent-app.md` 与 `agent-capability.md`。
- 新增 `openspec/designs/adr/workspace-file-extension-authority.md`。
- 更新 `openspec/designs/spec-to-design-map.md` 的导航与验证入口。
- 检查长期文档未重复定义 extension schema、deny-first 判定、authority owner 或匹配语义。
