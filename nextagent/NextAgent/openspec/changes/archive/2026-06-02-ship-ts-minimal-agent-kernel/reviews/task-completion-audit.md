## 任务完成审计（Task Completion Audit）

Change：`ship-ts-minimal-agent-kernel`

状态：在 TS 配置所有权修正、runtime 拥有的 session/scope 刷新、产品命名/session-message/local-gateway 清理、两层依赖 guard 实现、gateway 幂等写入清理和 contract 词汇归并之后，T001-T118 全部完成。T087-T092 用 app 拥有的 `Config`、`Resources`、`ResourceProviders`、`Plugins` 输入替换了此前过宽的 public `SystemConfig` / `ResourceInventory` / `AgentAssemblyCompiler` contract，并分离了 system/component config、Agent 业务 config 和 runtime-safe assembly 所有权。T107-T111 新增了实现 package 依赖防火墙、contract subpath allowlist、runtime-safe `agent-assembly` 拥有面、runtime 拥有的 `RunMessagePort`，并修复了 `agent-app` composition-root 例外策略。T112-T118 修复了专用 gateway 事实表、幂等锚点、message append/terminal commit 事务、owner-scoped gateway 命名、持久化标量词汇所有权和同形同策约束。Gateway-local SQLite 事务取消在本 change 中被显式 deferred。

### 本轮检视并修复的问题

- T029/T030：产品 model profile 配置证据此前只覆盖较早的最小 OpenAI 路径。T087-T092 现在定义了活跃的 TS 配置所有权路径：模型选择来自已接受的 assembly 而不是全局单 profile 规则，raw/component config 也不成为 public app contract 总线。
- T025/T029：`topP` 出现在 `ModelInvocationRequest` 上但没有 model profile 来源。`ModelOptions` 现在包含 `topP`，core 会把它扁平化进 `ModelInvocationRequest`。
- T054/T055：Runtime/core 此前不调用 lifecycle hook 或 checkpoint 边界。产品 app 现在装配显式 no-op lifecycle hook 和 no-op checkpoint provider。Runtime 在 request accept、模型前和 terminal 前调用 hook/checkpoint。Core 在 capability invocation 前调用 hook/checkpoint。测试断言这些主路径调用点。
- T043/T050/T051 一致性检查：新增 hook/checkpoint 测试后，暴露出用户与 assistant message 具有相同毫秒时间戳时 history 排序不确定的问题。Runtime 时间戳现在在进程内单调递增，因此 `createdAt asc, messageId asc` 的 history 排序在主路径上保持稳定。
- T075：针对 `https://api.minimaxi.com/v1` 使用模型 `MiniMax-M2.7` 运行配置的 OpenAI 兼容 E2E 后，更新了验证记录。
- T004-T019：新增 `tests/agent-kernel/runtime-foundation.test.ts`，验证 owner-scoped session 创建、active context 初始化、convenience session 准备、已有 session submit、缺失/跨 owner session 拒绝、已接受 run 的 assembly 身份、根用户 message 持久化、active context 追加、session-scoped timeline sequence 分配、assembly 绑定，以及 active context/run 写入的版本冲突行为。
- T027-T032/T068：新增 `packages/agent-model/tests/openai-provider.test.ts`，验证 OpenAI 兼容 adapter 使用配置的 base URL、credential resolver、model options 和 provider options；归一化 content delta；重组多块 tool-use 参数；并把非法 provider stream/tool 参数映射为安全错误且不泄漏 raw provider payload。修复了此前把非法 JSON 当作 `{}` 的 adapter 行为。
- T033-T038/T069-T071：新增 `packages/agent-capability/tests/read-capability.test.ts` 和 `tests/agent-kernel/tool-loop.test.ts`，验证 read descriptor schema、canonical `file_path` 校验、workspace/path guard、安全缺失文件降级、abort 失败、按模型顺序的多次 read 调用、当前 run 的 tool message 重组、每轮和每回合 tool 上限、缺失文件续接，以及安全拒绝失败。把 read invocation 修复为拒绝非 canonical 别名/额外参数键。
- T039-T041/T057：新增 `tests/agent-kernel/terminal-consistency.test.ts`，验证只有持久化 terminal commit 成功后才出现 terminal history/stream 可见性，以及持久化 terminal commit 失败后安全失败 assistant message 的持久化。修复了 runtime 此前在持久化 terminal commit 之前保存 terminal message 的行为，失败请求现在持久化安全 assistant 失败消息且不泄漏 raw error。
- T044/T050/T051/T066/T073/T074：收紧 Web query/schema 边界，使 session list、conversation 和 stream 路由拒绝非最小 public query 字段而不是静默忽略。扩展 `tests/agent-kernel/web-boundaries.test.ts`，覆盖禁止 submit 字段、session-scoped body `sessionId`、list cursor、conversation `includeHidden` 和 stream debug 路径 query 拒绝。
- T056：为已完成的 capability invocation 和安全拒绝新增 capability audit 调用，使用显式产品 no-op audit writer。扩展 tool-loop 测试，断言发出 `capability.completed` 和 `security.rejected` audit 事件且不暴露 raw tool/path 数据。
- T031：在 `packages/agent-model/tests/openai-provider.test.ts` 中新增可选 provider reasoning/thinking delta 归一化和不伪造覆盖；core 现在把 reasoning delta 投影为 `LLM_THINKING_DELTA`。
- T052/T053：新增 `tests/agent-kernel/owner-scope.test.ts`，验证 session、conversation history、message、run 和 timeline 事实跨 owner scope 不可见。
- T064：新增模型文本、capability result 和 terminal assistant message 输出 guard 实现以及 `tests/agent-kernel/output-guard.test.ts`；超限路径发布 `DEGRADATION_NOTICE`、以安全失败结束，并且不把 raw model/tool/terminal payload 泄漏进 stream/history/timeline。
- T072：新增 `tests/agent-kernel/cancellation-boundary.test.ts`，验证 runtime 拥有的 timeout `AbortSignal` 到达 `Agent.execute`、失败是安全的、不投影 `REQUEST_CANCELED`、不持久化 canceled terminal 状态、不存在 Web cancel 路由，且 runtime cancel 保持 deferred。Gateway-local SQLite 事务取消被有意 deferred；gateway public port 保持 async。
- T087-T092：从 `agent-contracts/app` 移除 app 配置总线 contract；新增内置 `packages/agent-app/config/default-system.yaml` 和 `default-agent.yaml`；把 `AgentDefinition`、resource/provider registry 和 compiler 输入/输出移入 `agent-app`；通过内置 config 加载、resource 注册、default-agent 编译、编译后的 `AgentAssemblyRegistry`、model registry、local SQLite gateway、no-op provider、runtime/session/core/context/model/capability/channel 注入重新接通产品组合；新增配置所有权、parser/compiler fail-closed 行为、未绑定 read 不可见、已接受 assembly 的 model/tool-loop 选择以及不泄漏 env/file config 感知的测试和 source 断言。
- T107-T111：为非 app 实现 package import 防火墙、产品 contract 根聚合 import 拒绝、按 package 的 `agent-contracts/<subpath>` allowlist 和狭窄的 `agent-contracts/agent-assembly` 边界新增可执行的 dependency-cruiser 策略。为实现 import、未授权 contract subpath 和 `agent-assembly` 泄漏新增代表性 negative fixture；新增 package manifest 防火墙断言；更新 README 依赖说明；把剩余测试中的 `AgentAssembly` import 移到 `agent-contracts/agent-assembly`；并让测试与 `Agent.execute(run, context, timeline, messages, signal)` 对齐。

### 当前验证证据

- `npm run build`：通过。
- `npm test`：通过，20 个文件 / 108 个测试通过。
- `npm test -- --run tests/agent-kernel/runtime-foundation.test.ts`：通过，5 个测试通过。
- `npm test -- --run packages/agent-model/tests/openai-provider.test.ts tests/agent-kernel/runtime-foundation.test.ts`：通过，8 个测试通过。
- `npm test -- --run packages/agent-capability/tests/read-capability.test.ts tests/agent-kernel/main-path.test.ts`：通过，11 个测试通过。
- `npm test -- --run tests/agent-kernel/tool-loop.test.ts packages/agent-capability/tests/read-capability.test.ts`：通过，8 个测试通过。
- `npm test -- --run tests/agent-kernel/terminal-consistency.test.ts tests/agent-kernel/tool-loop.test.ts`：通过，6 个测试通过。
- `npm test -- --run tests/agent-kernel/tool-loop.test.ts tests/agent-kernel/web-boundaries.test.ts`：通过，7 个测试通过。
- `npm test -- --run tests/agent-kernel/cancellation-boundary.test.ts tests/agent-kernel/output-guard.test.ts`：通过，5 个测试通过。
- `npm test -- --run tests/agent-kernel/owner-scope.test.ts tests/agent-kernel/cancellation-boundary.test.ts`：通过，3 个测试通过。
- `npm test -- --run tests/agent-kernel/output-guard.test.ts packages/agent-model/tests/openai-provider.test.ts`：通过，7 个测试通过。
- `npm run test:contract`：通过，2 个文件 / 19 个测试通过。
- `npm run lint:architecture`：通过；dependency-cruiser 巡检 164 个模块 / 445 个依赖无违规，随后 `tests/architecture/package-manifest-policy.cjs` 通过 package manifest 依赖策略。
- `node tests/architecture/package-manifest-policy.cjs tests/fixtures/architecture/implementation-package-manifest`：按预期失败，报告 `packages/agent-core/package.json` 不得依赖实现 package `@nextagent/agent-model`。
- `openspec validate --all --strict`：通过，3 项通过。
- `npm run test:e2e:openai`：通过，`OPENAI_API_KEY` 由 app 拥有的 credential resolver 解析，model profile 从 `packages/agent-app/config/default-system.yaml` 加载。
- `Get-ChildItem -Force data,workspaces -ErrorAction SilentlyContinue`：验证后无输出，确认测试产物已被清理。
- `rg "TODO|debug|console\.|MODEL_INPUT|MODEL_OUTPUT" packages tests --glob '!**/dist/**'`：只有 `tests/architecture/package-manifest-policy.cjs` 中有意保留的 `console.log/error` 输出。

### 任务覆盖索引

- T001-T003：由 `tests/contract/core-contracts.test.ts`、app/model contract 更新和 `npm run test:contract` 覆盖。
- T004-T010：由 `tests/agent-kernel/runtime-foundation.test.ts`、`tests/agent-kernel/web-boundaries.test.ts` 和主路径 E2E 测试覆盖。
- T011-T019：由 `tests/agent-kernel/runtime-foundation.test.ts`、`tests/agent-kernel/main-path.test.ts` 和 gateway/timeline 断言覆盖。
- T020-T026：由 `tests/agent-kernel/main-path.test.ts`、`tests/agent-kernel/runtime-foundation.test.ts`、`tests/contract/core-contracts.test.ts` 和 model request 扁平化断言覆盖。
- T027-T032：由 `packages/agent-model/tests/openai-provider.test.ts`、`tests/e2e/openai-product-path.test.ts` 和安全 provider 失败断言覆盖。
- T033-T038：由 `packages/agent-capability/tests/read-capability.test.ts`、`tests/agent-kernel/tool-loop.test.ts` 和当前 run message 重组断言覆盖。
- T039-T043：由 `tests/agent-kernel/terminal-consistency.test.ts`、`tests/agent-kernel/output-guard.test.ts` 和 stream/history 一致性断言覆盖。
- T044-T051：由 `tests/agent-kernel/web-boundaries.test.ts`、`tests/agent-kernel/runtime-foundation.test.ts` 和 session/conversation history 断言覆盖。
- T052-T057：由 `tests/agent-kernel/owner-scope.test.ts`、`tests/agent-kernel/cancellation-boundary.test.ts`、`tests/agent-kernel/tool-loop.test.ts`、`tests/agent-kernel/main-path.test.ts` 和 no-op/audit/safe-data 断言覆盖。
- T058-T060：由 `npm run lint:architecture`、`tests/architecture/dependency-rules.test.ts`、`tests/architecture/boundaries.test.ts`、`openspec/changes/ship-ts-minimal-agent-kernel/reviews/scope-boundary-review.md` 和 deferred 边界 route/catalog/schema 测试覆盖。
- T061-T063：由 `npm run test:e2e:openai`、`tests/agent-kernel/main-path.test.ts`、`tests/e2e/openai-product-path.test.ts` 和电信/locale 渲染断言覆盖。
- T064-T072：由 `tests/agent-kernel/output-guard.test.ts`、`tests/agent-kernel/tool-loop.test.ts`、`tests/agent-kernel/owner-scope.test.ts`、`tests/agent-kernel/cancellation-boundary.test.ts` 和 provider/capability 失败分类测试覆盖。Gateway-local SQLite 事务取消已记录为 deferred。
- T073-T074：由 `tests/agent-kernel/web-boundaries.test.ts` 的 create-session 和 submit schema negative test 覆盖。
- T075：由上述验证命令和 `openspec/changes/ship-ts-minimal-agent-kernel/reviews/verification-results.md` 覆盖。
- T076：由 `git diff` review 加上 `rg "TODO|debug|console\.|MODEL_INPUT|MODEL_OUTPUT" packages tests --glob '!**/dist/**'` 覆盖，当前该命令只报告 `tests/architecture/package-manifest-policy.cjs` 中有意保留的 `console.log/error` 输出。
- T077-T086：由产品化模块结构实现、architecture guard 测试和 `npm run lint:architecture` 覆盖。
- T087-T092：由 `tests/agent-kernel/config-assembly.test.ts`、`tests/contract/core-contracts.test.ts`、`tests/agent-kernel/main-path.test.ts`、`tests/agent-kernel/owner-scope.test.ts`、`tests/e2e/openai-product-path.test.ts`、所有权 source 扫描、`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`npm run test:e2e:openai` 和 `openspec validate --all --strict` 覆盖。
- T093：由 `packages/*/tests` 下的 package 自有测试、根目录跨模块/e2e 测试和 `npm test` 覆盖。
- T107-T111：由 `dependency-cruiser.config.cjs`、`tests/architecture/package-manifest-policy.cjs`、`tests/architecture/dependency-rules.test.ts`、`tests/architecture/workspace.test.ts`、`tests/contract/core-contracts.test.ts`、package README 依赖说明、negative architecture fixture、`npm run lint:architecture`、`npm run build`、`npm test`、`npm run test:contract` 和 `openspec validate --all --strict` 覆盖。

### 最终审计结论

在显式 deferred gateway-local SQLite 事务取消之后，当前 worktree 中所有 T001-T118 任务都有直接实现证据、必要的直接或定向测试证据、通过的验证输出，以及 architecture/OpenSpec 验证证据。当前未发现剩余的任务级缺口。
