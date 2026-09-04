# NextAgent v2.3 Release Notes

**发布日期**: 2026-07-21
**版本范围**: v2.2 → v2.3
**变更统计**: 261 commits (178 non-merge), 990 文件变更 (+83,019 / -9,245), 覆盖远端附件上传、长期记忆管理、运行诊断与日志硬化、Workflow/RAG、agent-web/PIU、工作区文件策略、安全护栏和 UCD/roadmap 规格收敛

## 摘要

v2.3 是 v2.2 之后的产品化补强版本，重点把远端文件上传、长期记忆管理、运行异常诊断、Workflow 结构化过程、Web/PIU 交互、工作区文件策略和内容安全护栏压实到可验证主路径，同时补齐 UCD、roadmap、API 和开发者文档。主要交付：

- **附件与远端上传收敛** - 两阶段上传、BlobStoreGateway、staged file lifecycle、附件执行 IO、历史附件读取和电信采集文件类型进入统一 attachment runtime 路径。
- **长期记忆管理落地** - Web 管理页、V2 API、application port、可信 identity 传递和本地 gateway/SQLite 契约继续对齐。
- **运行诊断与日志硬化** - runtime failure diagnostics、empty terminal output 拒绝、safe diagnostic projection、HTTP access telemetry、OTLP/metric 证据和独立 `agent-log` 包补齐。
- **Workflow、RAG 与结构化过程增强** - parallel-gateway fork/join、workflow RAG 参数、知识检索输出绑定、sub-recipe DSL 修复、Bash/clipc structured delta 和 structured node lifecycle logging 纳入主线。
- **agent-web、PIU 与 UCD 规格补强** - PIU structured detail/knowledge rendering、emit payload 修复、附件卡片、session history 校验、ToolSearch 投影、协同/沉浸主题刷新和完整 UCD 规格文档补齐。
- **工作区文件策略与安全护栏** - workspace file extension policy、ToolSearch/文件路径投影、安全 guardrail gateway、输入/输出代理检测、拒答隔离和 stream blocked event 归档。
- **发布与工程治理** - backend typecheck 纳入 build gate，composition pipeline 统一，coding standards、roadmap 分层和 developer docs 持续同步。

---

## 核心亮点

### 1. 远端附件上传与执行 IO 归一化

**OpenSpec Change**: `add-ts-remote-file-upload`, `configure-workspace-file-extensions`

附件链路从前端选择到后端执行继续收敛到 attachment runtime 和 BlobStoreGateway，减少上传、读取和执行输入之间的平行路径。

- 新增远端文件上传两阶段 pipeline、安全校验和 `hofsPath` 注入。
- 前端 composer 支持选择即 staged upload，并按配置驱动上传校验和附件摘要保留。
- 文件上传统一通过 `BlobStoreGateway`，移除平行 `FileStoreGateway` 路径，并支持本地 filesystem blob 存储。
- 附件执行 IO 移入 `agent-attachment-runtime`，历史附件可跨 turn 读取，sandbox attachment read 覆盖补齐。
- 新增电信采集 media types、markdown-only upload default、extension-to-media-type 单一映射和附件文件卡片 UCD 样式。
- workspace file extension policy 进入 capability 侧，并补充 workspace file policy、failure projection 和 safe path 展示。

### 2. 长期记忆管理与可信身份链路

**OpenSpec Change**: `add-ts-long-memory-manage`, `add-ts-memory-application-contract`

长期记忆从底层 gateway 对齐继续推进到 Web 管理入口和 application contract，身份、路由和前端状态的 owner 边界更明确。

- 新增长期记忆管理页面，并通过 V2 API 接入 Web 管理流程。
- Web memory management 通过 application port 路由，避免前端或 channel 持有记忆业务语义。
- 修复 memory management port 的 trusted identity context 传递，并统一 header identity contract。
- PIU panel header 和 sidebar 增加 memory management entry points，随后按 local mode 隐藏不适用入口。
- 对 memory page 的错误处理、竞态和数据安全做前端硬化。
- `packages/agent-memory` 增加 long-term memory management contract 与测试，保持 gateway/SQLite 映射可回归。

### 3. Runtime 失败诊断、日志与可观测硬化

**OpenSpec Change**: `add-ts-runtime-operational-log-hardening`, `allow-runtime-execution-exception-diagnostics`, `add-otlp-trace-export`, `refine-ts-empty-terminal-output`

运行时诊断从“能记录”继续收敛到“只在受控边界记录可诊断信息”，同时保留安全错误投影和可重复测试证据。

- Runtime 支持 execution failure diagnostics，并保留执行失败的受控诊断信息。
- 空 terminal assistant output 被 runtime 拒绝，core 对 empty model output without tool calls 做防护。
- 日志链路集中 safe messages、error projection、Pino logger acquisition、Fastify lifecycle 和 access telemetry。
- operational diagnostics 做 sanitize、safe root-cause projection、token usage diagnostics 保留和 emergency process boundary 覆盖。
- OTLP trace diagnostics、trace chain spans、Langfuse observation type、metrics registry/history/exporter 和 trace projector fixture 继续补强。
- 新增独立 `agent-log` 包和 `createRuntimeLogger` convenience function，降低业务层重复 logger 适配。

### 4. Workflow 并行、RAG 与结构化过程

**OpenSpec Change**: `add-ts-workflow-parallel-gateway`, `add-ts-workflow-rag-index-params`, `fix-ts-workflow-knowledge-search-outputs`, `add-bash-clipc-structured-delta`, `refine-ts-workflow-recipe-v2-contracts`

Workflow 从过程可见性继续补齐并行执行、RAG 参数、知识检索输出和 DSL 兼容边界，降低复杂 recipe 在执行和回放中的不确定性。

- 实现 concurrent parallel-gateway fork/join，并提供 configurable failure strategy。
- workflow RAG retrieval 支持 per-index params、structured logging 和 platform wire-format mapping。
- knowledge-search outputs 收敛到两个 canonical bindings，避免输出名漂移。
- sub-recipe 节点修复 dynamic name、output binding、event forwarding、time units、string coercion 和 answer binding。
- Bash + `clipc` structured event envelope 可发出 `TOOL_STRUCTURED_DELTA`，runtime 在 `NODE_COMPLETED` 时持久化用于历史回放。
- Python stdout JSON 展开、runtimeContext 透传和 workflow structured node lifecycle logging 进入执行引擎。

### 5. agent-web、PIU 与前端交互稳定性

**OpenSpec Change**: `add-piu-structured-detail-and-knowledge-render`, `add-ts-piu-panel-minimize`, `refine-piu-message-emit-payload`, `refine-session-title-and-search-validation`, `establish-agent-web-existing-behavior-baseline`, `establish-agent-web-assistant-markdown-rendering`

Web 端继续围绕真实交互修复状态、投影、展示和多宿主一致性，并用 OpenSpec 与测试固化已交付行为。

- PIU 支持按 `messageType` 渲染 structured detail 和 `renderKnowledge`，并修复 `PiuMessage` emit payload 展开。
- 协同和沉浸 PIU theme state change 会触发页面刷新，PIU minimize-to-input-box 能力继续保留。
- session history title/search 校验补齐日期范围顺序和 future bound，并把 composer stop state 限定到当前 viewed session。
- ToolSearch 结果可投影到前端展示，capability projection 对 safe file paths 和 search results 做展示收敛。
- 附件 chip、附件文件卡、scrollbar、skill catalog i18n、date picker locale 和 skill chip tooltip 样式继续修复。
- restored frontend regression evidence 覆盖 MessageInput、TurnBlock、share route、PIU state、process details、request store 和 markdown rendering 等路径。

### 6. 内容安全护栏与流式阻断

**OpenSpec Change**: `add-ts-safety-guardrails`, `refine-stream-guard-blocked-event`

内容安全从规格和 gateway 进入主路径，重点明确输入/输出代理检测、拒答隔离和 stream blocked event 的可观察边界。

- 新增 safety guardrail gateway，支持输入与输出代理检测。
- 安全拒答与正常模型输出隔离，避免被 downstream 投影误解为普通 assistant 内容。
- 补齐 fail-closed 行为、架构边界、spec 对齐和 dependency-cruiser 约束。
- 修复 guardrail 契约文档、内存泄漏和 fallback 文案。
- 归档 `add-ts-safety-guardrails` 与 `refine-stream-guard-blocked-event`，说明规格事实已进入长期基线。

### 7. UCD、Roadmap、文档与发布工程治理

**OpenSpec Change**: `add-ts-dev-agent-workbench`, `refine-agent-app-composition-pipeline`

v2.3 同时把用户体验规格、能力路线图和 composition 工程边界补齐，便于后续版本按可审计目标推进。

- 新增完整 UCD 文档集，覆盖 persona、user journeys、dynamic behavior、UI layout、component specs、empty/loading/error states、copy、sample scenarios 和 integrator customization guide。
- 增加 conversation interface contract、feature map overview table 和 capability × extension impact matrix。
- roadmap 拆为 p0 local release、p1 business extension、p2 formal release、p3 workflow execution、p4 capability exit、p5 distributed parallel 等分层计划。
- `agent-app` composition pipeline 统一，相关 composition helpers、failure scope、deferred bindings 和 owner 边界继续整理。
- `npm run build` 引入 backend typecheck gate，减少 release 前仅复制 asset 的误判。
- README、developer quickstart/testing/deployment/best-practices/plugin docs、agent-web API list 和 coding standards 持续更新。

---

## 问题修复

### Attachment 与 Workspace Files
- 修复两阶段上传早期 mock-only 改动进入主路径的问题，移除 mock-only tempFiles/async entrypoint 等变化。
- 修复 media type vocabulary 漂移、历史附件读取、staged upload lifecycle、sandbox attachment read 和本地 blob 存储。
- 修复 workspace extension policy failure projection、safe file path 展示和 search result 裁剪。

### Memory 与 Web Management
- 修复 memory management identity header、trusted identity context、API URL prefix 和 memory page 错误/竞态/数据安全问题。
- 修复 local mode 下 memory management entry 不应展示的问题。

### Runtime、Core 与 Observability
- 修复空 terminal assistant output、empty model output without tool calls、execution failure diagnostics、non-error exception causes 和 token usage diagnostics。
- 修复 operational diagnostic output 泄漏风险，统一 HTTP access telemetry 和 runtime logger facade typing。
- 修复 SQLite read failure 诊断和 maintenance degradation 时 active writes 处理。

### Workflow 与 RAG
- 修复 sub-recipe dynamic name、output binding、event forwarding、nodeType/status literal、runtimeContext 传递和 Python stdout JSON 展开。
- 修复 workflow RAG gateway dependency/local adapter ownership、platform mapping、fail-fast behavior 和 knowledge-search 输出绑定。
- 修复 workflow preview JSON compatibility 和 process panel 结构化投影一致性。

### Web、PIU 与 Session
- 修复 PIU content emit payload 嵌套、session history 日期范围、session switch share selection、shared conversation refetch 和 async session creation 覆盖导航。
- 修复 attachment chip optimistic display、staged attachment summaries、skill catalog description i18n、date picker month locale 和 dark-mode scrollbar。
- 修复 transient reconnect status 防抖和 no active session / background task stream 状态处理。

### Guardrail、安全与发布
- 修复 guardrail fail-closed、fallback 文案、契约文档和架构约束。
- 修复 release package smoke gate、bootstrap upload defaults 和 pre-existing build errors in interaction/remote-gateway tests。
- 修复 skill script executable mode 和 CLIP resolve lazy describe in list disclosure mode。

---

## 工程改进

### 架构与重构
- `agent-app` composition pipeline 统一，composition failure scope、deferred bindings、lifecycle、gateway、workflow 和 memory composition 边界更清晰。
- attachment runtime 统一 staged upload、execution IO、media type mapping 和 cleanup job。
- logging/observability 移除重复 logger exports、session logger adapter 和 fallback reason code duplication。
- Workflow RAG gateway dependency 与 local adapter ownership 收敛，避免跨 owner 装配漂移。

### 测试与验证
- 增加 workspace file extension policy、dev-workbench installed browser smoke、sandbox attachment reads、long-term memory management、runtime logging、observability、workflow RAG 和 guardrail 覆盖。
- 前端恢复并扩展 MessageInput、TurnBlock、PIU、share route、request store、process details、markdown rendering、SkillSelector 和 attachment file card regression evidence。
- `npm run build` 强化 backend typecheck gate，release smoke/package gate 与 bootstrap upload defaults 对齐。

### 文档
- 新增 v2.2.0.2 release notes，并在本版本补齐 v2.3 release notes。
- 新增或刷新用户配置指导、workflow usage guide、developer docs、agent-web API list、coding standards、UCD 文档集和 roadmap 分层文档。
- OpenSpec 归档或同步 context-monitor、remote upload、runtime operational log hardening、safety guardrails、stream guard blocked event、conversation UI state 和 workflow/RAG 相关变更。

---

## 统计

| 指标 | 数值 |
|------|------|
| Commits | 261 (178 non-merge) |
| 文件变更 | 990 |
| 代码新增 | +83,019 |
| 代码删除 | -9,245 |
| 主要功能主题 | 7 大类 |
| 重点修复方向 | Attachment / Memory / Observability / Workflow RAG / agent-web PIU / Workspace Files / Guardrail |
| 主要测试扩充 | Workspace extension policy + frontend regression + sandbox attachment reads + long-term memory management + observability/runtime logging + workflow RAG + guardrail gates |

---

## 升级指南

### 从 v2.2 升级

1. **附件、上传和 workspace file capability 使用方**:
   - 重新验证两阶段上传、staged upload、BlobStoreGateway、本地 filesystem blob、历史附件读取和 sandbox attachment read。
   - 检查 workspace file extension policy 是否覆盖当前 Agent package 配置，并确认非法扩展失败会被正确投影到前端。

2. **长期记忆和 Web 管理使用方**:
   - 按 V2 memory API、application port 和 trusted identity context 回归管理页。
   - 验证 local mode、sidebar/PIU entry point 和 memory page 错误状态是否符合当前部署能力。

3. **Workflow / RAG / Recipe 使用方**:
   - 对 parallel-gateway fork/join、failure strategy、workflow RAG per-index params 和 knowledge-search canonical bindings 做 recipe 级回归。
   - 对 sub-recipe、Bash/clipc structured delta、Python stdout JSON 和 `TOOL_STRUCTURED_DELTA` 历史回放做端到端检查。

4. **agent-web / PIU / 前端宿主使用方**:
   - 验证 PIU structured detail、renderKnowledge、emit payload、theme refresh、session history search 和 attachment card 展示。
   - 多宿主场景需重新跑 local、immersive、collaborative 下的共享 conversation state、share route 和 process panel 回归。

5. **Observability / Runtime / 运维诊断使用方**:
   - 检查 runtime execution failure diagnostics、empty terminal output、HTTP access telemetry、OTLP trace/metrics 和 safe diagnostic output。
   - 确认部署侧日志、metric、trace、audit 不消费未脱敏 prompt、模型输出、附件内容或高基数字段。

6. **安全护栏和发布门禁使用方**:
   - 验证 guardrail gateway、输入/输出代理检测、拒答隔离、stream blocked event 和 fail-closed 行为。
   - release 前确认 backend typecheck、release smoke gate、frontend regression gate 和 OpenSpec strict validation 按影响范围执行。

### 兼容性

- **Breaking Changes**: 未从本区间证据中识别到强制迁移级别的公开 breaking change；但上传 gateway、workspace file extension policy、memory management API、PIU emit payload、guardrail blocked stream 和 workflow knowledge-search 输出存在行为收敛，升级时应按上面的校验点回归。
- **Behavioral Changes**:
  - 附件上传、staged file、历史读取和执行 IO 统一由 attachment runtime / BlobStoreGateway 主路径承载。
  - workspace file tools 会按配置的扩展策略 fail closed，并把失败投影到前端。
  - 长期记忆 Web 管理走 application port 和 trusted identity context。
  - runtime 会拒绝空 terminal assistant output，并在受控边界保留执行异常诊断。
  - Workflow parallel-gateway、RAG retrieval params 和 knowledge-search output bindings 按当前规格收敛。
  - PIU emit payload 使用展开后的 content data，structured detail/knowledge rendering 进入前端渲染路径。
  - guardrail 检测会把安全拒答与普通 assistant output 隔离，并投影 stream blocked event。
- **Minimum Node.js**: 仍遵循仓库 Node.js LTS / `>=22.0.0` 要求。

---

## 已知限制

1. **远端上传仍需要部署侧对象存储治理**: 代码侧已收敛 staged upload、BlobStoreGateway 和 sandbox read，但对象存储认证、容量、生命周期、审计和跨地域策略仍由部署环境负责。
2. **长期记忆管理是受控管理入口，不是完整记忆运营平台**: 当前证据覆盖 Web 管理、application port 和 identity chain，记忆抽取、治理、批量运营和租户级策略仍需按后续规格验证。
3. **Workflow 并行与 RAG 仍依赖 recipe 设计质量**: parallel-gateway、RAG params 和 canonical bindings 已进入主路径，但复杂网络运维 recipe 的容量、失败策略和诊断口径仍需按场景压测。
4. **运行诊断必须保持受控边界**: execution exception diagnostics 仅适用于受控本地 runtime diagnostic，不能外溢到 Web API、stream、timeline、audit、metric 或 trace 的不可信输出。
5. **Guardrail 不是完整内容安全治理系统**: 本版本提供 gateway、检测和拒答隔离主路径；策略配置、评估样本、误判处置和组织级审计仍需部署侧治理。
6. **UCD 与 roadmap 文档不等同于已全部实现**: v2.3 补齐了体验规格和分层计划，实际能力仍以对应 OpenSpec、代码和验证证据为准。

---

**下一步**: 后续版本可继续聚焦远端上传部署治理、长期记忆策略化运营、Workflow/RAG 复杂场景压测、guardrail 策略评估、前端多宿主回归自动化，以及 release qualification 证据的持续沉淀。
