# agent-test-kit

## 职责

承载 schema samples、fake gateway、architecture test helpers 和开发者扩展验证辅助。

## 非职责

不进入 runtime production path，不拥有业务 contract，不绕过 package boundary 验证。

不拥有 HarnessBench 外部能力评测 runner。`tests/harnessbench/**` 是 `FN-10.13 HarnessBench 评测` 的唯一实现 owner，独立于本包产品 test kit contract：它使用 Node.js ESM、静态 JSON/YAML 和 Vitest，标准入口 `node tests/harnessbench/run.mjs`，运行期缓存与报告位于已忽略的 `test-output/harnessbench/**`。HarnessBench runner 只从 public package exports 使用 `@nextagent/agent-app/local-runtime-package` 和 `@nextagent/agent-runtime` execution workspace resolver，禁止导入 `packages/*/src/**`、`@nextagent/*/testing` 或 private subpath，不进入默认 `npm test` 或 release gate，不定义 release `ReleaseCheckResult` 或产品 API。完整边界见 `architecture/e2e-quality-gates.md` 的 HarnessBench External Evaluation 章节。

## 依赖

可依赖 `@nextagent/agent-common`、`@nextagent/agent-contracts` public subpaths 和测试辅助库；不得依赖 implementation private paths。

## 核心设计落点

- 落实 `architecture/ts-backend-architecture.md` 和 `architecture/core-contracts.md` 的 contract/architecture/test fixture 边界。
- fake gateway、deterministic provider、schema samples 和 architecture fixtures 只能服务测试路径，不得进入 product composition。
- 测试辅助必须通过 public exports 暴露，不通过 private path 让产品包绕过架构边界。
- plugin test harness 只服务插件作者单元测试：直接消费已 materialized 的 plugin object，支持调用 plugin provider Tool、评估 `agentRoutingPolicy` 和执行 lifecycle hook。它不读取 system config、`plugin.json`、插件目录，不动态导入 bundle，不做静态扫描、host external 校验、app ready gate、AgentAssembly 编译、capability catalog 或 policy registry 装配；harness 通过不代表生产可加载或已激活。
- `createPluginTestHarness(plugin, options?)` 的输入是已导入的 `NextAgentPlugin` object；`options` 可以提供 test-only `toolDependencies` 和默认 safe Agent scope。Harness 至少提供 `invokeTool(providerId, capabilityId, input)`、`evaluateAgentRoutingPolicy(policyId, run, context)` 和 `executeHook(hookId, input)`。这些操作使用 public plugin SDK / contract shape 直接调用插件逻辑：Tool 通过显式 provider id + capability id 定位，routing policy 使用与 core 相同的 `RequestRun` / `RequestContext` shape，hook 使用 public hook input/output contract。
- Harness 不创建 `AgentAssembly.capabilityBindings`、`AgentAssembly.policies`、startup hook registry entry 或 plugin registry snapshot；也不通过 app loader 校验 manifest、bundle、host external 或 Agent activation。缺失 provider/tool/policy/hook 或缺失 test dependency 可以表现为 test failure 或 safe error，但该结果只说明插件对象逻辑，不说明产品集成状态。

## 替换边界

否。`agent-test-kit` 是开发者扩展验证辅助。

## 验证关注点

- 测试辅助只能通过 public contract 和 public exports 工作。
- architecture negative fixtures 必须真实运行并断言失败。
- fake gateway/schema samples 不得成为 production dependency。
- plugin harness passing 不得被视为生产 product path 验证；插件构建、加载、Agent binding/hook/policy activation 和实际生效必须由 app/capability/runtime/core 集成或 E2E 用例覆盖。

## Public Exports

`@nextagent/agent-test-kit`
