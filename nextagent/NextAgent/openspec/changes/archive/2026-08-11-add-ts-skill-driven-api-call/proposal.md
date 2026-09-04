## 背景与问题（Why）

现有 Skill 执行机制：模型在 agent loop 中调用 `Skill` tool，`context=inline` 模式将 skill body 注入 model context，模型继续多轮 loop 读取 skill body 并调用各种 tool 完成任务。

电信运维场景中，部分 Skill 的本质是「根据用户问题调用一个固定 API 并返回结果」。这类 Skill 不需要模型多轮推理（agentic loop），而需要一条确定性的执行路径：解析 skill 中声明的 API 命令 -> 读取 Swagger 文档 -> 模型单次提参 -> 组装调用 -> 通过 HTTP 调用 -> 返回结果。

本 change 旨在为这类 Skill 引入「非 agentic API 调用」执行路径，由 Skill 元数据中的扩展字段控制是否启用。

> 所有决策点（D1-D10）已确认定稿。design、spec requirements 和 tasks 已补齐。

## 变更范围（What Changes）

基于需求的范围（已确认）：

1. Skill 元数据扩展字段：在 skill metadata 的 `extension` 中支持以下字段（默认值见 D3）：
   - `_naie_agentic_loop_flag`（string，默认 `"true"`）：控制是否走 agent loop。`"false"` 时走非 agentic API 调用路径。
   - `_naie_pass_through_flag`（string，默认 `"false"`）：透传标志（语义待确认，见 D7）。
   - `api_header_params`（逗号分隔 string，默认空）：API 调用需注入的 header 参数名。
   - `api_request_params`（逗号分隔 string，默认空）：API 调用需提取的请求参数名。
2. 非 agentic 执行路径：当 `_naie_agentic_loop_flag="false"` 时，编排层程序化调用 API tool，API 结果直接终态返回。
3. API 调用执行单元（独立 Tool capability，非 model-visible）：
   a. 解析 skill body 中的 API 命令（如 `api -name rest-complaints-api -hiro er`），提取 API 名称等参数。
   b. 根据 API 名称读取 SKILL.md 同级 `api/` 目录下的 `<name>.yaml`（Swagger 2.0），转换为 apiDoc 对象。
   c. 入参包含原始用户问题和 skill identity。
   d. 根据 skill 内容、用户问题、yaml 必填参数，调用模型进行参数提取（提参 prompt 先生成，后续优化）。
   e. 组装 API 调用结构体，通过 HTTP（参考 skillhub）发起调用。

## 待确认的关键决策点

以下决策点（D1-D10）均已确认定稿，design、spec requirements 和 tasks 已据此补齐。

### D1. 非 agentic 执行触发环节【已确认 2026-07-29，定稿】

确认走编排 A（Skill tool 独立返回 + 编排层程序化调 API tool）：

1. 模型在 agent loop 中调用 `Skill` tool（仅此一次 tool call）
2. `Skill` tool resolve 并 load skill metadata，读取 `_naie_agentic_loop_flag`
3. 若为 false：`Skill` tool 仍 load body 解析 api 命令，但不注入 skill body、不做 resource projection，返回独立结果（skill 信息、解析出的 api 命令等），不进入 inline 执行路径
4. 编排层检测到 flag=false 信号，程序化调用 API tool（走 `capabilityInvocation.invoke()`，与 `TargetedSkillRouter` 同一套 governance/audit/validation 机制，不经过模型）
5. API tool 返回自己的独立结果
6. API tool 的结果直接作为终态响应返回给用户，不再跑模型生成轮次

不变量：`_naie_agentic_loop_flag` 非 false（true 或不传）时，现有 inline body 注入路径完全不变，一行代码不动。spec 将此写成硬约束并配测试断言。

终态返回实现：编排层把 API 结果写入 terminal assistant message，跳过后续 model invocation。现有 agent loop 在 tool 结果后默认再跑一轮模型，此处需编排层在 flag=false 信号下拦截，不再进入模型轮次，而是用 API 结果直接终态提交。这是新增行为，落在编排层（`agent-core` routing，类似 `TargetedSkillRouter` 位置），不改现有 model loop 语义。

曾讨论的「Skill tool 内部嵌套调用 api tool」方案已废弃，理由：需求方要求 skill tool 和 api tool 各自独立返回结果。

### D2. API tool 的定位【已确认 2026-07-29，定稿】

确认为「独立 Tool capability，非 model-visible，由编排层程序化调用」：api tool 是一个独立的 Tool capability（有完整 inputSchema/outputSchema、独立实现、可单测、可复用、在 capability catalog 中注册），但不向模型披露（非 model-visible），不由模型直接调用。当编排层检测到 `_naie_agentic_loop_flag=false` 后，通过 `capabilityInvocation.invoke()` 程序化调用 api tool（与 `TargetedSkillRouter` 调 `Skill` tool 同一套机制）。

api tool 的 trusted 入参（原始用户问题、skill identity、api 命令等）由编排层从 trusted context 构造，不经过模型，不进入 model-visible input schema。

api tool 虽非 model-visible，但仍需注册为 governed Tool capability，复用 `builtin-tool-framework` 的 Tool 框架（defineTool、BuiltinToolExecutor、CapabilityInvocationRequest/Result）。它在 catalog 中注册但披露策略为 HIDDEN 或 model-invocable=false，不在 model-visible 披露集里。

### D3. 扩展字段承载方式【已确认 2026-07-29，定稿】

确认走选项 2：4 个字段全放 `metadata.extension`，并修改 `add-skill-metadata-extension`（active 未归档）以支持本 change 需求。

承载位置与 YAML 示例：
```yaml
metadata:
  extension:
    _naie_agentic_loop_flag: "false"
    _naie_pass_through_flag: "true"
    api_header_params: "x-user-id,x-user-name"
    api_request_params: "query"
```

字段值规则（值类型统一为 string，消费侧按需转换）：
- `_naie_agentic_loop_flag`：string，默认 `"true"`（不传时）。消费侧判断 `=== "false"` 走非 agentic 路径。
- `_naie_pass_through_flag`：string，默认 `"false"`（不传时）。语义见 D7。
- `api_header_params`：逗号分隔字符串，默认空字符串（不传时）。消费侧 `split(",")` 转数组。
- `api_request_params`：逗号分隔字符串，默认空字符串（不传时）。消费侧 `split(",")` 转数组。

对 `add-skill-metadata-extension` 的修改（需新开 change 或修改其 active 文档）：

修改 1 — `unsafeKeyPattern` 为 `api_header_params` 开白名单例外：
- 现有 `unsafeKeyPattern` 中 `headers?` 会拦截含 `header` 的 key，导致 `api_header_params` 被 `EXTENSION_OMITTED` 静默丢弃。
- 保持 pattern 不变，新增白名单机制：`api_header_params` 这一具体 key 名跳过 `unsafeKeyPattern` 检测。
- 这是对同形同策的受控例外，必须在 design 中写明原因、适用范围（仅此一个 key）和验证方式。

修改 2 — 放开「governed behavior 不消费 extension」原则：
- 现有设计原则：NextAgent 内部 governed behavior 路径不消费 extension。
- 本 change 需要编排层（`agent-core` routing）读取 `extension._naie_agentic_loop_flag` 来控制执行路径（`_naie_pass_through_flag` 为预留字段，编排层不消费，见 D7）。
- 放开范围：仅限编排层读取 `_naie_agentic_loop_flag` 这一个具体 key。`api_header_params`/`api_request_params` 不由 governed behavior 直接消费，而由 Skill tool 从 extension 读取后放入返回结果，编排层从结果中获取并传入 API tool。
- 这是对 governed behavior 分离原则的受控例外，必须更新 ADR `skill-extension-metadata-boundary.md` 写明例外范围。

不修改的部分：
- `SkillExtensionValue` 类型定义不变（仍拒绝 array）。`api_header_params`/`api_request_params` 用逗号分隔字符串承载，不走 array 路径。
- extension 的 wrapper 形式（`metadata.extension`）、flatten 语义、size/depth 限制不变。
- `sourceMetadata` 不受影响。

### D4. API 命令格式【已确认 2026-07-29，定稿】

skill body 中的 API 命令格式为 `api -name <api-name> -hiro <hiro-value>`：
- `-name` 后的值是 API 名称，用于定位 SKILL.md 同级 `api/` 目录下的 `<api-name>.yaml`（Swagger 2.0 文档）。
- `-hiro` 后的值（如 `ir`、`er`）标识调用方式分支。本 change 第一阶段不区分 `ir`/`er`，统一实现一种调用方式（见 D5）。后续 change 再按 `-hiro` 值分派不同调用方式。

该命令位于 skill body（markdown 正文）中，api tool 执行时从 body 解析提取。

### D5. API 调用方式与分层架构【已确认 2026-07-29，定稿】

第一阶段不区分 `-hiro` 值，统一采用 HTTP 调用方式。分层模式参考 skillhub 的 `SkillHubRemoteAccessPort` + `FetchSkillHubRemoteGatewayAdapter` + `agent-app` 注入：

调用方式：
- HTTP 请求（`fetch`），不使用 UDS。
- Bearer token 鉴权，credential 从配置注入（类似 skillhub 的 `credentialRef`/`SecretReference`），不来自模型输入、不来自 skill body、不来自客户端请求体。
- JSON body / JSON response。
- endpoint 及请求结构从 swagger 2.0 文档（`api/<name>.yaml`）解析得到。
- 超时、响应大小上限由 capability invocation policy 和 tool 默认值控制。

分层架构（按 deploymentMode 分 LOCAL/REMOTE）：

| 层 | owner | 内容 |
|---|---|---|
| Port 接口 | `agent-contracts/capability` | `ApiCallPort`，定义 `callApi`（非流式）和 `callApiStream`（流式）方法签名，与 `ParameterExtractionPort` 同位置 |
| LOCAL 实现 | `agent-platform-gateway-local` | `createLocalApiCallPort`，`fetch` HTTP/HTTPS 调用 + SSE 流式解析 |
| REMOTE 实现 | `agent-platform-gateway-remote` | `createRemoteApiCallPort`，UDS 调用占位（返回 503，后续填充） |
| 注入 | `agent-app` | `prepareCompositionInputsAsync` 按 `systemConfig.gateway.deploymentMode` 选择 LOCAL 或 REMOTE 实现，通过 `PreparedCompositionInputs` 传给 `composeNextAgentApp` → `toolDependencies` |

`ApiCallRequest` 接口含 `baseUrl`、`path`、`method`、`headers`、`query?`、`body?`、`credentialRef?`、`timeoutMs`。

后续 `-hiro ir`/`er` 分支化时，如需引入不同调用方式，另开 change 扩展。

### D6. 模型提参【已确认 2026-07-30，修订定稿】

提参在 API tool 内部完成，编排层不做提参。

原因：提参依赖 yaml 解析结果（必填参数定义），而读 yaml、解析参数是 API tool 的职责。如果编排层做提参，它得先读 yaml，把 API tool 的内部逻辑泄露到编排层。

- API tool 内部通过 `ParameterExtractionPort`（新增 Tool 依赖）调模型做单次 `complete()` 提参。不走 loop，不重试。
- `ParameterExtractionPort` 接口定义在 `agent-contracts/capability`，实现在 `agent-app/src/composition/parameter-extraction-port.ts`（直接调 `ModelInvocationService.complete()` + agent assembly model profile 解析），由 `agent-app` composition 注入到 `toolDependencies`。
- 提参 prompt 由 API tool 根据 skill 内容、用户问题、yaml 必填参数生成。tools 为空（提参不调 tool）。
- 提参用的模型由 agent assembly 的 model profile 决定，不在 skill metadata 中指定。
- 编排层只负责从 trusted context 提取 header params 和 request params，连同用户问题、skill identity 传入 API tool。
- `ToolDependencyName` 新增 `"parameterExtraction"`，`ToolDependencies` 新增 `parameterExtraction?: ParameterExtractionPort`。
- 提参 prompt 先生成一个基础版本，后续优化。

### D7. `_naie_pass_through_flag` 语义【已确认 2026-07-29，定稿】

预留字段，本 change 不实现任何行为。

- 字段保留在 extension 中，parser 正常解析和存储（值类型 string，默认 `"false"`）。
- 编排层、API tool 均不消费此字段。
- 语义和用途留给后续 change 定义。

### D8. `api_header_params` / `api_request_params` 的值来源【已确认 2026-07-29，定稿】

两批参数均由上层（编排层/trusted context）传入，不走模型提参：

- `api_header_params`（如 `"x-user-id,x-user-name"`）：指定要从当前请求头中提取的 header 名。编排层从当前请求头中提取这些值，传入 API tool。API 调用时注入到出站请求头里。
- `api_request_params`（如 `"query"`、`"alarmId,region"` 等，参数名由 skill 作者在 extension 中声明，不写死）：上层传入的请求参数值，编排层根据声明的参数名从 trusted context 获取后传入 API tool。API 调用时作为请求参数使用。不提参。

模型提参（D6）只负责提取 yaml 中定义的、上层未传入的其他必填参数。最终组装 API 调用时，`api_header_params`、`api_request_params` 和提参参数三批合并使用。

如果上层未传入 `api_request_params` 对应的值，该参数缺失由模型提参补全（见 D6）。

### D9. Swagger 2.0 -> apiDoc【已确认 2026-07-29，定稿】

采用方案 A：用现有 `js-yaml` 解析 + 自定义提取函数，不引入新依赖。

解析方式：
- 用仓库已有的 `js-yaml`（`load as parseYaml`）将 `api/<name>.yaml` 解析为 JS 对象。
- 自定义提取函数从解析结果中提取 API 调用所需字段，构造 apiDoc 对象。
- 不引入 swagger-parser 等第三方 swagger 解析库。
- 不做完整 Swagger 2.0 文档校验，只提取调用所需字段。

apiDoc shape（精简为调用所需信息）：

```typescript
interface ApiDoc {
  baseUrl: string;           // schemes[0]://host + basePath
  path: string;              // API path，如 /api/v1/complaints
  method: string;            // GET/POST/...
  produces: string;          // 响应 content type，如 "application/json" 或 "text/event-stream"
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

`produces` 来自 Swagger 2.0 文档的 `produces` 字段，用于判断流式/非流式调用（见 D10）。

使用方式：
- api tool 用 apiDoc 组装 HTTP 调用：endpoint = baseUrl + path，参数按 location 分配到 path/query/body/header。
- 提参 prompt 用 parameters 中 required=true 的项生成（仅限上层未通过 `api_request_params` 传入的参数）。

`$ref` 递归解析：body 参数的 `schema.$ref` 自动解析到 `definitions`，展开 properties 为扁平参数列表（dot notation，如 `filter.region.code`），递归最多 5 层。`required` 从 definition 的 `required` 数组判断。

描述提取优先级（`extractDescription`）：
1. `x-param-info.descriptionForModelCN`
2. `x-param-info.descriptionForModelEN`
3. `description` 字段

后续如需更多 swagger 信息（如 response schema、认证定义），apiDoc shape 按需扩展，另开 change。
### D10. 非 agentic 路径的返回结果与安全边界【已确认 2026-07-29，定稿，含流式扩展】

根据 apiDoc 的 `produces` 字段分两种返回方式：

**非流式（produces 为 application/json）**：
- API tool 返回 `CapabilityInvocationResult`，`status=SUCCEEDED`，`structuredPayload` 放 API 响应的 JSON body（原样，不做大小截断，非 agentic API tool 路径放宽/绕过现有 `maxCapabilityResultMessageChars` 限制）。
- `outputSchema` 定义为 `{ type: "object", additionalProperties: true }`（宽松，因不同 API 响应结构不同）。
- 超时由 capability invocation policy 的 `timeoutMs` 控制。

**流式（produces 为 text/event-stream）**：
- API tool 通过 `ToolExecutionContext.emitResultDelta` 逐步发流式 delta，原样转发 SSE 的 data 内容。
- delta payload 复用现有 `tool-structured-delta` 机制，payload 为 SSE data 原样内容。
- 流式结束后返回终态 `CapabilityInvocationResult`，`status=SUCCEEDED`，`structuredPayload` 放流式汇总或空对象（具体 shape 后续优化）。
- 超时由 capability invocation policy 的 `timeoutMs` 控制。

编排层将 API tool 返回的终态结果写入 terminal assistant message，作为终态响应返回给用户（见 D1 第 6 步）。流式 delta 在流式过程中实时投影给用户。

## Capability 影响（Capabilities）

### 新增 Capability

- `skill-driven-api-call`：非 agentic Skill 检测、API tool 编排调用、终态返回、Swagger 解析、流式/非流式响应。

### 修改的 Capability

- `skill-manifest-contract`：extension key 白名单例外（`api_header_params`）、governed behavior 消费 extension 受控例外（仅 `_naie_agentic_loop_flag`）。
- `skill-tool`：Skill tool 非 agentic 分派（flag=false 时仍 load body 解析 api 命令，不 inject body）。
- `builtin-tool-framework`：新增 `apiCallPort` 和 `parameterExtraction` Tool 依赖类型。

## 影响范围（Impact）

- `agent-contracts/capability`：`ParameterExtractionPort`、`ApiCallPort`、`ApiCallRequest`、`ApiCallResult`、`ApiCallStreamChunk` 接口、extension 消费边界调整。
- `agent-capability`：skill-manifest `unsafeKeyPattern` 白名单、api tool 定义与实现、`ToolDependencies` 扩展、`ToolDependencyName` 扩展。
- `agent-core`：编排层 flag 检测与 API tool 程序化调用、终态返回、并发冲突拒绝、checkpoint、header/request params 提取。
- `agent-platform-gateway-local`：`createLocalApiCallPort` 实现（`fetch` HTTP + SSE 流式）。
- `agent-platform-gateway-remote`：`createRemoteApiCallPort` 实现（UDS 占位）。
- `agent-app`：`createParameterExtractionPort` 实现、`apiCallPort` 按 deploymentMode 注入、`local-runtime-bindings` 扩展。
- 安全边界：header/request 参数值来源（trusted context）、HTTP 调用边界、超时限制。（不做 SSRF 防护、不做响应截断，见 design 决策 7）

## 归档前更新基线（Baseline Promotion Plan）

待 design/spec 完成后补充：stable spec capability、overview、相关 module/architecture/ADR 与 spec-to-design-map。