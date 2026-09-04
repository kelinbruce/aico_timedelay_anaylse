## Why

Portal 集成方当前无法按部署关闭“回答完成后的下一步问题推荐”，也无法调整 canonical `AskUserQuestion` 的等待时长。推荐问题默认自动触发并可能发起模型调用；AskUserQuestion 的默认等待时间固定为 30 分钟。对容量敏感或交互节奏不同的交付环境，这会造成不必要的模型消耗或过短/过长的等待窗口。

本 change 为 Agent package 增加一个受信的 `portal-ability-config` 配置块，并通过统一 provider 供 bootstrap、前端和 runtime 消费。配置缺失或非法时保持当前默认行为：推荐问题开启，AskUserQuestion 等待 30 分钟。

规范上下文：

- 配置来源：仅 active Agent package 的 `config/config.json`；请求体、客户端 metadata、模型输出和 Capability 参数不得覆盖。
- 部署语义：LOCAL 模式 load-once，不热更新；REMOTE 模式按 `statSync` 的 `size + mtimeMs` fingerprint 在请求时热更新。
- 默认值：`suggested-questions-enabled=true`；`ask-user-question-time-minutes=30`。
- 范围：`ask-user-question-time-minutes` 只影响 canonical `AskUserQuestion` 未显式指定 `timeoutAt` 的新 pending input；不影响其他 pending input。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- Portal 集成方可以在 Agent package 配置中关闭下一步问题推荐。
- 推荐问题关闭时，前端不挂载组件、不调用推荐 API；后端不预计算、不发起推荐模型调用。
- Runtime bootstrap 返回 `portalAbilityConfig.suggestedQuestionsEnabled`，前端使用该值决定是否展示推荐组件。
- Canonical `AskUserQuestion` 的默认等待时间可配置为 1 到 1440 分钟，非法值回退 30 分钟。
- REMOTE 模式下配置变化只影响之后新创建的 AskUserQuestion pending input；已 accepted 的 pending input deadline 不变。
- 所有配置值来自受信 app composition，不可由客户端或模型输出修改。

**非目标：**

- 不改变推荐问题的模型选择、prompt、清洗、解析和成功结果形状。
- 不修复既有推荐问题 precompute cache 与 `No Caching` spec 的偏差。
- 不把 `ask-user-question-time-minutes` 暴露到 bootstrap public DTO。
- 不改变 CONFIRMATION、AUTHORIZATION、HUMAN_HANDOFF、Workflow interrupt 或其他 QUESTION pending input 的默认 30 分钟超时。
- 不支持 LOCAL 模式运行期热更新；LOCAL 配置修改后需重启。
- 不新增通用 key-value 配置框架；本 change 只定义两个受控字段。

## What Changes

- Agent package `config/config.json` 新增 `portal-ability-config` 配置块，包含：
  - `suggested-questions-enabled`：boolean，默认 `true`；
  - `ask-user-question-time-minutes`：integer，范围 `1..1440`，默认 `30`。
- 新增 `PortalAbilityConfigProvider` 语义：LOCAL 模式启动后静态缓存；REMOTE 模式请求时按文件 fingerprint 热更新；缺失或非法值回退默认值。
- `GET /api/v1/runtime/bootstrap` response 新增 `portalAbilityConfig`，仅投影 `suggestedQuestionsEnabled`。
- 前端仅在 `portalAbilityConfig.suggestedQuestionsEnabled !== false` 时挂载下一步问题推荐组件并调用推荐 API。
- `suggested-questions-enabled=false` 时，后端 terminal 后预计算和推荐 REST endpoint 均不发起模型调用，REST 返回 `{ questions: [] }`。
- Canonical `AskUserQuestion` 未显式指定 `timeoutAt` 时，使用配置的等待分钟数计算 accepted `timeoutAt`；显式 `timeoutAt` 继续优先。
- 修改 pending input timeout 的稳定约束：仅为 canonical `AskUserQuestion` 增加这个受控例外，其他 pending input 仍不可配置。

## Feature 影响（Features）

### 修改的 Feature

- `F-1.9 智能问题推荐`：Portal 集成方可以关闭回答后的下一步问题推荐，并依赖前后端一致的关闭语义。
- `F-5.4 向用户提问`：Canonical `AskUserQuestion` 的默认等待时间可按受信配置调整，且只影响新创建的提问 pending input。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-5.2 调用能力` → `specs/agent-owned-resource-dynamic-loading/spec.md`
  - 功能边界：agent-owned 动态资源配置在文件上传配置之外增加 `PortalAbilityConfigProvider`，并保持 LOCAL/REMOTE 同形加载策略。
  - 系统质量属性：可靠性/恢复、可维护性。
  - 映射说明：`agent-owned-resource-dynamic-loading` 是补充规格。
- `FN-8.5 上传和管理附件` → `specs/ts-runtime-bootstrap-config/spec.md`
  - 功能边界：runtime bootstrap response 在附件配置之外投影 `portalAbilityConfig.suggestedQuestionsEnabled`。
  - 系统质量属性：可维护性、可测试性。
  - 映射说明：`ts-runtime-bootstrap-config` 是本次触及的 legacy bootstrap 配置规格。
- `FN-1.20 查看推荐问题` → `specs/question-recommendation/spec.md`
  - 功能边界：推荐问题触发、预计算和 REST 生成受 `suggestedQuestionsEnabled` 控制；关闭时返回空列表且不调用模型。
  - 系统质量属性：性能/容量、安全。
  - 映射说明：`question-recommendation` 是 canonical spec。
- `FN-5.6 向用户提问` → `specs/ask-user-question-tool/spec.md`
  - 功能边界：canonical `AskUserQuestion` 的默认等待时间来自受信 portal 能力配置，且只影响新 pending input。
  - 系统质量属性：可靠性/恢复、安全。
  - 映射说明：`ask-user-question-tool` 是 canonical spec。
- `FN-6.5 请求用户确认或授权` → `specs/human-pending-input-core/spec.md`
  - 功能边界：为 canonical `AskUserQuestion` 增加唯一受控默认 timeout 配置例外；其他 pending input timeout policy 不变。
  - 系统质量属性：可靠性/恢复、安全。
  - 映射说明：`human-pending-input-core` 是 pending input lifecycle 主规格。

## 影响范围（Impact）

- Portal 集成方和运维人员可以通过 Agent package 配置控制推荐问题开关与 AskUserQuestion 等待时长。
- 前端 runtime bootstrap 解析、下一步问题推荐组件和相关测试需要适配新增 public DTO 字段。
- 后端 app composition、runtime bootstrap route、suggested question precompute/REST gate 和 pending input timeout acceptance 需要消费同一 provider。
- REMOTE 部署的配置发布流程可以在文件 fingerprint 变化后让后续 bootstrap 和新 AskUserQuestion pending input 使用新值；LOCAL 部署需要重启。
- 公共 bootstrap response 是向后兼容的新增字段；推荐问题 REST 成功响应形状不变。
