## 1. `FN-5.5 执行命令和脚本`

- [x] 1.1 建立 Bash Tool 对 `clipc --params.header` 的目标行为测试：Skill opt-in 后注入 `X-Subject-Id/X-Display-Name`、覆盖模型同名值、保留其他字段、不注入 `tenantId`，未 opt-in 时保持原参数
  来源：`FN-5.5 执行命令和脚本` + Requirement `Bash 为 opt-in 的 clipc 调用注入可信用户身份 Header` + Scenarios `注入可信 X-Subject-Id 和 X-Display-Name`、`模型不能覆盖身份字段`、`不注入 tenantId`
  验证：修改生产实现前运行 `npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/bash-capability.test.ts --maxWorkers=1 -t "clipc"`，确认新增测试因当前未注入身份而失败；实现后同一命令通过

- [x] 1.2 实现 Bash Tool 的受限 `clipc` 身份参数注入，并同步模型可见 Tool description
  来源：`FN-5.5 执行命令和脚本` + Requirement `Bash 为 opt-in 的 clipc 调用注入可信用户身份 Header` + design `FN-5.5 执行命令和脚本 / 修改方案`
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/bash-capability.test.ts --maxWorkers=1 -t "clipc"`；断言 Skill opt-in 后最终 sandbox argv 中 `--params` 为包含可信 `X-Subject-Id/X-Display-Name` 的 JSON object，且不含 `tenantId`；未 opt-in 时保持原参数

- [x] 1.3 补充 negative case：非 `clipc` executable、`--params` 缺失、`--params` 非 JSON object 均不改写 argv
  来源：`FN-5.5 执行命令和脚本` + Requirement `Bash 为 opt-in 的 clipc 调用注入可信用户身份 Header` + Scenarios `非 clipc 命令不注入身份 Header`、`缺少或非法 --params 不合成身份参数`
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/bash-capability.test.ts --maxWorkers=1 -t "clipc"`；断言对应请求的 sandbox argv 与模型输入保持一致

- [x] 1.4 验证 Bash Tool 既有 tokenization、sandbox 提交和执行结果语义不回退
  来源：design `FN-5.5 执行命令和脚本 / 修改方案`、`验证策略`
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/bash-capability.test.ts --maxWorkers=1`

- [x] 1.5 收敛 Bash Tool 模型可见 description 至 4096 字符门禁内，并新增全内置工具 description 长度回归测试
  来源：design `FN-5.5 执行命令和脚本 / 验证策略` + `ModelToolDescriptorSchema` 既有 description 4096 上限
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/builtin-tool-guidance.test.ts packages/agent-capability/tests/bash-capability.test.ts --maxWorkers=1`；`builtin-tool-guidance.test.ts` 断言每个 builtin tool description 及 background 变体 Bash description 均不超过 4096 字符

- [x] 1.6 将身份注入收敛为当前 active Skill 的 `metadata.extension.api_header_params` opt-in，未声明 `X-Subject-Id` / `X-Display-Name` 的 Skill 保持原 `--params` 不变
  来源：Requirement `Bash 为 opt-in 的 clipc 调用注入可信用户身份 Header` + Scenario `未 opt-in 的 clipc 调用保持原参数`
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/bash-capability.test.ts packages/agent-capability/tests/builtin-tool-guidance.test.ts --maxWorkers=1`；断言 opt-in 后注入可信身份、未 opt-in 时 sandbox argv 保持不变，模型可见 description 保持 4096 字符门禁内

## 2. Change 整体验证

- [x] 2.1 验证 OpenSpec change 与实现一致性，并确认最终 diff 只包含本 change 文档、Bash Tool 实现和对应测试
  来源：proposal `影响范围` + design `验证策略`
  验证：`npx --yes @fission-ai/openspec validate add-bash-clipc-user-headers --type change --strict`；`git diff --check`


结果（2026-08-21）：新增测试在实现前按预期失败；实现后 `bash-capability.test.ts` 通过，`npx tsc -p packages/agent-capability/tsconfig.json --pretty false` 通过，`npm run build` 和 `npm run lint:architecture` 通过，本 change OpenSpec strict validation 和 `git diff --check` 通过。
