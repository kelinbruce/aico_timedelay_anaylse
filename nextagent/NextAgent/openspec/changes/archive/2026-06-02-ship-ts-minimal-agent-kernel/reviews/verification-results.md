## 验证结果（Verification Results）

Change：`ship-ts-minimal-agent-kernel`

注：这些结果包含 T087-T092 的 TS 配置所有权修正、T096-T102 的 runtime 拥有 session/scope 刷新、T103-T106 的产品命名/session-message/local-gateway 清理，以及 T107-T111 的两层 package 依赖/contract subpath guard。当前实现不再使用 public `SystemConfig -> ResourceInventory -> AgentAssemblyCompiler` contract；`agent-app` 拥有内置默认 system/Agent config 加载器、app 内部 resource/provider registry、compiler、产品组合路径，并通过 runtime session facade 向 runtime 注入 `UserSessionPort`。产品实现名称现在描述职责（`RequestLifecycleCoordinator`、`UserSessionService`、`DefaultAgent`、`DefaultContextEngine`、`SqliteGatewayStores`），而不是 change 范围。

- `npm run build`：通过。
- `npm test`：通过，20 个文件 / 108 个测试通过。`npm run test:e2e:openai` 首次在 sandbox 中因 Windows `spawn EPERM` 失败；在 sandbox 外重跑通过，1 个文件 / 1 个测试通过。
- `npm run test:contract`：通过，2 个文件 / 19 个测试通过。
- `npm run lint:architecture`：现在运行 dependency-cruiser 加 `node tests/architecture/package-manifest-policy.cjs`；通过，巡检 164 个模块 / 445 个依赖，package manifest 依赖策略通过。
- `npm run test:e2e:openai`：在 sandbox 外通过，`OPENAI_API_KEY` 由 app 拥有的 credential resolver 解析。
- `openspec validate --all --strict`：通过。
- `rg "TODO|debug|console\.|MODEL_INPUT|MODEL_OUTPUT" packages tests --glob '!**/dist/**'`：只有 `tests/architecture/package-manifest-policy.cjs` 中有意保留的 `console.log/error` 输出。
- `git diff --check`：通过；Git 只打印了 Windows 行尾转换警告，没有 whitespace 错误。
- `Get-ChildItem packages -Directory | ForEach-Object { npx tsc --noEmit --noUnusedLocals --noUnusedParameters -p $_/tsconfig.json }`：在移除拆分模块中的过期 import 后，所有 package tsconfig 均通过。
- `npx tsc --noEmit --noUnusedLocals --noUnusedParameters -p tests/tsconfig.json`：在移除过期测试 import 后通过。
- `Get-ChildItem -Force data,workspaces -ErrorAction SilentlyContinue`：完整运行 `npm test` 和 `npm run test:e2e:openai` 后无输出，确认测试 SQLite/workspace 产物已被 Vitest 生命周期关闭并清理。
- `rg 'tests/agent-kernel/(model-provider|capability-read|openai-product-path)\.test\.ts|tests/minimal-kernel|tests\\minimal-kernel|minimal-kernel\.test' openspec package.json tests packages --glob '!**/dist/**'`：测试所有权清理后无匹配。
- `npm test`：通过，package 自有测试位于 `packages/agent-model/tests/` 和 `packages/agent-capability/tests/`，根目录跨模块测试位于 `tests/agent-kernel/`，e2e 位于 `tests/e2e/`。
- `npx vitest run tests/agent-kernel/config-assembly.test.ts tests/agent-kernel/owner-scope.test.ts`：通过，覆盖内置 default-system/default-agent 加载、app 内部 compiler 校验、local SQLite gateway 注入、owner fail-closed、未绑定 read 不可见和已接受 assembly 的 `maxToolIterations`。
- `rg 'fallbackEligible|MODEL_GATEWAY|OPENAI_COMPATIBLE|providerKind: "CUSTOM"|kind: "remote"|SKILL_HUB|MCP_SERVER|AGENT_REGISTRY|LOCAL_DIRECTORY' packages/agent-app/src packages/agent-core/src packages/agent-context-engine/src packages/agent-capability/src tests/agent-kernel/config-assembly.test.ts -n`：只匹配 `fallbackEligible: false` / schema 引用；没有启用的产品 fallback 或扩展 capability source 路径被匹配。
- `rg -n "SystemConfig|RuntimePathsConfig|ChannelConfig|GatewayAdapterConfig|CapabilityProviderConfig|AgentAssemblyCompilerInput|AgentAssemblyCompilerOutput|interface AgentAssemblyCompiler|interface AgentDefinition|interface ResourceInventory" packages/agent-contracts/src packages/agent-runtime/src packages/agent-core/src packages/agent-context-engine/src packages/agent-model/src packages/agent-capability/src packages/agent-session/src packages/agent-platform-gateway-local/src --glob '!**/dist/**'`：无匹配，确认 raw config 和 compiler DTO 不泄漏进 public contract 或下游 package。
- `rg -n "process\.env|default-system|default-agent|readFileSync" packages/agent-runtime/src packages/agent-core/src packages/agent-context-engine/src packages/agent-model/src packages/agent-capability/src packages/agent-session/src packages/agent-platform-gateway-local/src --glob '!**/dist/**'`：无匹配，确认下游 package 不读取 env 或内置配置文件。
- `rg 'createDefaultAssemblyRegistry|hostedAgentId ??|exactly one|default assembly registry' packages/agent-runtime/src packages/agent-core/src packages/agent-context-engine/src packages/agent-capability/src packages/agent-app/src/composition packages/agent-app/src/config tests/agent-kernel/config-assembly.test.ts -n`：没有 runtime fallback 或硬编码默认 registry 被匹配。
- `rg "SessionHistoryQuery|SessionHistoryEntry|SessionHistoryPage|SessionConversationQuery|CurrentRequestConversationQuery|WebSessionPort" packages/agent-contracts/src packages/agent-channel-web/src packages/agent-runtime/src packages/agent-session/src --glob '!**/dist/**'`：没有过时 session history API 或 channel 拥有的 session 抽象被匹配。
- `rg "MinimalRuntimeKernel|createMinimalRuntimeKernel|MinimalSessionService|createMinimalSessionService|MinimalAgent|createMinimalAgent|MinimalContextEngine|createMinimalContextEngine|MinimalKernelGatewayBundle|LocalSqliteMinimalKernelGateway|createLocalSqliteMinimalKernelGateway|InMemoryMinimalKernelGateway|createInMemoryMinimalKernelGateway" packages tests --glob '!**/dist/**'`：无匹配。
- `rg "UserSessionListEntry|ListUserSessionConversationQuery|UserSessionConversationPage|CurrentRequestUserSessionConversationQuery|SessionConversationRecordQuery|CurrentRequestConversationRecordQuery|SessionConversationRecordPage|SessionHistoryRecordEntry|SessionHistoryRecordPage" packages/agent-contracts/src --glob '!**/dist/**'`：无匹配。
- `rg "RuntimeTimelinePort|RegisterWebChannelOptions" packages/agent-channel-web packages/agent-contracts/src/runtime --glob '!**/dist/**'`：无匹配。
- `rg "in-memory-minimal-kernel-gateway|createInMemoryMinimalKernelGateway|InMemoryMinimalKernelGateway|MinimalKernelGatewayBundle|LocalSqliteMinimalKernelGateway|createLocalSqliteMinimalKernelGateway" packages tests --glob '!**/dist/**'`：无匹配。
- `rg --pcre2 "@nextagent/agent-contracts(?!/)" packages --glob "*.ts" --glob "!**/dist/**"`：无匹配，确认产品代码不导入根聚合 contract export。
- `rg "@nextagent/agent-contracts/gateway" packages/agent-core --glob "*.ts" --glob "!**/dist/**"`：无匹配。
- `rg "@nextagent/agent-contracts/runtime" packages/agent-context-engine --glob "*.ts" --glob "!**/dist/**"`：无匹配。
- `tests/architecture/dependency-rules.test.ts`：通过，覆盖 channel -> `agent-session`、channel -> gateway adapter、非 app 实现 -> 实现 import、根 contract 聚合 import、未授权 contract subpath import 和 `agent-assembly` -> runtime contract 泄漏的分类 fixture。
- `tests/architecture/workspace.test.ts`：通过，覆盖 package manifest 防火墙断言和来源于 `dependency-cruiser.config.cjs` 的固定 `agent-app` 组合例外策略。
- `node tests/architecture/package-manifest-policy.cjs tests/fixtures/architecture/implementation-package-manifest`：按预期失败，报告 `packages/agent-core/package.json` 不得依赖实现 package `@nextagent/agent-model`。
- `tests/contract/core-contracts.test.ts`：通过，断言 `agent-contracts/agent-assembly` 保持 runtime-safe，`Agent.execute` 使用 `RunMessagePort.appendMessage(run, context, SessionMessageDraft)` 且 append port 上没有独立的 `AbortSignal`。
- Gateway-local SQLite 事务取消在本 change 中被有意 deferred；当前取消覆盖适用于 runtime/core/model/capability/stream 边界，gateway public port 保持 async。

OpenAI endpoint 说明：产品路径 E2E 实现在 `tests/e2e/openai-product-path.test.ts`，并在存在 `OPENAI_API_KEY` 时针对配置的 OpenAI 兼容 endpoint 运行。
