## Why

面向用户的 Agent 目前同时接收较保守的 System Prompt 触发指导和较长的 `AskUserQuestion` Tool 描述。模型在需要用户追问、澄清或普通确认时，仍可能直接输出文本问句，导致用户无法获得统一的结构化问题交互、pending input 暂停和回答恢复体验。需要把模型可见指导收敛为一条明确规则，并保持受保护操作与高风险确认的既有安全边界。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- 当面向用户的 Agent 需要用户回答追问、澄清、偏好、实现选择或普通确认时，模型可见指导要求通过 `AskUserQuestion` 发问，不在普通 assistant 文本中直接写出需要用户回答的问题。
- Tool description、输入 Schema description 与 System Prompt 使用一致、简洁且可操作的指导，降低模型遗漏或构造错误参数的概率。
- 保留凭据、secret、授权授予、受保护操作审批、高风险确认、人工接管、survey 和长表单不进入 `AskUserQuestion` 的安全边界。

**非目标：**

- 不增加自然语言推断、forced tool choice、自动 pending-input routing 或 runtime 语义路由。
- 不修改 pending input lifecycle、Web API、stream event、answer contract、持久化或前端渲染。
- 不向 `network-explorer` 暴露 `AskUserQuestion`。

## What Changes

- 修改面向用户 Agent 的模型指导：凡是实际需要用户回答的普通问题，必须调用 `AskUserQuestion`；禁止只在 assistant 文本中直接提问。
- 在任务方法和工具使用两个 System Prompt section 中表达相同强制规则，并明确普通确认与受保护/高风险确认的边界。
- 缩短并明确 `AskUserQuestion` Tool description 和各输入字段 description，保留自由文本、预设选项、多选、option-attached text input 与 question-level custom 的构造规则。
- 增加 prompt rendering 与 descriptor characterization tests，锁定一致的模型可见指导。

## Feature 影响（Features）

### 修改的 Feature

- `F-5.4 向用户提问`：用户可以依赖面向用户 Agent 将所有需要回答的普通问题投影为统一的 `AskUserQuestion` 交互，而不是不可恢复的纯文本问句。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-5.6 向用户提问` → `specs/ask-user-question-tool/spec.md`
  - 功能边界：模型可见指导从“仅阻塞安全推进时使用”收敛为“凡需要用户回答的普通问题均使用”，同时保持禁止用途边界和既有 pending input 行为。
  - 系统质量属性：安全、可维护性、可测试性。
  - 映射说明：`ask-user-question-tool` 是 canonical spec；本次触及 legacy spec `ask-user-question-trigger-policy`，其被修改的触发 Requirement 原子迁入 canonical spec。

## 影响范围（Impact）

- Agent 用户将更稳定地看到结构化提问 UI，并通过既有 pending input lifecycle 回答和恢复请求。
- Agent 开发者需要把 System Prompt 与 Tool descriptor 的用户提问规则保持一致。
- 受影响实现集中在内置 System Prompt、`AskUserQuestion` descriptor/schema 及其定向测试；公共 API、配置和运维部署方式不变。
