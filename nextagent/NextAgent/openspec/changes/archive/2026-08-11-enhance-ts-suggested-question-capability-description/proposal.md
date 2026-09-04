## 背景与问题（Why）

当前下一步问题推荐（`SuggestedQuestionPort`）的 prompt 填槽只有三个变量：用户问题（`query`）、最终回答（`final_answer`）和 Skill 上下文（`skill`）。当 Agent 具有明确的产品能力边界时，推荐问题可能超出 Agent 实际支持的能力范围，导致用户点击推荐后无法得到有效回答。

电信网络场景下，不同 Agent 可能面向不同产品域（如 5G 基站诊断、传输网运维、核心网告警），推荐问题需要与当前 Agent 的产品能力范围对齐，才能提供有价值的下一步追问。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- 在 `agents/{agentId}/resource/capabilityDescription.md` 文件存在时，将其内容作为「产品能力范围」填入推荐 prompt，与 `query`、`final_answer` 并列。
- 提供具备 LOCAL 和 REMOTE 双模式的热加载 Provider，替换文件后新 run 立即生效。
- 文件不存在时，推荐行为与当前完全一致，不产生任何破坏性变更。

**非目标：**

- 不修改前端推荐组件、API 端点、模型选择、输出清洗或解析逻辑。
- 不修改 `PrecomputedSuggestedQuestionPort` 的缓存策略（`No Caching` spec 债务另行处理）。
- 不对 `capabilityDescription.md` 内容做结构化解析或校验。
- 不将产品能力范围暴露给 Web API、SSE、WebSocket 或其他不可信边界。

## 变更范围（What Changes）

- **新增** `Capability Description Provider`：从 agent-owned resource 热加载 `capabilityDescription.md`，支持 LOCAL（load-once）和 REMOTE（fingerprint 热重载）双模式。
- **新增** `Capability Description Resolution`：定义 `{capability_description}` 变量的解析规则。
- **修改** `Prompt Variable Resolution`：在 user message 中增加产品能力范围段（仅非空时包含），在 system message 中增加产品能力范围选择规则；更新可信数据源列表。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-1.20 查看推荐问题` → canonical spec `question-recommendation`
  - 功能边界：推荐 prompt 增加产品能力范围上下文，使推荐问题与 Agent 产品能力对齐。
  - 系统质量属性：可维护性（热加载替换文件）、安全（可信 agent-owned resource）。
  - 映射说明：`question-recommendation` 是 canonical spec，本 change 修改其 `Prompt Variable Resolution` Requirement 并新增两个 Requirement。

## 影响范围（Impact）

- `agent-session`：新增 `CapabilityDescriptionProvider` 实现和 `createLocal/createRemote` 工厂；`SuggestedQuestionServiceDependencies` 增加可选 `capabilityDescriptionProvider` 字段；`renderRecommendationContext` 增加产品能力范围段。
- `agent-app`：`session-services-composition.ts` 根据 deployment mode 创建并注入 Provider。
- OpenSpec：`question-recommendation` spec 新增两个 Requirement、修改一个 Requirement。
- 前端、API、模型选择、输出清洗、缓存和 runtime lifecycle 不受影响。
