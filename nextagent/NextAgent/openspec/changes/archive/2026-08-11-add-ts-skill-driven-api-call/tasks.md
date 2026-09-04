## 1. Extension 修改（skill-manifest-contract）

- [x] 1.1 在 `agent-capability/src/skills/skill-manifest.ts` 的 `isSafeExtensionKey` 中新增 `api_header_params` 白名单，跳过 `unsafeKeyPattern` 检测但仍受 key 长度约束。
  验证：`npx vitest run packages/agent-capability/tests/skill-manifest.test.ts` 覆盖 `api_header_params` accepted、其他 header 含 key 仍 reject。
  来源：spec "Extension Key Whitelist For Api Header Params"；design 决策 6。

- [x] 1.2 在 design/ADR 中记录 governed behavior 消费 `_naie_agentic_loop_flag` 的受控例外（`_naie_pass_through_flag` 为预留字段，不在例外范围内），更新 `skill-extension-metadata-boundary.md` 例外范围。
  验证：code review 检查编排层仅读取 `_naie_agentic_loop_flag`，不读取 `_naie_pass_through_flag`/`api_header_params`/`api_request_params`。
  来源：spec "Governed Behavior May Consume Specific Extension Keys"；design 决策 6。

## 2. ApiCallPort / ParameterExtractionPort 接口与 Tool 依赖扩展

- [x] 2.1 在 `agent-contracts/src/capability/index.ts` 中新增 `ParameterExtractionPort` 接口（`extractParams(input, signal)`），在 `agent-capability/src/tools/tool-spi.ts` 中新增 `ApiCallPort` 接口（`callApi` 非流式 + `callApiStream` 流式），扩展 `ToolDependencyName`（加 `"apiCallPort"` 和 `"parameterExtraction"`）和 `ToolDependencies`。
  验证：`npm run build` 编译通过；TypeScript type check 通过。
  来源：spec "ApiCallPort Defines HTTP API Call Boundary"、"ParameterExtractionPort Provides Model Parameter Extraction To API Tool"；design 决策 3a、4。

- [x] 2.2 在 `agent-platform-gateway-local/src/api-call/local-api-call-port.ts` 中实现 `createLocalApiCallPort`（`fetch` HTTP/HTTPS 非流式 + SSE 流式解析），在 `agent-platform-gateway-remote/src/api-call/remote-api-call-port.ts` 中实现 `createRemoteApiCallPort`（UDS 占位，返回 503）。
  验证：build 通过；架构测试通过。
  来源：design 决策 4。

- [x] 2.3 在 `agent-app/src/composition/parameter-extraction-port.ts` 中实现 `createParameterExtractionPort`，直接调 `ModelInvocationService.complete()` + agent assembly model profile 解析 + JSON 参数解析。传 `locale` 和 `modelProfileId`。超时返回 `PARAMETER_EXTRACTION_TIMEOUT`，解析失败返回 `PARAMETER_EXTRACTION_FAILED`。
  验证：build 通过。
  来源：design 决策 3a、8。

- [x] 2.4 在 `agent-app` composition 中：`prepareCompositionInputsAsync` 按 `deploymentMode` 创建 `apiCallPort`（LOCAL 从 `loadLocalRuntimeBindings` 拿，REMOTE 从 `loadRemoteApiCallPort` 拿），存入 `PreparedCompositionInputs.capabilityRuntimeInput.apiCallPort`。`createParameterExtractionPort` 在 `composeNextAgentApp` 里创建并注入 `toolDependencies`。`local-runtime-bindings.ts` 扩展 `LocalGatewayRuntimeBindings` 加 `createLocalApiCallPort`。
  验证：build 通过；1107 测试通过。
  来源：design 决策 3a、4。

## 3. API Tool 定义与实现

- [x] 3.1 在 `agent-capability/src/builtins/` 中新增 `api-call-tool.ts`，使用 `defineTool` 创建 `ApiCall` tool（`modelInvocable=false`、`disclosurePolicy=HIDDEN`、`requiredDependencies=["skillSources","apiCallPort","parameterExtraction"]`）。
  验证：catalog registration tests 断言 tool 注册但非 model-visible。
  来源：spec "API Tool Is Independent Non-Model-Visible Tool Capability"；design 决策 3。

- [x] 3.2 实现 Swagger 2.0 解析：通过 `skillSources.readSkillResource` 读 `api/<name>.yaml`，用 `js-yaml` 解析 + 自定义提取函数构造 apiDoc（baseUrl/path/method/produces/parameters）。不做 yaml 缓存。文件缺失或格式错误返回 `API_DOC_LOAD_FAILED` safe error，不暴露文件路径。
  验证：apiDoc parsing unit tests 覆盖正常 yaml、malformed yaml、缺失文件。
  来源：spec "Swagger 2.0 ApiDoc Parsing"；design 决策 5、8。

- [x] 3.3 实现 API tool 执行流程：读 yaml → 构造 apiDoc → 生成提参 prompt → 通过 `parameterExtractionPort.extractParams()` 提参 → 合并参数（headerParams/requestParams/extractedParams）→ 通过 `apiCallPort` 调用 → 非流式返回 structuredPayload（原样不截断，绕过 maxCapabilityResultMessageChars）/ 流式通过 `emitResultDelta` 原样转发 SSE data。记录低基数结构化日志（api name、执行步骤、结果码），不记录 credential/请求体/响应体/endpoint。
  验证：focused tests 覆盖提参、非流式响应、流式 delta 转发、流式中断（API_STREAM_INTERRUPTED，已转发 delta 保留）、超时、abort、HTTP 401/403（UNAUTHORIZED）、HTTP 超时（TIMEOUT）、其他错误（UNAVAILABLE）、大响应不截断。
  来源：spec "Streaming And Non-Streaming Response Handling"、"HTTP Call Failure Handling"、"Parameter Sources Are Trusted"、"Observability For Non-Agentic API Path"；design 决策 3、7、8、11。

## 4. Skill tool 非 agentic 分派

- [x] 4.1 在 `agent-capability/src/builtins/skill-tool.ts` 的 `executeSkillTool` 中，`readSkillMetadata` 后插入 `_naie_agentic_loop_flag === "false"` 分派：仍 load body 解析 ```api 代码块中的 api 命令（api name、hiro），但不 inject body、不做 resource projection。返回 structuredPayload（skill name、api 命令、apiHeaderParams、apiRequestParams）+ metadata（nonAgenticApiCall: true）。api 命令解析失败返回 `API_COMMAND_PARSE_FAILED` safe error。
  验证：skill-tool tests 覆盖 flag=false load body 但不 inject、api 命令解析成功/失败、flag=true/不传走现有路径。
  来源：spec "Skill Tool Non-Agentic Dispatch"、"Non-Agentic Skill Detection And Dispatch"；design 决策 1、5、8。

## 5. 编排层（agent-core routing）

- [x] 5.1 新增编排模块（位置类似 `TargetedSkillRouter`），在 tool loop 处理完 Skill tool 结果后检测 `nonAgenticApiCall` 信号：从 structuredPayload 提取 api 信息 + apiHeaderParams + apiRequestParams → 从 `RequestContext.acceptedInputText` 获取用户问题 → 从请求头提取 header params → 从 trusted context 获取 request params → `capabilityInvocation.invoke()` 调用 API tool → 结果写入 terminal assistant message。编排层不做提参。
  验证：orchestration integration tests 覆盖检测信号、提取参数、调用 API tool、终态返回、不继续 model loop。
  来源：spec "Orchestration Layer Invokes API Tool And Returns Terminal Response"；design 决策 2。

- [x] 5.2 在 `DefaultAgent.executeRun` 的 tool loop 中，`executeToolCallsInOrder` 返回后、下一次 model invocation 之前，插入 `nonAgenticApiCall` 信号检测拦截点。同时检查同一轮是否存在其他 tool result，若存在则拒绝返回 `NON_AGENTIC_BATCH_CONFLICT`。
  验证：integration tests 断言 flag=false 时不进入下一轮 model invocation；同一轮有其他 tool call 时返回 NON_AGENTIC_BATCH_CONFLICT。
  来源：spec "Non-Agentic Batch Conflict Is Rejected"；design 决策 2、10。

- [x] 5.3 实现 checkpoint 策略：调用 API tool 前保存 checkpoint（标记进入非 agentic 路径），API tool 返回后保存 checkpoint（标记拿到结果）。恢复时发现已进入但未拿到结果则返回失败不重试。
  验证：checkpoint recovery tests 覆盖正常保存、崩溃后恢复不重试 API 调用。
  来源：spec "Checkpoint And Recovery For Non-Agentic Path"；design 决策 9。

## 6. 提参 prompt 生成

- [x] 6.1 在 API tool 内部生成基础版提参 prompt：根据 skill 内容、用户问题、yaml 必填参数构造提参 prompt，通过 `parameterExtractionPort.extractParams()` 调模型。
  验证：unit test 断言 prompt 包含必填参数定义和用户问题，extractParams 被正确调用。
  来源：spec "ParameterExtractionPort Provides Model Parameter Extraction To API Tool"；design 决策 3。

## 7. 验证和审查

- [x] 7.1 运行 `npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`openspec validate --all --strict`。
  验证：全量门禁通过。
  来源：AGENTS 验证门禁。

- [x] 7.2 运行 `nextagent-skill-review` 检视唯一实现路径、无 agent-contracts/system-prompt/sandbox/REST contract 变化（除已记录例外）并清理临时产物。
  验证：审查 PASS。
  来源：AGENTS OpenSpec 与实现质量门禁。

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，按 proposal/design 的归档前更新基线处理：
- 新增 `specs/skill-driven-api-call/spec.md` stable spec
- 更新 `specs/skill-manifest-contract/spec.md`、`specs/skill-tool/spec.md`、`specs/builtin-tool-framework/spec.md`
- 更新 `overview.md`、`designs/architecture/skill-driven-api-call.md`、`designs/modules/agent-capability.md`、`designs/modules/agent-core.md`
- 更新 `designs/adr/skill-extension-metadata-boundary.md`、`designs/spec-to-design-map.md`