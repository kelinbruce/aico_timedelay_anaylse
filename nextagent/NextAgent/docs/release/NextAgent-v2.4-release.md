# NextAgent v2.4 Release Notes

**发布日期**: 2026-07-30
**版本范围**: v2.3 → HEAD
**变更统计**: 606 commits (390 non-merge), 1393 文件变更 (+131,714 / -15,536), 覆盖会话过程历史与交互稳定性、Task Channel 外部接口、Workflow/RAG 执行、长期记忆与问题推荐、Skill/Sandbox 资源治理、安全边界、诊断和发布工程

## 摘要

v2.4 是从 v2.3 到当前主线代码的累计发布文档。本区间重点把长会话过程历史、外部任务接入、Workflow 复杂执行、长期记忆、Skill 资源访问和 Web 交互进一步收敛到可恢复、可诊断、可验证的产品路径，同时强化流式资源限制、输入校验、分享权限、回调目标和 Owner Scope 等安全边界。主要交付：

- **会话过程历史与 agent-web 稳定化** - thinking/process history 持久化与 hydration、live run identity、process activity handoff、retry/edit、分享、投诉反馈和多宿主交互持续修复。
- **Task Channel 与外部机器接口** - HTTP/JSON task interface、SSE streaming、统一事件、跨 session 查询、UDS/HTTPS callback 和 allowlist 安全约束落地。
- **Workflow、RAG 与模型执行收敛** - parallel gateway、worker pool、取消回滚、异常变量、知识节点、output parser、Recipe DSL、LLM 节点和流式 tool-call 恢复持续完善。
- **长期记忆、收藏与问题推荐** - 长期记忆管理、写入准入、来源分类、首轮用户画像加载、收藏上限和建议问题生成进入统一产品路径。
- **Skill、Sandbox 与大内容资源治理** - Skill Python 输出目录、跨轮资源重新授权、execution-scope projection authority、metadata extension、文件下载和超大工具结果外置得到补强。
- **安全、容量与诊断硬化** - channel 输入校验、SSE/WS 资源上限、Guardrail 投影、路径脱敏、分享权限 hash、Owner Scope 和 operational diagnostics 继续加固。
- **OpenSpec、架构与发布工程** - Function/spec 追踪、架构指南、API/UCD/开发者文档、构建质量基线和 release package 默认能力同步。

---

## 核心亮点

### 1. 会话过程历史、流式恢复与 Web 交互

**OpenSpec Change**: `persist-ts-refresh-stable-completed-turns`, `fix-thinking-history-handoff-duplication`, `add-agent-web-process-activity-affordances`, `fix-agent-web-live-run-identity-recovery`, `harden-agent-web-request-acceptance-control`

长会话的思考过程、执行步骤和已完成回答现在以更稳定的方式持久化、恢复和投影，减少刷新、切换会话、retry/edit 与 live stream 交错时的状态漂移。

- 持久化 thinking process history，并对 started history request、bounded hydration、取消和 refresh 后 completed turn 稳定性建立明确 lifecycle。
- 修复 thinking history handoff 重复、placeholder 提前消失、FAILED 内部状态外露、history/live envelope 竞争和 no-active-session stream 状态。
- 新增 process activity affordances，把过程详情按阶段交接到 assistant output，并保留 run-scoped disclosure。
- 修复 retry/edit 的 identity、input unlock、guard-blocked turn 原位替换和 fork-inherited latest turn 上不应开放操作的问题。
- 增加投诉反馈与投诉历史，并完善 BI report、分享选择、收藏、长文本附件、会话搜索和多宿主主题/语言切换体验。
- conversation/session 查询上限和日期范围约束统一到 Web API 与前端交互提示，降低超量查询和不一致失败。

### 2. Task Channel、外部接口与回调安全

**OpenSpec Change**: `add-ts-task-channel`, `add-web-channel-ir-surface`, `harden-channel-input-security-boundaries`

Task Channel 从基础任务接口扩展为面向外部系统的持续事件接口，同时补齐任务查询、回调交付和不可信输入边界。

- 刷新外部 Task Channel API，支持 SSE streaming、统一事件模型和精简后的请求/响应契约。
- 增加跨 session task query，并按 timeline anchor 关联 task event 与运行事实。
- 支持 UDS callback、REMOTE relative URL 校验、自签名证书配置和回调 origin allowlist。
- 当前主线要求 callback target 命中 allowlist，避免任务完成回调被利用访问未授权目标。
- 对最终 API URL、`isStreamRecord` 参数、terminal event 长连接语义、E2E 和开发者文档进行一致性修复。
- Web Channel IR surface、operation log identity 和 channel 输入校验共同补齐机器接口的身份、诊断和边界验证。

### 3. Workflow、RAG 与模型调用稳定性

**OpenSpec Change**: `add-ts-workflow-parallel-gateway`, `refine-ts-workflow-cancel-policy`, `refine-ts-workflow-exception-failure-contract`, `add-ts-workflow-knowledge-nodes`, `add-ts-workflow-output-parser-contract`, `enhance-ts-workflow-llm-nodes`

Workflow 从节点能力补齐继续推进到复杂 recipe 的并发、取消、输出和恢复语义，减少不同节点与执行模式之间的行为分叉。

- parallel-gateway fork/join、wait tolerance 和 failure strategy 继续收敛；批量并行执行改为 worker pool，避免两级分批造成并发利用率和尾延迟问题。
- 取消语义明确为外部 cancel rollback，并延后 executing run 的 terminal commit，以保留回滚内容。
- exception failure variables 统一到 `error.code`、`error.message`、`error.category`，knowledge node、RAG index params 和 output binding 同步完善。
- output parser contract、display control projection、Recipe DSL 输出格式、Python result metadata 和 undefined variable 注入问题得到修复。
- LLM 节点增加 template engine、stream mode 和 completion 能力，并对缺失 assembler 的 `prompt_template_name` 配置 fail fast。
- 修复 streamed tool-call 名称分片、reasoning-only output、tool round assistant content、blank reasoning delta 和模型输出 token limit recovery。
- workflow capability kind、package composition、routing、persistence recovery 和 Agent loop tool 的 OpenSpec/实现边界持续收敛。

### 4. 长期记忆、收藏与问题推荐

**OpenSpec Change**: `add-ts-long-memory-manage`, `guard-long-term-memory-writes`, `refine-memory-source-classification`, `add-ts-response-memory-disclosure`, `add-favorite-count-limit`, `refine-ts-suggested-question-prompt`

长期记忆从存储能力扩展到可管理、可约束、可披露的产品路径，并与收藏和问题推荐交互保持明确边界。

- 完成长记忆管理 API、application port、Web 管理工作区和可信 identity 传递。
- 长期记忆写入准入保持在 `agent-memory` 内部，`add_memory` 写入按 learned memory 分类，避免来源语义漂移。
- 首轮主动加载 `USER_CHARACTERISTICS`，同时保留响应中记忆使用披露和来源分类约束。
- 修复管理搜索、编辑保持、queryText 上限、删除后状态和从新会话打开收藏等交互。
- 收藏上限收敛到 per-user，并增加 remote pre-check；问题和答案收藏切换时保留彼此的相对状态。
- 建议问题生成补强 prompt 有效性、稳定性，并将画像与相似问题数量限制为 10。

### 5. Skill、Sandbox、附件与大内容资源

**OpenSpec Change**: `support-skill-tools-field`, `add-skill-metadata-extension`, `refine-skill-body-path-leakage`, `fix-sandbox-unauthorized-path-mapping`, `share-skill-projection-authority-by-execution-scope`, `add-ts-hofs-file-download`

Capability 执行中的文件、Skill projection 和大内容处理进一步统一到受控资源边界，降低跨轮访问失败和宿主路径泄漏。

- Skill Python 执行通过 `NEXTAGENT_WORKSPACE_DIR`、`NEXTAGENT_TEMP_DIR`、`NEXTAGENT_SKILL_ROOT` 区分最终结果、中间数据和只读 Skill 资源。
- 修复 prior tool call 中 Skill 路径的重新授权，并按 execution scope 共享 projection authority，支持多轮继续访问同一受控资源。
- Skill manifest 支持 `tools` alias 和 `metadata.extension`，并拒绝不符合约束的 array extension。
- unauthorized sandbox path 映射为 capability rejection，本地输出路径转换为安全投影，per-run temp directory 在 terminal 后清理。
- HOFS `FILE` structured delta 支持受控下载，修复非 ASCII 文件名、object name 标准化和前端 blob 获取路径。
- 超大 Read 工具结果可外置，减少大内容直接进入模型上下文或流式传输造成的容量压力。
- 清理 runtime-generated Skill root locator 遗留的临时目录，并移除不再交付的 `telecom-domain-qa` builtin Skill。

### 6. 安全、容量、Guardrail 与运行诊断

**OpenSpec Change**: `harden-stream-resource-limits`, `add-share-ops-hash-permission`, `add-ts-runtime-operational-log-hardening`, `refine-ts-runtime-trace-timeline-correlation`, `improve-model-correctable-tool-errors`

不可信输入、流式连接、分享授权和诊断输出继续按电信级安全与容量要求收紧，同时保留对运维故障有用的受控信息。

- 对 Web 请求输入补齐 maxLength、enum、range、字段级 validation error 和边界测试。
- 对 SSE/WS 增加资源限制和 DoS 防护，收紧 session/conversation 查询上限。
- 分享权限从完整 ops array 替换为 SHA-256 hash，避免电信规模操作集合直接放大 token、header 和持久化负载。
- 修复 output guard 检测、blocked event 的 `requestContextId`、guard-blocked turn 排序以及 retry/edit 行为。
- 绝对路径在 Bash stdout/stderr、structured TEXT 和普通回答投影中脱敏，并保持换行等用户可读结构。
- composition 补齐 `webIdentityResolver` 透传与 session Owner Scope 校验；callback target、channel input 和 sandbox path 均按可信边界 fail closed。
- runtime diagnostic logs 增加受控故障定位信息，trace/timeline correlation 和 developer hook timing 继续补强，但不改变对 Web/stream/audit/metric/trace 的安全输出限制。
- AskUserQuestion 校验失败转为模型可纠正 tool result，并保留 option-attached text input，减少因可修正输入错误直接终止请求。

### 7. OpenSpec、架构、测试与发布工程

**OpenSpec Change**: `establish-agent-web-existing-behavior-baseline`, `refine-local-package-developer-hook-trace-default`

本区间持续把实现事实同步到 OpenSpec、架构说明和发布门禁，降低代码、接口文档、UCD 和交付包之间的漂移。

- 建立 Function 与 OpenSpec capability/spec 的追踪约束，并按 Function 结构和质量属性细化 change 写作。
- 刷新系统架构指南、adapter delivery boundary、feature/function catalog、UCD、roadmap 和外部技术交流材料。
- OpenAPI、Task Channel API、开发者文档、Workflow/Recipe 说明和 frontend 文档随接口实现同步。
- workspace build 与 quality baseline 重新建立，Prettier、TypeScript、测试配置和 repository gate consistency 得到修复。
- release package 恢复 default Agent staging，启用 developer hook trace 默认能力，并补充相关验证。
- 新增或恢复 process history stress mock、Task Channel E2E、Workflow/RAG、memory、share、complaint、validation boundary 和多宿主前端回归证据。

---

## 问题修复

### agent-web、会话与过程历史

- 修复 history hydration、thinking handoff、process detail disclosure、live envelope、completed turn refresh 和长会话滚动中的竞争与重复。
- 修复 guard-blocked、retry/edit、fork inherited turn、frozen share、收藏、投诉历史和 BI report 的状态一致性。
- 修复 PIU library build 中 `process.env.NODE_ENV` 替换范围，避免构建配置污染非 PIU 代码。
- 修复文件下载、结构化回答、空 answer segments fallback、路径脱敏和非 ASCII 文件名展示。

### Task Channel、Web API 与输入校验

- 修复 Task Channel URL、stream 参数、terminal event 描述、callback 配置和最终 E2E/文档对齐。
- 修复 channel-web 合并后的 API contracts、ValueErrorType 映射、memory route 缩进和 OpenAPI YAML 缩进。
- 统一 locale、session list、conversation list、日期范围和 queryText 等请求约束与业务限制。
- 增强 validation error 的字段名、接口上下文和约束说明。

### Workflow、Core 与 Model

- 修复 worker pool 并发、retry delta 状态、immutable args、Recipe DSL、output parser、Python result 和 cancel fixture。
- 修复 tool rounds 中 assistant content 污染、reasoning-only output、blank reasoning、streamed tool name fragmentation 和 token limit recovery。
- 修复 prior Skill resource path reauthorization、AskUserQuestion validation result 丢失和 sandbox unauthorized path 映射。

### Memory、Security 与诊断

- 修复长期记忆编辑/搜索、收藏互斥、首轮画像加载和建议问题生成。
- 修复 guard output block、stream resource limits、分享权限体积、Owner Scope 和 callback allowlist。
- 修复 runtime operational logs、trace timeline ownership、local timezone timestamp 和 developer hook timing 的诊断一致性。

---

## 工程改进

### 架构与重构

- `agent-app` composition pipeline 持续统一 Web identity、session owner、Workflow、Memory、Cron 和 Task Channel 装配。
- Workflow 的 engine、package composition、cancel、parallelism、output parser 和 Recipe DSL owner 边界进一步收敛。
- Skill projection authority 以 execution scope 统一，避免 agent-core、capability 和 sandbox 各自形成平行授权语义。
- memory write admission 保持 package-internal，Web/channel 仅使用 application contract 和 public DTO。

### 测试与验证

- 增加 process history stress/handoff、live run identity、retry/edit、guard-blocked、complaint、favorite/share 和多宿主前端覆盖。
- 增加 Task Channel SSE/callback/query、Web request validation、Owner Scope 和 stream resource limit 边界测试。
- 增加 Workflow worker pool、parallel gateway、cancel rollback、output parser、LLM/knowledge/RAG 节点和 Recipe DSL 回归。
- 增加 Skill resource multi-turn reauthorization、sandbox path mapping、HOFS download 和 large content 外置验证。

### 文档

- 新增或刷新 Task Channel、OpenAPI、Workflow/Recipe、Skill authoring、lifecycle hook、部署、frontend 和架构指南。
- 更新 feature/function catalog、UCD、roadmap、产品报告和外部技术交流材料。
- 归档或推进 process history、agent-web baseline、observability、question recommendation、Workflow、memory 和 model adapter 等 OpenSpec change。

---

## 统计

| 指标 | 数值 |
|------|------|
| Commits | 606 (390 non-merge) |
| 文件变更 | 1393 |
| 代码新增 | +131,714 |
| 代码删除 | -15,536 |
| 主要功能主题 | 7 大类 |
| 重点修复方向 | agent-web/history / Task Channel / Workflow/RAG / Memory / Skill/Sandbox / Security / Release engineering |
| 主要测试扩充 | process history + Task Channel E2E + Workflow concurrency/DSL + Web validation + Skill resources + memory/share/complaint + architecture gates |

---

## 升级指南

### 从 v2.3 升级

1. **agent-web 与会话历史使用方**:
   - 回归 refresh、session switch、retry/edit、fork、guard-blocked、process history hydration 和 process activity handoff。
   - 在 local、immersive、collaborative 三种宿主下验证 shared chat workspace、主题/语言切换、分享和投诉入口。

2. **Task Channel 与外部系统接入方**:
   - 按当前 Task Channel 文档重新验证 SSE event、跨 session query、terminal event、`isStreamRecord` 和 API URL。
   - 显式配置 callback allowlist；若使用自签名证书，仅在受控环境评估并配置 `tlsInsecure`。

3. **Workflow / RAG / Recipe 使用方**:
   - 回归 parallel-gateway、worker pool、cancel rollback、exception variables、output parser、LLM template 和 knowledge/RAG outputs。
   - 检查 Python node、batchConfig、stream delta 和 Recipe DSL 是否依赖旧的隐式字段或输出格式。

4. **Memory、收藏和问题推荐使用方**:
   - 验证长记忆管理 API、trusted identity、write admission、source classification 和首轮用户画像加载。
   - 验证 per-user 收藏上限、问题/答案收藏状态和建议问题数量上限。

5. **Skill / Sandbox / 文件能力使用方**:
   - Skill Python 脚本应使用 `NEXTAGENT_WORKSPACE_DIR`、`NEXTAGENT_TEMP_DIR` 和 `NEXTAGENT_SKILL_ROOT`。
   - 回归多轮 Skill 资源访问、HOFS 文件下载、非 ASCII 文件名和超大 Read 结果外置。
   - 若依赖 `telecom-domain-qa` builtin Skill，需要迁移到显式安装或业务自有 Skill。

6. **安全、容量和运维使用方**:
   - 校验 SSE/WS 上限、请求字段约束、分享权限 hash、Owner Scope、callback allowlist 和路径脱敏。
   - 检查本地 operational diagnostics 的存储与访问控制，确保受控原始异常信息不外溢到 Web、stream、timeline、audit、metric 或 trace。

7. **发布包使用方**:
   - 重新验证 default Agent staging、developer hook trace 默认行为和构建产物中的 runtime dist。
   - 后端和前端应分别运行对应 build/test；根目录 build 不能替代 `frontend/agent-web` 的 TypeScript/Vite 验证。

### 兼容性

- **Breaking Changes**: 本区间未识别到统一的公开 breaking change；但 Task Channel、Workflow DSL/output、分享权限、callback allowlist、Skill 资源授权和 builtin Skill 集合存在需要接入方回归的行为收敛。
- **Behavioral Changes**:
  - Task Channel 使用当前 SSE/统一事件与简化契约，callback target 必须满足 allowlist。
  - Workflow 并行批处理使用 worker pool，取消、异常变量、output parser 和 Recipe DSL 按当前规格收敛。
  - 分享权限以 SHA-256 hash 表达，不再依赖完整 ops array。
  - 长期记忆可在首轮加载 `USER_CHARACTERISTICS`，写入准入和来源分类更严格。
  - Skill 资源可按 execution scope 跨轮重新授权，sandbox 非授权路径映射为 capability rejection。
  - `telecom-domain-qa` 不再作为 builtin Skill 随主线交付。
- **Minimum Node.js**: 仍遵循仓库当前声明的 Node.js `22.22.0` 要求。

---

## 已知限制

1. **本文是 `v2.3 → HEAD` 的累计快照**: `HEAD` 比最新标签 `v2.3.3` 前进 63 个提交；在正式打 `v2.4` 标签前，文档内容和统计仍可能随主线变化。
2. **Task Channel 回调依赖部署侧网络与证书治理**: allowlist、UDS、HTTPS 和自签名证书支持不能替代部署环境的 egress、DNS、证书轮换和审计策略。
3. **Workflow 复杂 recipe 仍需场景级验证**: worker pool、取消、output parser、Python/RAG/LLM 节点已补强，但电信运维 recipe 的容量、外部依赖和失败恢复仍需独立压测。
4. **Skill 跨轮资源访问仅覆盖受控 execution scope**: projection authority 不等于任意宿主文件访问，未授权路径仍应被 sandbox 拒绝。
5. **Guardrail 与诊断依赖部署策略**: 代码提供拒答投影、脱敏和受控诊断边界，检测质量、误判处置、日志留存和访问控制仍由部署侧治理。
6. **UCD、roadmap 和报告不是实现完成证明**: 实际可用能力仍以 OpenSpec、代码、测试和发布环境验证为准。

---

**下一步**: 正式发布前应冻结目标 commit、打 `v2.4` 标签，并以该 tag 重新采集统计；同时完成后端、前端、Task Channel、Workflow 和 release package 的范围化 qualification。
