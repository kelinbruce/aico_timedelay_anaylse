## 1. 规格和配置边界

- [x] 1.1 验证 active change 的 proposal、delta specs、design 和 tasks 完整且严格有效
  验证：`openspec validate enable-controlled-clipc-bash-command --strict`
  来源：proposal 全范围；design D1-D5
- [x] 1.2 将 app sandbox 配置收窄为专用 `clipcExecutableDirectoryEnv`，移除通用 `additionalExecutables` shape
  验证：`tests/agent-kernel/config-assembly.test.ts` 和 TypeScript build
  来源：sandbox-runtime / Restricted Local Sandbox Resolves Governed Business Executables From Trusted Configuration；design D2
- [x] 1.3 恢复 `configRoot/skills` 生产 system Skill 根，并保持测试 fixture 由测试专用路径使用
  验证：`tests/agent-kernel/local-skill-source-config.test.ts`、`tests/agent-kernel/config-assembly.test.ts`
  来源：proposal 变更范围；design D5

## 2. 受控执行实现

- [x] 2.1 完成 Bash `clipc` 参数策略并覆盖合法与非法命令
  验证：`packages/agent-capability/tests/bash-capability.test.ts`
  来源：bash-tool / Bash Default Commands Are Local And Read Only；Bash Is Workspace Scoped And Network CLI Is Denied
- [x] 2.2 restricted local sandbox 使用专用 `clipcExecutableDirectory` 定位并结构化执行 `clipc`
  验证：`packages/agent-platform-gateway-local/tests/restricted-local-sandbox.test.ts`
  来源：sandbox-runtime / Restricted Local Sandbox Resolves Governed Business Executables From Trusted Configuration；design D3
- [x] 2.3 app composition 从受信环境变量读取 `clipc` 目录并注入默认 sandbox gateway
  验证：`tests/agent-kernel/config-assembly.test.ts` 或等价 app composition focused test
  来源：design D2、D4

## 3. 负向和集成验证

- [x] 3.1 增加 policy 到 sandbox gateway 的真实执行测试，证明授权后的 `clipc` 不再被下一层拒绝
  验证：focused integration test 使用临时 fake `clipc` executable 并断言结构化参数输出
  来源：bash-tool / Governed clipc command is accepted；design D4
- [x] 3.2 实际触发并断言 locator 缺失、未知 executable、非法 `clipc` 参数和 executable path 覆盖均 fail closed
  验证：Bash policy 与 restricted sandbox negative tests
  来源：bash-tool / Malformed clipc command is rejected；sandbox-runtime / Missing clipc locator fails closed、Unknown executable remains denied
- [x] 3.3 验证未新增 public gateway contract、private import 或任意 executable 配置逃逸
  验证：`npm run test:contract`、`npm run lint:architecture` 和 `$nextagent-code-review` 检查点
  来源：proposal API/contract 范围；design D1-D3

## 4. 完整门禁

- [x] 4.1 运行产品代码与 OpenSpec 完整验证
  验证：`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`openspec validate --all --strict`
  来源：AGENTS.md 验证门禁；proposal 验证入口

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，在归档前根据 proposal/design 的“归档前更新基线”处理：

- 同步 `openspec/specs/bash-tool/spec.md` 和 `openspec/specs/sandbox-runtime/spec.md`。
- 更新 `openspec/overview.md`。
- 更新 `openspec/designs/architecture/runtime-boundaries.md`。
- 更新 `openspec/designs/modules/agent-capability.md`、`agent-platform-gateway-local.md`、`agent-app.md`。
- 更新 `openspec/designs/spec-to-design-map.md`。
- 检查长期文档没有重复定义命令策略或 executable locator 语义。
