## 背景和现状（Context）

NextAgent 在一次请求 terminal commit 后，前端没有后续问题引导能力。`docs/Recipe specification.md` 第七章设计了基于 Recipe 节点 `recommends` 字段的三级推荐体系，但那是 legacy Recipe DSL 的行为，TS 后端从未实现。

当前架构中，请求完成后有以下 post-terminal 异步 worker：`TaskTrajectoryWorker`（构建执行轨迹）和 `MemoryExtractionScheduler`（提取长期记忆）。推荐问题生成是另一个 post-terminal 行为，但它不是异步 worker——而是前端按需触发的同步请求。

相关现状：
- `ModelInvocationService` 已提供 `complete()` 和 `stream()` 两个方法，推荐生成使用 `complete()`。
- `CapabilityCatalog.resolve()` 可按 `capabilityId` 获取 `CapabilityDescriptor`（含 `displayName` 和 `description`）。
- `RecipeRegistry.require(agentId, recipeName)` 可获取 `RecipeDefinition`（含 `displayName` 和 `description`）。
- `RequestRunStoreGateway.loadRun()` 可加载已完成 run 并检查 `terminalStatus`。
- `SessionMessageStoreGateway.listCurrentRequestMessages()` 可获取 run 对应的 USER 和 ASSISTANT 消息。
- `RunTimelineEventStoreGateway.listEvents()` 可获取 timeline 事件，用于 skill 三路取值的第三路。
- `AgentRoutingDecision` 在 `DefaultAgent.executeRun()` 中产生，但不会持久化为独立字段。第三路（timeline CAPABILITY_STARTED 事件）是获取实际调用 skill 的可靠途径。
- Web channel 已有 `SkillCatalogQueryPort` 的注入模式，`SuggestedQuestionPort` 复用同一 composition 注入路径。

## 目标和非目标（Goals / Non-Goals）

**目标：**
- 在 terminal commit 完成后，通过独立 REST 接口基于 prompt 生成 3 个推荐问题。
- prompt 变量从可信数据源组装：`{query}`、`{skill}`、`{final_answer}`、`{user_features}`。
- `{skill}` 按三路优先级取值：routing decision skill → recipe → timeline SKILL capability。
- 前端在 `REQUEST_COMPLETED` 后自动调用接口，展示推荐问题组件，点击可发送。
- 实现尽可能独立，不侵入 runtime lifecycle、context engine 或 memory 模块。

**非目标：**
- 不实现 Recipe spec 第七章的三级推荐体系（静态 recommends 字段、意图识别节点推荐、LLM 兜底链）。
- 不做推荐结果缓存或锚点表。
- 不实现 `{user_features}` 的 memory 数据填充（当前留空，预留扩展）。
- 不实现 `{plan_summary}` 和 `{memory_candidates}` 变量（已从 prompt 中移除）。
- 不改变 stream transport 契约（推荐结果通过独立 REST 接口返回，不走 SSE/WS stream）。
- 不在 `agent-context-engine` 的 prompt template registry 中注册推荐模板。

## 设计决策（Decisions）

### D1: Port 归属 — `agent-contracts/runtime`

`SuggestedQuestionPort` 定义在 `agent-contracts/runtime`，与 `UserPreferencePort`、`SkillCatalogQueryPort` 同级。

**理由：** 推荐生成是 app-facing 应用行为，不是 runtime lifecycle 行为。Port 由 `agent-app` composition 实现，注入 `agent-channel-web`。这与 `SkillCatalogQueryPort` 的模式一致——web channel 通过 port 委托，不直接依赖 `agent-capability` 或 `agent-core`。

**放弃的方案：**
- 放在 `agent-contracts/core`：core 承载 Agent orchestration contract，推荐生成不是 Agent 内部行为。
- 放在 `agent-context-engine`：context engine 负责 request-lifecycle 的 context assembly，推荐生成是 post-terminal 行为，不属于 context assembly。

### D2: DTO 结构

```typescript
// agent-contracts/runtime

export interface SuggestedQuestionRequest {
  readonly tenantId: TenantId;
  readonly subjectId: SubjectId;
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
  readonly requestId: MessageId;
  readonly runId: RequestRunId;
}

export interface SuggestedQuestionResult {
  readonly questions: readonly string[];
}

export interface SuggestedQuestionPort {
  generate(request: SuggestedQuestionRequest, signal?: AbortSignal): Promise<SuggestedQuestionResult>;
}
```

`SuggestedQuestionRequest` 只携带 owner-scoped 和 agent-scoped 坐标，不携带 prompt 变量内容。所有变量由 Port 实现从可信数据源自行加载。

### D3: Prompt 模板归属 — Port 实现层

Prompt 模板作为常量定义在 `agent-app` composition 的 Port 实现中，不进入 `agent-context-engine` 的 `PromptTemplateRegistry`。

**理由：**
- `agent-context-engine` 的 template registry 服务于 request lifecycle 的 context assembly，有 budget policy、profile 选择、closed-registration variable table 等重 machinery。
- 推荐问题的 4 个变量不是 request-lifecycle 变量，塞进 `variable-resolver` 的注册表会污染那个闭表。
- 推荐生成是一次性 post-terminal 调用，不需要 budget/history selection/attachment resolution。
- 模板内容是行为契约，在 spec 中固化；实现中只做简单的字符串替换。

### D4: Prompt 模板内容

System message 和 user message 分离。System message 是固定的角色定义和任务指令；user message 是填充了变量的上下文。

**System message（完整模板）：**

```
你是一个资深问题推荐专家，你的任务是根据[原始问题]基于当前完整会话上下文、当前意图的语义边界以及类似场景的高频追问参考，直接生成最合适的下一步问题。

## [输入的上下文]:
用户问题: {query}
## 若开启多轮改写，则传递改写后的问题
当前问题对应的意图: {skill}
用户特征: {user_features}
最终回答: {final_answer}

## [任务目标]：
不是相似问句扩写任务。在当前问题回答之后，推荐用户最可能继续问、且最能推动任务向前推进的3个问题。这些问题是围绕同一个主题展开的，但是要从不同的角度去探索该主题。确保每个问题都具有明确的知识来源，并且逻辑通顺，避免任何虚构的内容。

你需要在内部完成四件事：
1.判断当前任务阶段。例如知识解释、数据查询、异常发现、根因定位、结果验证或规划分析啊。
2.判断当前回答已经覆盖了什么，还缺什么。例如影响范围、根因、证据、趋势、运维动作。
3.结合当前意图，选择最符合当前意图语义边界的下一步问题
4.参考高频追问的语言风格，但不要机械的抄。

## 【具体步骤】：
1、所推荐的问题必须与原始问题的主题保持一致，但要讨论该主题的不同方面。
2、保持推荐问题的风格与原始问题一致，每个推荐问题保证只有单一意图，避免对比或者多问题。
3、每个问题都应该有可靠的知识出处。确保信息准确无误。
4、问题的数量必须恰好为3个。
5、避免重复或者过于宽泛的问题。推荐问题的表达要尽量精简，每一条都必须完整、自然、可直接点击追问的问题句。
6、与当前会话语言保持一致。

## [示例]:
### [原始问题]: 如何提升人工智能模型的精度？
### [输出]:
哪些因素会影响人工智能模型的训练效果？
如何选择合适的数据子集来优化人工智能模型的性能？
在模型精度优化过程中，如何平衡模型复杂度与训练时间的关系？

## 重要提示：
1、务必只输出推荐的问题即可，省略思考过程，使用空一行。风格，务必不要输出其他内容。
2、输出问题时，务必不要输出序号。
请你回答：
```

**User message：** 空字符串（所有上下文已在 system message 中通过变量注入）。

**变量替换：** 使用简单的字符串替换（`{query}` → 实际值），不使用 `agent-context-engine` 的 variable resolver。若变量值包含模板占位符（如 `{`），实现 MUST 先转义变量值再替换，避免注入。

### D5: Skill 两路取值实现

Port 实现需要获取 `AgentRoutingDecision` 来判断第一路。但 `AgentRoutingDecision` 不持久化为独立字段。实现方案：

- **第一路（Timeline Routing Evidence 指定 Skill）**：从 timeline events 中查找 `type === "POLICY_APPLIED"` 且 `inlinePayload.policyDomain === "TARGETED_SKILL"` 且 `inlinePayload.outcome === "constraint-accepted"` 的事件，取其 `selectedCapabilityId`，通过 `CapabilityCatalog.resolve()` 获取 descriptor，校验 `kind === "SKILL"` 后取 `displayName + ": " + description`。

  **备选方案（放弃）：** 在 `RequestRun` 或 `RequestRunRecord` 上新增 `routingDecisionKind` 和 `routingDecisionTarget` 字段——这需要修改 runtime contract 和 gateway schema，影响面过大。

- **第二路（Timeline 实际调用的 Skill）**：从 timeline events 中筛选 `type === "CAPABILITY_STARTED"` 的事件，对 `capabilityId` 去重后逐个 `CapabilityCatalog.resolve()`，过滤 `kind === "SKILL"` 的 descriptor，将每个的 `displayName + ": " + description` 以换行分隔拼接。

**Recipe/Workflow 路径（不可实现）**：原设计的三路取值第二路（recipe/workflow routing decision）当前不可实现。`RoutingPolicyEvidence`（由 `RoutingEvidenceRecorder` 记录到 `POLICY_APPLIED` 事件）不包含 `recipeName` 字段，因此 Port 实现无法从 timeline events 推断 recipe routing decision。此路径为 deferred 扩展点，未来若 `RoutingPolicyEvidence` 增加 recipe 信息可通过 OpenSpec change 引入。

### D6: Model 调用配置

```typescript
const modelRequest: ModelInvocationRequest = {
  requestId: brand("suggested-question"),
  stepId: brand("suggested-question"),
  invocationScope: {
    agentId: request.agentId,
    sessionId: request.sessionId,
    requestId: request.requestId,
    runId: request.runId
  },
  providerKind: profile.providerKind,
  modelName: profile.modelName,
  ...(profile.baseUrl === undefined ? {} : { baseUrl: profile.baseUrl }),
  ...(profile.credentialRef === undefined ? {} : { credentialRef: profile.credentialRef }),
  messages: [
    { role: "SYSTEM", content: [{ type: "text", text: systemPrompt }] },
    { role: "USER", content: [{ type: "text", text: "" }] }
  ],
  tools: [],
  commonOptions: {
    temperature: 0.7,
    maxOutputTokens: 1024
  },
  providerOptions: {},
  timeoutMs: 30_000
};
```

`modelName` 和 `providerKind` 来自 agent assembly 的主 model profile。Port 实现通过 `AgentAssemblyRegistry.active(agentId)` 获取当前活跃 assembly，再通过 `modelProfiles.selectForAssembly(assembly)` 获取 model profile。同一 `generate()` 调用内只调用一次 `active()`，获取的 assembly 同时传递给 `resolveSkillContext()` 中的 `CapabilityCatalog.resolve()`，避免重复查询。

`temperature: 0.7` 和 `maxOutputTokens: 1024` 是推荐场景的合理默认值——推荐问题需要一定创造性但不应过于发散，1024 tokens 足够 3 个问题。

### D7: 输出清洗与解析

模型输出在解析前先经过清洗管线，处理模型常见的异常输出格式。清洗按以下顺序执行：

1. **推理块剥离**：
   - 完整 `<think>...</think>`：正则 `/<think>[\s\S]*?<\/think>/gi` 移除标签对及内部内容。
   - 未闭合 `<think>`：正则 `/<think>[\s\S]*$/gi` 移除标签及其后所有内容（模型推理被截断、超时或输出被 maxOutputTokens 截断的场景）。
   - 孤立 `</think>`：正则 `/<\/think>/gi` 移除残留的闭合标签。
2. **Markdown 围栏剥离**：移除以 ` ``` ` 开头的行（包括 ` ```markdown ` 等带语言标记的围栏行）。
3. **叙述性文本过滤**：过滤以"以下是"、"下面是"、"推荐"、"建议"等叙述性短语开头的段——这些是引导语而非推荐问题。
4. **Markdown 标题标记剥离**：移除段首的 `#`、`##`、`###` 等 Markdown 标题标记。

清洗后按空行（`\n\n`）分割为段，每段 `trim()` 后过滤空字符串。去除序号前缀（正则 `/^\d+[\.\、\)\s]+/`）。不足 3 条返回已有，超过 3 条取前 3 条。

**设计理由**：MiniMax-M2.7-highspeed 等模型会在 `content` 字段中嵌入 `<think>` 推理块；部分模型在输出被截断时留下未闭合的 `<think>` 标签。清洗管线确保解析逻辑对所有这些变体都能正确提取推荐问题。

### D8: 前端组件设计

推荐问题组件位于 `agent-web/src/features/suggested-questions/`，包含：
- `SuggestedQuestions.tsx`：主组件，负责调用接口、渲染推荐问题矩形、处理点击发送。
- `SuggestedQuestions.css`：组件样式。

组件在 `ChatPage.tsx` 的消息渲染区域中，当消息为 assistant terminal 消息时，在 action buttons（点赞/点踩/收藏）下方 16px 处渲染。

调用时机：在 `REQUEST_COMPLETED` stream event 处理逻辑中触发接口调用。

### D9: 安全边界

- Owner scope 从 Web channel identity resolver 获取，不从请求体获取。
- Agent scope 从 `Session.agentId` 获取，不从请求体获取。
- `SuggestedQuestionRequest` 中不携带 prompt 变量内容，Port 实现自行从可信数据源加载。
- 模型输出只解析为 `string[]`，不执行、不反序列化为结构化对象。
- 推荐问题内容不写入日志、metric、trace 或 audit。
- Prompt 原文、模型原始输出、provider response metadata 不在 HTTP 响应中暴露。

### D10: TurnBlock 布局变更

为实现推荐问题组件在 assistant action buttons 下方 16px 处渲染，对 `TurnBlock.tsx` 中 assistant 气泡的 `BubbleActions` 定位做了以下调整：

- `position` 从 `absolute` 改为 `relative`（仅 assistant 气泡）。原 `absolute` 定位使 action buttons 浮在内容上方，推荐组件需要紧跟在 action buttons 下方的文档流中渲染，`absolute` 定位会导致推荐组件与内容重叠。
- `visible` 从 `isAssistantRegionHovered`（hover 显示）改为常驻显示。原 hover 显示逻辑与推荐组件的常驻展示需求冲突——用户需要看到推荐问题才能点击，但 hover 离开后推荐区域也会消失。改为常驻显示后，action buttons 始终可见，推荐组件在 action buttons 下方稳定渲染。
- `align` 保持 `"left"`，操作行（复制、点赞、点踩、收藏、重新生成、时间戳）整体左对齐，与推荐组件的左对齐布局一致。时间戳位于重新生成按钮右侧（操作行最末位）。
- 容器 `alignItems` 从 `"flex-start"` 改为 `"stretch"`，使推荐组件能占满气泡宽度。

这些变更仅影响 assistant 气泡（`bubble === "assistant"`），user 气泡的 `BubbleActions` 定位不受影响。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | Owner scope 和 agent scope 从可信 boundary 获取；prompt 变量不从请求体获取；模型输出只解析为 string[]；推荐内容不记入日志/audit；变量值转义后替换防止模板注入 | route tests（scope 校验失败返回 403）、unit tests（变量值转义）、architecture tests（不暴露 prompt 原文） |
| 性能/容量 | 同步 model invocation，timeout 30s；maxOutputTokens 1024；无缓存，每次重新生成；单次调用资源消耗等价于一次普通 model turn | unit tests（timeout 处理）、route tests（响应时间不阻塞 stream） |
| 可靠性/恢复 | terminal status 不是 COMPLETED 时返回空列表不报错；model invocation 失败时返回空列表不报错；AbortSignal 已取消时立即返回空列表；前端接口失败时静默不展示 | unit tests（各失败路径返回空列表）、前端 tests（接口失败静默处理） |
| 可维护性 | Port 定义在 agent-contracts/runtime，实现在 agent-app composition；prompt 模板作为常量在实现层，不侵入 context-engine；skill 两路取值逻辑封装在 Port 实现内 | architecture tests（port 边界、不依赖 context-engine template registry） |
| 可测试性 | Port 接口可 mock；model invocation 可注入 mock；capability catalog 可注入 mock；timeline/gateway 可注入 mock；前端组件可独立测试 | contract tests（port 签名）、unit tests（各依赖 mock）、前端 component tests |
| 审计/可追溯性 | 推荐生成不写入 canonical timeline、不修改 RequestRun 状态；推荐内容不记入日志/metric/trace/audit（属于用户交互内容，不是系统执行事实） | architecture tests（不写入 timeline、不修改 run state） |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| SuggestedQuestionPort 是 async contract 并接收 AbortSignal | T1 | contract test：port 签名断言 |
| terminalStatus !== COMPLETED 返回空列表 | T2 | unit test：FAILED/CANCELED/SUPERSEDED 返回 `{ questions: [] }` |
| DEGRADATION_NOTICE + COMPLETED 视为成功 | T2 | unit test：TOOL_ROUND_LIMIT_EXCEEDED + COMPLETED 继续生成 |
| {query} 来自 USER message content | T3 | unit test：变量组装断言 |
| {final_answer} 来自 terminal ASSISTANT message | T3 | unit test：变量组装断言 |
| {user_features} 为空字符串 | T3 | unit test：变量组装断言 |
| {skill} 两路取值优先级 | T4 | unit test：两路场景各一个 |
| {skill} 不包含 TOOL capability | T4 | unit test：timeline 只有 TOOL 事件时 {skill} 为空 |
| ModelInvocationService.complete() 调用，tools 为空 | T5 | unit test：model request 断言 |
| 不使用 ModelInvocationService.stream() | T5 | architecture test：不调用 stream |
| 输出解析：空行分割、去序号、不足3返回已有、超过3取前3 | T6 | unit test：各种输出格式 |
| REST 端点 scope 校验、403/404/200 | T7 | route test：各状态码 |
| 推荐内容不记入日志/audit | T7 | route test + architecture test |
| 不缓存，每次重新生成 | T8 | unit test：两次调用各发起 model invocation |
| 不写入 timeline、不修改 run state | T8 | architecture test |
| 前端 REQUEST_COMPLETED 后调用接口 | T9 | 前端 test：event 触发调用 |
| 前端 FAILED/CANCELED 不调用 | T9 | 前端 test：事件不触发 |
| 前端接口失败静默 | T9 | 前端 test：mock 失败不报错 |
| 推荐组件渲染位置和样式 | T10 | 前端 component test：渲染断言 |
| 点击推荐问题自动发送 | T10 | 前端 component test：点击触发 submit |

## 文档承载决策（Documentation Ownership）

| 事实 | 主承载文档 |
|---|---|
| SuggestedQuestionPort 接口契约 | `openspec/specs/question-recommendation/spec.md` |
| REST API 端点行为契约 | `openspec/specs/question-recommendation/spec.md` |
| Prompt 模板内容与变量解析规则 | `openspec/specs/question-recommendation/spec.md`（行为契约）+ 本 design.md（完整模板文本） |
| Skill 三路取值逻辑 | `openspec/specs/question-recommendation/spec.md` |
| 前端推荐组件交互行为 | `openspec/specs/question-recommendation/spec.md` |
| SuggestedQuestionPort composition | `openspec/designs/modules/agent-app.md`（归档时补充） |
| suggested-questions 路由组 | `openspec/designs/modules/agent-channel-web.md`（归档时补充） |
| 导航 | `openspec/designs/spec-to-design-map.md`（归档时补充） |

## 风险与取舍（Risks / Trade-offs）

- [routing decision 不持久化] -> 从 timeline routing evidence 事件推断 routing decision；如果 timeline 中没有 routing evidence 事件，第一路和第二路直接跳到第三路。这是可接受的降级——model-driven loop 是最常见路径，第三路（timeline SKILL capability）已经覆盖了该场景。
- [模型输出不稳定] -> 解析逻辑容错：不足 3 条返回已有，超过 3 条截断，包含序号去除序号。模型返回空输出时返回空列表，前端静默不展示。
- [同步调用延迟] -> timeout 30s，前端展示 loading 状态。如果用户在等待期间发起新请求，前端可取消推荐接口调用（AbortSignal）。
- [无缓存导致重复调用开销] -> 用户每次刷新都可能触发调用。可接受，因为推荐生成成本等价于一次普通 model turn，且用户不会频繁刷新同一请求的推荐。
- [prompt 模板硬编码在实现层] -> 模板内容在 spec 中固化为行为契约，实现中作为常量。若未来需要可配置，再通过 OpenSpec change 引入。

## 迁移计划（Migration Plan）

无迁移风险。新增 Port、新增 REST 端点、新增前端组件，不修改既有行为。部署后功能立即可用，不需要数据迁移或配置变更。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/question-recommendation/spec.md`：新增，承载全部行为契约。
- `openspec/overview.md`：补充基于 prompt 的下一步问题推荐能力的产品背景。
- `openspec/designs/modules/agent-channel-web.md`：补充 `suggested-questions` 路由组。
- `openspec/designs/modules/agent-app.md`：补充 `SuggestedQuestionPort` composition。
- `openspec/designs/spec-to-design-map.md`：新增 `question-recommendation` 导航条目。

## 待确认问题（Open Questions）

无。
