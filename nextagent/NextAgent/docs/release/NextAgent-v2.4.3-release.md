# NextAgent v2.4.3 Release Notes

**发布日期**: 2026-08-06
**版本范围**: v2.4.2 → v2.4.3
**变更统计**: 126 commits (99 non-merge), 321 文件变更 (+27,136 / -4,983), 覆盖 Capability 失败治理、Workflow 执行与历史一致性、长期记忆和收藏交互、本地运行诊断、Skill 参数边界、安全容量与测试治理

## 摘要

v2.4.3 是 v2.4.2 之后的稳定性与治理增强版本。本版本重点统一 Capability 从输入校验、执行、重试到最终失败投影的语义，补强 Workflow 与已完成历史的一致性，完善长期记忆和收藏管理体验，并把本地 operational log 收敛为可定位复杂 Model、Tool 和异常问题的受控诊断面。主要交付：

- **Capability 失败治理统一** - Tool 输入违规、执行失败、超时、重试和最终失败采用统一的有界结果与诊断语义。
- **Workflow 执行稳定性增强** - Capability 节点最终失败显式转为 Workflow 异常，修复完成态 live/history 一致性和多个 Recipe 节点边界问题。
- **长期记忆与身份隔离完善** - 管理页补齐分页、导入后统计刷新、敏感信息展示和 trusted host identity 隔离。
- **收藏内容视图升级** - 收藏从侧栏替换行为收敛为独立主内容视图，支持会话分组、过滤、分页、正文展开和准确定位。
- **本地运行诊断增强** - Tool、Model、异常、timing 和 usage 形成可关联诊断链，并降低默认 info 日志噪声、限制日志轮转容量。
- **Skill、Web 与容量边界加固** - Skill args 不再因业务字段名误判，服务端安全响应头、上下文分块加载和 schema traversal 容量保护得到补强。
- **OpenSpec 与回归证据补齐** - 关键行为由 change、黑盒测试、契约测试、架构测试和前端多宿主测试共同约束。

---

## 核心亮点

### 1. Capability 失败、重试与诊断语义统一

**OpenSpec Change**: `unify-capability-failure-disposition`

Capability 执行从各 Tool 分散处理失败，收敛为统一的输入违规、执行结果、重试决策和最终失败处置路径，使 Agent、Workflow 和调用方能稳定区分可纠正失败、可重试失败、部分成功与终态失败。

- governed execution boundary 统一执行输入校验、结果规范化、有界 retry 和 violation projection。
- Bash、Python、RAG、ApiCall、Memory、Agent、Workflow 与 targeted Skill routing 对齐统一失败结果；公共错误证据受容量和敏感信息约束。
- `anyOf` / `oneOf` schema validation 按 discriminator 选择分支并过滤未选分支噪声，任意 producer output 的严格校验保持 throw-safe。
- 成功结果在 retry 判断前返回；执行完成后的取消不再丢弃既有结果，重试循环在下一次调用前检查 abort。
- 非幂等 Tool 的 timeout 明确不可重试；`DEGRADED` 仅用于复合操作的部分成功，不再泛化为普通失败。
- AskUserQuestion 使用稳定失败 fingerprint；同一输入连续第二次失败时终止恢复循环，避免模型反复提交等价无效参数。
- Workflow Capability 节点把最终失败转换为显式异常并保持节点侧零额外重试，避免 Agent 与 Workflow 双重重试。
- 新增 first-party Tool failure ledger、黑盒结果契约、安全负例、core characterization 和 architecture assertion。

### 2. Workflow、Recipe 与完成态历史一致性

**OpenSpec Change**: `persist-ts-refresh-stable-completed-turns`, `add-ts-workflow-event-history`

Workflow 的节点失败、参数转换和 completed live/history 投影进一步稳定，降低复杂 Recipe 在执行完成、刷新和历史回看时的状态漂移。

- 修复 completed Workflow 在 live stream 与 history hydration 之间的不一致，保留已完成过程的稳定展示。
- Workflow Capability 最终失败进入统一 exception path；Python DATA_ANALYSIS、LLM、RESTFUL、交互节点和 pending input 增加回归覆盖。
- RESTFUL Capability 保留 `model` 作为业务参数；Python literal conversion 正确递归处理嵌套 boolean 与 null。
- interrupt-gateway 只读取 canonical `node.timeout`，移除 `inputs.timeoutAt` 的平行 fallback。
- HTML display content safety check 使用已知 HTML tag names，减少业务文本被误判为标签。
- Recipe DSL 说明与 1.0 native 字段名重新对齐；本版本没有把中途尝试的 snake_case aliases 保留为新的运行时契约。
- `add-ts-workflow-event-history` 仍处于规格与实施准备阶段；本版本只声明已有 completed live/history 修复，不宣称完整 durable Workflow event history 已交付。

### 3. 长期记忆管理、可信身份与敏感展示

**OpenSpec Change**: `add-ts-long-memory-manage`

长期记忆管理从基础列表和编辑能力继续推进到完整分页、远端身份隔离和安全展示，提升电信运维场景下大量记忆记录的可用性。

- 管理页增加完整分页控件、分页布局和类型列可读性优化。
- 导入完成后刷新总数，搜索、编辑、删除与分页状态保持一致。
- Web memory request 按 host user 隔离，remote deployment 优先使用 trusted host user headers，避免浏览器请求自行覆盖身份。
- memory service 和 Web route 保持 owner scope；补充 identity、API、页面状态和 readonly fixture 测试。
- 内存内容中的路径和敏感占位符使用统一 presentation policy，避免不同列表与正文组件出现不一致展示。

### 4. 收藏主内容视图与多宿主交互

**OpenSpec Change**: `fix-agent-web-favorite-panel-navigation`, `rename-piu-to-aico`

收藏从替换最近会话列表的侧栏状态，收敛为 Local、Immersive 与 Collaborative/PIU 可复用的独立内容视图，同时完成 AICO 品牌启动名迁移。

- 收藏页面在主内容区展示，最近会话列表保持可见；收藏、会话、记忆管理和投诉历史由单一主内容选择控制。
- 同一 session 的收藏 turn 按会话分组，支持关键词与时间过滤、每页 15 个 session 的显式分页、正文展开和取消收藏确认。
- 选择收藏 turn 后恢复所属会话并定位到目标回合；取消收藏失败会保留当前项并允许重试。
- `#/favorites` 支持直达、刷新和浏览器前进/后退；Local 与 Immersive 复用一致路由语义，Collaborative 在既有左侧扩展容器复用收藏面板。
- PIU 启动名从 `AIAgentPIU` 更名为 `AICOPIU`，同步更新 Prel `autoLoad` key、mock、sessionStorage key 和测试。
- 构建产物仍为 `AIAgentPIU.js` / `AIAgentPIU.css`，hosting 静态路径与内部函数/组件命名不变。
- 前端增加收藏、多宿主路由、正文渲染、历史过程和 E2E smoke 回归证据。

### 5. 本地运行诊断、日志信噪比与容量

**OpenSpec Change**: `refine-local-runtime-diagnostic-visibility`, `add-ts-runtime-operational-log-hardening`

本地 operational log 现在能够按 request、run、step、Model invocation 和 Tool invocation 关联真实失败原因，同时继续与 Web、stream、timeline、audit、metric 和 trace 的安全投影隔离。

- Tool diagnostic 在 normal 与 debug 下记录 canonical `toolInput` / `toolOutput`，保留可信 `stepId`，并排除 `generatedMessages` 正文。
- `modelInput` 只记录移除全部 SYSTEM message 后的 `messages`；`modelOutput` 使用规范化 final result，不记录 reasoning、provider raw body 或 stream delta。
- Model terminal summary 记录实际 `durationMs`、条件性 `firstContentLatencyMs` 和 provider 已返回的 usage，不估算或补零。
- runtime 捕获异常通过有界 `rawExceptionData` 保留 message、stack、cause 和可序列化诊断字段。
- local special fields 只对 credential 与认证类 token 做窄匹配脱敏，避免误伤路径、命令、业务正文、usage token count 和正常 tokenization 字段。
- 默认 info 日志减少成功 owner check、纯观察 Hook、trace 投影确认和重复 Skill unavailable 噪声；HTTP 请求只保留一次 final access record。
- managed logs 上限收敛为单轮转文件 30 MiB、最多 10 个归档，降低长期运行的本地磁盘风险。

### 6. Skill 参数、服务端安全与容量边界

**OpenSpec Change**: `refine-skill-args-governance-boundary`

Skill 业务参数与框架执行治理的边界更明确，同时 Web response、context assembly 和 schema traversal 增加容量与安全保护。

- Skill `args` 不再因 `mode`、`path`、`providerId`、`timeoutMs`、`childBudget` 等业务字段名被全局黑名单误拒绝。
- 框架 timeout、budget 和 provider selection 仍只来自可信 runtime context、policy 与受治理 metadata，不读取同名 Skill args。
- 服务端为全部 outbound response 增加安全响应头，并通过 app 级测试约束。
- context engine 对 render-time `loadMessages` 分块，避免 GET URL 过长。
- Capability result schema traversal 合并 deep copy、JSON serializable 检查和 byte budget，增强深层/异常结果的容量保护。
- Cron expression 采用独立 clean-room implementation，并补充解析与 Tool 测试。
- Task Channel batch 请求在全部 item 失败时返回 HTTP 400，文档和 route 测试同步更新。

### 7. OpenSpec、架构与验证治理

**OpenSpec Change**: `refine-ts-agent-gateway-state-store-boundary`, `persist-ts-refresh-stable-completed-turns`

本版本继续以 OpenSpec、黑盒验证和架构约束区分“已交付实现”与“目标态设计”，避免把活跃 change 的提案状态误报为产品能力。

- Capability failure disposition 增加 implementation-boundary architecture assertion、first-party ledger、failure evidence security negative tests 和跨 Tool 黑盒验证。
- agent-web 增加 favorite、memory、identity、process history、redaction、routing 和多宿主 E2E/组件测试。
- Workflow 增加 Capability node、interaction node、LLM node、cancel policy、execution engine 和 tool port 覆盖。
- observability 增加 timing、redaction、structured log、trace 与 timeline projection 正反向测试。
- `refine-ts-agent-gateway-state-store-boundary` 在本区间完成提案和设计，但实现曾被回退，tasks 仍未开始；本版本不包含该目标态 gateway 重构。
- `persist-ts-refresh-stable-completed-turns` 已交付本区间涉及的 completed history 修复，但仍有 presentation 和完整门禁任务未完成，不将整个 change 宣称为完成。

---

## 问题修复

### Capability、Core 与 Tool

- 修复任意 producer output 导致严格结果校验抛出异常的问题。
- 修复 `anyOf` / `oneOf` 未选分支产生重复或误导性 diagnostics。
- 修复 successful Capability result 被 retry/abort 后置判断覆盖或丢弃的问题。
- 修复 timeout、non-idempotent operation、partial success 与最终失败 disposition 不一致。
- 修复 AskUserQuestion 等价失败循环和 capability failure fingerprint 过度依赖错误文本的问题。
- 修复 Skill args 因业务字段名与治理词汇重名而被拒绝的问题。

### Workflow、Context 与 Task Channel

- 修复 completed Workflow live/history 不一致。
- 修复 RESTFUL `model` 业务参数被治理字段过滤、Python nested boolean/null 转换和 display HTML 安全判断。
- 修复 render-time message loading 可能造成 GET URL overflow。
- 修复 Task Channel batch 全部失败仍返回成功类 HTTP 状态的问题。

### agent-web、Memory 与 Identity

- 修复收藏入口替换最近会话列表、多个主内容菜单同时激活和收藏定位不稳定。
- 修复 memory 管理分页不完整、导入后总数未刷新、类型文本裁切和布局失衡。
- 修复 remote Web identity 未优先使用 trusted host headers，以及 memory request 未按 host user 隔离。
- 修复路径、redaction placeholder 和 memory sensitive content 在不同 UI 投影中的展示不一致。

### Security 与 Observability

- 为所有 outbound responses 补齐安全响应头。
- 修复 local runtime diagnostic 缺少 Tool step、Model input/output、异常根因、timing 或 usage 的问题。
- 修复默认 info 日志重复、过密，以及 managed log 缺少明确容量上限的问题。
- 收窄 local special field 脱敏匹配，避免普通业务字段和 token 计数被误伤，同时保持 credential/token 清除。

---

## 工程改进

### 架构与重构

- Capability 失败处置保留在 `agent-capability` / `agent-core` / `agent-workflow` implementation boundary，没有扩张公共 `agent-contracts` 的内部结果 shape。
- result validation 合并为单次有界 traversal，减少重复 deep copy 与 serializability 扫描。
- retry control flow 收敛为早返回和两分支决策，删除冗余 exception wrapper 与无效 invocation stage。
- 收藏视图从 Sidebar 内部状态拆出共享 `FavoriteTurnsPanel`，由 shell 统一拥有当前主内容选择。

### 测试与验证

- 增加 Capability execution boundary、result contract、validation violations、failure evidence security 和 first-party Tool ledger 测试。
- 增加 Workflow final failure、Python DATA_ANALYSIS、RESTFUL 参数、pending input 和 completed history 回归。
- 增加 Web favorite、memory、identity、redaction、route history、PIU/Immersive 及 E2E smoke 覆盖。
- 增加 operational log、Model timing、usage、trace/timeline projection、安全响应头和 context chunking 测试。

### 文档与规格

- 更新 Recipe DSL 1.0 high-level specification，使字段名与当前 native contract 一致。
- 更新 Task Channel batch failure 文档和 observability design review evidence。
- 新增或细化 Capability failure、runtime diagnostics、Skill args、收藏导航、AICO 命名、Workflow event history 和 gateway state-store boundary 的 OpenSpec artifacts。
- 移除默认 Agent 中不再交付的内置 Recipe sample files，避免示例被误认为受支持产品能力。

---

## 统计

| 指标 | 数值 |
|------|------|
| Commits | 126 (99 non-merge) |
| 文件变更 | 321 |
| 代码新增 | +27,136 |
| 代码删除 | -4,983 |
| 主要功能主题 | 7 大类 |
| 重点修复方向 | Capability failures / Workflow history / Memory & Identity / Favorites & AICO / Runtime diagnostics / Security & Capacity / Governance |
| 主要测试扩充 | Capability boundary + Workflow nodes/history + agent-web multi-host/favorites/memory + diagnostics/redaction + security headers + architecture gates |

---

## 升级指南

### 从 v2.4.2 升级

1. **Capability 与 Tool 开发方**:
   - 回归自定义 Tool 的输入违规、timeout、abort、retry、partial success 和 invalid output；不要依赖旧的分散失败 shape 或错误字符串推断处置。
   - 非幂等 Tool 应确认 timeout 后不重试；Workflow Capability 节点不应在 Agent retry 之外再做隐式节点重试。

2. **Workflow / Recipe 使用方**:
   - 回归 Capability final failure、RESTFUL `model` 参数、Python nested values、interrupt timeout 和 completed history。
   - 继续按 Recipe DSL 1.0 native 字段名配置；不要依赖本区间曾短暂出现但已回退的 snake_case aliases。

3. **长期记忆与远端部署使用方**:
   - 验证 trusted host user headers、owner-scoped memory request、分页、导入后总数和敏感信息展示。
   - 确认反向代理只注入受信身份 header，且客户端无法直接伪造该边界。

4. **agent-web / PIU 集成方**:
   - 将 `Prel.autoLoad` key 从 `AIAgentPIU` 改为 `AICOPIU`；静态产物路径仍使用 `AIAgentPIU.js` / `AIAgentPIU.css`。
   - collaborative active-session storage key 已变化，升级后应允许重新选择会话；回归 Local、Immersive 和 Collaborative 的收藏入口与主内容导航。

5. **日志与运维使用方**:
   - 重新评估 local operational log 的文件权限、采集范围和保留策略；它现在会保留更多 Model、Tool、路径、命令和异常正文，但仍会清除 credential 与认证类 token。
   - 日志解析器应兼容 Model terminal summary 中的 `durationMs`、条件性 `firstContentLatencyMs` 和可选 usage，并适配 30 MiB / 10 archives 的 managed log 上限。

6. **Task Channel 与 Web 服务使用方**:
   - 调整 batch API 对“全部 item 失败”返回 HTTP 400 的处理逻辑。
   - 验证反向代理与嵌入宿主不会移除新增安全响应头，并回归大历史上下文的分块加载。

### 兼容性

- **Breaking Changes**:
  - PIU 启动名从 `AIAgentPIU` 改为 `AICOPIU`；`Prel.autoLoad` 使用方必须更新 key。
  - collaborative active-session storage key 从 `nextagent:AIAgentPIU:activeSessionId` 改为 `nextagent:AICOPIU:activeSessionId`，已有浏览器会丢失上次 active session id。
  - 本地 runtime diagnostic 的内容安全边界发生变化：受控本地日志保留更多原始业务诊断内容，运维治理必须按新边界复核。
- **Behavioral Changes**:
  - Capability failure、retry、input violation 和 partial success 按统一 disposition 处理。
  - Workflow Capability final failure 显式进入 exception path，节点不重复 Agent retry。
  - 收藏在主内容区域展示并支持独立 hash route、服务端过滤和 session 分组分页。
  - Skill `args` 字段名不再被全局治理词汇黑名单拒绝，但仍不能覆盖可信 runtime policy。
  - Task Channel batch 全部失败时返回 HTTP 400。
- **Minimum Node.js**: `22.22.0`。

---

## 已知限制

1. **完整 Workflow event history 尚未交付**: `add-ts-workflow-event-history` 在该 tag 下仍有 28 个未完成 task；本版本只包含 completed live/history 一致性等已落地修复。
2. **刷新稳定性 change 仍有未完成项**: `persist-ts-refresh-stable-completed-turns` 尚余 Workflow-as-Tool presentation 和完整受影响门禁任务，复杂嵌套 Workflow 展示仍需继续验证。
3. **Gateway state-store 目标态仅完成规格准备**: `refine-ts-agent-gateway-state-store-boundary` 的实现改动已回退，v2.4.3 仍使用现有 gateway/state-store shape。
4. **本地诊断不是外部观测面**: 原始 Model、Tool 与异常内容只能留在受控 local operational log，不得进入 Web API、stream、timeline、SafeError、audit、metric、trace 或 observation-derived log。
5. **AICO 更名不包含产物重命名**: 启动契约使用 `AICOPIU`，但构建文件和静态托管路径仍保留 `AIAgentPIU` 名称；集成方需同时理解两层命名。
6. **收藏筛选仍受有界窗口约束**: 收藏以既有服务端有界查询结果进行过滤和 session 分组，不代表提供无上限的全租户收藏分析能力。

---

**下一步**: 后续版本应完成 Workflow event history、刷新稳定性剩余 presentation/gate，并在实施前重新审计 gateway state-store 目标态；同时持续以 Capability 黑盒契约、多宿主 Web E2E 和本地诊断安全边界作为发布 qualification 重点。
