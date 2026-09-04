## 1. Guard 和 Characterization

- [x] 1.1 增加 architecture/source guard，断言 `agent-app` composition code 不再定义 memory extraction、workflow prompt/model adapter、runtime observation mapping、sandbox tool preparation、suggested/frequent question service、health probe business check 等 owner-owned helper。
  验证：新增或更新 architecture/source test，并运行 `npm run lint:architecture`；非法 helper fixture 或 source pattern 必须实际触发失败。
  来源：`[TS] App Composition Root 三职责边界`；design 决策 1、5、7。

- [x] 1.2 增加 dependency guard，断言 `agent-memory`、`agent-workflow`、`agent-observability`、`agent-context-engine`、`agent-capability`、`agent-runtime`、`agent-session`、`agent-channel-web` 不得依赖 `agent-app` 或 app-private composition path；并断言 `agent-session` 的 question services 不得依赖 `agent-model`、`agent-capability`、`agent-context-engine`、`agent-runtime` implementation 或 `agent-channel-web` implementation。
  验证：新增 dependency-cruiser negative fixture 或 rule，并运行 `npm run lint:architecture`，确认非法依赖会失败；negative case 覆盖 `agent-memory -> agent-context-engine`、`agent-memory -> agent-model`、`agent-workflow -> agent-context-engine`、`agent-workflow -> agent-capability`、`agent-workflow -> agent-model`、owner health probe package -> `agent-observability`、`agent-session -> agent-capability/local`、`agent-session -> agent-model`、`agent-session -> agent-runtime`、`agent-session -> agent-channel-web`，以及 owner package 从 `@nextagent/agent-contracts` root aggregate import。
  来源：`Scenario: owner packages do not depend on agent-app`；design 决策 2。

- [x] 1.3 增加 app composition characterization tests，固定 startup readiness、capability availability、memory tool availability、workflow availability、health/readiness safe diagnostics、question route availability 和 shutdown lifecycle handle 行为。
  验证：新增 app composition integration/characterization tests，并运行仓内等价 Vitest 命令。
  来源：`Scenario: composition refactor preserves external behavior`；design 迁移计划。

## 2. Observability Ownership

- [x] 2.1 在 `agent-observability` 暴露 `createRuntimeObservationBridge(...)`，承载 runtime log entry 到 observation event 的 safe mapping。
  验证：新增 `agent-observability` unit tests，覆盖 budget、capability selection、sandbox completion、unknown log shape 和 safe fallback mapping。
  来源：design 决策 2、3；proposal 影响范围。

- [x] 2.2 将 `agent-app` 中 runtime log observation mapping 替换为 `agent-observability` public factory 调用。
  验证：app composition characterization tests 通过；`rg "runtimeObservationFromLogEntry|budgetObservationFromRuntimeLog|sandboxCompletionObservationFromRuntimeLog" packages/agent-app/src` 无迁出后的旧 helper。
  来源：`Scenario: agent-app 只执行依赖注入`。

- [x] 2.3 验证 safe diagnostic 输出兼容。
  验证：observability snapshot/characterization tests 断言 safe reason code、stable refs 和 redaction 行为不变。
  来源：design 风险与取舍：observability safe diagnostic 文案变化。

## 3. Memory Ownership

- [x] 3.1 在 `agent-memory` 暴露 `createMemoryExtractionLlmStrategy(...)`，内部拥有 candidate parsing、category validation、source trace 和 safe error mapping；prompt 依赖使用 memory-local structural callback，由 `agent-app` 适配 context-engine prompt assembler。
  验证：新增 `agent-memory` tests，覆盖有效 JSON、无效 JSON、category mismatch、trajectory index 越界、model safeError、prompt/template failure 和 abort signal；architecture lint 断言 `agent-memory` 不依赖 `agent-context-engine` implementation。
  来源：`Scenario: agent-app 只执行依赖注入`；design 决策 2、3。

- [x] 3.2 在 `agent-memory` 暴露 `createMemoryLifecycleDiagnostics(...)`，承载 extraction/aging/revival diagnostic observation 所需的 owner-safe projection。
  验证：新增 `agent-memory` diagnostic tests，断言不输出 prompt、memory content、raw path、credential、token 或 raw storage/provider error。
  来源：proposal 影响范围；design 质量属性：安全、审计/可追溯性。

- [x] 3.3 将 `agent-app` 中 memory extraction strategy、candidate parser、memory extraction/aging diagnostic helper 替换为 `agent-memory` public factories。
  验证：app composition characterization tests 通过；`rg "parseMemoryExtractionLlmCandidates|createMemoryExtractionLlmStrategy|memoryExtractionSafeError|createMemoryAgingDiagnosticObservation|createMemoryExtractionDiagnosticObservation" packages/agent-app/src` 无迁出后的旧 helper。
  来源：`Scenario: agent-app 只执行依赖注入`；design current baseline。

- [x] 3.4 验证 local/remote memory backend gating 不变。
  验证：memory app composition tests 覆盖 local backend 启动 worker/scheduler、remote complete-service backend 不启动本地 worker/scheduler、disabled/invalid memory 不暴露 memory tools。
  来源：`Scenario: composition refactor preserves external behavior`。

## 4. Workflow Ownership

- [x] 4.1 在 `agent-workflow` 暴露 `createWorkflowRuntimeAdapters(...)`，承载 runtime capability resolver、model invocation config resolver 和 LLM prompt preparation；prompt/capability 依赖使用 workflow-local structural callbacks 或 `agent-contracts/*` contracts，由 `agent-app` 适配具体实现。
  验证：新增 `agent-workflow` tests，覆盖 agent scope/version lookup、capability governance resolver、model profile selection、inline prompt、template prompt、prompt failure safe error；architecture lint 断言 `agent-workflow` 不依赖 `agent-context-engine` 或 `agent-capability` implementation。
  来源：design 决策 2、3。

- [x] 4.2 将 `agent-app` 中 workflow runtime adapter helper 替换为 `agent-workflow` public factory 调用。
  验证：workflow app wiring tests 通过；`rg "createWorkflowRuntimeCapabilityResolver|resolveWorkflowModelInvocationConfig|prepareWorkflowLlmPrompt" packages/agent-app/src` 无迁出后的旧 helper。
  来源：`Scenario: agent-app 只执行依赖注入`。

- [x] 4.3 验证 workflow availability 和已有 routing/execution 行为不变。
  验证：运行 workflow package tests 和 app composition characterization tests；现有 workflow routing/execution tests 通过。
  来源：`Scenario: composition refactor preserves external behavior`。

## 5. Context Ownership

- [x] 5.1 在 `agent-context-engine` 暴露 `createRequestScopedSummaryGenerator(...)`，承载 request-scoped assembly lookup、model profile selection 和 traceable summary generator construction，并复用 existing `createDefaultTraceableSummaryGenerator(...)`。
  验证：新增 `agent-context-engine` tests，覆盖 agent version lookup、default profile selection、credentialRef 传递、prompt assembler failure safe path。
  来源：design 决策 2、3、5。

- [x] 5.2 将 `agent-app` 中 request-scoped summary helper 替换为 `agent-context-engine` public factory 调用。
  验证：context/app composition tests 通过；`rg "createRequestScopedSummaryGenerator" packages/agent-app/src` 只保留 import 或调用，不保留本地 helper 定义。
  来源：`Scenario: agent-app 只执行依赖注入`。

## 6. Capability Ownership

- [x] 6.1 演进 `agent-capability` existing `createWorkspaceBackedSandboxExecutionPort(...)`，承载 app-local `runSandbox(...)` 中仍未迁入的 sandbox request preparation、Python temp script preparation、sandbox safe error mapping 和 cleanup 行为；若暴露 `createSandboxToolExecutionAdapter(...)`，它 MUST delegate to the same implementation。
  验证：新增/更新 `agent-capability` sandbox tests，覆盖 bash/python command path、temp script cleanup、unsupported executable、unsafe path、unavailable、canceled、path redaction；source test 断言不存在第二套 sandbox adapter implementation。
  来源：design 决策 2、3、5；`Scenario: agent-app 只执行依赖注入`。

- [x] 6.2 将 `agent-app` 中 sandbox/tool preparation helper 替换为 `agent-capability` public factory 调用。
  验证：capability sandbox tests 和 app composition tests 通过；`rg "async function runSandbox|preparePythonSandboxExecution|toSandboxCapabilitySafeError|sanitizeSandboxExecutionDiagnosticMessage|sandboxRequest" packages/agent-app/src` 无迁出后的旧 helper。
  来源：`Scenario: agent-app 只执行依赖注入`。

- [x] 6.3 增加 sandbox negative verification，确保 capability/hook/policy 不绕过 sandbox gateway。
  验证：architecture/source negative test 实际触发直接 `child_process`/host shell import 或 private sandbox path 使用并断言失败；运行 `npm run lint:architecture`。
  来源：design 质量属性：安全；AGENTS.md 动态执行边界。

## 7. Session Question Assist Ownership

- [x] 7.1 在 `agent-session` 增加 conversation-derived assist service 边界，并从 `agent-capability/local` 或 `agent-app/composition` 迁入 question-owned helpers：category question catalog read model、question hash、suggested question prompt/output parsing、frequent question merge/ranking/association logic。
  验证：package export tests 或 build 断言 `@nextagent/agent-session` public exports 可用；package export/source tests 断言 `@nextagent/agent-capability` 不再导出 `CategoryQuestionResourceDiscovery`、`CategoryQuestionDiscoveryOptions`、`CategoryQuestionReadinessEvidence`、`CategoryQuestionReadinessOutcomeCode`、`CategoryQuestionCatalog`、`CategoryL1`、`CategoryL2`、`QuestionEntry`、`computeQuestionHash`、`createQuestionEntry` 或 `normalizeLocale`；architecture lint 断言 `agent-session` question service 不依赖 `agent-app`、`agent-channel-web` implementation、`agent-runtime` implementation、`agent-capability` implementation、`agent-model` implementation 或 `agent-context-engine` implementation；source check 断言 `agent-session` 不 import `agent-capability/local`、`AgentPackageSourceLocator` implementation 或 app path helpers。
  来源：design 决策 2、3、5；category question semantics and capability public export shrink constraints。

- [x] 7.2 在 `agent-session` 暴露 `createSuggestedQuestionService(...)`，实现 existing `SuggestedQuestionPort` 行为，不修改 `agent-contracts/runtime`。
  验证：迁移/新增 suggested question tests，覆盖 completed terminal run、non-completed run returns empty、abort returns empty、model safeError returns empty、skill context resolution、output cleaning/parsing、no timeline write。
  来源：`question-recommendation` existing spec；design current baseline。

- [x] 7.3 在 `agent-session` 暴露 `createFrequentQuestionService(...)` 和 session-local `CategoryQuestionCatalogPort` / `createCategoryQuestionCatalog(...)`，实现 existing `FrequentQuestionPort` list/pin/association 行为，不修改 Web DTO；category catalog loading 只能通过 app-injected narrow source/port，不得让 `agent-session` 读取完整 app config、raw config root 或 app-private path。
  验证：迁移/新增 frequent question tests，覆盖 fixed/pinned/high-frequency/non-fixed 五层排序、pin limit、gateway safe error fallback、association pinned/high-frequency/static caps、locale filtering 和 dedup。
  来源：existing frequent/question-association behavior；design current baseline。

- [x] 7.4 将 `agent-app` 中 `suggested-question-service.ts`、`frequent-question-service.ts`、`precomputed-suggested-questions.ts` 和 `category-question-service.ts` 替换为 `agent-session` public factories 或 thin composition-only wrappers。
  验证：app composition characterization tests 和 channel route tests 通过；`rg "SUGGESTED_QUESTION_SYSTEM_PROMPT|parseQuestions|createFrequentQuestionService|listQuestionAssociations|computeQuestionHash|CategoryQuestionResourceDiscovery|category-question-service" packages/agent-app/src` 无业务实现残留。
  来源：`[TS] App Composition Root 三职责边界`；design 决策 2、3、5 的 question assist ownership 和 capability public export shrink constraints。

## 8. Health Probe Ownership

- [x] 8.1 将 `createAppHealthProbes(...)` 中 gateway/model/capability business checks 拆到对应 owner package structural probe factory；`agent-observability` 继续拥有 `createHealthEvaluator(...)`，`agent-app` 负责把 structural probe object 适配成 `HealthProbe`。
  验证：owner package health tests 覆盖 gateway read check、model profile credential check、capability catalog read check 的 UP/DOWN safe result；不得输出 credential、path 或 raw provider/gateway error；architecture lint 断言 owner probe package 不依赖 `agent-observability` implementation。
  来源：proposal health probe 范围；design 决策 2、3、4 的 structural probe ownership constraint。

- [x] 8.2 将 `agent-app` health composition 替换为 owner probe factory 调用，并只负责把 probes 注入 `createHealthEvaluator(...)` 与 health/readiness route。
  验证：app composition characterization tests 通过；`rg "function createAppHealthProbes|MODEL_PROVIDER_CREDENTIAL_OK|CAPABILITY_CATALOG_READ_OK|GATEWAY_READ_OK" packages/agent-app/src` 无本地业务 probe 实现。
  来源：`Scenario: agent-app 只执行服务启动`。

- [x] 8.3 验证 health/readiness safe diagnostics 兼容。
  验证：health snapshot/characterization tests 断言 component name、status、reasonCode、summary 和 metrics labels 与现有兼容，除非 OpenSpec 明确更新。
  来源：`Scenario: composition refactor preserves external behavior`。

## 9. App 收口

- [x] 9.1 删除 `agent-app` 中迁出后未使用的 imports、类型别名、helper、test fixture 和 duplicate logic。
  验证：`npm run build`；`rg` 检查 design 中列出的迁出 helper 名称在 `agent-app` 中无本地定义。
  来源：design 决策 7；AGENTS.md 实现质量门禁。

- [x] 9.2 确认 `agent-app` 只保留 config、assembly、entrypoints、server、wiring、startup/shutdown、packaging/release 相关职责。
  验证：code review 检查点：逐文件检查 `packages/agent-app/src` 中新增/保留代码能归入三职责；无法完全自动化，因为职责判断需要结合 owner 语义。
  来源：`[TS] App Composition Root 三职责边界`。

- [x] 9.3 运行全局回归验证。
  验证：`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`。
  来源：proposal 验证入口；design 验证映射。

## 10. OpenSpec 和 Roadmap 收尾

- [x] 10.1 验证 OpenSpec change 本体。
  验证：`openspec validate shrink-agent-app-to-composition-root --strict`。
  来源：proposal Baseline Promotion Plan。

- [x] 10.2 验证所有 OpenSpec 文档一致性。
  验证：`openspec validate --all --strict`。
  来源：AGENTS.md 验证门禁。

- [x] 10.3 更新 change consistency check 记录，说明 proposal、spec、design、tasks、roadmap 和 onepage 一致。
  验证：检查 `docs/ts-migration/change-consistency-checks.md` 中 `shrink-agent-app-to-composition-root` 记录已覆盖 `agent-session` question assist、sandbox existing port 和 health probe owner 修正。
  来源：roadmap 生成后一致性确认规则。

## 11. 严格 Composition Root 收口追补

- [x] 11.1 将 review 发现的残留 app-owned helper 继续迁回 owner package，包括 memory tool port、workflow tool/recipe/remote bridge、large content externalizer、clip command runner、capability model patch resolver、HTTP/health/safe-error observation adapter、attachment observation projection、model invocation observation context store 和 skill catalog query port。
  验证：`npx tsc -b`；`rg` 检查这些 helper 在 `packages/agent-app/src/composition` 中只作为 owner public factory 调用或不出现，不再有本地定义。
  来源：用户复审要求；`[TS] App Composition Root 三职责边界`。

- [x] 11.2 强化 architecture/source guard，防止上述 helper 回流到 `agent-app` composition path。
  验证：`npm run lint:architecture`；source guard 覆盖新增迁出 helper 名称。
  来源：design 决策 7；AGENTS.md 禁止第二套实现。

- [x] 11.3 对严格收口后的实现运行完整验证门禁并确认无废弃代码、冗余代码或第二套实现。
  验证：`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`openspec validate shrink-agent-app-to-composition-root --strict`、`openspec validate --all --strict`。
  来源：用户完成标准；AGENTS.md 验证门禁。

## 12. 残留业务逻辑复审追补

- [x] 12.1 将复审发现的 long-term memory disabled gateway/default search wrapping、RAG unavailable gateway、SkillHub source authorization、subagent deferred unavailable result、projection metrics mapping 和 workflow recipe capability attachment 从 `agent-app` 迁到 owner package public API。
  验证：`npx tsc -b`；`rg "isSkillHubProviderSourceAuthorized|noopRagRetrievalGateway|lazySubagentExecutionPort|recordProjectionResult|class DisabledLongTermMemoryAdapter|function createDisabledLongTermMemoryGateway|function attachRecipeCapabilitiesToAssemblies" packages/agent-app/src` 无业务实现残留。
  来源：用户复审要求；`[TS] App Composition Root 三职责边界`。

- [x] 12.2 强化 architecture/source guard，覆盖本次复审残留 helper，防止它们回流到 `agent-app` composition path。
  验证：`npm run lint:architecture`。
  来源：design 决策 7；AGENTS.md 禁止第二套实现。

- [x] 12.3 将再次复审发现的 workflow guardrail lifecycle-hook adapter 和 RAG knowledge retrieval result shaping 从 `agent-app` 迁到 `agent-workflow` public API。
  验证：`npx tsc -b`；`npx vitest run packages/agent-workflow/tests/runtime-node-adapters.test.ts`；`rg "evaluateGuardrail:\\s*async|retrieveKnowledge:\\s*async|fileNameFromRef|WorkflowGuardrailDecision|WorkflowKnowledgeRetrievalResult|createWorkflowKnowledgeDocument|RagRetrievalChunk|\\.slice\\(0, request\\.rankTopN\\)|safeModelRequestSummary: request\\.safeContentSummary" packages/agent-app/src --glob "*.ts"` 无业务实现残留。
  来源：用户再次复审要求；`[TS] App Composition Root 三职责边界`。

## 13. create-app 结构收口追补

- [x] 13.1 将 `create-app.ts` 中 app-local gateway provider selection、channel registration、assembly/scoping 和无状态启动 helper 拆分到职责命名的 composition module，`create-app.ts` 保留 public options/type facade、配置解析入口和启动/关闭装配流水线。
  验证：`npx tsc -b`；`rg "function createGatewayBindingsForSelection|function registerProductWebChannel|function createHotReloadingActiveAssemblyRegistry|function createCapabilityProviderReferenceValidation" packages/agent-app/src/composition/create-app.ts` 无本地定义；`packages/agent-app/src/composition/create-app.ts` 行数 1126。
  来源：用户复审要求；design 决策 7；`[TS] App Composition Root 三职责边界`。

- [x] 13.2 增加 architecture source guard，防止 `create-app.ts` 回到超大文件或重新承载已拆出的 composition helper。
  验证：`npx vitest run --config vitest.config.architecture.ts tests/architecture/workspace.test.ts`；新增 guard 断言 `create-app.ts` 不超过 1150 行，且 gateway/channel/assembly/helper 定义不回流。
  来源：AGENTS.md 禁止废弃代码、冗余代码、第二套实现；用户“避免超大类”完成标准。

- [x] 13.3 对结构收口后的实现运行完整验证门禁。
  验证：`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`openspec validate shrink-agent-app-to-composition-root --strict`、`openspec validate --all --strict`。
  来源：用户完成标准；AGENTS.md 验证门禁。

## 14. create-app 主流程清晰度追补

- [x] 14.1 将 capability subsystem、workflow execution、context engine、memory maintenance 和 app lifecycle start/close 的装配细节继续拆到职责命名的 composition module，使 `createComposedApp(...)` 只表达阶段化装配过程和依赖交接。
  验证：`npx tsc -b`；architecture guard 断言 `create-app.ts` 使用 `capability-composition`、`workflow-composition`、`context-engine-composition`、`memory-maintenance-composition` 和 `app-lifecycle-composition`；`packages/agent-app/src/composition/create-app.ts` 行数 1126。
  来源：用户复审要求；`Scenario: agent-app 只执行依赖注入`；design 可维护性目标。

- [x] 14.2 对主流程清晰度追补后的实现运行完整验证门禁。
  验证：`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`openspec validate shrink-agent-app-to-composition-root --strict`、`openspec validate --all --strict`。
  来源：用户完成标准；AGENTS.md 验证门禁。

## 15. create-app 装配阶段追补

- [x] 15.1 将 request runtime、session-facing services 和 product channel/server 的装配细节拆到对应 module composition，使 `createComposedApp(...)` 只保留流程控制、配置事实加载结果交接和跨模块依赖注入。
  验证：`npx tsc -b`；architecture guard 断言 `create-app.ts` 使用 `request-runtime-composition` 和 `session-services-composition`，并断言 `create-app.ts` 不超过 1000 行；`packages/agent-app/src/composition/create-app.ts` 行数 947。
  来源：用户复审要求；`Scenario: agent-app 只执行依赖注入`；design 可维护性目标。

- [x] 15.2 对装配阶段追补后的实现运行完整验证门禁。
  验证：`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`openspec validate shrink-agent-app-to-composition-root --strict`、`openspec validate --all --strict`。
  来源：用户完成标准；AGENTS.md 验证门禁。

## 16. createComposedApp 真正分阶段装配追补

task 13-15 的 guard 只看行数与 import 字符串，无法保证 `createComposedApp` 主流程清晰；复审发现仍存在散落 mutable 回填、内联 owner-owned 构造与 memory aging observer 第二套实现。本节按风险递增、每步可独立回滚。

- [x] 16.1 消除假循环 mutable binding：把 `modelObservationContexts` + `observedModel` 构建前移到 `projectorHost` 之后、`composeWorkflowExecutionLayer` 之前，直接传入 workflow/session/context 层；删除 `let workflowModelInvocation` 及其 getter。
  验证：`npx tsc -b`；`rg "let workflowModelInvocation" packages/agent-app/src/composition/create-app.ts` 无结果。
  来源：design 决策 8.1；用户复审要求。

- [x] 16.2 集中化真循环 deferred bindings：新建 `composition/deferred-composition-bindings.ts`，导出 `createCompositionDeferredBindings()`，固定字段 `lifecycleHookInvocation`(proxy)+`bindLifecycleHookInvocationTarget`、`workflowCapabilityInvocation`+`bind`、`workflowRuntimeAdapters`+`bind`、`runtimeSubagentExecution`+`bind`；create-app 创建一次传给 workflow/capability/request-runtime/context 层；删除散落 `let` 与内联 `set*` 回调（含 `setLifecycleHookInvocationTarget`）。
  验证：`npx tsc -b`；`createComposedApp` 函数体内 `let` 声明仅出现在 deferred holder。
  来源：design 决策 8.1；`Scenario: agent-app 只执行依赖注入`。

- [x] 16.3 消除 memory aging observer 第二套实现：在 `memory-maintenance-composition` 暴露 `createMemoryAgingObservers(...)`，返回 `{ diagnosticObserver, auditObserver }`；`memoryToolPort` 与 aging scheduler 共用同一 observer 工厂；create-app 不再内联 observer 闭包。
  验证：`npx tsc -b`；`rg "createAgingDiagnosticObservation|createAgingAuditObservation" packages/agent-app/src/composition/create-app.ts` 无结果。
  来源：design 决策 8.3；AGENTS.md 禁止第二套实现。

- [x] 16.4 新建 `attachment-composition.ts`：承载 `createAttachmentIntakeRuntime`/`createAttachmentCleanupRuntime`/`createAttachmentLifecycleDiagnostics` + diagnostic observer 闭包；create-app 只 `composeAttachmentLayer(...)`。
  验证：`npx tsc -b`；`rg "createAttachmentIntakeRuntime|createAttachmentCleanupRuntime|createAttachmentLifecycleDiagnostics" packages/agent-app/src/composition/create-app.ts` 无直接调用。
  来源：design 决策 8.2；同形同策（其他子系统均有 `*-composition.ts`）。

- [x] 16.5 把 model profile validation evidence 报告（`reportModelProfileValidationEvidence` + 内联 `createObservationEvent`）下沉到 observability composition 或 `composeModelDiagnostics`；create-app 不再出现 `createObservationEvent(`。
  验证：`npx tsc -b`；`rg "createObservationEvent\(" packages/agent-app/src/composition/create-app.ts` 无结果。
  来源：design 决策 8.2；observability shaping 归 owner。

- [x] 16.6 新建 `health-composition.ts`：承载三 probe 构造 + `createHealthEvaluator` + `createObservedHealthEvaluator`；create-app 只 `composeHealthEvaluator(...)`。
  验证：`npx tsc -b`；`rg "createModelProviderHealthProbe|createCapabilityCatalogHealthProbe|createSessionGatewayReadHealthProbe|createHealthEvaluator|createObservedHealthEvaluator" packages/agent-app/src/composition/create-app.ts` 无直接调用。
  来源：design 决策 8.2；task 8.2 "只把 probes 注入 createHealthEvaluator" 的真正落地。

- [x] 16.7 扩展 `gateway-composition.ts` 承载 gateway/sandbox/rag/scheduledMaintenance/todoState/`ensureRagKnowledgeBuilt` 编排；create-app 调用 `composeGatewayLayer(...)`。
  验证：`npx tsc -b`；create-app 中 gateway 相关只剩单次 `composeGatewayLayer` 调用。
  来源：design 决策 8.2；`Scenario: agent-app 只执行依赖注入`。

- [x] 16.8 把 `capabilityProviders` 解析 + `isProviderAdapterRegistered` 回调移进 `capability-composition.ts`；create-app 不再内联。
  验证：`npx tsc -b`；`rg "isProviderAdapterRegistered" packages/agent-app/src/composition/create-app.ts` 无结果。
  来源：design 决策 8.2；capability provider business composition 归 owner。

- [x] 16.9 升级 `workspace.test.ts` guard（line 257）：在现有断言上增加——create-app.ts 不含 `createObservationEvent(`、不含 `diagnosticObserver:`/`auditObserver:`、不含 `createAttachmentIntakeRuntime`/`createHealthEvaluator`/`createLongTermMemoryToolPort`/`isProviderAdapterRegistered`/`createModelProviderHealthProbe` 直接调用；且 `createComposedApp` 函数体内 `let` 声明数 ≤ deferred holder 字段数。新增 negative fixture（临时内联回任一被禁符号）实际触发失败。
  验证：`npx vitest run --config vitest.config.architecture.ts tests/architecture/workspace.test.ts`；negative fixture 实际触发失败。
  来源：design 决策 8.4；AGENTS.md 禁止项须被测试实际触发并断言失败。

- [x] 16.10 对分阶段装配追补后的实现运行完整验证门禁 + push 前 `$nextagent-code-review`。
  验证：`npm run build`、`npx tsc -b`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`openspec validate shrink-agent-app-to-composition-root --strict`、`openspec validate --all --strict`。
  来源：用户完成标准；AGENTS.md 验证门禁与 push 约束。

## 17. review findings cleanup

- [x] 17.1 修复 config validation 中 gateway transport 决策泄漏、audit port `any`、dead import/barrel/stale declaration，并用 contract/architecture 验证覆盖。
  验证：`npx tsc -b --pretty false`；`npx vitest run --config vitest.config.contract.ts tests/contract/gateway-configuration-contracts.test.ts`；`npx vitest run --config vitest.config.release.ts packages/agent-app/tests/risk-policy.test.ts`；`npm run lint:architecture`；源码回归搜索确认 `GatewayConfig` console warn、audit `any`、risk-policy barrel、stale `.d.ts`、dead helper 无残留。
  来源：用户 review findings P1-2/P1-3/P2-1/P2-2/P2-3/P2-4/P2-9；AGENTS.md structured logging、typed contract、外科手术式修改。

- [x] 17.2 将启动期 RAG knowledge build 的 cancellation signal 串到 gateway build，并补 composition characterization 测试。
  验证：`npx tsc -b --pretty false`；`npx vitest run --config vitest.config.release.ts packages/agent-app/tests/composition.test.ts`；`npm run lint:architecture`。
  来源：用户 review findings P2-6/P2-8；AGENTS.md 长耗时 gateway 操作 cancellation 与 lifecycle/gateway 测试要求。

- [x] 17.3 将剩余 memory/model/request-runtime observation shaping 下沉到 owner 工厂，composition module 只注入 projector/transport。
  验证：`npx tsc -b --pretty false`；`npx vitest run --config vitest.config.release.ts packages/agent-app/tests/composition.test.ts`；源码回归搜索确认 `memory-config-telemetry.ts`、`model-diagnostics-composition.ts`、`request-runtime-composition.ts` 不再包含 `createObservationEvent`/`diagnosticCandidates`/`LOW_CARDINALITY` shaping。
  来源：用户 review finding P2-5；design 决策 8.2/8.4 与 task 11.1 observation adapter 迁移目标。

- [x] 17.4 对 review cleanup 运行完整验证门禁。
  验证：`npm run build`、`npx tsc -b --pretty false`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`openspec validate shrink-agent-app-to-composition-root --strict`、`openspec validate --all --strict`。
  来源：用户完成标准；AGENTS.md 验证门禁。

## 18. agent-app 内部结构优化（业务回归、装配分层、子目录依赖）

延续 design 决策 9。本节只落地符合现有依赖方向、不引入 owner 反向依赖的部分；observation adapter 归属、plugin-loader 边界、完整子目录 DAG deferred 到后续 OpenSpec change（见 design 待确认问题）。

- [x] 18.0 修正 composition 依赖方向（前置）：新建 `composition/composition-contracts.ts`，仅承载跨 composition module 共享的 type-only 词汇；从 create-app.ts 抽出共享类型（`AppGatewayStores`、`AppSandboxGatewayPort`、`*Factory`、`RagRetrievalBinding`、`CapabilityProviderReferenceValidation`、`RuntimeModelProviderKind`、`SkillHubAccessFactory`、`CreateComposedAppOptions`/`CreateNextAgentAppOptions`、`NextAgentApp`、`Web*Registration`/`*Context`、`WebIdentityResolver`）；从 assembly-composition 抽出 `AgentScope`。单个 layer 的返回 interface（如 `ContextEngineComposition`、`MemoryMaintenanceComposition`）若只被该 module 与 create-app 使用，可继续由本 module export；只有确需跨多个 composition module 共享的返回类型才进入 contracts。所有 composition module 改从 contracts 导入共享类型，删 `import ... from "./create-app.js"`。消除 sibling composition module 值依赖：`findDuplicateProviderId` 移入 `app-composition-helpers.ts` 或 owner module，不进入 contracts；`trustedAgentPromptRoot` 归 prompt-template-composition 或由 create-app 调用后作入参传入。删 stale `session-services-composition.d.ts`。加 depcruise 规则禁止 `composition/(?!create-app\.ts|composition-contracts\.ts) → ./create-app.js`，并禁止 `*-composition.ts` value-import sibling composition module（允许 type-only import contracts，允许从 owner package public export 导入 value factory）。
  验证：`npx tsc -b --pretty false`；`npm run lint:architecture`；`Select-String -Path packages/agent-app/src/composition/*-composition.ts -Pattern "from .\./create-app\.js"` 无结果；source/architecture test 断言 composition module 无 sibling composition value import，且 contracts 文件只包含 type/interface/type alias/import type/export type。
  来源：design 决策 9.5；架构设计 module 为独立叶子、create-app 唯一编排。

- [x] 18.1 修复 `config → composition` 逆向：把 `createDefaultProductOptions()` 从 `config/system-config.ts` 移到 `composition/create-app.ts` 或 `composition/default-product-options.ts`，删 `system-config.ts` 对 `CreateNextAgentAppOptions` 的 import；加 depcruise 规则禁止 `config/ → composition/`。`composition → server`（叶子）保留；`assembly → plugin`（type-only）暂 tolerated。
  验证：`npx tsc -b --pretty false`；`npm run lint:architecture`；`Select-String -Path packages/agent-app/src/config/system-config.ts -Pattern "composition"` 无结果。
  来源：design 决策 9.3；用户方向3。

- [x] 18.2 抽 observability 基础设施装配：新建 `composition/observability-composition.ts` 暴露 `composeObservabilityInfrastructure(...)`，承接 `create-app.ts` 内联的 structuredLogProjector、metricsProjector、projectorHost、runtimeObservationBridge、runtimeLogger、auditWriter、auditProjector、modelObservationContexts、observedModel；返回 `{ projectorHost, runtimeLogger, auditWriter, observedModel, modelObservationContexts, structuredLogTransport }`；create-app 只调用 + 注入。
  验证：`npx tsc -b --pretty false`；`Select-String -Path packages/agent-app/src/composition/create-app.ts -Pattern "createObservabilityProjectorHost|createStructuredLogProjector|createObservedModelInvocationService"` 无直接调用。
  来源：design 决策 9.2；用户方向2。

- [x] 18.3 扩 `assembly-composition.ts` 暴露 `composeAgentAssemblyLayer(...)`：只承接 agent package discovery、recipe capability attachment、runtime-facing assembly projection、startup/active assembly registry、default route assembly/scope、agentScopesByAgentId。不得把 lifecycle hook materialization、memory tools opt-in、prompt template 装配合入该 layer。
  验证：`npx tsc -b --pretty false`；`Select-String -Path packages/agent-app/src/composition/create-app.ts -Pattern "createAgentDiscoveryAssemblies|attachRecipeCapabilitiesToAssemblies|composeRuntimeFacingAgentAssemblies"` 无直接调用；`composeAgentAssemblyLayer` 入参/返回值不包含 memory tool opt-in 或 lifecycle hook executable。
  来源：design 决策 9.2；用户方向2。

- [x] 18.4 抽 lifecycle hook startup materialization：新建 `composition/lifecycle-hook-composition.ts` 或扩展现有 lifecycle composition，承接 materialized hook snapshots/executables、assembly-scoped executable registry 和 startup runtime lifecycle hook executor；接收 `lifecycleHookDefinitions` 与 `agentAssemblies` 作入参产出 materialization 结果。startup `lifecycleHookDefinitions` 汇总/冻结（`buildStartupLifecycleHookRegistry`+`freezeLifecycleHookDefinitions`，只依赖 options+pluginRegistry）留在 create-app 作编排胶水，不归该 layer 拥有，避免与 18.3 assembly 形成 definitions↔assemblies 循环依赖。create-app 只注入 materialization 结果，不再内联 snapshot/executable 构造。
  验证：`npx tsc -b --pretty false`；`Select-String -Path packages/agent-app/src/composition/create-app.ts -Pattern "materializeAgentHookSnapshots|buildAssemblyScopedLifecycleHookExecutables|createStartupRuntimeLifecycleHookExecutor"` 无直接调用；`composeLifecycleHookMaterialization`（或等价 layer）入参包含 definitions 与 agentAssemblies、不自行 freeze definitions。
  来源：design 决策 9.2；用户方向2。

- [x] 18.5 抽 model service 选择：新建 `composition/model-composition.ts` 暴露 `composeModelService(...)`，承接 `createProductModelInvocationService` + `requiresModelGatewayProvider` + `hasRemoteGatewaySelection`；create-app 只调用。
  验证：`npx tsc -b --pretty false`；`Select-String -Path packages/agent-app/src/composition/create-app.ts -Pattern "function createProductModelInvocationService"` 无结果。
  来源：design 决策 9.2；用户方向2。

- [x] 18.6 下沉 prompt template 装配：新建 `composition/prompt-template-composition.ts` 或移入 `context-engine-composition.ts`，承接 prompt template registry/assembler 构造与 builtin agent prompt registrations；create-app 只注入 prompt registry/assembler，不把该逻辑放入 assembly layer。
  验证：`npx tsc -b --pretty false`；create-app.ts 不再内联 `createDefaultPromptTemplateRegistry`/`builtinAgentPromptTemplateRegistrations` 编排；prompt template composition 不依赖 gateway/runtime/request lifecycle。
  来源：design 决策 9.2；用户方向2。

- [x] 18.7 收口 session question catalog 小内联：把 `createCategoryQuestionCatalog` + `locateResourceDir` 移入 `composeSessionServicesLayer` 或 session-services 专用 composition helper；create-app 只传 trusted resource locator/source 所需窄依赖；同时复用已解析的 `identity`，不再重新读取 `options.identity ?? defaultIdentity()`。
  验证：`npx tsc -b --pretty false`；`Select-String -Path packages/agent-app/src/composition/create-app.ts -Pattern "createCategoryQuestionCatalog"` 无结果。
  来源：design 决策 9.1；前序 review P3-2/P3-3。

- [x] 18.8 memory config bounds 回归 `agent-memory`：`agent-memory` 暴露 memory config 默认值/校验 owner API（例如 `defaultMemoryConfig()` + `validateMemoryConfig(projection)`），拥有 decayStaleDays/decayFactor/reviveConfidenceBoost 等默认值与数值边界；`config/validation.ts` 只做 schema parse、config evidence 聚合和 agent-app 状态映射，不改变既有 config schema/DTO。
  验证：`npx tsc -b --pretty false`；memory configuration contract tests 覆盖默认值、非法数值、disabled/invalid readiness；`config/validation.ts` 不再出现 memory lifecycle 数值边界比较或默认常量定义。
  来源：design 决策 9.1；用户方向1。

- [x] 18.9 app-lifecycle shaping 下沉：把 `app-lifecycle-composition.ts` 内联的 `createObservationEvent(`（APP_START/APP_SHUTDOWN）移入 observability adapter（`emitAppLifecycleObservation`）；composition module 只调用。
  验证：`npx tsc -b --pretty false`；`Select-String -Path packages/agent-app/src/composition/app-lifecycle-composition.ts -Pattern "createObservationEvent\("` 无结果。
  来源：design 决策 9.1；用户方向1。

- [x] 18.10 guard 升级：把 `forbiddenCreateAppCompositionFragments`（`createObservationEvent(`、`diagnosticObserver:`、`auditObserver:` 等）扩展到职责命名的 `composition/*-composition.ts`，配显式 exception allowlist（每个 exception 写 owner/原因/允许片段）；新增 create-app body 形态断言（`compose*` 调用 + deferred bind + return + 有上限的 trivial 赋值）；加 negative fixture 实际触发失败。guard 只禁 owner-owned shaping/strategy/algorithm，不禁合法 owner public factory wiring。
  验证：`npx vitest run --config vitest.config.architecture.ts tests/architecture/workspace.test.ts`；negative fixture 触发失败。
  来源：design 决策 9.4；AGENTS.md 禁止项须被测试实际触发并断言失败。

- [x] 18.11 对内部结构优化运行完整验证门禁 + push 前 `$nextagent-code-review`。
  验证：`npm run build`、`npx tsc -b --pretty false`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`openspec validate shrink-agent-app-to-composition-root --strict`、`openspec validate --all --strict`。
  来源：用户完成标准；AGENTS.md 验证门禁与 push 约束。

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，在归档前根据 proposal/design 的“归档前更新基线”处理：

- 同步 `openspec/specs/ts-backend-architecture/spec.md`。
- 更新 `openspec/designs/architecture/ts-backend-architecture.md`。
- 更新 `openspec/designs/modules/agent-app.md`。
- 按迁移结果更新 `openspec/designs/modules/agent-memory.md`、`openspec/designs/modules/agent-workflow.md`、`openspec/designs/modules/agent-observability.md`、`openspec/designs/modules/agent-context-engine.md`、`openspec/designs/modules/agent-capability.md`。
- 更新 `openspec/designs/modules/agent-session.md`，补充 question assist 子能力边界。
- 更新 `openspec/designs/spec-to-design-map.md`。
- 检查长期文档没有重复定义同一状态机、API schema、数据 owner 或接口语义。
