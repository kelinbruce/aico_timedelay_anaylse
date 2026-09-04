> 当前代码基线尚未实现 `add-ts-memory-core` public boundary，也尚未提供 memory tool descriptors 或 app composition wiring。以下任务重新标记为待实施；勾选前必须有对应代码、测试和验证命令。

## 1. Capability 工具暴露和输入契约

- [x] 1.1 增加 memory tools exposure gate，验证 `add-ts-memory-core` 不在 release scope、`MemoryConfig` 为 `DISABLED` / `INVALID`、AgentAssembly 未 opt-in、memory core 无效或未提供 public boundary 时，memory tools 不得注册到模型可见 tool discovery、effective capability catalog 或可执行调用路径。
  来源：spec requirement "Memory tools delivery depends on memory core" scenario "Memory configuration is disabled" / "Memory configuration is invalid" / "Memory core dependency is missing"；design D1A 工具定义静态存在、模型可见暴露动态受控
- [x] 1.2 在 `agent-memory` memory tools submodule 中定义 `createMemoryToolDefinitions()`，返回 `search_memory`、`get_memory_detail`、`add_memory` 的 standard capability tool definitions；确保它们只通过 capability tool 通道暴露，且只在 release scope、`MemoryConfig.status === VALID`、AgentAssembly opt-in 和 selected gateway ports / memory tool adapter readiness 全部通过后由 `agent-app` 作为 `providerId="memory-tools"` 的 provider-scoped app-composed Tool catalog 交给 capability subsystem；不得追加到默认 enabled `builtinToolDefinitions`；`update_memory`、`forget_memory`、`get_user_context` 不得出现在 model-visible tool discovery、effective capability catalog 或 executable invocation path 中。
  来源：spec requirement "Memory tools exposure through capability channel" scenario "Memory core dependency is available"；design D1 / D1A
- [x] 1.3 为 3 个工具补充 input schema，拒绝 `tenantId`、`subjectId`、`agentId`、`ownerSubjectId`、`owner`、`userId` 或等价 scope 字段。
  来源：spec requirement "Memory tools exposure through capability channel" scenario "Owner fields in tool input are rejected"；design 质量属性 安全
- [x] 1.4 为 3 个工具补充 result schema，覆盖成功 payload、`SafeError` 和 degraded diagnostic 字段；不得输出 audit id、audit linkage 或 audit 子状态字段。
  来源：spec requirement "Memory tools failure and degradation" scenario "Observability projection failure after memory side effect"；design D6
- [x] 1.5 增加 contract tests，验证 3 个工具 descriptor 名称、参数默认值、非法 owner 字段拒绝、枚举值和 result shape，并验证 `update_memory`、`forget_memory`、`get_user_context` 不存在 model-facing descriptor。
  来源：spec requirement "Memory tools exposure through capability channel" 质量属性 可测试性
- [x] 1.6 增加 release-scope/assembly 验证，确认目标 release scope 已纳入 `add-ts-memory-core` 和 `add-ts-memory-tools`，memory tools 不得声明可脱离 core 独立交付。
  来源：spec requirement "Memory tools delivery depends on memory core" scenario "Target release includes memory tools after core"；proposal 影响范围

## 2. Memory core 接入边界

- [x] 2.1 实现 memory tool 执行入口，从当前 `RequestContext.identityContext` 注入可信 `tenantId` 和 `subjectId`，从 `RequestContext.agentId` 注入 agent scope。
  来源：spec requirement "Memory tools exposure through capability channel" scenario "Normal tool invocation enters capability flow"；design D1
- [x] 2.2 将 `search_memory` 通过 app-composed `LongTermMemoryToolPort.searchLongTermMemory` 调用，构造 `SearchLongTermMemoryQuery`，返回 L1 projection，验证 `minConfidence`、`limit`、`offset`、category 和 `USER_CHARACTERISTICS` purpose 参数；capability implementation 不得直接导入 memory retriever。
  来源：spec requirement "search_memory L1 retrieval" scenario "Normal L1 search"；design D2
- [x] 2.3 将 `get_memory_detail` 通过 app-composed `LongTermMemoryToolPort.getLongTermMemoryDetail` 调用，支持 `longTermMemoryIds[]` 批量详情，返回逐条 L2 projection 或 per-entry SafeError。
  来源：spec requirement "get_memory_detail L2 retrieval" scenario "Normal batch detail retrieval"；design D3
- [x] 2.4 将 `add_memory` 通过 app-composed `LongTermMemoryToolPort.saveLongTermMemory` 写入，处理 core-defined 四类结构化 content 校验、confidence 默认值、briefIndex 生成/截断、sourceTrace 构造和 request/invocation-level idempotency write options；不得在请求期执行相似检索、冲突检测、candidate/evidence 写入或 confidence corroboration。
  来源：spec requirement "add_memory structured write" scenario "Normal add memory"；design D2
- [x] 2.5 确认 `update_memory`、`forget_memory` 不作为 model-facing tools 实现；底层 `saveLongTermMemory` partial update、`deleteLongTermMemory` physical delete 和 `listLongTermMemory` 等 memory core gateway 方法可继续由 maintenance/user-management/future changes 通过自身边界消费，不得通过 memory tools 或 `LongTermMemoryToolPort` 消费。
  来源：spec requirement "Update and delete remain non-model-facing memory interfaces"；design D4

## 3. 失败、降级和预算

- [x] 3.1 实现 memory disabled 双层语义：装配/暴露前 `MemoryConfig.status = DISABLED` 时 3 个 memory tools 对模型不可见；stale/precomputed binding 在暴露后遇到 disabled 快照时，3 个 tools 均返回 `LTM_DISABLED`，不得保留 `get_user_context` 式空 traits 特例。
  来源：spec requirement "Memory tools failure and degradation" scenario "Disabled memory is not exposed" / "Stale binding after memory is disabled"；design D1A / D5
- [x] 3.2 实现 storage unavailable、timeout、cancellation、invalid query、invalid write、not found/not owned 和 result-too-large 的 SafeError 映射。
  来源：spec requirement "Memory tools failure and degradation" scenario "Storage unavailable"，scenario "Tool timeout"；design D2, D3, D4, D5
- [x] 3.3 为 result size budget 增加验证，确保 `search_memory` 和 `get_memory_detail` 超预算时返回 `MEMORY_TOOL_RESULT_TOO_LARGE`，不得静默截断。
  来源：spec requirement "search_memory L1 retrieval" scenario "Search result too large"；design 质量属性 性能/容量
- [x] 3.4 为 capability timeout/cancellation 增加集成验证，确保下游 memory operation 接收 cancellation signal。
  来源：spec requirement "Memory tools failure and degradation" scenario "Tool timeout"；AGENTS.md 验证门禁

## 4. 可观测、日志和指标

- [x] 4.1 为 `add_memory` 成功写入验证安全 capability/gateway/observability facts；如 existing observability/audit path 或 future owning change 投影 domain-specific memory write 事件，其属性不得包含 raw content；memory tool adapter 不得注入独立 `auditWriter`、`diagnosticSink` 或 observability dependency。
  来源：spec requirement "add_memory structured write" scenario "Normal add memory"；design 质量属性 审计/可追溯性
- [x] 4.2 为 `search_memory(categoryFilter="USER_CHARACTERISTICS", purpose=...)` 验证安全日志、metric、audit 或 diagnostic 若存在，只记录 purpose 和 retrievedTraitNames/ref，不记录 trait value。
  来源：spec requirement "search_memory L1 retrieval" scenario "Purpose-scoped user characteristics search"；design D5 质量属性 审计/可追溯性
- [x] 4.5 增加 observability projection failure 验证，覆盖 memory side effect 已发生但后置 log/metric/audit 投影失败时，工具结果仍表达 memory outcome，投影失败进入 structured log 或 metric。
  来源：spec requirement "Memory tools failure and degradation" scenario "Observability projection failure after memory side effect"；design D6
- [x] 4.6 增加工具调用指标和结构化日志验证，确保日志/指标不包含 raw tool args/result、trait value、secret 或未授权内容。
  来源：spec requirement "Memory tools failure and degradation" 质量属性 安全；design 质量属性 审计/可追溯性

## 5. 集成和安全验证

- [x] 5.1 增加 `search_memory` 正常路径、空 query 列表路径、`USER_CHARACTERISTICS` purpose 过滤、purpose 非法组合、invalid parameter、result-too-large 和 disabled path 集成测试。
  来源：spec requirement "search_memory L1 retrieval" scenario "Empty query lists active candidates"，scenario "Purpose-scoped user characteristics search"，scenario "Purpose is rejected for non-user-characteristics search"，scenario "Invalid search parameters"，scenario "Search result too large"
- [x] 5.2 增加 `get_memory_detail` 正常 L2、not found/not owned、result-too-large 和 disabled path 集成测试。
  来源：spec requirement "get_memory_detail L2 retrieval" scenario "Detail not found or not owned"
- [x] 5.3 增加 `add_memory` 显式用户指令正常写入、briefIndex 截断、invalid structured content、storage unavailable 和 disabled path 集成测试，并增加 negative test 断言 `add_memory` 不调用 search/list/detail、不写 candidate/evidence、不调整已有 confidence。
  来源：spec requirement "add_memory structured write" scenario "Add memory invalid structured content"
- [x] 5.4 增加 non-exposure 验证，确认 `update_memory`、`forget_memory`、`get_user_context` 没有 model-facing descriptor、input schema、effective capability catalog exposure 或 executable invocation path。
  来源：spec requirement "Update and delete remain non-model-facing memory interfaces" scenario "Update and forget tools are not exposed"
- [x] 5.5 增加跨 scope 安全测试，验证所有 model-facing tools 只能访问当前 `tenantId`、`subjectId` 和 `agentId` 的 memory facts。
  来源：spec requirement "Memory tools exposure through capability channel" scenario "Owner fields in tool input are rejected"；design 质量属性 安全

## 6. 架构边界和收尾

- [x] 6.1 增加 architecture boundary test，验证本 change 不修改 context assembly 自动注入逻辑，不新增 platform endpoint，不引入 session store schema。
  来源：spec requirement "Memory tools architecture boundaries" scenario "No context assembly mutation"，scenario "No platform endpoint"；proposal 非目标
- [x] 6.2 增加 dependency boundary test，验证 `agent-memory` memory tools submodule 只通过 public package export type-only 导入 `agent-capability` Tool SPI types，并只导入 `agent-common` 和 memory core public contracts；不得导入 `agent-capability` catalog、discovery、executor、builtin tool definitions、private source path、gateway-local private path、store driver 或 adapter-private DTO；验证 `agent-capability` 不导入 `agent-memory`、memory gateway ports 或 memory DTO；验证 memory tools 没有被追加进默认 enabled `builtinToolDefinitions`，且若新增 app-composed Tool catalog/executor 接入点，该接入点是 provider-scoped 通用能力、没有 memory-specific branch；同时验证除 `agent-app` composition 与 capability invocation 测试外，非模型模块（agent-memory extraction/aging/maintenance、context、runtime、channel、gateway adapter）不导入或调用 memory tool descriptors、tool implementation、`LongTermMemoryToolPort` 或 capability executor 来访问长期记忆。
  来源：spec requirement "Memory tools architecture boundaries" scenario "No competing memory contract"；design D2
- [x] 6.3 增加 dependency availability test，验证运行期 memory core 不可用时，已存在的 stale/precomputed tool binding 返回明确 unavailable SafeError 或 spec 定义的受控降级，不得落入工具层本地实现。
  来源：spec requirement "Memory tools delivery depends on memory core" scenario "Memory core dependency is missing"；design D1
- [x] 6.4 运行 `cmd /c openspec.cmd validate add-ts-memory-tools --strict` 并修复所有规格问题。
  来源：AGENTS.md 验证门禁
- [x] 6.5 运行目标 package 的 contract/integration/security/observability 测试，并记录失败项或跳过原因。
  来源：AGENTS.md 验证门禁
- [x] 6.6 检查 proposal/design/spec/tasks 的范围一致性，确保 exposure gate、不可独立交付、目标 release scope、`MemoryConfig` disabled/invalid 不可见、自动提取、aging、REST/Web UI、sharing 和配置 namespace 等边界保持一致。
  来源：proposal 影响范围；design 非目标
- [x] 6.7 检查历史能力取舍是否仍保持在目标语义层：只继承显式工具调用、L1/L2、owner 隔离、用户明确记忆指令的 add_memory ACTIVE 写入和 search_memory 上的按需用户特征检索；不得把 model-facing update/forget、相似/冲突检测、candidate/evidence、存储实现、自动恢复、REST/Web、sharing 或后台生命周期写入本 change。
  来源：design 非目标；proposal 影响范围

- [x] 6.8 更新模块和包依赖文档，显式记录 `agent-memory` memory tools submodule 对 `agent-capability` public Tool SPI 类型的受限 type-only 依赖授权，以及 `agent-capability` 不反向依赖 memory provider / memory DTO / memory gateway ports 的边界。
  验证：更新 `openspec/designs/modules/agent-memory.md`、`openspec/designs/modules/agent-capability.md` 和 `packages/agent-memory/README.md` 或等价 package boundary 文档；`npm.cmd run lint:architecture` 通过；dependency boundary tests 覆盖该授权没有扩散到非 tools submodule 或 value-level capability implementation。
  来源：proposal 受限依赖授权；design 决策 1 / 2；spec scenario "Narrow Tool SPI dependency authorization"

## 7. Defer 解除补充实现

- [x] 7.1 重构 `get_memory_detail` 输入从单个 `longTermMemoryId` 改为 `longTermMemoryIds[]`（上限 20），返回 `{results: [{longTermMemoryId, entry?, error?}]}` 结构；每条 per-entry 独立执行和返回 SafeError。
  验证：contract tests 覆盖 batch 成功、batch partial not found、batch limit exceeded；integration tests 覆盖 3 条混合结果。
  来源：spec requirement "get_memory_detail L2 retrieval"；design 决策 3

- [x] 7.2 实现 `add_memory` fast-path 边界验证：`add_memory` 只为用户明确记忆指令创建 ACTIVE 记忆，不做 corpus-level 去重、相似度边界、语义等价判断或冲突检测；重复提交防护仅使用 request/invocation-level idempotency write options。
  验证：contract/integration tests 覆盖 result `outcome="CREATED_ACTIVE"`、同一 invocation idempotency 不重复 side effect、以及 forbidden dependency/call assertion：`add_memory` 不调用 `searchLongTermMemory` / `listLongTermMemory` / candidate writer / `adjustLongTermMemoryConfidence`。
  来源：spec requirement "add_memory structured write" fast-path boundary

- [x] 7.3 更新 tools exposure gate，确认目标 release scope 已纳入 `add-ts-memory-core`、app composition 提供 `VALID` MemoryConfig、AgentAssembly 已 opt-in 且 app composition 提供 selected gateway ports / memory tool adapter 后，memory tools 才随 core 一同暴露。
  验证：release-scope/assembly 测试覆盖 "Target release includes memory tools after core"、"Memory configuration is disabled"、"Memory configuration is invalid" 和 "Memory core dependency is missing" scenarios。
  来源：spec requirement "Memory tools delivery depends on memory core" scenario "Target release includes memory tools after core" / "Memory configuration is disabled"

## 8. Tool input schema contract

- [x] 8.1 为 3 个 memory tool 定义严格 input schema：每个 schema MUST 使用 `additionalProperties: false`，只声明模型允许提供的业务参数；不得声明 `tenantId`、`subjectId`、`agentId`、`ownerSubjectId`、`owner`、`userId` 或等价 scope 字段。
  验证：`npx.cmd vitest run packages/agent-memory/tests/memory-tools-provider.test.ts tests/agent-kernel/memory-runtime-integration.test.ts` 覆盖每个 tool 传入 owner/agent scope 字段时被现有 capability JSON Schema validation 拒绝，并返回 `CAPABILITY_INPUT_INVALID`；descriptor snapshot 验证每个 memory tool input schema 均为 `additionalProperties: false`。
  来源：spec requirement "Memory tools exposure through capability channel" scenario "Owner fields in tool input are rejected"；design 决策 7。

- [x] 8.2 保持 `BuiltinToolsExecutor.invoke()` 和 `ToolMetadata` 公共 SPI 不变：不得新增 `forbiddenInputFields`、`forbiddenFieldErrorCode`、`forbiddenFieldErrorMessage`、`inputValidationErrorCode`、`validateJsonDetailed` 或 memory-specific validation branch。
  验证：`rg "forbiddenInputFields|forbiddenFieldErrorCode|forbiddenFieldErrorMessage|inputValidationErrorCode|validateJsonDetailed|isMemoryTool|hasOwnerField|normalizeMemoryToolArguments|memoryInputFailed|MEMORY_TOOL_" packages/agent-capability/src` 无匹配；`npm.cmd run lint:architecture` 通过。
  来源：architectural constraint "executor must not know about specific tools" from `add-ts-capability-core-governance`。

- [x] 8.3 `add_memory` 的 `USER_CHARACTERISTICS` string content 容错必须通过该 tool 的 input schema union（`content: string | structuredContent`）和 tool execute 内部转换实现，不进入公共 executor；string 必须转换为 core-compatible `{ category: "USER_CHARACTERISTICS", traits: [content], purpose: ["GENERAL"] }`。
  验证：`npx.cmd vitest run packages/agent-memory/tests/memory-tools-provider.test.ts` 覆盖 `add_memory` string content 容错转换；`rg "USER_CHARACTERISTICS|MEMORY_TOOL_" packages/agent-capability/src/execution/executor.ts` 无匹配。
  来源：spec requirement "Memory tools exposure through capability channel" + "Memory tools failure and degradation"。

## 9. App composition wiring

- [x] 9.1 在 `agent-app` 中创建 `memory-tool-port.ts`，实现 `createLongTermMemoryToolPort()` 将 selected gateway store/retriever 适配为仅供 model-facing memory tool implementation 使用的最小 `LongTermMemoryToolPort`（仅含 `searchLongTermMemory`、`getLongTermMemoryDetail`、`saveLongTermMemory`）。该 adapter 不经过 `agent-memory` wrapper，不进入公共 `ToolDependencies` SPI，不包含独立 observability adapter dependency，也不得作为其他模块访问长期记忆的 service API。
  验证：`npx.cmd vitest run tests/agent-kernel/memory-runtime-integration.test.ts` 覆盖 tool port 创建、store/retriever 转发和 adapter 最小方法集；revival-on-access 接线不在本 change 验收。
  来源：design 决策 2、7；spec requirement "App composition exposes enabled long-term memory tools"。

- [x] 9.2 在 `create-app.ts` 中调整装配顺序（先 gateway/config snapshot 后 capability subsystem），并通过 `createLongTermMemoryToolAdapter()` helper 创建 adapter，然后只在 `MemoryConfig.status === VALID` 且 AgentAssembly opt-in 时调用 `agent-memory` 暴露的 `createMemoryToolDefinitions(adapter)`。memory tool definitions 只通过闭包捕获 `LongTermMemoryToolPort`；不得向 `ToolDependencies` / `requiredDependencies` 新增 `longTermMemory` 或任何 memory/observability-specific dependency name，不得创建独立 observability adapter dependency。若当前 capability subsystem 缺少接收这些 definitions 的入口，应新增 provider-scoped app-composed Tool catalog/executor 通用接线点，并以稳定 `providerId="memory-tools"` 的非默认 builtin provider 暴露 memory tools；`providerId="memory-tools"` 只用于 capability catalog identity，不得选择 local/remote memory backend 或携带 gateway adapter 配置；不得新增 memory-specific registry/executor/discovery path，也不得追加到默认 enabled `builtinToolDefinitions`。`MemoryConfig` 为 `DISABLED` / `INVALID` 时不得向模型可见 discovery、effective capability catalog 或 executable invocation path 暴露 memory tools；通过现有 startup/config diagnostics 路径上报 memory 配置诊断。
  验证：`npx.cmd vitest run tests/agent-kernel/config-assembly.test.ts tests/agent-kernel/memory-runtime-integration.test.ts` 覆盖 `MemoryConfig` VALID + opt-in 时 tools 为 AVAILABLE 且 providerId 为 `memory-tools`、DISABLED 默认不可见、INVALID 不可见、AgentAssembly 未 opt-in 或 providerId 不匹配时不可见、stale binding disabled 时返回 LTM_DISABLED；source test/architecture test 断言 `ToolDependencyName`、`allowedDependencyNames`、`BuiltinToolsExecutor` 未新增 memory-specific dependency 或分支，`builtinToolDefinitions` 未包含 memory tools，app-composed Tool catalog/executor 无 memory-specific import/branch。
  来源：design 决策 1A、7；spec requirement "Memory tools delivery depends on memory core" + "App composition exposes enabled long-term memory tools" + "Memory configuration diagnostics are reported safely"。

- [x] 9.4 接入 trusted description override 投影：当 `add-ts-memory-configuration` 从已绑定 memory capability 的 `capabilityBindings[].description` 生成 `ToolCatalogConfig.safeDescriptionOverride` 时，memory tool descriptor MAY 使用该值覆盖模型可见描述；该覆盖不得影响 exposure gate、capability enablement、provider identity、input/output schema、scope、权限或 invocation arguments。
  验证：capability catalog/config assembly 测试覆盖绑定描述缺失使用内置描述、绑定描述存在只覆盖 descriptor description、memory disabled/invalid 时即使存在 description override 也不暴露工具；architecture/code review 检查 memory tool implementation、executor、runtime、context 和 channel 不直接读取 `agent.yaml`，只消费 app composition 产出的 trusted `ToolCatalogConfig`。
  来源：spec requirement "Memory tools exposure through capability channel" scenario "Binding description override does not affect exposure"；`add-ts-memory-configuration` requirement "Agent-level memory description and prompt overrides"。

- [x] 9.3 保持 tools 与 aging 职责分离：本 change 只要求 `get_memory_detail` 通过 memory core public retrieval boundary 读取 L2；aging revival-on-access 接线由 `add-ts-memory-aging` 定义和验证，不在本 change 中实现或验收。
  验证：architecture/spec consistency 检查确认本 change 不直接定义 aging revival branch；如 aging change 需要接线，应在 `add-ts-memory-aging` 的任务和验证中覆盖。
  来源：proposal 非目标；`add-ts-memory-aging` owns archived revival on owner-authorized L2 access。

## 归档前基线提升检查（非实施任务）

实现完成并验证通过后，在归档前根据 proposal/design 的“归档前基线提升计划”处理：

- 同步 `openspec/specs/memory-tools/spec.md`。
- 按需更新 `openspec/overview.md`。
- 按需更新 `openspec/designs/architecture/memory.md`。
- 按需更新 `openspec/designs/domain/memory.md`。
- 按需更新 `openspec/designs/contracts/capability.md`。
- 必须更新 `openspec/designs/modules/agent-memory.md`。
- 必须更新 `openspec/designs/modules/agent-capability.md`。
- 按需新增或更新 `openspec/designs/adr/memory-tools-boundary.md`。
- 按需更新 `openspec/designs/spec-to-design-map.md`。
- 检查长期文档没有重复定义同一状态机、API schema、数据 owner 或接口语义。
