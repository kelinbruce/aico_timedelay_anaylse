## 背景与问题（Why）

当前 NextAgent 在一次请求 terminal commit 之后，前端没有"下一步问题推荐"能力。用户完成一轮问答后，需要自己想下一个问题，缺乏引导性的后续探索入口。电信网络运维场景中，用户往往不清楚一个异常或查询之后还能从哪些角度继续深挖（影响范围、根因、趋势、运维动作等），推荐问题能显著降低用户的认知负担并推动任务向前推进。

`docs/Recipe specification.md` 第七章曾设计了基于 Recipe 节点 `recommends` 字段、意图识别节点和 LLM 兜底的三级推荐体系，但那是 legacy Recipe DSL 的行为，TS 后端从未实现，且该文档不是 OpenSpec 规格，不能直接作为实现依据。

本次变更基于 prompt 驱动的方式，在 terminal commit 完成后通过独立 REST 接口调用主模型生成推荐问题。该方案不依赖 Recipe DSL、不依赖意图识别节点、不依赖 memory 历史追问数据，以最小独立实现满足"基于当前会话上下文推荐下一步问题"的核心需求。

## 变更范围（What Changes）

### 新增 `SuggestedQuestionPort`（agent-contracts/runtime）

定义一个独立的应用端口，接收已完成的 request run 坐标，返回推荐问题列表。Port 是 async contract，接收 `AbortSignal`。Port 由 `agent-app` composition 实现并注入 `agent-channel-web`。

### 新增 REST API 端点（agent-channel-web）

新增 `POST /api/v1/sessions/:sessionId/requests/:requestId/suggested-questions`，返回 `{ questions: string[] }` JSON 响应。端点通过 trusted Web channel identity resolver 解析 owner scope，通过 session-bound `agentId` 解析 agent scope。

### 推荐生成服务（agent-app composition）

Port 实现负责：
1. 加载已完成的 `RequestRun` 和 session message，校验 `terminalStatus === "COMPLETED"`，否则返回空列表。
2. 组装 prompt 变量：`{query}`（用户原始问题）、`{skill}`（当前意图对应的 skill/recipe 名称及描述）、`{final_answer}`（AI 最终回答）、`{user_features}`（预留，当前为空字符串）。
3. `{skill}` 的两路取值：timeline routing evidence 指定 skill → timeline 中实际调用的 SKILL capability 名称+描述。recipe/workflow 路径因 `RoutingPolicyEvidence` 不含 recipeName 字段而不可实现，为 deferred 扩展点。
4. 模板插值后，通过 `ModelInvocationService.complete()` 调用主模型（空 tools 数组），解析输出为问题列表。
5. 不做缓存，每次调用重新生成。

### 前端推荐问题组件（agent-web）

流式回答结束后（`REQUEST_COMPLETED` 事件后），前端调用推荐接口，在点赞、点踩、收藏按钮下方 16px 处新增推荐问题组件。每个推荐问题以圆角矩形展示，点击后自动发送该问题作为下一个请求。

## Capability 影响（Capabilities）

### 新增 Capability
- `question-recommendation`: 基于 prompt 的下一步问题推荐行为契约，包含 `SuggestedQuestionPort` 接口契约、REST API 端点行为、prompt 模板与变量解析规则、skill 两路取值逻辑、terminal 状态守卫、agent/owner scope 校验、前端推荐组件交互行为和 DFX 要求。

### 修改的 Capability
（无）

## 影响范围（Impact）

- **agent-contracts/runtime**：新增 `SuggestedQuestionPort` 及配套 Request/Result DTO。
- **agent-channel-web**：新增 `suggested-questions` 路由、schema 和 projection。
- **agent-app**：composition 实现 `SuggestedQuestionPort`，注入 model invocation service、capability catalog、agent assembly registry、message store、request run store、timeline store。
- **agent-web**（前端）：新增推荐问题组件、SSE `REQUEST_COMPLETED` 后的接口调用逻辑、点击推荐问题自动发送的交互。
- **agent-contracts/model**：无变更，复用已有 `ModelInvocationService.complete()`。
- **agent-context-engine**：无变更，推荐生成不走 context engine 的 prompt template registry。
- **agent-runtime**：无变更，推荐生成在 terminal commit 之后独立执行，不进入 runtime lifecycle。
- **agent-memory**：无变更，`{user_features}` 当前留空，不触发 memory search。
- **配置**：无新增配置字段；功能依赖既有 agent assembly 的 model profile。
- **测试**：contract tests（port 签名、DTO schema）、gateway/route tests（scope 校验、terminal 状态守卫、空列表回退）、unit tests（skill 两路取值、prompt 变量插值、输出解析）、前端组件 tests（渲染、点击发送、loading/error 状态）。
- 无 breaking change。

## 归档前更新基线（Baseline Promotion Plan）

**行为契约：**
- `openspec/specs/question-recommendation/spec.md`：新增，承载 `SuggestedQuestionPort` 接口契约、REST API 端点行为、prompt 模板与变量解析规则、skill 两路取值逻辑、terminal 状态守卫和前端交互行为。

**长期背景：**
- `openspec/overview.md`：补充基于 prompt 的下一步问题推荐能力的产品背景。

**设计视图：**
- `openspec/designs/modules/agent-channel-web.md`：补充 `suggested-questions` 路由组。
- `openspec/designs/modules/agent-app.md`：补充 `SuggestedQuestionPort` composition。
- `openspec/designs/spec-to-design-map.md`：新增 `question-recommendation` 导航条目。

**验证入口：**
- contract tests：`SuggestedQuestionPort` 签名、DTO schema。
- route tests：scope 校验、terminal 状态守卫、失败/取消/superseded 返回空列表。
- unit tests：skill 三路取值、prompt 变量插值、LLM 输出解析为 `string[]`。
- 前端 tests：推荐组件渲染、点击发送、loading/error 状态。
