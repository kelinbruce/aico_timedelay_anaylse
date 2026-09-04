# NextAgent v1.8 Release Notes

**发布日期**: 2026-06-28
**版本范围**: v1.7 → v1.8 (当前 HEAD)
**变更统计**: 100 commits (58 non-merge), 602 文件变更 (+33,151 / -10,388), 覆盖 Web 交互、工具框架、Runtime、Context、RAG、Memory、Gateway 与测试门禁

## 摘要

v1.8 是一个以 **交互增强**、**工具调用能力升级** 和 **规格/测试体系补强** 为核心的版本。主要交付：

- **会话标注能力上线** — 支持点赞、点踩、收藏和侧边栏收藏列表，补齐对话级反馈与运营沉淀能力。
- **Suggested Questions 推荐能力** — 在对话回合中提供建议问题，帮助用户更快进入下一步诊断或操作。
- **`http_request` 工具与流式响应投影** — 新增受治理的远程 HTTP 调用能力，并支持将流式响应安全投影到前端。
- **同轮并行工具调用** — Core Tool Loop 支持同一轮并行执行多个工具调用，提升复杂任务编排效率。
- **Lifecycle Hook 能力补完** — 完成生命周期 Hook 执行能力，补强运行态扩展、终态处理与异常路径约束。
- **上下文、RAG、Memory 持续加固** — 增加自动压缩阈值、RAG 检索作用域与默认索引治理，并修复长期记忆提取与置信度问题。
- **测试门禁体系升级** — 补齐 E2E、功能、兼容性、可靠性、安全、性能等多类 TESTClaw 测试资产，并同步 OpenSpec 基线。

---

## 核心亮点

### 1. 会话标注与收藏能力

**OpenSpec Change**: `add-ts-conversation-annotation`

为对话会话补齐可运营的反馈闭环。

- 新增点赞、点踩与收藏标注能力 (`feat(conversation-annotation): add thumbs up/down and favorite annotation capability`)
- 新增侧边栏收藏列表，并修复会话标题展示 (`feat(conversation-annotation): add sidebar favorites list with session title fix`)
- 完成前端状态、图标和路由收口 (`fix(conversation-annotation): enable annotation icons from neutral state`, `fix(agent-web): finalize conversation annotation rollout`)
- 覆盖前端 UI、API、supersede cleanup 等测试路径

### 2. Suggested Questions 推荐交互

**OpenSpec Change**: `add-ts-question-recommend`

让 Agent 在回合末提供更自然的下一步引导。

- 新增建议问题能力与服务编排 (`feat(question-recommend): add suggested questions capability`)
- 修正两路径 skill resolution 与 route scope 校验 (`fix(question-recommend): sync spec to two-path skill resolution and correct route scope validation`)
- 为 TurnBlock 触发条件、动作区布局和前端展示补充测试

### 3. `http_request` 工具与流式响应投影

**OpenSpec Change**: `add-ts-http-request-tool`, `add-ts-http-request-streaming-response`

新增可治理的远程服务调用能力，并把响应安全带回主路径。

- 新增 `http_request` 工具与 `RemoteServiceCallGateway` 契约 (`feat(capability): add http_request tool and RemoteServiceCallGateway contract`)
- 支持 HTTP 请求流式响应投影 (`feat(http-request): support streaming response projection`)
- 增强工具输入预览，按工具类型输出键控预览信息 (`feat(agent-core): enrich toolInputPreview with tool-specific keyed previews`)
- 覆盖启动装配状态、观测脱敏、流式投影与工具框架测试

### 4. 同轮并行工具调用与 Tool Loop 稳定性

**OpenSpec Change**: `support-parallel-tool-calls`

提升复杂任务的多工具执行效率，同时避免重复失败拖垮主路径。

- 支持同一轮并行工具调用 (`feat(agent-core): support same-round parallel tool calls`)
- 改进并行工具诊断 (`fix(agent-core): improve parallel tool diagnostics`)
- 阻止重复 capability 失败循环 (`fix(agent-core): stop repeated capability failures`)
- 新增内核与 package 级并行工具测试覆盖

### 5. Lifecycle Hook、配置校验与运行时观测

**OpenSpec Change**: `complete-ts-lifecycle-hook-capabilities`, `add-ts-gateway-configuration`, `configurable-raw-toolinput-logging`

让运行时扩展点更完整、配置更安全、观测更可控。

- 完成生命周期 Hook 能力 (`feat(lifecycle-hooks): complete lifecycle hook capabilities`)
- 新增 gateway configuration 启动校验与默认本地回退 (`feat(agent-app): add gateway-configuration startup validation with default local fallback`)
- 新增可配置的原始 `toolInput` 日志，默认仍做安全脱敏 (`feat(agent-core): add configurable raw toolInput logging with sanitized default`)
- 修复 aborted model run 后的 stream state 收口 (`fix(runtime): settle stream state after aborted model run`)

### 6. Context、RAG 与 Memory 加固

围绕上下文窗口治理、检索隔离和长期记忆稳定性做持续补强。

- 自动压缩触发阈值调整为 effective window 减 13k (`feat(context-engine): trigger auto-compact at effective-window minus 13k threshold`)
- RAG 检索支持通过 gateway selection 路由，并补齐默认索引与原因契约 (`feat(rag): wire retrieval through gateway selection`, `feat(rag): configure default retrieval indexes`, `feat(rag): extend retrieval reason contract`)
- 本地检索按 workspace 作用域隔离 (`fix(rag): scope local retrieval by workspace`)
- 修复长期记忆内容处理、语义 note 提取保留、提取置信度上限与 dreaming 元数据过滤 (`fix(memory): harden long-term memory content handling`, `fix(memory): preserve LLM extraction for semantic notes`, `fix(memory): cap LLM extraction confidence`, `fix(agent-memory): filter dreaming runtime metadata`)

### 7. 测试门禁与文档体系升级

本版本同时显著扩充了验证资产和开发示例。

- 新增和重组 TESTClaw 功能、兼容性、观测、安全、性能、可靠性测试套件
- 新增多篇 `docs/develop-case` 与生命周期 Hook 开发文档
- 大量 OpenSpec change 归档并同步长期基线设计文档
- 修复主干上既有 build、test、architecture gate 失败，提升回归稳定性

---

## 问题修复

### Web 与交互
- 修复技能选择栏芯片溢出测量和“全部”按钮布局 (`fix(skill-selector): rework chip overflow measurement and 全部 button layout`)
- 修复会话标注图标中性态和最终前端收口问题

### Runtime 与 Core
- 修复 aborted model run 后流状态无法正确收敛的问题
- 修复重复 capability 失败造成的循环风险
- 修复严格 TS 标志下的 supersede-cleanup 测试问题

### RAG 与 Memory
- 修复本地检索未按 workspace 隔离的问题
- 修复默认索引契约与长记忆内容处理问题
- 修复提取置信度、语义 note 保留与 runtime metadata 过滤问题

### 安全与诊断
- 清洗 skillhub manifest diagnostics，避免不安全诊断暴露 (`fix(agent-capability): sanitize skillhub manifest diagnostics`)
- 技能校验日志补充具体失败信息，提升可诊断性

---

## 工程改进

### 重构与架构
- 隔离 RAG retrieval composition binding (`refactor(app): isolate rag retrieval composition binding`)
- 移除旧 architecture-test-gate `spec.ts` 子目录结构 (`refactor: remove old architecture-test-gate spec.ts subdirs`)
- 对 `agent-core`、`agent-runtime`、`agent-contracts`、`agent-channel-web` 等主路径契约做一致性收敛

### 测试与验证
- 增加 `http_request` 能力测试、并行工具测试、会话标注测试、建议问题测试、网关配置契约测试
- 新增大批 TESTClaw 聚合套件，覆盖功能、兼容性、可靠性、安全、性能和 UI 交互
- Smoke 测试新增 opt-in 控制，避免默认执行真实模型提供商路径

### 文档
- 新增自定义 Agent、Skill、SubAgent、Lifecycle Hook 等开发案例
- 同步 OpenSpec 架构设计文档，包括 `remote-service-call` 等新增基线

---

## 统计

| 指标 | 数值 |
|------|------|
| Commits | 100 (58 non-merge) |
| 文件变更 | 602 |
| 代码新增 | +33,151 |
| 代码删除 | -10,388 |
| 主要功能主题 | 7 大类 |
| 重点修复方向 | 4 类 |
| 主要测试扩充 | TESTClaw + kernel + contract + frontend |

---

## 升级指南

### 从 v1.7 升级

1. **Web 交互层**:
   - 如果前端依赖会话列表或 TurnBlock 渲染，请验证标注按钮、收藏入口和 suggested questions 展示
   - 如有自定义会话侧边栏，请确认收藏列表与标题投影兼容

2. **工具与远程调用**:
   - 新增 `http_request` 工具后，需检查能力清单、网关绑定和远程调用策略是否已按部署配置完成
   - 流式响应现在会投影到前端，确认 channel/web 的消费端对增量事件兼容

3. **并行工具调用**:
   - Tool loop 现支持同轮并行执行，若有依赖串行副作用顺序的自定义工具，请验证是否需要显式约束
   - 检查日志与诊断侧是否已适配新的并行执行可观测信息

4. **Lifecycle Hook 与配置**:
   - 使用 Hook 的部署需验证生命周期阶段定义、错误处理和终态行为
   - 启动阶段会更严格校验 gateway configuration，错误配置会更早暴露

5. **RAG / Memory / Context**:
   - 本地检索按 workspace 隔离，若历史环境混用索引或工作区，请验证检索结果范围
   - 自动压缩阈值已调整，建议复核长上下文任务的压缩频率与摘要质量

### 兼容性

- **Breaking Changes**: 未发现强制迁移级别的公开 breaking change
- **Behavioral Changes**:
  - 同轮工具调用可能并行执行
  - `http_request` 工具与流式投影引入新的运行时事件形态
  - 会话标注与建议问题会改变默认 Web 交互体验
- **Minimum Node.js**: LTS 要求不变

---

## 已知限制

1. **`http_request` 治理深度**: 当前已建立工具与 gateway 契约，细粒度策略编排、更多协议适配和更丰富的远程诊断仍可继续增强
2. **并行工具调度**: 同轮并行能力已可用，但更复杂的依赖拓扑、优先级和资源配额治理仍有演进空间
3. **Suggested Questions**: 当前以基础推荐与展示为主，个性化推荐质量和跨轮学习策略可继续提升
4. **会话标注运营**: 已具备标注与收藏事实能力，但更完整的统计分析和运营闭环仍待后续版本建设
5. **测试资产治理**: 测试门禁已显著增强，但长期仍需持续控制执行时长和维护成本

---

**下一步**: v1.9 可优先聚焦远程调用治理深化、并行编排策略、记忆与检索质量提升，以及基于会话反馈的运营闭环能力。
