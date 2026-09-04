# FN-5.17 技能驱动 API 调用

> 能力域 D5 Capability 能力体系 · 子域 [D5.3 Skill 与检索](.) · 返回 [功能树](../../index.md)

| 项 | 值 |
|---|---|
| 当前状态 | 稳定 |
| 覆盖特性 | [F-5.6](../../../features/D5-Capability能力体系/D5.3-Skill与检索/F-5.6-Skill系统.md) |
| 主规格 | `skill-driven-api-call` |
| 接口 | 能力调用端口（隐藏 `ApiCall` tool） |

## 描述

当 Skill 的 metadata extension `_naie_agentic_loop_flag="false"` 时，系统走非 agentic 执行路径：Skill tool 解析 API 命令但不注入 body，编排层程序化调用隐藏 `ApiCall` tool，由 `ApiCall` tool 解析 Swagger 2.0 yaml、模型单次提参、组装 HTTP 调用并返回终态结果，不经模型多轮 loop。flag 为 `"true"` 或缺失时走现有 inline body 注入路径，行为完全不变。

## 前置条件

- 技能在当前请求范围内可用，且 manifest extension 声明 `_naie_agentic_loop_flag="false"`。
- Skill body 包含 ` ```api ` 代码块声明 API 命令（`api -name <api-name> -hiro <hiro-value>`）。
- SKILL.md 同级 `api/` 目录下存在 `<api-name>.yaml`（Swagger 2.0）。
- `ApiCall` tool 的 `skillSources`、`apiCallPort`、`parameterExtraction` 依赖均已注入。

## 输入

| 参数 | 必填 | 说明 |
|---|---|---|
| 技能标识 | 是 | 要调用的技能（由模型 `Skill` tool call 触发） |
| 用户问题 | 是 | 原始用户问题，从 `RequestContext.acceptedInputText` 获取 |
| header params | 否 | `api_header_params` 声明的请求头参数名，编排层从当前请求头提取 |
| request params | 否 | `api_request_params` 声明的请求参数名，编排层从 trusted context 获取 |

## 输出

API 调用结果。非流式返回完整 JSON body（原样不截断）；流式逐 chunk 转发 SSE data 后返回终态结果。结果作为终态 assistant message 返回给用户，不继续模型 loop。

## 处理过程

1. 模型调用 `Skill` tool，`Skill` tool 读取 `extension._naie_agentic_loop_flag`。
2. flag 为 `"false"` 时，`Skill` tool 加载 body 解析 ` ```api ` 代码块提取 api 命令，但不注入 body、不做 resource projection，返回带 `nonAgenticApiCall: true` 信号的结果。
3. 编排层检测信号，从 `structuredPayload` 提取 api 信息和参数声明，从请求头和 trusted context 获取参数值，构造 trusted 入参调用 `ApiCall` tool。
4. `ApiCall` tool 读取 `api/<name>.yaml` 解析为 `ApiDoc`，对未被上层覆盖的必填参数通过 `ParameterExtractionPort` 单次模型提参，合并三批参数后通过 `ApiCallPort` 发起 HTTP 调用。
5. 非流式响应原样放入 `structuredPayload`；流式响应通过 `emitResultDelta` 转发 SSE data。
6. 编排层把 `ApiCall` tool 结果写入 terminal assistant message，跳过后续 model invocation。

## 结果

- 正常：API 调用结果作为终态响应返回。
- API 命令解析失败：返回 `API_COMMAND_PARSE_FAILED`。
- yaml 加载失败：返回 `API_DOC_LOAD_FAILED`。
- 提参超时/失败：返回 `PARAMETER_EXTRACTION_TIMEOUT` / `PARAMETER_EXTRACTION_FAILED`。
- HTTP 401/403：返回 `UNAUTHORIZED`。
- HTTP 超时：返回 `TIMEOUT`。
- HTTP 其他失败：返回 `UNAVAILABLE`。
- 流式中断：返回 `API_STREAM_INTERRUPTED`，已转发 delta 保留。
- 必填参数缺失：返回 `MISSING_REQUIRED_PARAMS`。
- 同轮并发冲突：返回 `NON_AGENTIC_BATCH_CONFLICT`。

## 规格

| 规格项 | 规格值 | 权威来源 |
|---|---|---|
| 触发条件 | `metadata.extension._naie_agentic_loop_flag === "false"`；`"true"` 或缺失时走现有 inline 路径 | `skill-driven-api-call`：`Non-Agentic Skill Detection And Dispatch` |
| `ApiCall` tool 可见性 | `modelInvocable=false`、`disclosurePolicy=HIDDEN`，只由编排层程序化调用 | `skill-driven-api-call`：`API Tool Is Independent Non-Model-Visible Tool Capability` |
| 终态返回 | `ApiCall` tool 结果写入 terminal assistant message，跳过后续 model invocation | `skill-driven-api-call`：`Orchestration Layer Invokes API Tool And Returns Terminal Response` |
| 提参模式 | `ParameterExtractionPort` 单次 `complete()` 调用，不走 loop、不重试 | `skill-driven-api-call`：`ParameterExtractionPort Provides Model Parameter Extraction To API Tool` |
| 非流式响应 | 原样返回完整 JSON，不截断，绕过 `maxCapabilityResultMessageChars` | `skill-driven-api-call`：`Streaming And Non-Streaming Response Handling` |
