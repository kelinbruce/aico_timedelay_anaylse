## 1. 配置与装配

- [x] 1.1 扩展 app composition sandbox 配置 schema、Raw/Default config shape 和默认配置，新增 `sandbox.disable` 且默认 `false`。
  验证：`npm test -- --run tests/agent-kernel/config-assembly.test.ts`
  来源：spec requirement "Sandbox function disable switch is startup validated and frozen"；design decision "frozen local config projection"
- [x] 1.2 将 frozen `DefaultSystemConfig.sandbox.disable` 传入 Bash tool config 和 local restricted sandbox gateway 装配路径。
  验证：`npm run build`
  来源：spec requirement "Local restricted sandbox can disable function validation only by frozen local config"；design decision "agent-app projection"

## 2. Bash policy 和 restricted local sandbox 行为

- [x] 2.1 保持默认 Bash policy 和 local restricted sandbox 校验行为，覆盖 unsupported command、unsafe path、request environment 和 workingDirectory override 的 negative cases。
  验证：`npm test -- --run packages/agent-capability/tests/bash-capability.test.ts packages/agent-platform-gateway-local/tests/restricted-local-sandbox.test.ts`
  来源：scenario "Default Bash policy remains strict"；scenario "Default local sandbox validation remains enabled"
- [x] 2.2 实现 `disable=true` 时跳过 Bash tool-level policy 和 adapter 函数校验，同时保留 sandbox dependency/gateway execution、fixed cwd、sanitized env、timeout/cancellation 和 output limit。
  验证：`npm test -- --run packages/agent-capability/tests/bash-capability.test.ts packages/agent-platform-gateway-local/tests/restricted-local-sandbox.test.ts`
  来源：scenario "Disabled validation relaxes Bash policy before sandbox submission"；scenario "Explicit local config disables adapter function validation"；design quality attribute "安全"

## 3. 验证和收尾

- [x] 3.1 验证 OpenSpec change 和相关 TS 构建/测试。
  验证：`openspec validate --all --strict`、`npm run build`、`npm test -- --run packages/agent-capability/tests/bash-capability.test.ts packages/agent-platform-gateway-local/tests/restricted-local-sandbox.test.ts tests/agent-kernel/config-assembly.test.ts`
  来源：proposal impact；design verification map
- [x] 3.2 检查实现没有新增 request-time 配置读取、host execution bypass、raw command/output logging 或长期基线文档直接修改。
  验证：code review 检查点；`git diff -- openspec/changes/allow-local-sandbox-validation-disable packages/agent-app packages/agent-platform-gateway-local tests`
  来源：design non-goals；AGENTS.md sandbox/security constraints

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，在归档前根据 proposal/design 的“归档前更新基线”处理：

- 同步 `openspec/specs/bash-tool/spec.md`、`openspec/specs/sandbox-deny-by-default-adapter/spec.md` 和 `openspec/specs/app-config-schema/spec.md`。
- 按需更新 `openspec/designs/architecture/configuration-boundary.md`。
- 按需更新 `openspec/designs/modules/agent-app.md` 和 `openspec/designs/modules/agent-platform-gateway-local.md`。
- 按需更新 `openspec/designs/spec-to-design-map.md`。
- 检查长期文档没有重复定义同一配置字段、adapter 语义或执行边界。
