## 1. `FN-4.1 调用模型`

- [x] 1.1 为 `ModelProfile.reasoningTextMode` 建立配置 contract 失败测试：合法 OpenAI-compatible 值被保留并冻结，字段缺失保持缺失，显式 `null`、未知值和 Model Gateway 配置阻止 ready；实现前确认目标断言失败。
  来源：`FN-4.1 调用模型` + `Agent App system config 使用 canonical model/provider 配置` + `模型 profile 可声明隐式 reasoning 起点` 的“未配置时保持显式模式”“不支持的 provider 配置隐式模式”“配置值非法” Scenarios
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-app/tests/system-config.test.ts --reporter=dot`；实现前新增目标用例按预期失败，实施后该文件全部通过。
  实际证据（2026-08-20）：实现前运行上述命令，新增合法值用例因状态仍为 `BLOCKED` 失败，3 个非法值与 Model Gateway 用例因仍返回 unknown-field code 失败；14 个既有用例通过，确认失败基线命中目标 contract。

- [x] 1.2 为 OpenAI-compatible adapter 建立目标行为失败测试：覆盖流式跨 chunk 孤立 `</think>`、非流式隐式分界，以及未配置显式标签、普通 content 和原生 `reasoning_content` 回归；实现前确认隐式模式断言失败。
  来源：`FN-4.1 调用模型` + `模型 profile 可声明隐式 reasoning 起点` 的“隐式起点流式响应完成归一化”“隐式起点非流式响应完成归一化”“未配置时保持显式模式” Scenarios
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-model/tests/openai-compatible-provider.test.ts --reporter=dot`；实现前隐式模式目标用例按预期失败，既有回归通过，实施后该文件全部通过。
  实际证据（2026-08-20）：实现前运行上述命令，非流式结果仍为 `content=inspect</think>answer` 且无 reasoning，流式 reasoning 仍为空；2 个新增目标用例失败、34 个既有用例通过。

- [x] 1.3 扩展 canonical model config contract 与 `agent-app` closed parser：增加 `reasoningTextMode` 精确 enum，保留合法 frozen 值，缺失时不合成字段，并拒绝非法值及非 OpenAI-compatible provider；不改变 `ResolvedModelConfiguration` 和 invocation/result shape。
  来源：`FN-4.1 调用模型` + `Agent App system config 使用 canonical model/provider 配置` + `模型 profile 可声明隐式 reasoning 起点` 全部配置 Scenarios；design `FN-4.1 调用模型 / 修改方案`
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-app/tests/system-config.test.ts tests/contract/model-invocation-contracts.test.ts --reporter=dot`；预期合法、缺省和 negative cases 全部通过，closed invocation/result contract 回归通过。
  实际证据（2026-08-20）：release config 下 `packages/agent-app/tests/system-config.test.ts` 19/19 通过；该 config 不收集根 contract 文件，改用 `npx vitest run --config vitest.config.contract.ts tests/contract/model-invocation-contracts.test.ts --reporter=dot`，10/10 通过，确认 profile schema 接受两个精确值并拒绝 null/unknown，request 与 resolved configuration 继续拒绝该字段。

- [x] 1.4 修改 OpenAI-compatible adapter 按 frozen selected model profile 设置 AI SDK reasoning middleware：`IMPLICIT_OPEN_THINK_TAG` 映射为 `startWithReasoning=true`，缺失或 `EXPLICIT_THINK_TAG` 映射为 `false`；stream/complete 复用同一 wrapped model，Core/Web 无新增解析。
  来源：`FN-4.1 调用模型` + `模型 profile 可声明隐式 reasoning 起点` 的三个正常 Scenarios；design `FN-4.1 调用模型 / 修改方案`
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-model/tests/openai-compatible-provider.test.ts --reporter=dot`；预期隐式、显式、普通 content、native reasoning、stream 和 complete 全部通过。
  实际证据（2026-08-20）：上述 provider test 36/36 通过；隐式非流式与跨 chunk 流式均得到 `reasoning=inspect`、`content=answer`，既有显式标签、普通 content 与原生 `reasoning_content` 回归保持通过。

- [x] 1.5 完成 `FN-4.1` focused build 与配置/模型回归，确认新增字段只停留在可信模型 binding，未进入 selection、request、Core 或 Web contract。
  来源：design `FN-4.1 调用模型 / 修改方案` 与 `验证策略`
  验证：`npm run build --workspace @nextagent/agent-contracts && npm run build --workspace @nextagent/agent-app && npm run build --workspace @nextagent/agent-model`，随后运行 `npx vitest run --config vitest.config.release.ts packages/agent-app/tests/system-config.test.ts packages/agent-model/tests/openai-compatible-provider.test.ts tests/contract/model-invocation-contracts.test.ts --reporter=dot`；预期 build 和 focused tests 全部通过。
  实际证据（2026-08-20）：三个 workspace build 均通过；release focused tests 2 files、55/55 通过，contract focused tests 10/10 通过；`rg reasoningTextMode packages tests` 仅命中 model config contract、app parser、OpenAI-compatible adapter及其测试，没有进入 selection、Core、runtime、channel 或 frontend。

- [x] 1.6 在 `docs/developer/12-deployment.md` 的 canonical 模型配置章节补充隐式 reasoning 起点示例，明确按模型配置、缺失字段不报错、默认显式模式、provider 限制及该字段不控制模型生成 reasoning。
  来源：用户 2026-08-20 补充开发者示例的明确要求 + `模型 profile 可声明隐式 reasoning 起点` 的全部正常与 provider 约束 Scenarios
  验证：`rg -n "reasoningTextMode|IMPLICIT_OPEN_THINK_TAG|EXPLICIT_THINK_TAG" docs/developer/12-deployment.md`、`git diff --check`、`openspec validate add-configurable-implicit-reasoning-start --strict`；预期示例和默认行为说明可定位，文档无空白错误且 change 严格校验通过。
  实际证据（2026-08-20）：`rg` 定位到字段表、YAML 启用示例、隐式模式语义和缺省不报错说明；`git diff --check` 退出 0；change strict validation 通过。

## 2. Change 整体验证

- [x] 2.1 完成 OpenSpec、后端 build、unit、contract 和 architecture 全部门禁，确认串行依赖的 300 秒默认超时目标态未回退且没有新增目录或越界解析 owner。
  来源：proposal `影响范围`；design `验证策略`、`长期基线刷新计划` 和 `迁移与回滚`
  验证：`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`openspec validate --all --strict`；预期全部通过。
  实际证据（2026-08-20）：更新至最新 `origin/main` 后，先将两个已被历史提交验证过但主线遗漏的测试断言收敛到当前 contract：Skill trust test 从 canonical `structuredPayload.body` 读取正文，diagnostic artifact test 在目录断言前等待 writer close；focused 2 files、13/13 通过。随后 `npm run build` 通过；`npm test` 171 files、2198/2198 通过；`npm run test:contract` 49 files、387/387 通过；`npm run lint:architecture` 51 files、314/314 通过；NetAgent external dependency guard 9/9 通过；`openspec validate --all --strict` 309/309 通过。默认配置仍为 `timeoutMs=300000`，未新增源码目录，provider framing 解析 owner 仍唯一位于 `agent-model`。

## 归档前更新基线检查（非实施任务）

实现和验证完成后，归档流程按照 design 的“长期基线刷新计划”归并 stable spec、Function、architecture、modules 和 spec-to-design-map，并确认 `raise-default-model-timeout-300s` 的 300 秒目标态已先进入或被本 change 串行保留。
