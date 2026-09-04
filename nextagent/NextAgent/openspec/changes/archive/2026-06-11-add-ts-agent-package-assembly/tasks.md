## 1. 规格与边界冻结

- [x] 1.1 在 `proposal.md`、`specs/agent-package-assembly/spec.md` 和 `design.md` 冻结 package assembly 的黑盒边界：只处理已选中 package root 的启动期 compile、runtime-facing 产物、registry lookup 和 package-assembly-level 失败收敛，不吸入产品入口选择、default-agent 打包同步或 release packaging。
  验证：`openspec validate add-ts-agent-package-assembly --strict`
  来源：proposal scope；design D1、D6
- [x] 1.2 在 spec/design 中明确 assembly compiler 与 capability catalog 的唯一职责分界：compiler 不依赖 descriptor pre-discovery，不写 synthetic enabled binding；visibility / availability / conflict / executability 由 catalog 负责。
  验证：`openspec validate add-ts-agent-package-assembly --strict`；code review 检查 `agent-assembly-compiler.ts` 与 capability catalog 边界
  来源：spec requirement `Capability Bindings Remain Assembly Facts Rather Than Discovery Results`；design D4

## 2. 实现收敛

- [x] 2.1 收敛 `agent-app` package assembly 主流程：启动期由 `agent-app` 对已选中的 package root 执行 parse、validate、compile 和 registry publication；request path 不得重新读取 package 输入。
  验证：`npm test -- tests/agent-kernel/config-assembly.test.ts`
  来源：spec requirement `Agent Package Assembly Compiles Runtime-Ready Assembly At Startup`；design D3、D5
- [x] 2.2 收敛 compile-time 校验：保留 identity/version/workspace/resource/model/prompt/provider 引用的安全校验，并确保 runtime-facing `AgentAssembly` 只包含最小字段。
  验证：`npm test -- tests/agent-kernel/config-assembly.test.ts`
  来源：spec requirement `Runtime-Ready AgentAssembly Contains Only Runtime-Facing Fields`；spec requirement `Workspace Resolution And Package Validation Are Compile-Time Preconditions`
- [x] 2.3 修正 `agent-assembly-compiler` 的 implementation-vs-spec gap：去掉“assembly compile 必须先有唯一 descriptor”的前置假设，只保留 binding shape 与 registered provider 校验，并用 catalog 承担后续 descriptor existence / availability / conflict 判断。
  验证：`npm test -- tests/agent-kernel/config-assembly.test.ts`
  来源：design gap；spec requirement `Capability Bindings Remain Assembly Facts Rather Than Discovery Results`
- [x] 2.4 补足 lookup freeze 的 negative verification：acceptance 只走 `active(agentId)`，accepted request / recovery 只走 `require(agentId, agentVersion)`，missing assembly 不得 fallback，request path 不得 reparse package。
  验证：`npm test -- tests/agent-kernel/config-assembly.test.ts`
  来源：spec requirement `AgentAssemblyRegistry Lookup Semantics Stay Frozen`；design D5
- [x] 2.5 补足 package assembly failure / degradation negative cases：缺失权威输入、workspace 越界、required ref 缺失时 fail-closed；未被显式 binding 消费的非关键 candidate source 失效时只输出 safe diagnostics。
  验证：`npm test -- tests/agent-kernel/config-assembly.test.ts`
  来源：spec requirement `Failure And Degradation Are Explicit At The Package Assembly Boundary`；design D6

## 3. 验证和收尾

- [x] 3.1 运行全量非回归验证，确认 package assembly 收敛未破坏当前最小内核和 capability 边界。
  验证：`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`openspec validate --all --strict`
  来源：design Verification Map；AGENTS.md 验证门禁
- [x] 3.2 清理本次实现引入的临时旁路、调试状态或过时测试假设，确认没有继续把产品入口治理、打包同步或 request-path fallback 混入 package assembly 范围。
  验证：`git diff --check`；code review 检查 `packages/agent-app/src/assembly/*`、`packages/agent-app/src/composition/*`、`tests/agent-kernel/config-assembly.test.ts`
  来源：proposal scope；design D1、D5、Risks / Trade-offs

## 归档前更新基线检查（非实施任务）

- 同步 `openspec/specs/agent-package-assembly/spec.md`。
- 按需更新 `openspec/overview.md`。
- 按需更新 `openspec/designs/architecture/core-contracts.md`。
- 按需更新 `openspec/designs/architecture/configuration-boundary.md`。
- 按需更新 `openspec/designs/modules/agent-app.md`。
- 按需更新 `openspec/designs/spec-to-design-map.md`。
- 检查长期文档没有重复定义 package assembly compile、registry lookup、catalog visibility 或产品入口选择边界。
