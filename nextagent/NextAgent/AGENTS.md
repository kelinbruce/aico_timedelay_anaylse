# NextAgent 开发约束

NextAgent 是面向电信网络智能体的 TypeScript 智能体框架，包含根目录后端 workspace 和同仓浏览器前端。所有设计和实现必须服务电信网络任务、领域术语、运维诊断、网络能力治理和客户系统集成，并满足电信级质量要求：安全、容量、可靠性/恢复、可审计、可诊断、可维护、可测试。

## 编程规范

实现代码时必须遵守 [`docs/coding-standards.md`](docs/coding-standards.md)。如其与 OpenSpec 或本文件其他要求冲突，以 OpenSpec 和本文件为准。

## LLM Wiki

[`.agents/wiki/`](.agents/wiki/) 是面向 CodeAgent 的项目知识库，按需加载、不重复本文件已定义的规则。修改代码前，根据任务类型选择 1-3 个 wiki 页面读取：

- **不确定放哪个包** → [`decision-trees.md`](.agents/wiki/decision-trees.md)
- **需要架构或依赖规则** → [`architecture-map.md`](.agents/wiki/architecture-map.md)
- **写代码或 review** → [`anti-patterns.md`](.agents/wiki/anti-patterns.md)
- **上下文预算紧张** → [`quick-ref.md`](.agents/wiki/quick-ref.md)
- **完整索引** → [`README.md`](.agents/wiki/README.md)

wiki 是本文件的补充，不替代其约束。冲突时以本文件 > openspec/ > wiki 为准。

## 规格优先

- `openspec/` 是权威规格来源。
- 新增或修改 Web API、stream event、runtime command、context contract、capability contract、gateway contract、persistence owner、安全边界、可观测信号前，必须先有 OpenSpec change。
- 实施阶段默认只改 active change 文档和代码；长期基线文档在归档前更新。
- 不得把未被 OpenSpec 定义的行为直接写进实现。

## 架构边界

- 在受版本控制的源码、配置、文档或测试资产中新增一层目录前，必须完成架构评审并留下可追溯的通过结论，明确该目录的 owner、职责边界、生命周期以及构建、打包和运行时影响；未通过架构评审不得将该目录纳入仓库或提交。测试、示例、fixture 和临时验证目录也不例外。
- 仓库根目录是 TS 后端 npm workspace；浏览器 UI 源码位于独立 package `frontend/agent-web`，构建后以 `@nextagent/agent-web` artifact 供 app composition 托管消费。
- `frontend/agent-web` 只拥有 local、immersive、collaborative 三种宿主下的浏览器投影、组件交互和本地 view state；不得拥有 request lifecycle、canonical stream/history truth、trusted identity、Agent Scope、Owner Scope、capability authority 或 persistence。三种宿主必须复用同一 chat workspace 和后端 runtime bootstrap/transport contract，宿主入口差异不得形成平行业务语义。
- `agent-runtime` 拥有 request lifecycle、scheduler、same-session lane、cancellation、checkpoint、terminal commit 和 canonical timeline。
- `agent-channel-web` 只负责 transport 和 stream projection，不拥有 request lifecycle。
- `agent-core` 负责 Agent 内部 request routing 和 orchestration；runtime 不做业务语义路由。
- `agent-context-engine` 负责 context assembly、query policy、window selection、compaction 和 prompt shaping。
- `agent-model` 隔离 provider SDK、stream normalization、tool-use normalization 和 safe error mapping。
- `agent-capability` 统一承载 Capability 生命周期；Tool、Skill、Agent 都是 Capability 类型。
- `agent-attachment-runtime` 负责附件可信校验、暂存、引用、可用性和 cleanup。
- `agent-memory` 负责长期记忆、自学习、记忆生命周期和长期记忆检索；不阻塞 request terminal commit。
- `agent-platform-gateway-local` 和 `agent-platform-gateway-remote` 隔离 persistence、remote service、sandbox、PaaS SDK 和 driver 细节。
- `agent-observability` 负责 structured logging、redaction、trace/metric integration。
- `agent-app` 是唯一 composition root。
- 跨 package 只能通过 public package exports 和 `agent-contracts`/`agent-common` 协作；禁止 private path import。
- 跨多个 contract subpath 共享的 durable scalar vocabulary 归 `agent-common`；`agent-common` 不放 DO、DTO、Record、port 或业务服务。不得为了避免重复 enum 让 `agent-contracts/gateway` 依赖 `agent-contracts/session`、`agent-contracts/runtime`、`agent-contracts/attachment` 等业务 subpath；gateway Record 只能引用 common vocabulary 和自身 persistence-only vocabulary。
- 主路径必须同时满足两层隔离：Agent Scope 和 Owner Scope。Agent Scope 由可信 app composition、hosted-agent selection 或已持久化 `Session.agentId` 决定，用于选择 Agent 配置、assembly、model profile、prompt profile、capability binding、context policy 和 agent-owned data；Owner Scope 由可信 channel/auth identity 决定，用于隔离租户/用户运行时数据。
- `Session` 必须绑定 `agentId`；`RequestRun` 必须在 acceptance 时固化 `agentId`、`agentVersion`、`agentAssemblyRef`；accepted 后 runtime、core、context、model、capability、gateway 查询不得重新按默认 Agent 或全局配置选择执行路径。
- 主路径运行数据访问必须同时校验 Agent Scope 和 Owner Scope。session list/history/conversation、message、active context、timeline、terminal commit、attachment/artifact/memory 等一旦进入持久化路径，Record、SQLite row 和 query contract 必须显式携带 `agentId`；不得只按 `tenantId`/`subjectId` 查询。唯一受控例外是已有 session submit 的 `SessionLookupRequest`，可先按 `tenantId/subjectId/sessionId` 读取 `Session.agentId`，随后必须校验当前 trusted Agent Scope 与 session-bound `agentId` 一致。
- 主路径对象必须分清 DO/DTO/PO：领域服务只暴露领域对象或内部 read model；Web/channel 只暴露 public DTO；gateway 只暴露 `*Record` 持久化 DTO；DB row/entity 只允许停留在 gateway-local 私有实现。
- `*Record` 只能作为 gateway port 的入参或返回值，不得作为 `agent-session`、`agent-runtime`、`agent-context-engine` 等领域/application service 的 public return，也不得进入 Web response。
- public Web alias 只允许在 `agent-channel-web` schema/projection 层出现，例如 `displayTitle`、`lastActivityAt`、`cursor`、`nextCursor`、`attachments`；内部 read model 必须使用 canonical 字段。
- 主路径持久化事实必须有明确 `DO -> Record -> SQLite row` 映射 owner；`agentId` 等归属字段只能来自可信 app composition 或已持久化领域对象，不得来自客户端请求体。gateway contract 如需复用 owner scope 字段，只能使用中性 owner-scoped contract，例如 `OwnerScoped`；不得让 `*Record` 继承 `*Request`。
- 简单 gateway 写入必须使用 `Record + write options`；`idempotencyKey`、`expectedVersion` 等写入控制信息属于 command metadata，不得塞进 `*Record`，也不得为同形 `record + idempotencyKey` 新增一次性 `*WriteRequest`/`*AppendRequest` 包装。查询、过滤和多事实复合事务可以使用专门 request type。
- 主路径复合持久化操作必须由 gateway 提供单一 composite write，并在 gateway-local 中以一个数据库事务完成；runtime/application 层负责组装业务语义 Record，gateway-local 只负责 row mapping、sequence/ordinal、CAS、唯一约束、幂等和事务，不得反推业务事件语义。
- 主路径 persistence 必须使用专用业务 store/table，禁止用 generic `records(store,key,json)` 承载 request run、session、message、active context、timeline event、checkpoint 等业务事实。
- 幂等写入默认采用锚点事实表原则：每个 idempotent write 定义一个业务锚点表，并在该表按可信 owner scope、agent scope 及相关 session/request/run 坐标建立 scoped uniqueness；重复 key 返回首次锚点事实结果且不得重复 side effect。状态推进若本质是同一事实的 version CAS transition，应按 CAS 建模，不得为了“看起来幂等”给每个 transition 追加无法锚定的伪 operation key。独立 idempotency store/table 只能作为没有清晰锚点事实时的受控例外，并必须先写入 OpenSpec design。

## 技术约束

- 使用 Node.js LTS、TypeScript strict ESM、npm workspaces、Fastify、Pino、TypeBox/Ajv、Vitest、dependency-cruiser、OpenTelemetry、AsyncLocalStorage、Kysely。
- HTTP、stream、config、gateway response、persisted JSON、capability input/output 等不可信边界必须 runtime schema validation。
- Agent、Model、Capability、stream delivery 等慢边界必须使用 async contract，并接收 `AbortSignal` 或等价 cancellation context；Gateway public port 必须是 async contract，远程、长耗时或可取消的 Gateway 操作必须接收 cancellation context，local atomic persistence transaction 以一致性为先，不承诺事务中途 abort。
- 动态执行 shell、python、脚本、模型生成代码必须走 sandbox gateway boundary；不得直接使用宿主进程权限。
- identity 和 owner scope 只能来自 channel/auth boundary；agent scope 只能来自可信 app composition/hosted-agent selection 或已持久化 session/run；请求体、模型输出、Capability 参数或客户端 metadata 不得覆盖当前身份或当前 Agent。
- 除下述受控本地运行诊断外，日志、metric、trace、audit、safe error 不得包含 prompt、模型输出、stream delta、raw provider error、路径、credential、token、附件内容或高基数字段。本地 operational runtime diagnostic 是唯一原始定位面：Tool 执行必须通过 canonical `toolInput` / `toolOutput` 记录原始输入和已有有效输出；`toolOutput` 不记录 `generatedMessages` 正文，只记录其 count 和 kinds；Model 调用的 canonical `modelInput` 必须只包含移除全部 `SYSTEM` message 后的 `messages`，不得包含 Tool descriptors、`modelId` 或其他模型调用选项，并通过 canonical `modelOutput` 直接记录规范化 final result 的 `content`、`toolCalls`、`finishReason`、`usage` 和 `safeError`，不得记录 reasoning、provider raw body 或 stream delta；每个实际 Model `completed`/`failed` terminal summary 必须记录 run-bound `durationMs`，存在 content、reasoning 或 Tool call feedback 时记录同源且不大于总时延的 `firstContentLatencyMs`，并只投影 normalized final result 已提供的 usage，不得估算或补零；runtime owner 捕获的执行异常必须通过 canonical `rawExceptionData` 保留有界的 message、stack、cause、sandbox 路径、URL 和可序列化异常字段。上述行为在 normal 与 debug 下均启用，不得由 diagnostic-detail 配置关闭。五个 special fields 只对 credential 与认证类 token 做窄匹配脱敏，其 prompt、路径、命令、stdout、stderr 和普通业务内容不按敏感信息脱敏；脱敏不得误伤 `credentialRef`、`credentialStatus`、usage token count、`tokenCount`、`tokenLength` 或 `tokenization*` 等正常诊断字段。它们仍必须受字段数、递归深度、数组项、单值长度和单条日志大小约束，且不得进入 Web API、SSE、WebSocket、timeline、SafeError、audit、metric、trace 或 `ObservabilityObservationEvent`。

## 验证门禁

- 后端 workspace 常规验证命令：在仓库根目录运行 `npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`。根目录 `npm run build` 当前只复制 builtin Skill assets，不执行 `frontend/agent-web` TypeScript 或 Vite build，不得把它作为前端 build 证据。
- 前端改动必须在 `frontend/agent-web` 运行 `npm run build` 和相关 `npm test -- ...`；涉及 artifact、宿主模式或静态托管时追加 `npm run build:vite:modes`，涉及浏览器用户旅程时追加相应 `npm run test:e2e -- ...` 或仓库既有 Playwright gate。只改文档时可按影响范围裁剪，但必须说明未运行项。
- OpenSpec 验证命令：`openspec validate --all --strict`。
- push 代码前，默认加载并使用仓内 `.agents/skills/nextagent-code-review/SKILL.md`（`$nextagent-code-review`）进行模型语义检视并满足其规则；commit 阶段不强制执行该检视，不得以固定代码规则扫描替代 push 前模型检视。
- 改 runtime lifecycle、concurrency、cancellation、retry/edit、terminal commit、streaming、gateway persistence、sandbox、安全、agent scope 或 owner scope 时，必须补 characterization/contract/architecture 测试。
- 没有可重复验证路径的任务不得视为完成。
- OpenSpec task 不得部分完成；若一个 task 包含多个独立约束，先拆成可分别验收的子目标。
- 编码前对照 proposal、design、spec、tasks，确认关键约束都有对应实现或明确延期说明。
- 勾选 task 前必须有实际验证命令、测试结果或明确 code review 检查点；不得只用”测试通过”概括完成。
- 禁止项、边界逃逸、非法依赖等 negative case 必须被测试或命令实际触发并断言失败。

### Push/Commit 约束

Push 前必须通过 `$nextagent-code-review` 检视，commit 阶段建议但非强制。

**Push 门禁（强制）**：
- Push 前必须运行 `$nextagent-code-review` 对提交范围进行模型语义检视。
- 检视必须覆盖：Frozen core contract、Architecture boundary（含 frontend/browser ownership 和多宿主一致性）、Minimal kernel non-regression、Security、OpenSpec consistency、Clean Code、受影响前端 build/test/e2e 证据。
- 检视发现 P0 或 P1 问题时，**禁止 push**，必须修复后重新检视。
- P2 问题可带明确 follow-up plan push，P3 问题可选修复。
- 检视结论必须明确：PASS / PASS WITH FOLLOW-UP / BLOCKED。
- 不得以静态扫描工具（ESLint、dependency-cruiser）或测试套件替代模型检视。

**Commit 规范（建议）**：
- 遵循 Conventional Commits：`type(scope): description`。
- 单一职责：一个 commit 只做一件事，message 中出现”、”或”and”连接不相关主题时应拆分。
- Message 必须反映完整 scope：涉及生产代码、配置默认值变更、新增测试文件（>100 行）都必须在 message 中体现。
- 禁止模糊中文短消息（如”打包修改”、”部署配套修改”）。
- 跨 3+ package 的 commit 必须有清晰 cross-cutting theme，否则应拆分。

## 开发准则

务必严格遵守如下准则。

### 同形同策

相同语义类别、相同生命周期阶段、相同架构边界、相同安全/一致性不变量的对象和操作，必须用同一条原则处理。

- 同类 contract 使用同一个 owner、命名规则和 shape；不得为相同语义新增平行 DTO、Record、Request、enum、port、store 或 helper。
- 同类 write 使用同一个 write pattern；同类 persistence fact 使用同一个表建模、scope、幂等和事务策略。
- 发现一个 case 需要调整原则时，先更新 OpenSpec，把新原则应用到所有同类 case；不得只修当前点。
- 真正不能套用统一原则的例外必须在 OpenSpec design 中写明原因、适用范围、owner 和验证方式；没有文档化例外时按统一原则处理。

### 编码前先想清楚

不要假设，不要掩盖不确定性，明确说出取舍。

- 实现前显式说明假设；不确定就问。
- 存在多种解释时列出来，不要静默选择。
- 有更简单方案时说清楚；必要时反驳需求。
- 遇到不清楚的点就停下，说明哪里不清楚并询问。

### 简单优先

只写解决问题所需的最少代码，不做 speculative work。

- 不实现请求之外的功能。
- 不为单次使用代码抽象。
- 不添加未被要求的灵活性、配置项或扩展点。
- 不处理不可能发生的错误路径。
- 200 行能写成 50 行时，重写成 50 行。
- 如果资深工程师会认为它过度设计，就简化。

### 外科手术式修改

只改必须改的内容，只清理自己造成的问题。

- 不顺手改相邻代码、注释或格式。
- 不重构没有坏的代码。
- 匹配现有风格，即使你会用不同写法。
- 发现无关死代码时只说明，不删除。
- 删除自己改动导致未使用的 import、变量、函数。
- 不删除改动前已经存在的死代码，除非明确要求。
- 每一行改动都必须能追溯到用户请求。

### 实现质量门禁

在外科手术式修改的边界内执行童子军原则：触达的代码应比修改前更清晰、更少冗余，但不得把无关重构混入当前任务。

- 新增代码必须被产品路径、测试路径或 OpenSpec 定义的 public contract 使用；不得为未来能力添加未被 OpenSpec 定义的半实现、配置项、扩展点或 dead code。
- 本次改动产生的未使用 import、变量、函数、helper、临时 fixture、debug logging、重复 schema 或重复实现，必须在任务结束前清理。
- 发现本次触达范围内已有 dead code 或明显冗余时，优先清理；若清理会扩大范围或影响无关模块，只记录问题，不顺手改。
- 测试优先覆盖黑盒规格、边界条件、安全属性和可观察结果；不得为了锁死某个私有实现细节而写 brittle test。
- 只有架构边界、防 private import、防 testing fixture 泄漏、防产品路径 mock/no-op 替代、source-level forbidden pattern 这类目标，才允许 source/architecture assertion；这类测试必须明确对应的架构或 OpenSpec 约束。
- 修 bug 应先表达用户或系统可观察的失败行为；若失败根因是内部实现形状，测试仍应尽量断言外部行为或 contract 结果，而不是复刻内部代码路径。
- task 勾选或宣称完成前，必须完成相关验证，并说明是否存在刻意保留的 deferred 能力、test-only fixture、no-op provider 或既有债务。

### 目标驱动执行

把任务转成可验证目标，并循环到验证通过。

- “添加校验”应转为“为非法输入写测试，再让测试通过”。
- “修 bug”应转为“写出复现测试，再让测试通过”。
- “重构 X”应转为“重构前后测试都通过”。

多步骤任务先给简短计划：

```text
1. [步骤] -> 验证: [检查]
2. [步骤] -> 验证: [检查]
3. [步骤] -> 验证: [检查]
```

成功标准必须具体。含糊目标需要先澄清。
