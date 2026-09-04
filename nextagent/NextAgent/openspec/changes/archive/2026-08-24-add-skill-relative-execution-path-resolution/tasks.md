## 1. `FN-5.5 执行命令和脚本`

- [x] 1.1 在 `skill-resource-projection.test.ts` 和 `bash-capability.test.ts` 建立唯一匹配、显式 Skill 名称、无匹配保持、歧义拒绝及原 Tool input 不变的目标行为测试；实现前确认新增正例失败
  来源：`FN-5.5` + `Bash 补全唯一匹配的 Skill 相对脚本路径` + `Skill 名称前缀的 Python 脚本唯一匹配`、`不带 Skill 名称的 shell 脚本唯一匹配`、`显式 Skill 名称不存在时不跨 Skill 回退`、`无匹配时保持既有执行行为`；`Skill 相对脚本解析保持 projection 安全边界` + `同名脚本歧义时拒绝猜测`、`显式 Skill 名称消除同名歧义`
  验证：运行 `npx.cmd vitest run --config vitest.config.release.ts packages/agent-capability/tests/bash-capability.test.ts packages/agent-capability/tests/skill-resource-projection.test.ts --maxWorkers=2`；实现前新增补全/歧义断言按预期失败，既有 characterization 通过

- [x] 1.2 为 `WorkspaceFilePort` 增加 scope-derived `resolveSkillResourcePath` 三态接口，复用 committed projection、manifest、containment、link 和普通文件验证，并只返回排序后的逻辑路径
  来源：design `FN-5.5 执行命令和脚本 / 修改方案 / 1. 在 WorkspaceFilePort 增加窄解析接口`；`FN-5.5` + 安全 + `Skill 相对脚本解析保持 projection 安全边界` + `未提交或跨 scope projection 不参与匹配`、`链接逃逸候选不参与匹配`
  验证：运行 `npx.cmd vitest run --config vitest.config.release.ts packages/agent-capability/tests/skill-resource-projection.test.ts --maxWorkers=1`；当前 scope 唯一/歧义结果正确，未提交、损坏、跨 scope、symlink/junction/reparse 候选不匹配且结果不含物理路径

- [x] 1.3 在 Bash sandbox preparation 前识别四个直接解释器与对应脚本后缀，唯一匹配时只替换首个 argv，歧义时返回稳定 SafeError，无匹配和不支持形式保持原行为
  来源：design `FN-5.5 执行命令和脚本 / 修改方案 / 2. Bash 只识别直接解释器脚本执行`；`FN-5.5` + `Bash 补全唯一匹配的 Skill 相对脚本路径` 全部 Scenarios；`Skill 相对脚本解析保持 projection 安全边界` + `同名脚本歧义时拒绝猜测`
  验证：运行 `npx.cmd vitest run --config vitest.config.release.ts packages/agent-capability/tests/bash-capability.test.ts packages/agent-capability/tests/skill-resource-projection.test.ts --maxWorkers=2`；唯一匹配 gateway argv 已补全，歧义 sandbox 零调用，其他输入保持原 argv

- [x] 1.4 补充绝对路径、父级穿越、known logical root、错误后缀、`references/`、`-c/-lc/-m`、管道、重定向、命令替换和 wrapper 的安全/兼容负例
  来源：`FN-5.5` + `Bash 补全唯一匹配的 Skill 相对脚本路径` + `复杂命令和非脚本参数不自动补全`；`FN-5.5` + 安全 + `Skill 相对脚本解析保持 projection 安全边界`
  验证：运行 `npx.cmd vitest run --config vitest.config.release.ts packages/agent-capability/tests/bash-capability.test.ts packages/agent-capability/tests/skill-resource-projection.test.ts --maxWorkers=2`；每个禁止输入均实际触发并断言不补全、不越权且不泄露物理路径

- [x] 1.5 更新 Bash descriptor 的窄兼容说明，明确唯一匹配、歧义失败、复杂命令不改写以及显式 root-qualified 路径优先
  来源：proposal `What Changes`；design `FN-5.5 执行命令和脚本 / 修改方案 / 2. Bash 只识别直接解释器脚本执行`
  验证：运行 `npx.cmd vitest run --config vitest.config.release.ts packages/agent-capability/tests/bash-capability.test.ts --maxWorkers=1`；descriptor 断言覆盖全部兼容边界

## 2. Change 整体验证

- [x] 2.1 严格校验 change，并确认 Function/spec 1:1、delta operation、owner 边界和无 `agent-contracts` 变更
  来源：proposal `Function 影响（OpenSpec Capabilities）`；design `验证策略`
  验证：运行 `npx.cmd --yes @fission-ai/openspec@latest validate add-skill-relative-execution-path-resolution --strict` 和 `$nextagent-skill-review`；预期 strict validation 与语义审查均 PASS

- [x] 2.2 运行 capability 聚焦测试、contract 与 architecture gates，确认 canonical workspace、Skill projection、Bash streaming/background 和 sandbox policy 非回归
  来源：proposal `影响范围`；design `验证策略`
  验证：运行相关 Vitest suites、`npm run test:contract`、`npm run lint:architecture` 和 `npm run build`；本 change 相关用例全部通过，若主线既有失败则记录精确失败且确认不涉及本 change 文件

### 实施验证记录（2026-08-12）

- 聚焦回归：9 个测试文件通过，142 个用例通过，6 个平台相关用例跳过；`agent-capability` strict TypeScript 检查通过。
- 全量测试：155 个测试文件、1965 个用例通过；保留 2 个不涉及本 change 文件的既有失败：`per-call-skill-trust.test.ts` 与 `model-catalog.test.ts`。
- OpenSpec：当前 change 严格校验通过；全量严格校验 239 项通过、8 项既有失败，新增 change 不在失败项中。
- 既有全量门禁：build 的 `workflow-batch-template-string-loader.test.ts` 存在 6 个 `searchNode` 可能为 `undefined` 的错误；contract 缺少 long-term-memory batch create API fixture；architecture 的 sandbox source assertion 缺少既有标记。以上失败均不涉及本 change 文件。
- `$nextagent-skill-review`：PASS；Function/spec 1:1、projection owner、安全负例和无 `agent-contracts` 变更均满足。
- `$nextagent-code-review`：PASS WITH FOLLOW-UP；未发现本 change 的 P0/P1，推送后继续由对应既有 change 处理全库基线失败。

## 归档前更新基线检查（非实施任务）

归档流程按照 design 的“长期基线刷新计划”同步 stable spec、`FN-5.5`、`F-5.3`、module 设计和 spec-to-design-map，并检查不重复定义 projection authority、sandbox contract 或路径语义。
