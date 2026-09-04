## 背景和现状（Context）

现有 Skill 执行机制：模型在 agent loop 中调用 `Skill` tool，`context=inline` 模式将 skill body 注入 model context，模型继续多轮 loop 读取 skill body 并调用各种 tool 完成任务。`Skill` tool 实现在 `agent-capability/src/builtins/skill-tool.ts`，通过 `readSkillMetadata` 读取 governed metadata，通过 `loadCanonicalBodyView` 加载 body。

`add-skill-metadata-extension`（active 未归档）已实现 `SkillMetadata.extension`，规定 extension value 仅允许 primitive 和递归 JsonObject（拒绝 array），且 governed behavior 路径不消费 extension。

skillhub 的远程调用采用 `SkillHubRemoteAccessPort`（port 接口，`agent-capability`）+ `FetchSkillHubRemoteGatewayAdapter`（HTTP 实现，`agent-platform-gateway-remote`）+ `agent-app` 注入工厂的分层模式。

`TargetedSkillRouter`（`agent-core/src/routing/targeted-skill-router.ts`）是「编排层程序化调用 tool」的现成先例：它在 agent loop 之外通过 `capabilityInvocation.invoke()` 调用 `Skill` tool，构造标准 `CapabilityInvocationRequest`，走完整 governance/audit/validation 流程。

`SubagentExecutionPort`（接口在 `agent-contracts/capability`，实现在 `agent-runtime`，`agent-app` 注入）是「tool 调 runtime 层服务」的成熟先例。

`RequestContext` 有 `acceptedInputText?: string` 字段，可用于获取原始用户问题。

`SkillSourceDiscovery` 有 `listSkillResources` 和 `readSkillResource` 方法，`api/` 已在 `allowedResourceRoots` 中，可直接读取 `api/<name>.yaml`。

## 目标和非目标（Goals / Non-Goals）

**目标**：
1. Skill metadata extension 支持 `_naie_agentic_loop_flag`、`_naie_pass_through_flag`、`api_header_params`、`api_request_params` 四个字段。
2. flag=false 时 Skill tool 仍 load body 解析 api 命令，但不 inject body、不做 resource projection，返回 skill 信息和 api 命令。
3. 编排层检测 flag=false，程序化调用独立 API tool，API 结果直接终态返回。
4. API tool 内部解析 swagger 2.0 yaml、通过 ParameterExtractionPort 提参、组装 HTTP 调用、支持流式/非流式响应。
5. flag=true/不传时现有 inline body 注入路径完全不变。

**非目标**：
- 不区分 `-hiro ir`/`er` 调用方式（第一阶段统一 HTTP）。
- 不实现 `_naie_pass_through_flag` 的任何行为（预留）。
- 不新增 swagger-parser 等第三方依赖。
- 不做 SSRF 防护、响应 redaction、响应截断、header 值校验（信任受控安装的 skill 来源）。
- 不做 yaml 解析缓存（一次 request 一次读取）。

**$ref 递归解析**：body 参数的 `schema.$ref` 自动解析到 `definitions`，展开 properties 为扁平参数列表（dot notation），递归最多 5 层。`required` 从 definition 的 `required` 数组判断（父级 required 且子级 required 才为 required）。

**描述提取优先级**（`extractDescription`）：`x-param-info.descriptionForModelCN` > `x-param-info.descriptionForModelEN` > `description`。

**必填参数校验**：提参前检查已传入参数是否覆盖所有必填参数，覆盖则跳过提参。合并后再次校验所有必填参数是否有值，缺失则返回 `MISSING_REQUIRED_PARAMS`。
- 不新增凭证管理 UI / REST 管理 API。

## 设计解决方案（Decisions）

### 决策 1：Skill tool 非 agentic 分派点

在 `executeSkillTool`（`agent-capability/src/builtins/skill-tool.ts`）中，`readSkillMetadata` 之后、现有 fork 检查之前，插入分派逻辑：

```
readSkillMetadata ->
  if extension._naie_agentic_loop_flag === "false":
    -> 仍 load body（解析 api 命令需要），但不 inject body、不做 resource projection
    -> 解析 ```api 代码块中的 api 命令（api name、hiro value）
    -> 返回 skill 信息 + api 命令 + apiHeaderParams/apiRequestParams + nonAgenticApiCall 信号
  else:
    -> 现有 inline body 注入路径（不变）
```

非 agentic 分支返回的 `CapabilityInvocationResult`：
- `status=SUCCEEDED`
- `structuredPayload` 包含：skill name、解析出的 api 命令（api name、hiro value）、`apiHeaderParams`（从 extension 读取的值）、`apiRequestParams`（从 extension 读取的值）
- `metadata` 包含 `nonAgenticApiCall: true` 信号，供编排层检测
- `generatedMessages` 为空（不注入 body）

### 决策 2：编排层架构（agent-core routing）

新增编排模块（位置类似 `TargetedSkillRouter`），在 tool loop 处理完 Skill tool 结果后检测 `nonAgenticApiCall` 信号：

1. 检测到信号后，从 Skill tool 结果的 `structuredPayload` 中提取 api name、hiro value、skill identity、apiHeaderParams、apiRequestParams
2. 原始用户问题从 `RequestContext.acceptedInputText` 获取
3. 从当前请求头提取 header params（根据 apiHeaderParams 声明的参数名）
4. 从 trusted context 获取 request params（根据 apiRequestParams 声明的参数名）
5. 构造 `CapabilityInvocationRequest` 调用 API tool，传入 trusted 入参
6. API tool 返回结果后，将 `structuredPayload` 写入 terminal assistant message，跳过后续 model invocation

编排层不做提参。提参在 API tool 内部完成（见决策 3），因为提参依赖 yaml 解析结果，而读 yaml 是 API tool 的职责。

拦截点：在 `DefaultAgent.executeRun` 的 tool loop 中，`executeToolCallsInOrder` 返回后、下一次 model invocation 之前，检查是否有 `nonAgenticApiCall` 信号。

### 决策 3：API tool 为独立非 model-visible Tool capability

API tool 使用 `defineTool` 创建，注册到 builtin tool 列表：
- `name`: `"ApiCall"`（或同类名）
- `modelInvocable`: `false`（非 model-visible）
- `disclosurePolicy`: `HIDDEN`
- `requiredDependencies`: `["skillSources", "apiCallPort", "parameterExtraction"]`
- `inputSchema`: trusted 入参（apiName、hiro、userQuestion、headerParams、requestParams、skillIdentity）
- `outputSchema`: `{ type: "object", additionalProperties: true }`

API tool 执行流程：
1. 通过 `skillSources` 的 `readSkillResource` 读取 `api/<apiName>.yaml`（复用现有接口，不扩展 SkillSourceDiscovery）
2. 用 `js-yaml` 解析 + 自定义提取函数构造 apiDoc
3. 根据 apiDoc.parameters 中 required=true 且未被 `api_request_params` 覆盖的参数，生成提参 prompt
4. 通过 `parameterExtractionPort.extractParams()` 调模型单次 `complete()` 提参（走 `RunBoundModelInvocation`，自动产生 MODEL_INVOCATION_STARTED/COMPLETED timeline 事件）
5. 根据 apiDoc.produces 判断流式/非流式
6. 合并参数：headerParams（请求头提取）、requestParams（上层传入）、extractedParams（模型提参）
7. 通过 `apiCallPort` 发起 HTTP 调用
8. 非流式：返回 `structuredPayload`（API 响应 JSON，原样不截断）
9. 流式：通过 `emitResultDelta` 原样转发 SSE data，结束后返回终态结果

### 决策 3a：ParameterExtractionPort 分层（参考 SubagentExecutionPort）

提参在 API tool 内部完成，需要调模型。API tool 在 `agent-capability`，拿不到 `ModelInvocationService`（在 `agent-runtime`/`agent-app`）。通过 port 接口注入，遵循 `SubagentExecutionPort` 同一架构模式：

| 层 | owner | 内容 |
|---|---|---|
| Port 接口 | `agent-contracts/capability` | `ParameterExtractionPort`，定义 `extractParams(input, signal)` 方法签名 |
| 实现 | `agent-app` composition | `createParameterExtractionPort`，直接调 `ModelInvocationService.complete()` + agent assembly model profile 解析 + JSON 参数解析。`locale` 和 `modelProfileId` 从 context 和 profile 传入 |
| 注入 | `agent-app` | 经 `createApp` → `capability-composition` → capability subsystem → API tool |

`ToolDependencyName` 新增 `"parameterExtraction"`，`ToolDependencies` 新增 `parameterExtraction?: ParameterExtractionPort`。

> Port owner 说明：`ParameterExtractionPort` 和 `ApiCallPort` 都放在 `agent-contracts/capability`，与 `SubagentExecutionPort` 同构——因为它们的实现分别在 `agent-app` 和 `agent-platform-gateway-local`/`agent-platform-gateway-remote`，接口需跨包共享。

### 决策 4：ApiCallPort 分层（按 deploymentMode 分 LOCAL/REMOTE）

| 层 | owner | 内容 |
|---|---|---|
| Port 接口 | `agent-contracts/capability` | `ApiCallPort`，定义 `callApi(input, signal)` 非流式 + `callApiStream(input, signal)` 流式方法签名 |
| LOCAL 实现 | `agent-platform-gateway-local` | `createLocalApiCallPort`，`fetch` HTTP/HTTPS + SSE 流式解析 |
| REMOTE 实现 | `agent-platform-gateway-remote` | `createRemoteApiCallPort`，UDS 占位（返回 503，后续填充） |
| 注入 | `agent-app` | `prepareCompositionInputsAsync` 按 `deploymentMode` 选择实现，存入 `PreparedCompositionInputs.capabilityRuntimeInput.apiCallPort`，经 `composeNextAgentApp` → `toolDependencies` 注入 |

`ToolDependencyName` 新增 `"apiCallPort"`，`ToolDependencies` 新增 `apiCallPort?: ApiCallPort`。

`ApiCallRequest` 含 `baseUrl`、`path`、`method`、`headers`、`query?`、`body?`、`credentialRef?`、`timeoutMs`。

### 决策 5：Swagger 2.0 解析与 api 命令提取

**api 命令提取**：从 skill body 的 markdown ```api 代码块中匹配内容，用正则提取 `-name` 和 `-hiro` 后面的值。

**yaml 读取**：通过 `skillSources` 的 `readSkillResource` 读取 `api/<name>.yaml`，复用现有接口，不扩展 `SkillSourceDiscovery`。`api/` 已在 `allowedResourceRoots` 中。

**yaml 解析**：用 `js-yaml`（`load as parseYaml`）解析，自定义提取函数构造 apiDoc：

```
ApiDoc {
  baseUrl: string;        // schemes[0]://host + basePath
  path: string;
  method: string;
  produces: string;       // "application/json" 或 "text/event-stream"
  parameters: ApiParameter[];
}
ApiParameter {
  name: string;
  location: "path" | "query" | "body" | "header";
  required: boolean;
  type?: string;
  description?: string;
}
```

不做 yaml 解析缓存（一次 request 一次读取）。

**$ref 递归解析**：body 参数的 `schema.$ref` 自动解析到 `definitions`，展开 properties 为扁平参数列表（dot notation），递归最多 5 层。`required` 从 definition 的 `required` 数组判断（父级 required 且子级 required 才为 required）。

**描述提取优先级**（`extractDescription`）：`x-param-info.descriptionForModelCN` > `x-param-info.descriptionForModelEN` > `description`。

**必填参数校验**：提参前检查已传入参数是否覆盖所有必填参数，覆盖则跳过提参。合并后再次校验所有必填参数是否有值，缺失则返回 `MISSING_REQUIRED_PARAMS`。

### 决策 6：Extension 修改

修改 `add-skill-metadata-extension`（active 文档）两处：

修改 1 — `unsafeKeyPattern` 白名单：
- 在 `isSafeExtensionKey` 中新增白名单集合 `extensionKeyWhitelist = new Set(["api_header_params"])`
- 白名单内的 key 跳过 `unsafeKeyPattern` 检测，但仍受 key 长度和其他安全约束
- 受控例外，design 中写明原因和适用范围

修改 2 — governed behavior 消费例外：
- 编排层（`agent-core` routing）允许读取 `extension._naie_agentic_loop_flag`（`_naie_pass_through_flag` 为预留字段，不在本 change 消费范围内）
- 通过 `readSkillMetadata(descriptor).extension` 读取，不直接访问 raw metadata
- `api_header_params`/`api_request_params` 由 Skill tool 读取后放入返回结果，编排层从结果中获取（方案 A）
- 更新 ADR `skill-extension-metadata-boundary.md` 写明例外范围

### 决策 7：流式/非流式响应与安全边界

根据 apiDoc.produces 分两种路径：
- `application/json`：`apiCallPort.callApi()` 返回完整 JSON 结果，放入 `structuredPayload`，原样不截断
- `text/event-stream`：`apiCallPort.callApiStream()` 返回 SSE async iterable，API tool 通过 `emitResultDelta` 原样转发每个 SSE data，流结束后返回终态 `structuredPayload`（空对象，后续优化）

安全边界确认（均不做额外防护）：
- 不做 SSRF 防护（信任受控安装的 skill 来源）
- 不做响应 redaction（原样返回业务数据）
- 不做响应大小截断（非 agentic API tool 路径放宽/绕过现有 `maxCapabilityResultMessageChars` 限制）
- 不做 header 值校验（Fastify 已处理，fetch API 会拒绝非法值）

### 决策 8：错误处理

| 失败场景 | safe error code | 处理 |
|---|---|---|
| api 命令解析失败（无 ```api 代码块、格式错误、缺 -name） | `API_COMMAND_PARSE_FAILED` | Skill tool flag=false 路径返回 FAILED |
| yaml 文件不存在或格式错误 | `API_DOC_LOAD_FAILED` | API tool 返回 FAILED，不暴露文件路径 |
| 提参超时 | `PARAMETER_EXTRACTION_TIMEOUT` | ParameterExtractionPort 返回，不暴露模型输出/prompt |
| 提参结果解析失败 | `PARAMETER_EXTRACTION_FAILED` | 同上 |
| HTTP 401/403 | `UNAUTHORIZED` | API tool 包装为 FAILED |
| HTTP 超时 | `TIMEOUT` | API tool 包装为 TIMED_OUT |
| HTTP >= 400（非 401/403） | `UNAVAILABLE` | API tool 包装为 FAILED |
| 必填参数缺失（合并后校验） | `MISSING_REQUIRED_PARAMS` | API tool 返回 FAILED |
| 流式中断 | `API_STREAM_INTERRUPTED` | 已转发 delta 保留，终态返回 FAILED |

所有 safe error 不暴露 endpoint、credential、请求体、响应体、模型输出、prompt、文件路径。

### 决策 9：Checkpoint 与恢复策略

- 编排层调用 API tool 前保存 checkpoint（标记进入非 agentic 路径）
- API tool 返回后保存 checkpoint（标记拿到结果）
- 恢复时如果发现已进入非 agentic 路径但未拿到结果，直接返回失败，不重试 API 调用（避免重复 side effect）
- 靠 checkpoint 精确标记避免重复调用，不额外做幂等处理

### 决策 10：并发处理

同一轮 tool calls 中如果同时存在 flag=false 的 Skill tool 和其他 tool call，拒绝并返回 `NON_AGENTIC_BATCH_CONFLICT` safe error。编排层在 `executeToolCallsInOrder` 返回后检查。

### 决策 11：可观测性

- 审计：复用现有 capability invocation 审计，不新增审计事件。
- 日志：API tool 记录低基数结构化日志（api name、执行步骤、成功/失败结果码），不记录 credential、请求体、响应体、endpoint。
- metric：复用现有 capability invocation metric。
- trace：提参走 `RunBoundModelInvocation`，自动产生 `MODEL_INVOCATION_STARTED/COMPLETED` timeline 事件，不新增 trace 机制。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | credential 从配置注入；参数值来自 trusted context；不暴露 endpoint/credential/路径；不做额外防护（信任受控 skill 来源） | schema negative tests、safe error tests |
| 兼容性 | flag=true/不传时现有路径完全不变；extension 修改为受控例外 | 现有 skill-manifest tests 全量通过 |
| 可靠性/恢复 | API 调用失败返回 safe error；超时由 timeoutMs 控制；流式中断保留已转发 delta；checkpoint 标记避免重复调用 | timeout/abort/failure/checkpoint tests |
| 可维护性 | ApiCallPort/ParameterExtractionPort 接口与实现分离；参考 skillhub/SubagentExecutionPort 同构分层 | architecture boundary tests |
| 可测试性 | fake ApiCallPort/ParameterExtractionPort 注入；apiDoc 解析纯函数单测 | focused unit tests |
| 审计/可追溯性 | 复用 capability invocation 审计 + RunBoundModelInvocation timeline 事件 | observation tests |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| flag=true/不传时现有路径不变 | 1.1, 7.1 | 现有 skill-manifest + skill-tool tests 全量通过 |
| flag=false 时 Skill tool load body 解析 api 命令但不 inject | 4.1 | skill-tool non-agentic dispatch tests |
| api_header_params key 白名单 | 1.1 | skill-manifest whitelist tests |
| governed behavior 消费 extension 例外 | 1.2 | architecture boundary tests |
| API tool 独立非 model-visible | 3.1 | catalog registration tests |
| ApiCallPort 分层 | 2.1, 2.2 | gateway adapter tests + architecture tests |
| ParameterExtractionPort 分层 | 2.1, 2.3 | port implementation tests + architecture tests |
| swagger 解析 apiDoc | 3.2 | apiDoc parsing unit tests |
| api 命令 ```api 代码块解析 | 4.1 | api command parsing tests |
| 流式/非流式响应 | 3.3 | streaming/non-streaming response tests |
| 响应不截断 | 3.3 | large response tests |
| 编排层调用 + 终态返回 | 5.1 | orchestration integration tests |
| 并发冲突拒绝 | 5.2 | NON_AGENTIC_BATCH_CONFLICT tests |
| checkpoint/恢复 | 5.3 | checkpoint recovery tests |
| 错误处理 | 3.3, 5.1 | error handling tests |
| 可观测性 | 5.1 | logging/timeline observation tests |
| 全量门禁 | 7.1 | build/test/contract/architecture/openspec |

## 文档承载决策（Documentation Ownership）

- 行为契约：`specs/skill-driven-api-call`（新增）、`specs/skill-manifest-contract`（修改）、`specs/skill-tool`（修改）、`specs/builtin-tool-framework`（修改）
- 跨模块设计：`designs/architecture/skill-driven-api-call.md`（归档前新增）
- 模块设计：`designs/modules/agent-capability.md`、`designs/modules/agent-core.md`（归档前更新）
- ADR：`designs/adr/skill-extension-metadata-boundary.md`（归档前更新例外范围）
- 导航：`designs/spec-to-design-map.md`

## 风险与取舍（Risks / Trade-offs）

- [extension 修改影响 active change] -> 受控例外，范围限定到具体 key 和具体消费点，更新 ADR
- [api_header_params key 白名单违反同形同策] -> 仅此一个 key，design 中写明原因
- [编排层拦截 tool loop 增加复杂度] -> 落在 routing 层，不改 model loop 语义，参考 TargetedSkillRouter 先例
- [swagger 解析不完整] -> 只提取调用所需字段，后续按需扩展
- [不做 SSRF 防护] -> 信任受控安装的 skill 来源，后续如需可加 endpoint allowlist
- [响应不截断] -> 非_agentic 路径放宽 maxCapabilityResultMessageChars，需确保不影响其他 tool
- [流式终态 shape 未定] -> 先空对象，后续优化
- [不做 yaml 缓存] -> 一次 request 一次读取，性能可接受

## 迁移计划（Migration Plan）

无数据迁移。现有 Skill 无 extension 字段时行为不变。新增 extension 字段的 Skill 在 flag=false 时走新路径，flag=true/不传时走现有路径。

## 归档前更新基线（Baseline Promotion Plan）

实现完成并验证通过后：
- `specs/skill-driven-api-call/spec.md`：新增 stable spec
- `specs/skill-manifest-contract/spec.md`：新增 extension 消费例外 Requirement
- `specs/skill-tool/spec.md`：新增非 agentic 分派 Requirement
- `specs/builtin-tool-framework/spec.md`：新增 apiCallPort/parameterExtraction 依赖 Requirement
- `overview.md`：补充非 agentic API 调用能力描述
- `designs/architecture/skill-driven-api-call.md`：新增跨模块设计
- `designs/modules/agent-capability.md`、`agent-core.md`：更新模块设计
- `designs/adr/skill-extension-metadata-boundary.md`：更新例外范围
- `designs/spec-to-design-map.md`：更新导航

## 待确认问题（Open Questions）

- 流式终态 `structuredPayload` 的具体 shape（本 change 先空对象，后续优化）。
- 提参 prompt 的具体内容（本 change 先生成基础版本，后续优化）。
- `api_request_params` 上层未传入对应值时的行为（本 change 初步按提参补全处理）。