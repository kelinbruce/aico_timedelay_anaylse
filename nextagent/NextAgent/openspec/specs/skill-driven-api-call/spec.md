# skill-driven-api-call Specification

## Purpose

Define the non-agentic Skill-driven API call execution path: when a Skill's metadata extension `_naie_agentic_loop_flag` is `"false"`, the system detects the flag, parses the API command from the Skill body, programmatically invokes a hidden `ApiCall` Tool capability through the orchestration layer, and returns the API result as the terminal response without continuing the model loop. This covers non-agentic detection and dispatch, the independent non-model-visible `ApiCall` tool, orchestration-layer invocation and terminal return, `ParameterExtractionPort` and `ApiCallPort` Tool dependencies, Swagger 2.0 apiDoc parsing, streaming/non-streaming response handling, HTTP failure handling, trusted parameter sources, checkpoint/recovery, and observability.

## Function

- **所属 Function**：`FN-5.17 技能驱动 API 调用`
- **Function 变更类型**：`NEW`
- **spec 角色**：主规格

## Requirements

### Requirement: Non-Agentic Skill Detection And Dispatch

The system SHALL support a non-agentic execution path for Skills whose metadata extension `_naie_agentic_loop_flag` is set to `"false"`. When this flag is `"false"`, the `Skill` tool MUST still load the skill body to parse the api command from the ` ```api ` markdown code block, but MUST NOT inject the body into model context and MUST NOT perform resource projection. It MUST return a result containing skill identity, parsed api command info, `apiHeaderParams`, `apiRequestParams`, and a `nonAgenticApiCall` signal in metadata. When the flag is `"true"` or absent, the existing inline body injection path MUST remain completely unchanged.

#### Scenario: Flag false loads body for api command parsing but does not inject

- **WHEN** the model calls `Skill` with a valid skill name
- **AND** the resolved skill metadata extension `_naie_agentic_loop_flag` equals `"false"`
- **THEN** the `Skill` tool MUST load the skill body via `loadCanonicalBodyView`
- **AND** MUST parse the ` ```api ` code block to extract api name and hiro value
- **AND** MUST NOT inject the body into `generatedMessages`
- **AND** MUST NOT call `projectSkillResources`
- **AND** MUST return `CapabilityInvocationResult` with `status=SUCCEEDED`
- **AND** `structuredPayload` MUST contain skill name, parsed api command, `apiHeaderParams` value, `apiRequestParams` value
- **AND** `metadata` MUST contain `nonAgenticApiCall: true`
- **AND** `generatedMessages` MUST be empty

#### Scenario: Flag true or absent preserves existing behavior

- **WHEN** the model calls `Skill` with a valid skill name
- **AND** the resolved skill metadata extension `_naie_agentic_loop_flag` is `"true"` or absent
- **THEN** the `Skill` tool MUST follow the existing inline body injection path
- **AND** behavior MUST be identical to the current implementation

#### Scenario: Api command parse failure returns safe error

- **WHEN** flag is `"false"` and the skill body does not contain a ` ```api ` code block, or the command is missing `-name`
- **THEN** the `Skill` tool MUST return `CapabilityInvocationResult` with `status=FAILED`
- **AND** `safeError.code` MUST be `API_COMMAND_PARSE_FAILED`
- **AND** the error MUST NOT expose raw body content

### Requirement: API Tool Is Independent Non-Model-Visible Tool Capability

The system SHALL register an `ApiCall` tool as an independent Tool capability using `defineTool`. The tool MUST NOT be model-visible (`modelInvocable=false`, `disclosurePolicy=HIDDEN`). It MUST be invoked only by the orchestration layer through `capabilityInvocation.invoke()` when `nonAgenticApiCall` signal is detected. The tool MUST require `skillSources`, `apiCallPort`, and `parameterExtraction` dependencies.

#### Scenario: API tool is registered but not model-visible

- **WHEN** the capability catalog is assembled
- **THEN** the `ApiCall` tool descriptor MUST be registered with `modelInvocable=false`
- **AND** `disclosurePolicy` MUST be `HIDDEN`
- **AND** the tool MUST NOT appear in model-visible tool disclosure

#### Scenario: API tool requires dependencies

- **WHEN** the `ApiCall` tool is composed
- **THEN** `requiredDependencies` MUST include `skillSources`, `apiCallPort`, and `parameterExtraction`
- **AND** if any dependency is unavailable, the tool MUST be `UNAVAILABLE`

### Requirement: Orchestration Layer Invokes API Tool And Returns Terminal Response

The orchestration layer (`agent-core` routing) SHALL detect the `nonAgenticApiCall` signal from `Skill` tool results. When detected, it MUST extract header params from current request headers, obtain request params from trusted context, construct trusted API tool input, invoke the API tool through `capabilityInvocation.invoke()`, and use the API tool result as the terminal response without continuing the model loop. The orchestration layer MUST NOT perform model parameter extraction; that is the API tool''s responsibility.

#### Scenario: Orchestration detects non-agentic signal and invokes API tool

- **WHEN** the `Skill` tool returns a result with `nonAgenticApiCall: true` in metadata
- **THEN** the orchestration layer MUST extract api name, hiro value, skill identity, `apiHeaderParams`, and `apiRequestParams` from the result
- **AND** MUST extract header params from current request headers using `apiHeaderParams` declared names
- **AND** MUST obtain request params from trusted context using `apiRequestParams` declared names
- **AND** MUST get original user question from `RequestContext.acceptedInputText`
- **AND** MUST invoke the `ApiCall` tool through `capabilityInvocation.invoke()` with trusted input
- **AND** MUST NOT continue the model loop after the API tool returns

#### Scenario: API tool result becomes terminal response

- **WHEN** the API tool returns a successful `CapabilityInvocationResult`
- **THEN** the orchestration layer MUST write the `structuredPayload` to terminal assistant message
- **AND** MUST skip subsequent model invocation
- **AND** the run MUST reach terminal state with the API result as the final response

#### Scenario: Non-agentic batch conflict is rejected

- **WHEN** the same tool round contains a Skill tool result with `nonAgenticApiCall: true` AND other tool results
- **THEN** the orchestration layer MUST reject the batch
- **AND** MUST return a safe error with code `NON_AGENTIC_BATCH_CONFLICT`

### Requirement: ParameterExtractionPort Provides Model Parameter Extraction To API Tool

The system SHALL define `ParameterExtractionPort` as a Tool-facing dependency interface owned by `agent-contracts/capability`. The port MUST expose a `extractParams(input, signal)` operation that performs a single model `complete()` call through `RunBoundModelInvocation` for parameter extraction. The production implementation MUST be in `agent-runtime`, wrapping `ModelInvocationService` and resolving the model profile from the accepted agent assembly. The port MUST be injected through `agent-app` composition, following the same pattern as `SubagentExecutionPort`.

#### Scenario: API tool extracts parameters through ParameterExtractionPort

- **WHEN** the API tool needs to extract parameters for required API parameters not covered by `api_request_params`
- **THEN** it MUST call `parameterExtractionPort.extractParams()` with a prompt generated from skill content, user question, and yaml required parameters
- **AND** the port MUST use `RunBoundModelInvocation` to produce `MODEL_INVOCATION_STARTED` and `MODEL_INVOCATION_COMPLETED` timeline events
- **AND** MUST use a single `complete()` call without retry or loop
- **AND** MUST use the model profile from the accepted agent assembly

#### Scenario: ParameterExtractionPort is unavailable

- **WHEN** the `parameterExtraction` dependency is not provided
- **THEN** the `ApiCall` tool MUST be `UNAVAILABLE`
- **AND** the catalog MUST expose an unavailable descriptor with a safe availability reason

#### Scenario: Parameter extraction timeout returns safe error

- **WHEN** model parameter extraction times out
- **THEN** the port MUST return a safe error with code `PARAMETER_EXTRACTION_TIMEOUT`
- **AND** MUST NOT expose model output or prompt content

#### Scenario: Parameter extraction result parse failure returns safe error

- **WHEN** the model returns a result that cannot be parsed into expected parameters
- **THEN** the port MUST return a safe error with code `PARAMETER_EXTRACTION_FAILED`
- **AND** MUST NOT expose model output or prompt content

### Requirement: ApiCallPort Defines HTTP API Call Boundary

The system SHALL define `ApiCallPort` as a Tool-facing dependency interface owned by `agent-capability`. The port MUST expose API call operations without coupling to HTTP implementation details. The production implementation MUST be a `FetchApiCallGatewayAdapter` in `agent-platform-gateway-remote`, injected through `agent-app` composition.

#### Scenario: ApiCallPort supports non-streaming call

- **WHEN** the API tool invokes `apiCallPort.callApi()` with endpoint, method, headers, body, and signal
- **THEN** the port MUST return the response status, headers, and body
- **AND** MUST accept `AbortSignal` for cancellation and timeout

#### Scenario: ApiCallPort supports streaming call

- **WHEN** the API tool invokes `apiCallPort.callApiStream()` with the same input
- **THEN** the port MUST return an async iterable of SSE data chunks
- **AND** MUST accept `AbortSignal` for cancellation and timeout

#### Scenario: Gateway implementation uses Bearer token from configuration

- **WHEN** the `FetchApiCallGatewayAdapter` makes an HTTP call
- **THEN** it MUST inject Bearer token from configured `credentialRef`
- **AND** MUST NOT accept credentials from model input, skill body, or client request body

### Requirement: Swagger 2.0 ApiDoc Parsing

The API tool SHALL parse `api/<name>.yaml` (Swagger 2.0) using `js-yaml` and a custom extraction function. The yaml file MUST be read through `skillSources.readSkillResource` (reusing the existing `SkillSourceDiscovery` interface without extension). The parsed `ApiDoc` MUST contain `baseUrl`, `path`, `method`, `produces`, and `parameters`. The system MUST NOT introduce third-party swagger parsing libraries. The system MUST NOT cache parsed apiDoc (one read per request).

#### Scenario: Valid swagger yaml produces apiDoc

- **WHEN** the API tool reads a valid Swagger 2.0 yaml file through `readSkillResource`
- **THEN** it MUST produce an `ApiDoc` with `baseUrl` (from schemes/host/basePath), `path`, `method`, `produces`, and `parameters`
- **AND** each parameter MUST have `name`, `location`, `required`, and optional `type`/`description`

#### Scenario: Yaml file missing or malformed fails safely

- **WHEN** the `api/<name>.yaml` file does not exist or cannot be parsed
- **THEN** the API tool MUST return a safe failed `CapabilityInvocationResult`
- **AND** `safeError.code` MUST be `API_DOC_LOAD_FAILED`
- **AND** MUST NOT expose raw file content or file paths in safe error

### Requirement: Streaming And Non-Streaming Response Handling

The API tool SHALL determine streaming vs non-streaming behavior based on `apiDoc.produces`. When `produces` is `text/event-stream`, the API tool MUST stream SSE data via `emitResultDelta` and return a terminal result after streaming completes. When `produces` is `application/json`, the API tool MUST return the complete JSON response in `structuredPayload` without truncation.

#### Scenario: Non-streaming response returns complete JSON without truncation

- **WHEN** `apiDoc.produces` is `application/json`
- **AND** the HTTP call succeeds
- **THEN** the API tool MUST return `CapabilityInvocationResult` with `status=SUCCEEDED`
- **AND** `structuredPayload` MUST contain the API response JSON body in full (no truncation)
- **AND** the non-agentic API tool path MUST bypass or relax the existing `maxCapabilityResultMessageChars` limit

#### Scenario: Streaming response forwards SSE data via delta

- **WHEN** `apiDoc.produces` is `text/event-stream`
- **AND** the HTTP call returns SSE chunks
- **THEN** the API tool MUST call `emitResultDelta` for each SSE data chunk (original data forwarded as-is)
- **AND** after streaming completes, MUST return terminal `CapabilityInvocationResult` with `status=SUCCEEDED`

#### Scenario: Streaming interruption preserves forwarded deltas

- **WHEN** the SSE stream is interrupted mid-stream
- **THEN** already-forwarded deltas MUST be preserved
- **AND** the API tool MUST return terminal `CapabilityInvocationResult` with `status=FAILED`
- **AND** `safeError.code` MUST be `API_STREAM_INTERRUPTED`

### Requirement: HTTP Call Failure Handling

The API tool SHALL handle HTTP call failures with stable safe error codes. Failures MUST NOT expose endpoint, credential, request body, or response body.

#### Scenario: HTTP unauthorized

- **WHEN** the HTTP call returns 401 or 403
- **THEN** the API tool MUST return `CapabilityInvocationResult` with `status=FAILED`
- **AND** `safeError.code` MUST be `UNAUTHORIZED`

#### Scenario: HTTP timeout

- **WHEN** the HTTP call times out
- **THEN** the API tool MUST return `CapabilityInvocationResult` with `status=TIMED_OUT`
- **AND** `safeError.code` MUST be `TIMEOUT`

#### Scenario: HTTP other failure

- **WHEN** the HTTP call fails for reasons other than unauthorized or timeout
- **THEN** the API tool MUST return `CapabilityInvocationResult` with `status=FAILED`
- **AND** `safeError.code` MUST be `UNAVAILABLE`

### Requirement: Parameter Sources Are Trusted

The API tool SHALL assemble HTTP call parameters from three trusted sources: header params extracted from current request headers, request params from trusted context (upper layer), and extracted params from model parameter extraction. None of these parameter values MUST come from model input, skill body, or client request body directly.

#### Scenario: Header params extracted from request headers

- **WHEN** `apiHeaderParams` is `"x-user-id,x-user-name"`
- **THEN** the orchestration layer MUST extract `x-user-id` and `x-user-name` values from current request headers
- **AND** MUST pass them to the API tool as header params

#### Scenario: Request params from trusted context

- **WHEN** `apiRequestParams` is `"query"`
- **THEN** the orchestration layer MUST obtain the `query` value from trusted context
- **AND** MUST pass it to the API tool as a request param

#### Scenario: Extracted params fill remaining required parameters

- **WHEN** the swagger yaml defines required parameters not covered by `apiHeaderParams` or `apiRequestParams`
- **THEN** model parameter extraction MUST generate values for those parameters
- **AND** all three parameter batches MUST be merged before assembling the HTTP call

### Requirement: Checkpoint And Recovery For Non-Agentic Path

The orchestration layer SHALL save a checkpoint before invoking the API tool (marking entry into the non-agentic path) and after the API tool returns (marking result obtained). If recovery finds the non-agentic path was entered but no result was obtained, the system MUST return failure without retrying the API call.

#### Scenario: Checkpoint saved before API tool invocation

- **WHEN** the orchestration layer is about to invoke the API tool
- **THEN** it MUST save a checkpoint marking entry into the non-agentic path

#### Scenario: Recovery without result does not retry API call

- **WHEN** recovery finds the non-agentic path was entered but no result checkpoint exists
- **THEN** the system MUST return failure
- **AND** MUST NOT retry the API call (avoiding duplicate side effects)

### Requirement: Observability For Non-Agentic API Path

The non-agentic API path SHALL reuse existing capability invocation audit and metric. The API tool SHALL emit low-cardinality structured logs (api name, execution step, success/failure result code). Parameter extraction SHALL produce `MODEL_INVOCATION_STARTED` and `MODEL_INVOCATION_COMPLETED` timeline events via `RunBoundModelInvocation`. Logs MUST NOT include credential, request body, response body, or endpoint.

#### Scenario: API tool logs execution steps

- **WHEN** the API tool executes (read yaml, parameter extraction, HTTP call)
- **THEN** it MUST emit structured logs with api name, execution step, and result code
- **AND** MUST NOT log credential, request body, response body, or endpoint

#### Scenario: Parameter extraction produces timeline events

- **WHEN** the API tool performs parameter extraction through `ParameterExtractionPort`
- **THEN** `MODEL_INVOCATION_STARTED` and `MODEL_INVOCATION_COMPLETED` timeline events MUST be emitted
- **AND** these events MUST be produced by `RunBoundModelInvocation`
