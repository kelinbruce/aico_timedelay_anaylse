# Skill 驱动 API 调用（非 Agentic 路径）

## 背景

Skill 执行基线由 `skill-tool`、`skill-manifest-contract`、`builtin-tool-framework` 和统一 Capability Catalog 承载。默认 `context=inline` 路径把 Skill body 注入 model context，由模型多轮 loop 读取 body 并调用各种 tool 完成任务。

电信运维场景中，部分 Skill 的本质是「根据用户问题调用一个固定 API 并返回结果」。这类 Skill 不需要模型多轮推理，而需要一条确定性执行路径：解析 Skill 中声明的 API 命令 → 读取 Swagger 文档 → 模型单次提参 → 组装调用 → 通过 HTTP 调用 → 返回结果。Skill 驱动 API 调用能力为这类 Skill 引入非 agentic 执行路径，由 Skill metadata extension 中的 `_naie_agentic_loop_flag="false"` 控制。

行为契约由 `openspec/specs/skill-driven-api-call/spec.md` 主承载；跨模块白盒设计事实由本文件承载。`ApiCall` 作为隐藏 Tool 的最终结果消费、replay policy 和 E1–E6 失败语义由 `openspec/designs/architecture/capability-invocation-and-failure-disposition.md` 统一承载，本文件只补充非 agentic 路径特有的装配、拦截和恢复事实。

## 触发与分派

### Skill tool 非 agentic 分派点

`Skill` tool（`agent-capability/src/builtins/skill-tool.ts`）在 `readSkillMetadata` 之后、现有 fork context 检查之前插入分派逻辑：

1. 读取 `extension._naie_agentic_loop_flag`。
2. 若值为 `"false"`：仍通过 `loadCanonicalBodyView` 加载 body 以解析 ` ```api ` 代码块中的 API 命令（api name、hiro value），但不 inject body、不做 resource projection。返回 `CapabilityInvocationResult`（`status=SUCCEEDED`），`structuredPayload` 包含 skill name、解析出的 api 命令、`apiHeaderParams`（从 extension 读取）、`apiRequestParams`（从 extension 读取）；`metadata` 包含 `nonAgenticApiCall: true` 信号；`generatedMessages` 为空。
3. 若值为 `"true"` 或 extension 缺失：走现有 inline body 注入路径，行为完全不变。

API 命令格式为 `api -name <api-name> -hiro <hiro-value>`，`-name` 定位 SKILL.md 同级 `api/` 目录下的 `<api-name>.yaml`（Swagger 2.0）。`-hiro` 第一阶段不区分 `ir`/`er`，统一 HTTP 调用。api 命令解析失败（无 ` ```api ` 代码块、缺 `-name`）返回 `API_COMMAND_PARSE_FAILED` safe error，不暴露 raw body。

### 编排层拦截点

新增编排模块位于 `agent-core` routing（位置类似 `TargetedSkillRouter`）。拦截点在 `DefaultAgent.executeRun` 的 tool loop 中，`executeToolCallsInOrder` 返回后、下一次 model invocation 之前：

1. 检测 `Skill` tool 结果 `metadata.nonAgenticApiCall === true`。
2. 从 `structuredPayload` 提取 api name、hiro value、skill identity、`apiHeaderParams`、`apiRequestParams`。
3. 原始用户问题从 `RequestContext.acceptedInputText` 获取。
4. 从当前请求头提取 header params（根据 `apiHeaderParams` 声明的参数名）。
5. 从 trusted context 获取 request params（根据 `apiRequestParams` 声明的参数名）。
6. 构造 `CapabilityInvocationRequest` 调用 `ApiCall` tool，传入 trusted 入参。
7. `ApiCall` tool 返回后，把 `structuredPayload` 写入 terminal assistant message，跳过后续 model invocation。

编排层不做提参。提参在 `ApiCall` tool 内部完成，因为提参依赖 yaml 解析结果，而读 yaml 是 `ApiCall` tool 的职责。

### 并发冲突

同一轮 tool calls 中如果同时存在 flag=false 的 `Skill` tool result 和其他 tool result，编排层拒绝并返回 `NON_AGENTIC_BATCH_CONFLICT` safe error。

## ApiCall Tool

`ApiCall` 是独立 Tool capability，使用 `defineTool` 创建并注册到 builtin tool 列表：

- `name`: `"ApiCall"`
- `modelInvocable`: `false`（非 model-visible）
- `disclosurePolicy`: `HIDDEN`
- `requiredDependencies`: `["skillSources", "apiCallPort", "parameterExtraction"]`
- `inputSchema`: trusted 入参（apiName、hiro、userQuestion、headerParams、requestParams、skillIdentity）
- `outputSchema`: `{ type: "object", additionalProperties: true }`

`ApiCall` tool 执行流程：

1. 通过 `skillSources` 的 `readSkillResource` 读取 `api/<apiName>.yaml`（复用现有 `SkillSourceDiscovery` 接口，不扩展；`api/` 已在 `allowedResourceRoots` 中）。
2. 用 `js-yaml`（`load as parseYaml`）解析 + 自定义提取函数构造 `ApiDoc`。不引入第三方 swagger 解析库，不做完整 Swagger 2.0 校验，只提取调用所需字段。不做 yaml 解析缓存（一次 request 一次读取）。
3. 根据 `ApiDoc.parameters` 中 `required=true` 且未被 `api_request_params` 覆盖的参数，生成提参 prompt。
4. 通过 `parameterExtractionPort.extractParams()` 调模型单次 `complete()` 提参（走 `RunBoundModelInvocation`，自动产生 `MODEL_INVOCATION_STARTED`/`MODEL_INVOCATION_COMPLETED` timeline 事件）。
5. 根据 `ApiDoc.produces` 判断流式/非流式。
6. 合并参数：headerParams（请求头提取）、requestParams（上层传入）、extractedParams（模型提参）。
7. 通过 `apiCallPort` 发起 HTTP 调用。
8. 非流式：返回 `structuredPayload`（API 响应 JSON，原样不截断）。
9. 流式：通过 `emitResultDelta` 原样转发 SSE data，结束后返回终态结果。

### ApiDoc shape

```typescript
interface ApiDoc {
  baseUrl: string;        // schemes[0]://host + basePath
  path: string;
  method: string;
  produces: string;       // "application/json" 或 "text/event-stream"
  parameters: readonly ApiParameter[];
}
interface ApiParameter {
  name: string;
  location: "path" | "query" | "body" | "header";
  required: boolean;
  type?: string;
  description?: string;
}
```

body 参数的 `schema.$ref` 自动解析到 `definitions`，展开 properties 为扁平参数列表（dot notation，如 `filter.region.code`），递归最多 5 层。`required` 从 definition 的 `required` 数组判断（父级 required 且子级 required 才为 required）。描述提取优先级（`extractDescription`）：`x-param-info.descriptionForModelCN` > `x-param-info.descriptionForModelEN` > `description`。

提参前检查已传入参数是否覆盖所有必填参数，覆盖则跳过提参。合并后再次校验所有必填参数是否有值，缺失则返回 `MISSING_REQUIRED_PARAMS`。

## 分层架构

### ParameterExtractionPort

提参在 `ApiCall` tool 内部完成，需要调模型。`ApiCall` tool 在 `agent-capability`，拿不到 `ModelInvocationService`（在 `agent-runtime`/`agent-app`）。通过 port 接口注入，遵循 `SubagentExecutionPort` 同一架构模式：

| 层 | owner | 内容 |
|---|---|---|
| Port 接口 | `agent-contracts/capability` | `ParameterExtractionPort`，定义 `extractParams(input, signal)` 方法签名 |
| 实现 | `agent-runtime` | 包装 `ModelInvocationService.complete()` + agent assembly model profile 解析 + JSON 参数解析。`locale` 和 `modelProfileId` 从 context 和 profile 传入 |
| 注入 | `agent-app` | 经 `createApp` → `capability-composition` → capability subsystem → `ApiCall` tool |

`ToolDependencyName` 新增 `"parameterExtraction"`，`ToolDependencies` 新增 `parameterExtraction?: ParameterExtractionPort`。提参超时返回 `PARAMETER_EXTRACTION_TIMEOUT`，解析失败返回 `PARAMETER_EXTRACTION_FAILED`，均不暴露模型输出或 prompt。

### ApiCallPort

按 `deploymentMode` 分 LOCAL/REMOTE：

| 层 | owner | 内容 |
|---|---|---|
| Port 接口 | `agent-contracts/capability` | `ApiCallPort`，定义 `callApi(input, signal)` 非流式 + `callApiStream(input, signal)` 流式方法签名 |
| LOCAL 实现 | `agent-platform-gateway-local` | `createLocalApiCallPort`，`fetch` HTTP/HTTPS + SSE 流式解析 |
| REMOTE 实现 | `agent-platform-gateway-remote` | `createRemoteApiCallPort`，UDS 占位（返回 503，后续填充） |
| 注入 | `agent-app` | `prepareCompositionInputsAsync` 按 `deploymentMode` 选择实现，存入 `PreparedCompositionInputs.capabilityRuntimeInput.apiCallPort`，经 `composeNextAgentApp` → `toolDependencies` 注入 |

`ApiCallRequest` 含 `baseUrl`、`path`、`method`、`headers`、`query?`、`body?`、`credentialRef?`、`timeoutMs`。Bearer token 鉴权，credential 从配置注入（类似 skillhub 的 `credentialRef`/`SecretReference`），不来自模型输入、不来自 skill body、不来自客户端请求体。`local-runtime-bindings.ts` 扩展 `LocalGatewayRuntimeBindings` 加 `createLocalApiCallPort`。

> Port owner 说明：`ParameterExtractionPort` 和 `ApiCallPort` 都放在 `agent-contracts/capability`，与 `SubagentExecutionPort` 同构——因为它们的实现分别在 `agent-runtime`/`agent-app` 和 `agent-platform-gateway-local`/`agent-platform-gateway-remote`，接口需跨包共享；`agent-capability` 通过 `tool-spi.ts` re-export 消费。

## 响应与安全边界

根据 `ApiDoc.produces` 分两种路径：

- `application/json`：`apiCallPort.callApi()` 返回完整 JSON 结果，放入 `structuredPayload`，原样不截断。非 agentic `ApiCall` tool 路径放宽/绕过现有 `maxCapabilityResultMessageChars` 限制。
- `text/event-stream`：`apiCallPort.callApiStream()` 返回 SSE async iterable，`ApiCall` tool 通过 `emitResultDelta` 原样转发每个 SSE data，流结束后返回终态 `structuredPayload`（空对象，后续优化）。

安全边界确认（均不做额外防护，信任受控安装的 skill 来源）：

- 不做 SSRF 防护（信任受控安装的 skill 来源）。
- 不做响应 redaction（原样返回业务数据）。
- 不做响应大小截断（非 agentic 路径放宽 `maxCapabilityResultMessageChars`）。
- 不做 header 值校验（Fastify 已处理，fetch API 会拒绝非法值）。

HTTP 失败 safe error code：401/403 → `UNAUTHORIZED`；超时 → `TIMEOUT`（`TIMED_OUT`）；其他 >=400 → `UNAVAILABLE`；流式中断 → `API_STREAM_INTERRUPTED`（已转发 delta 保留）。所有 safe error 不暴露 endpoint、credential、请求体、响应体、模型输出、prompt、文件路径。

## 参数来源

API 调用参数来自三个可信来源：

1. `api_header_params`（如 `"x-user-id,x-user-name"`）：编排层从当前请求头提取，传入 `ApiCall` tool，注入到出站请求头。
2. `api_request_params`（如 `"query"`、`"alarmId,region"`）：编排层从 trusted context 获取，传入 `ApiCall` tool，作为请求参数。不提参。
3. 模型提参：提取 yaml 中定义的、上层未传入的其他必填参数。

三批参数合并后组装 HTTP 调用。如果上层未传入 `api_request_params` 对应的值，该参数缺失由模型提参补全。所有参数值都不来自模型输入、skill body 或客户端请求体直接提供。

## Checkpoint 与恢复

- 编排层调用 `ApiCall` tool 前保存 checkpoint（标记进入非 agentic 路径）。
- `ApiCall` tool 返回后保存 checkpoint（标记拿到结果）。
- 恢复时如果发现已进入非 agentic 路径但未拿到结果，直接返回失败，不重试 API 调用（避免重复 side effect）。
- 靠 checkpoint 精确标记避免重复调用，不额外做幂等处理。

## 可观测性

- 审计：复用现有 capability invocation 审计，不新增审计事件。
- 日志：`ApiCall` tool 记录低基数结构化日志（api name、执行步骤、成功/失败结果码），不记录 credential、请求体、响应体、endpoint。
- metric：复用现有 capability invocation metric。
- trace：提参走 `RunBoundModelInvocation`，自动产生 `MODEL_INVOCATION_STARTED`/`MODEL_INVOCATION_COMPLETED` timeline 事件，不新增 trace 机制。

## 禁止项

- 不得让 `ApiCall` tool 成为 model-visible（`modelInvocable` 必须为 `false`，`disclosurePolicy` 必须为 `HIDDEN`）。
- 不得让编排层做提参（提参是 `ApiCall` tool 的职责）。
- 不得让 credential 来自模型输入、skill body 或客户端请求体。
- 不得在 safe error 中暴露 endpoint、credential、请求体、响应体、模型输出、prompt 或文件路径。
- 不得在 flag=true/不传时改变现有 inline body 注入路径。
- 不得引入第三方 swagger 解析库。
- 不得做 yaml 解析缓存。
- `_naie_pass_through_flag` 为预留字段，编排层和 `ApiCall` tool 均不消费。

## Deferred scope

- `-hiro ir`/`er` 调用方式分支化（第一阶段统一 HTTP）。
- `_naie_pass_through_flag` 语义和用途（留给后续 change 定义）。
- 流式终态 `structuredPayload` 的具体 shape（先空对象，后续优化）。
- 提参 prompt 的具体内容（先生成基础版本，后续优化）。
- REMOTE `ApiCallPort` 的 UDS 实现（当前返回 503 占位）。
- SSRF 防护、响应 redaction、响应截断、header 值校验（信任受控 skill 来源）。
