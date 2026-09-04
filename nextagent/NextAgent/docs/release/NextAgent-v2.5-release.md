# NextAgent v2.5 Release Notes

**发布日期**: 2026-08-14
**版本范围**: v2.4 → v2.5
**变更统计**: 1255 commits (783 non-merge), 3911 文件变更 (+421,704 / -170,405), 覆盖 Web/PIU 交互与过程恢复、Task Channel 与 IPv6 接入、Workflow/Cron、Capability 路由与 Skill、Memory/RAG、Sandbox 安全与运行诊断、评测和发布治理

## 摘要

v2.5 是从 v2.4 到 v2.5 标签的累计发布。本版本重点把过程消息、结构化 Capability 结果、外部任务接口、复杂 Workflow、长期记忆和本地执行边界收敛到更稳定、可恢复、可诊断的产品路径，并通过 HarnessBench、TestClaw、多宿主前端和 release package 验证持续提高交付可信度。主要交付：

- **Web、PIU 与过程展示稳定化** - 修复 live/history 切换、结构化增量聚合、刷新恢复、PIU 历史重放和结果卡片噪声，保持三种宿主的一致交互。
- **Task Channel 与网络接入升级** - 流式和异步任务接口分离，补齐批量查询、回调恢复、附件输入和 IPv6 入站/出站验证。
- **Workflow 与 Cron 执行收敛** - 强化取消回退、事件历史、节点输出、执行时间线、并发容量和启动时延诊断。
- **Capability 路由、Skill 与 Agent 扩展** - 增加官方模型驱动 router plugin，完善显式路由优先级、Skill/Workflow 候选治理、业务显示名和内置工具指导。
- **Memory、RAG 与系统提醒** - 长期记忆管理、导入导出、召回注入、RAG 展示和知识问答进一步统一到可信上下文与安全呈现边界。
- **Sandbox、安全与可观测性硬化** - 默认启用 executable policy，引入受控 API 访问约束，补齐北向结果 Hook、运行诊断、IPv6 和 Web 安全边界。
- **评测、OpenSpec 与发布治理** - 扩充 HarnessBench/TestClaw 证据，完善架构目录评审、规格归档、开发文档和本地运行包 qualification。

---

## 核心亮点

### 1. Web、PIU、结构化结果与过程恢复

**OpenSpec Change**: `fix-live-process-message-projection`, `persist-structured-delta-aggregation`, `refine-capability-result-card-presentation`, `refine-agent-web-expand-panel-dsl-lifecycle`

过程详情和结构化 Capability 输出在实时执行、刷新、重连与历史重放之间保持更稳定的一致性，减少完成瞬间内容清空、重复或被通用占位文案覆盖的问题。

- live 订阅已交付的非空过程正文可在完成事件到达时继续复用；普通 Tool 正文仍由 `SessionMessage` 唯一持久化，避免 Event 与 Message 双 owner。
- PIU、STREAM_DSL、TEXT、DSL、ACTION、OPERATOR 和 FILE structured delta 按类型聚合并持久化，实时订阅保持即时呈现，历史恢复直接消费聚合结果。
- Bash、Python、Rag 的既有安全详情默认可展开查看；无业务价值的重复成功摘要和浏览器猜测摘要不再强制展示。
- 修复 PIU answer UUID 聚合、历史聊天 replay、滚动位置、iframe pointer capture、外层 operator 可见性、主题切换和知识弹窗溢出。
- 修复 thinking 去重、process detail 生命周期、模型步骤 live content、完成态 history replay 和 structured delta 重复投影。
- 收藏、投诉、分享、会话状态、日期筛选、AskUserQuestion 和 Cron dashboard 的交互与校验持续收敛。

### 2. Task Channel、外部系统接入与 IPv6 可用性

**OpenSpec Change**: `add-ts-task-channel`, `support-ts-ipv6-availability`, `add-ts-remote-file-upload`

面向网管、告警和编排系统的 Task Channel 形成更明确的流式/异步交付模型，并补齐重启、回调丢失和 IPv6 部署下的恢复与验证路径。

- `POST /api/v1/stream-task` 直接返回 SSE；`POST /api/v1/async-tasks` 以批量 JSON 接收任务并通过 callback 交付结果。
- Create、Edit、Retry 按流式和异步模式拆分；Cancel、Query、Answer 使用统一任务路由，Query 支持最多 20 个任务批量对账。
- 外部 `taskId` 明确对应 runtime `requestId`，`sessionId` 保持独立；内部 `runId`、`contextId` 等诊断坐标不再对外暴露。
- 支持结构化 PendingInput、edit multipart 和 JSON inline fileContent，并复用附件可信校验路径。
- callback allowlist、UDS/HTTPS、自签名证书受控配置和最终一致性查询共同加强外部交付恢复能力。
- `NEXTAGENT_CHANNEL_HOST` / `NEXTAGENT_CHANNEL_PORT` 支持受信启动覆盖；IPv6 literal、loopback 和支持平台上的 unspecified 双栈行为均增加真实 socket 证据。
- 默认仍绑定 `127.0.0.1:3000`，本地配置认证的 localhost-only 安全边界未放宽。

### 3. Workflow、Recipe、Cron 与运行生命周期

**OpenSpec Change**: `refine-ts-workflow-cancel-policy`, `add-ts-workflow-event-history`, `add-workflow-start-latency-logging`, `fix-cron-active-task-capacity-enforcement`

Workflow 与周期任务从“节点可以执行”继续推进到取消补偿、事件恢复、容量限制和可诊断运行，降低复杂电信运维流程中的状态漂移。

- Workflow `controlPolicy` 收敛为外部 cancel 回退：取消后可在独立信号和 `cancelTimeout` 下执行补偿路径，再提交 CANCELED 终态。
- 节点失败不再误入 cancel policy，由 retry、exception 或 FAILED 终态承担；回退路径不写正向 checkpoint。
- Workflow event history、live/history 一致性、pending input timeout/resume、子 Recipe output mapping 和单节点 loop 重复得到补强。
- LLM、Python、knowledge、RAG、API choice、batch、output parser 和结构化节点的输入输出及展示持续修复。
- Cron dashboard 增加任务表单、执行筛选和时间线，并修复 active task capacity、时间范围、点击外部关闭和友好错误提示。
- 新增 Workflow start latency 诊断，区分加载、装配、输入解析和首节点启动阶段，便于定位调度前延迟。
- Workflow 节点、Recipe DSL 与执行历史均补充黑盒、契约和前端回归证据。

### 4. Capability 路由、Skill 与插件扩展

**OpenSpec Change**: `add-agent-router-plugin`, `add-routing-explicit-priority`, `provide-provider-backed-capability-display-names`, `refine-builtin-tool-guidance`

Agent 可在保持显式路由优先和可信 assembly 边界的前提下，使用官方 router plugin 对已绑定 Skill/Workflow 做受治理的模型终选。

- 新增 `agent-router-plugin`，候选仅来自 accepted Agent assembly 中已启用、显式绑定且对当前 Agent Scope / Owner Scope 可用的 Skill 或 Workflow。
- router 支持 `SKILL`、`WORKFLOW`、`SKILL_OR_WORKFLOW`，可选用当前 Agent 已绑定的 Rag Tool 预筛，再由当前 Agent 初始模型有界终选。
- `$skill:`、`$workflow:`、trusted target 和显式 routing mode 的优先级保持在 policy 之前；非法输出或越界选择安全拒绝。
- plugin API 提升到 1.2，通过 closed runtime services 提供所需能力，不暴露 raw Agent definition、credential、gateway implementation 或宿主私有对象。
- Capability 技术名与 provider-backed 业务显示名分离，Skill 参数治理避免把普通业务字段误判为可信策略覆盖。
- 改进 Bash、Python、Read、Glob、Grep、ApiCall、AskUserQuestion 和 ToolSearch 的模型指导，减少重复发现、错误工作目录和不必要调用。
- Skill relative execution path、资源 projection、定向 payload、manifest extension array 与 URL/path 泄漏等边界得到修复。

### 5. Memory、RAG、知识问答与系统提醒

**OpenSpec Change**: `add-ts-long-memory-manage`, `add-ts-system-reminder-memory-v1`, `enhance-ts-workflow-knowledge-qa`

长期记忆从管理与召回能力进一步收敛到统一的模型可见上下文通道，并与 RAG、收藏和知识问答保持清晰的来源与呈现边界。

- 长期记忆管理支持搜索、分页、导入导出、敏感字段展示和 trusted host identity 隔离。
- `relevant_memories` 通过统一 `<system-reminder>` 管道进入模型输入，不再与真实 USER 输入混为同一归因。
- 无系统提醒时 rendered model input 保持零影响；提醒内容由统一包装、折叠和 render 管道治理。
- 修复首轮用户画像注入、远端 stale record 过滤、共享记忆非 owner 取消发布、复制状态和 memory operation log。
- RAG 结果按召回数量摘要、来源和内容预览详情分层展示，减少摘要与详情重复。
- Workflow knowledge QA、RAG tool 参数和 batch input template 持续完善，并保留 Agent Scope / Owner Scope 查询边界。
- 收藏列表 N+1、计数上限、主内容视图和跨会话定位得到优化。

### 6. Sandbox、安全边界、Hook 与运行诊断

**OpenSpec Change**: `harden-default-sandbox-executable-policy`, `add-local-sandbox-controlled-api-access`, `add-northbound-output-normalization-hook`, `refine-ts-runtime-trace-timeline-correlation`

本地执行、北向输出和诊断面按默认最小授权继续收紧，同时保留电信运维定位所需的受控原始信息。

- 默认系统配置启用 executable allow/deny policy，默认执行入口收敛为 `clipc`、`curl` 和 `python`；未授权 executable 与 shell interpretation 在进程启动前失败。
- local restricted sandbox 可由受信配置声明 `allowedApis`；curl 和 Python 中可识别的 HTTP(S) 目标必须命中允许前缀，固定 Unix Socket 也受同一目标策略约束。
- 默认 executable 集合移除 `python3` 别名，避免同一 Python 能力出现平行入口；自定义部署仍可通过受信配置声明自己的名单。
- 北向 output normalization Hook 仅对命中特定检查字符串的 Bash 调用返回结构化结果，其他 Capability 或非目标调用保持 `SKIP`。
- operational diagnostics 补齐 Tool、Model、原始异常、duration、first-content latency 和 usage 关联，同时限制 managed log 轮转容量。
- Web/SSE/WebSocket 安全响应头、frame 限制、CORS、validation message、路径泄漏和 secret/token 脱敏持续加固。
- Guardrail blocked round、question activity、stream residue 和 terminal result summary 的投影语义得到修复。

### 7. HarnessBench、TestClaw、OpenSpec 与发布工程

**OpenSpec Change**: `add-ts-system-integration-validation-gate`, `refine-harnessbench-score-publication`, `harden-harnessbench-execution-reliability`

版本 qualification 从单一源码测试继续扩展到独立系统旅程、模型评测、架构门禁和可复核发布产物。

- TestClaw 系统集成门禁通过候选运行包公共入口执行，不允许导入源码私有路径、testing export、mock target 或复用源码测试报告。
- HarnessBench 加强多轮 session、timeout、结果收集、模型输出预算、评分分母和失败诊断，提升复杂任务评测稳定性。
- 完整 scoring run 即使 rubric 覆盖存在缺口也发布 `frameworkEffectScore`，同时以 `evaluationValidity=degraded` 和 `coverageGap` 明示证据质量。
- 增加 DeepSeek/Harness 综合对比报告与评测材料，但报告结论不替代代码、OpenSpec 和可重复门禁。
- 新增源码目录架构评审约束，明确 owner、职责、生命周期以及构建、打包和运行时影响后方可纳入版本控制。
- 大批 completed change 完成 stable spec、Feature/Function、架构和 spec-to-design map 同步归档。
- release package 恢复默认 Agent staging、前端 artifact 和解包 self-check，并持续修复版本解析与本地诊断默认配置。

---

## 问题修复

### Web、会话与结构化展示

- 修复 live process 完成时正文清空、thinking 重复、terminal content 重复和模型步骤内容丢失。
- 修复 PIU 历史 replay、滚动、主题切换、知识弹窗、operator、iframe pointer 和 answer UUID 聚合。
- 修复 AskUserQuestion 自由文本、输入长度、分享 URL、历史抑制和答案分类。
- 修复收藏 N+1、会话筛选、日期面板、附件过期阻止发送、Markdown link/image 安全与换行渲染。

### Runtime、Workflow 与 Cron

- 修复 cancel 跨 request identity、terminal stuck accepted、active run terminal commit 和 guard-blocked round persistence。
- 修复 Workflow loop、sub-recipe output、batch template、pending input resume、knowledge/RAG 节点与 output parser。
- 修复 Cron active capacity、执行时间线、日期过滤、task router PIU host 和 server timestamp 一致性。
- 修复 inferred model output truncation、reasoning-only/blank reasoning、streamed tool call 和 model-gateway eligibility 路径。

### Capability、Skill、Memory 与附件

- 修复定向 Skill payload 丢失、Skill body 在 AskUserQuestion 后丢失、manifest array 校验和资源路径泄漏。
- 修复 ApiCall/CLIP/Bash structured delta、参数透传、required input 和 non-agentic 调用链。
- 修复 memory import/export、安全本地化、远端 identity/stale record、首轮画像和共享记忆 owner 校验。
- 修复附件 projected input units、HOFS 全附件映射、远程文件上传和 workspace path identity。

### Security、Observability 与工程门禁

- 修复 WebSocket frame、HTTP security headers、CORS、server default bind、IPv6 HTTPS callback 和 API 字段级错误消息。
- 修复 log 文件删除后恢复、memory/ApiCall 多余日志、绝对路径诊断和 trace/timeline 关联。
- 修复 full validation scope、release package version lookup、前端多宿主构建与 OpenSpec 归档一致性。

---

## 工程改进

### 架构与重构

- `agent-runtime`、`agent-channel-web` 与 `SessionMessage` 的 request lifecycle、stream projection 和正文 owner 边界进一步明确。
- Workflow cancel、failure、exception、checkpoint 与 history 采用更一致的生命周期模型。
- router plugin、PromptTemplate resolver、Capability display name 和 Skill projection 使用公共 contract 协作，不暴露 composition 私有对象。
- System Reminder 由 Context Engine 统一包装与渲染，Memory 只提供受治理的召回内容。

### 测试与验证

- 增加 SSE/WebSocket 等价性、刷新/重连、PIU replay、AskUserQuestion、收藏、Cron 和三宿主前端回归。
- 增加 Task Channel、IPv6 socket、callback、remote upload、sandbox allowedApis 和 executable negative cases。
- 增加 Workflow cancel rollback、event history、Recipe 节点、RAG/Memory、router plugin 和 model adapter 契约测试。
- 增加 TestClaw 独立系统集成、HarnessBench 评分/覆盖率和 release package 解包自检。

### 文档与规格

- 更新架构、开发者指南、OpenAPI、Task Channel、Workflow/Recipe、UCD、feature/function catalog 和测试特性文档。
- 归档并同步 Workflow、Memory、Web、Task Channel、Model、Capability、Observability 和发布治理相关 OpenSpec change。
- 新增 HarnessBench 评测、DeepSeek 对比和外部技术交流材料，明确其证据边界。

---

## 统计

| 指标 | 数值 |
|------|------|
| Commits | 1255 (783 non-merge) |
| 文件变更 | 3911 |
| 代码新增 | +421,704 |
| 代码删除 | -170,405 |
| 主要功能主题 | 7 大类 |
| 重点修复方向 | Web/PIU/process / Task Channel/IPv6 / Workflow/Cron / Capability/Skill / Memory/RAG / Security/Diagnostics / Evaluation/Release |
| 主要测试扩充 | 多宿主 Web + Task Channel + IPv6 + Workflow lifecycle + Sandbox negative cases + TestClaw + HarnessBench + release self-check |

---

## 升级指南

### 从 v2.4 升级

1. **Task Channel 与外部系统接入方**:
   - 按流式 `stream-task` 与异步 `async-tasks` 两套路由重新验证 create/edit/retry；不要继续依赖已删除的独立 SSE 订阅或 Task WebSocket 端点。
   - 将外部任务坐标收敛到 `taskId=requestId` 与独立 `sessionId`，并适配扁平 Query 响应、`TASK_PENDING`、结构化 PendingInput 和 callback allowlist。

2. **Workflow / Recipe / Cron 使用方**:
   - 将旧四入口 `controlPolicy` 迁移到仅含 cancel branch 和 `cancelTimeout` 的新形态；节点失败应使用 retry / exception，而不是 cancel policy。
   - 回归 cancel rollback、pending input resume、event history、LLM/Python/RAG/output parser 节点和 Cron active capacity。

3. **Capability、Skill 与插件开发方**:
   - 若启用 router plugin，确认目标 Skill/Workflow 已显式绑定且对当前 Agent/Owner scope 可用，并配置 plugin API 1.2 所需 runtime services。
   - 回归 Skill args、relative execution path、manifest extension、provider display name 和 structured delta；不要依赖私有 composition 对象或未绑定候选。

4. **Memory、RAG 与模型上下文使用方**:
   - 验证 `<system-reminder>` 中 `relevant_memories` 的归因与 prompt 行为，不要再假设召回记忆是普通 USER 消息。
   - 回归导入导出、remote identity、first-turn characteristics、RAG detail 和 knowledge QA 输出。

5. **Sandbox 与运维使用方**:
   - 检查 `default-system.yaml` 的 executable policy；默认仅授权 `clipc`、`curl`、`python`，`python3` 不再是默认别名。
   - 为需要访问 HTTP(S) 的 curl/Python 场景配置受信 `allowedApis`，并确认该机制只是应用层显式目标控制，不等同于 OS 网络隔离。
   - 复核 local operational log 的访问控制、30 MiB/10 archives 保留策略和北向 Hook activation。

6. **agent-web / PIU 集成方**:
   - 将 PIU 启动 key 从 `AIAgentPIU` 更新为 `AICOPIU`；静态 artifact 名仍保留 `AIAgentPIU.js` / `AIAgentPIU.css`。
   - 回归 local、immersive、collaborative 三宿主的 live/history、PIU replay、结果卡片、AskUserQuestion、收藏与 Cron dashboard。

7. **部署与发布维护方**:
   - 如需 IPv6 监听，使用 `NEXTAGENT_CHANNEL_HOST` / `NEXTAGENT_CHANNEL_PORT` 并验证代理、证书、DNS 与主机双栈策略。
   - 使用 Node.js `22.22.0` 执行后端、前端多宿主和 release package qualification；根 `npm run build` 不能替代 frontend TypeScript/Vite build。

### 兼容性

- **Breaking Changes**:
  - Task Channel create/edit/retry 已拆分为流式和异步端点；旧独立 SSE subscription 与 Task WebSocket 端点不再注册。
  - Task Channel 外部标识、Query response、PendingInput 和事件投影已收敛；依赖内部 `runId` / `contextId` 或旧嵌套 response 的调用方必须迁移。
  - Workflow 旧 `ControlPolicy` 六值策略和 resume/modify/restart 入口已移除，cancel policy 改为 branch + timeout 形态。
  - PIU 启动名从 `AIAgentPIU` 改为 `AICOPIU`，collaborative active-session storage key 同步变化。
  - 默认 local sandbox 从未启用 executable 校验收敛为启用 allow/deny policy，未列入允许名单的宿主 executable 将在启动前被拒绝。
- **Behavioral Changes**:
  - QUESTION kind 的 AskUserQuestion 在所有子形态下都可接受选项外自由文本；其他 PendingInput kind 的安全校验不变。
  - 召回记忆通过 `<system-reminder>` 注入，不再作为普通用户输入归因。
  - Bash、Python、Rag 默认提供可展开安全详情；无价值成功摘要可能被省略。
  - 完整 HarnessBench scoring run 在 rubric 覆盖不完整时仍发布分数，并通过 degraded/coverageGap 标识证据缺口。
  - 默认监听仍是 `127.0.0.1:3000`；IPv6 监听需显式配置。
- **Minimum Node.js**: `22.22.0`。

---

## 已知限制

1. **Task Channel `reportEvents` 尚未执行过滤**: 参数已进入 public contract，但 v2.5 当前行为仍等同 `ALL`；不能依赖它减少事件类型。
2. **受控 API 不是强网络沙箱**: `allowedApis` 只检查 curl/Python 中可明确提取的 HTTP(S) 目标，不能阻止恶意 Python 在运行时动态构造或转发网络访问。
3. **System Reminder 首版范围有限**: v2.5 只交付 `relevant_memories` producer，不代表所有运行上下文都已迁入统一提醒管道。
4. **IPv6 不提供强制选路或自动回退策略**: 当前保证覆盖配置、URL 生成和关键真实 socket 路径，不新增全局 `ipFamily`、DNS family policy 或逐连接族诊断。
5. **router plugin 只选择显式绑定候选**: default-visible、搜索可发现但未绑定的 Skill/Workflow 不进入候选，RAG 预筛也不能扩大 assembly authority。
6. **degraded HarnessBench 分数仍有证据缺口**: 分数可用于趋势分析，但必须结合 `rubricCoverageRate` 和 `coverageGap` 解读，不能把 degraded 结果当作完整覆盖。

---

**下一步**: 后续版本应继续以真实电信运维任务验证 Task Channel 回调恢复、Workflow cancel 补偿、IPv6 部署和受控 Sandbox；同时扩展 System Reminder producer、提高 HarnessBench rubric 覆盖，并保持 OpenSpec、三宿主 Web、独立系统集成和 release package 证据同步。
