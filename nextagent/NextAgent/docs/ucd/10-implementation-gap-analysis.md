# UCD 设计实现缺口历史快照

> **状态说明（2026-08-13）**：本文档是 2026-07-18 形成的 UCD 差距历史快照，其中部分条目已实现、已由 change 交付或已不适合独立立项。团队领取开发任务时请使用 [UCD 能力差距交付里程碑](../roadmap/ucd-capability-delivery.md)；不要直接按本文档的 A/B/C 分类、原始统计或原始优先级创建实现 change。
>
> **核对基线（2026-08-13）**：当前状态已按 `origin/main@4f27c4a9f`、owning stable/active OpenSpec、代码和测试复核；active change 尚待归档时会明确标注。`[UCD目标]` 不表示已交付。下方 A/B/C 正文保留历史形成时的判断，若与本覆盖层冲突，以本覆盖层和 roadmap 为准。
>
> **当前 disposition 覆盖层**：
>
> | 状态 | 历史条目 | 当前判断 |
> |---|---|---|
> | `[已实现-主干]` | A5、A7、B3 的 activity 子项、B6、B8、B11、B12、B13、B14、B16、B21、C1、C2 的 workflow 路线决策、C4、C6、C7、C8、C9 的 Dashboard 展示、C10、C11、C13，以及 B4 中的当前会话 preview rail | 不再作为独立实现缺口；sidebar preview 等剩余子项仍按独立状态判断 |
> | `[已实现主路径/交互目标重定界]` | C10 | header `⚡` monitor/output/kill 已满足后台任务追踪主路径；capability-card 内联区仍是可选 UCD 目标，不由现有 stable spec 承载，也未进入 Ready |
> | `[部分实现/需拆分]` | B3 的 preview/session-favorite 子项、B4、C3、C5 | 保留的子缺口必须按现有前后端边界拆分；C3/C5 在没有明确收益前不单独立项 |
> | `[Clarify]` | A2/B15、B1、A6/B17/B18、B19、B20、C12 | 先完成语义、owner 或安全边界决策，再判断是否准入 change；C2 已由稳定规格决定复用 `QUESTION` |
> | `[Ready]` | — | 当前没有仅凭本历史快照即可领取的 Ready 项；以 roadmap 为准 |
> | `[Candidate]` | A9、B7 等 | 需要产品价值/范围确认，不是默认承诺 |
> | `[已实现-主干，但名称需澄清]` | C11 | 会话标题/日期范围搜索 UI 与 API 已实现；若目标是会话内消息全文搜索，应作为不同候选能力重新定义 |
>
> 以下是**原始快照分类**，仅保留追溯价值：
> - **A 类：契约与实现双空白** — 无 spec、无实现，需从契约定义开始
> - **B 类：契约部分覆盖** — 有相关 spec 或设计文档，但未明确覆盖该能力的具体契约，需补充条款
> - **C 类：契约就绪，实现待补** — spec 已完整定义，纯实现缺口
>
> 每项包含"用户场景"（什么情况下用户会用到这个能力）和"业务价值"（高/中/低，及理由），便于按价值排序优先级。

---

## A 类：契约与实现双空白（9 项）

### A1. 文件下载组件

| 维度 | 内容 |
|------|------|
| **UCD 设计位置** | `05-component-specs/file-download.md` |
| **用户场景** | Agent 生成配置模板、报表、日志分析结果等文件，用户需要下载到本地使用或归档 |
| **业务价值** | **高** — 运维场景中"导出 Agent 生成的文件"是核心需求，缺少下载能力意味着 Agent 生成的文件用户无法获取 |
| **设计要点** | 能力卡片结果中提供文件下载入口，支持文件名、大小、格式展示，点击触发下载流程 |
| **Spec 状态** | 无。`ts-attachment-intake` / `ts-attachment-cleanup` / `request-attachments` 仅覆盖附件上传与生命周期，下载无契约 |
| **实现状态** | 无任何下载基础设施 |
| **待补齐工作** | 1) 新建 spec 定义下载 URL 生成、鉴权、过期策略；2) 定义 safeResult kind 中的下载字段投影；3) 前端实现下载组件 |

### A2. 网管 GUI 链接导航卡片

| 维度 | 内容 |
|------|------|
| **UCD 设计位置** | `05-component-specs/tool-output-presentation-policy.md` |
| **用户场景** | Agent 在回答中引用网管系统的某个页面（如设备详情、告警详情、配置面板），用户点击导航卡片直接跳转到网管 GUI 对应页面，无需手动查找 |
| **业务价值** | **高** — 打通 Agent 与网管系统的导航闭环，是"从对话到操作"的关键一环，缺失则用户需要手动在网管系统中定位 Agent 提到的页面 |
| **设计要点** | 工具输出结果中包含网管 GUI 链接时，渲染为可点击的导航卡片，点击后跳转至宿主产品相关页面 |
| **Spec 状态** | `[部分实现]` `agent-web-structured-message-rendering` 已定义 ACTION/OPERATOR 结构化消息与宿主 `CustomEvent` 路径；`OperatorContent.type` 已声明 `BUTTON | LINK`，但没有 LINK 专属呈现、安全 allowlist、scope 或确认契约 |
| **实现状态** | `[部分实现/Clarify]` `OperatorButtons.tsx` 可渲染按钮并按模型提供的 key dispatch `CustomEvent`，但 `LINK` 当前仍按普通按钮渲染；`ActionCard.tsx` 会自动 dispatch 模型提供的事件 key，且 live re-render/remount 与 history replay 都可能重复触发 |
| **待补齐工作** | 先通过 `harden-action-operator-event-dispatch` 明确 event key allowlist、宿主注册、scope、必要确认及 history 禁派发或 live-only at-most-once/idempotency；安全边界确定后，再判断是否需要独立 LINK 导航卡片 change。不得把现有基础 renderer 误报为“完全未实现”，也不得在未加固前扩大发送面 |

### A3. 长时能力扩展态

| 维度 | 内容 |
|------|------|
| **UCD 设计位置** | `05-component-specs/capability-card.md`、`openspec/designs/architecture/conversation-ui-state.md` "任务输出与上下文解耦原则"章节 |
| **用户场景** | Agent 执行耗时较长的能力（如批量网络扫描、大规模配置下发），用户需要看到已运行多久、能否取消、进度如何，并根据"输出是否需要参与后续上下文"选择等待/转后台/Fork 继续 |
| **业务价值** | **中** — 提升长时任务的可控性和用户信心。当前后台任务追踪区可部分替代（查看状态/kill），但缺少计时器、进度条、转后台 CTA、Fork 继续 CTA 等直观反馈与分流入口 |
| **设计要点** | 长时能力卡片展示扩展态：运行计时器、取消按钮、进度条（可选）、**转后台 CTA**、**Fork 继续 CTA**。CTA 可见性受工具声明的 `outputContextMode` 调控：`required` 仅允许等待/Fork；`decoupled` 仅允许等待/转后台；`user-choice` 全部允许。详见 `conversation-ui-state.md` "任务输出与上下文解耦原则"。**移除原 `forkEligible` 字段**——fork CTA 归 A4 定义，A3 只负责扩展态字段（elapsedTime/progress/cancellable/backgroundable） |
| **Spec 状态** | 无。`agent-web-background-task-control` spec 仅覆盖后台任务 monitor/kill，不含扩展态 UI 契约（计时器/进度/转后台 CTA）。`outputContextMode` 工具声明机制未定义（见 B20） |
| **实现状态** | 能力卡片仅有 running → completed/failed 基本态，无扩展态；只有 Bash 支持 `run_in_background: true`（等价于发起时直接选择"转后台"） |
| **待补齐工作** | 1) 新建 spec 定义长时能力判定阈值、扩展态字段（`elapsedTime`/`progress`/`cancellable`/`backgroundable`）；2) 定义 safeResult 中的扩展态投影；3) 定义 `outputContextMode` 工具声明机制（依赖 B20）；4) 前端实现扩展态 UI + 两个 CTA 的可见性逻辑 |

### A4. Fork-to-Continue 引导

| 维度 | 内容 |
|------|------|
| **UCD 设计位置** | `05-component-specs/capability-card.md`、`openspec/designs/architecture/conversation-ui-state.md` "任务输出与上下文解耦原则"章节 |
| **用户场景** | 长时能力运行中，用户不愿等待且任务输出需要参与后续上下文（`outputContextMode=required` 或 `user-choice` 且用户判断输出需进 context），用户希望从**上一轮已完成对话的答案处** fork 新会话继续对话，原会话继续等待任务完成 |
| **业务价值** | **中** — 原 A4 评估为低价值（仅"换个方向探索"），按"任务输出与上下文解耦原则"重新定位后升为中价值：Fork 继续是"用户不愿等 + 输出需进 context"场景下的唯一非阻塞路径，是长时任务分流的关键一环。派生按钮已存在于消息级别（ASSISTANT 气泡），但卡片级 CTA 提供更精准的触发时机（长时任务阻塞时） |
| **设计要点** | 长时能力运行中，卡片提供"Fork 继续" CTA。**Fork 点：上一轮已完成对话的答案处**（非当前运行中的任务）。点击后：1) 派生新会话，继承 fork 点之前的全部 active context；2) 原会话继续等待任务完成，任务输出仍进入原会话 active context；3) 用户在新会话继续对话，不被长时任务阻塞；4) 任务完成后用户可切回原会话查看完整结果。CTA 可见性：`outputContextMode=decoupled` 时隐藏（输出不进 context，fork 无意义）；其他模式显示 |
| **Spec 状态** | 无。`session-fork-from-message` spec 覆盖会话派生机制（`submit.ts:350-467`），但无 fork-to-continue 引导 CTA 契约、无"原会话继续等待任务"的语义约束 |
| **实现状态** | 派生按钮存在于 ASSISTANT 消息气泡（`TurnBlock.tsx`），但能力卡片级别无 fork CTA；fork 机制本身已实现（`forkFromMessage`/`forkFromRequest`） |
| **待补齐工作** | 1) 在 `session-fork-from-message` spec 中补充能力卡片级 fork CTA 条款，明确 fork 点为"上一轮已完成答案处"；2) 定义 CTA 显隐条件（受 `outputContextMode` 调控）；3) 定义"原会话继续等待任务"的会话语义；4) 前端实现 |

### A5. Cron 管理面板

| 维度 | 内容 |
|------|------|
| **UCD 设计位置** | `05-component-specs/cron-task.md`、`08-sample-scenarios.md` 场景 23 |
| **用户场景** | 用户通过 Agent 创建了定时任务后，需要查看/管理这些任务：看下次执行时间、删除过期任务、查看一次性任务的执行结果。缺少管理面板会导致"僵尸任务"持续运行而用户不知情，且一次性任务触发后用户无法回溯执行情况 |
| **业务价值** | **高** — 定时任务创建后不可管理是严重的用户体验和安全问题，用户无法掌控 Agent 创建的定时任务何时执行、是否还在运行 |
| **设计要点** | 侧边栏 Cron 图标入口 → 打开 Cron 管理模态框 → Tab 分离「运行中 / 已结束」两个视图：运行中 Tab 展示 ACTIVE 任务（循环 + 未触发单次），已结束 Tab 展示 COMPLETED 一次性任务（按 `lastTriggeredAt` 倒序分页），支持查看执行结果跳转、删除 |
| **Spec 状态** | 无。`cron-tools` change（`openspec/changes/add-ts-cron-tools/`）覆盖 cron 工具语义（create/list/delete、durable task、trigger、recovery、LUI safe projection），但无管理面板 UI 契约 |
| **实现状态** | 后端有 cron 工具实现，前端无管理面板。后端 `listTasks` 查询条件为 `status <> 'DELETED'`（含 ACTIVE 和 COMPLETED），未支持 status 过滤参数与分页；`requestRunId` 已存在于 `cron_triggers` 表但未在 list 投影暴露；`lastTriggeredAt`/`nextRunAt` 字段后端未直接提供 |
| **待补齐工作** | 1) 新建 spec 定义管理面板 UI 契约（入口、Tab 分离、列表字段、操作权限、查看结果跳转）；2) 后端扩展 `listTasks` 支持 `status` 过滤、分页 cursor、JOIN `cron_triggers` 暴露 `lastTriggeredAt`/`requestRunId`、补 `nextRunAt` 计算；3) 前端实现侧边栏图标 + 管理模态框（Tab 切换 + 跳转原会话 turn） |

### A6. 内容扫描脱敏

| 维度 | 内容 |
|------|------|
| **UCD 设计位置** | `05-component-specs/tool-output-presentation-policy.md` |
| **用户场景** | 工具输出中可能包含敏感信息（密码、密钥、用户个人数据），系统需要自动识别并脱敏后展示给用户，避免敏感信息暴露在对话界面 |
| **业务价值** | **高** — 安全合规需求。当前 `redaction-policy` spec 只覆盖日志脱敏，用户可见的工具输出内容如果包含敏感信息会直接暴露给前端 |
| **设计要点** | 工具输出结果在呈现给用户前，扫描敏感内容（密钥、令牌、PII 等）并脱敏替换 |
| **Spec 状态** | `[部分实现/Clarify]` `redaction-policy` 覆盖 observability 边界；`guardrail-gateway` 与 Web transport specs 已覆盖 REMOTE guardrail 的输入拒绝、输出整轮拦截、`OUTPUT_GUARD_BLOCKED` 和后续 model-visible history 隔离，但未定义 conversation stream 字段级替换策略 |
| **实现状态** | `[已实现-主干的基础]` runtime terminal `finalContent` 有正则替换/私钥阻断；REMOTE 且启用 guardrail 时可执行输入/输出整轮拦截。当前没有统一的 live thinking/answer 字段级内容扫描，也没有 live/history/share 一致的替换策略 |
| **待补齐工作** | 先明确字段级替换与整轮阻断的关系、authoritative security owner、适用 deployment、fail-closed 行为和 live/history/share 一致性；完成 clarify 后再决定是否创建实现 change，不把两种不同成熟度的 guard 合并描述为一个已交付能力 |

### A7. CSV / 非 Markdown 附件支持

| 维度 | 内容 |
|------|------|
| **UCD 设计位置** | `05-component-specs/composer.md` |
| **用户场景** | 用户上传 CSV 数据文件让 Agent 分析（如告警列表、设备清单），或上传其他非 Markdown 格式的配置文件 |
| **业务价值** | **已实现-主干** — 运维场景常见 CSV 数据上传需求已由可配置 staged Web composer 路径承接 |
| **设计要点** | Composer 附件添加支持 CSV 等 非 Markdown 格式文件，上传后正确解析和展示 |
| **Spec 状态** | `ts-attachment-intake` 已覆盖 staged intake、配置 allowlist、逻辑 Read path 与安全元数据边界；CSV 不需要独立解析契约才能完成附件引用 |
| **实现状态** | `[已实现-主干]` 默认 allowlist 仍为 `md`/`markdown`；配置后支持 CSV/TSV/TXT/JSON/XML/LOG，以及 PDF、Office、抓包、归档等已映射类型。附件原始内容不直接进入 prompt，模型仅获得安全元数据和逻辑 Read path；物理 materialized path 与 `storageRef` 不可见。兼容直传路径仍是 3 个、5 MiB、Markdown-only，不能与 staged composer 配置混为一谈 |
| **待补齐工作** | 无独立实现 change。产品若要改变默认 allowlist、提供特定格式预览，或收敛兼容直传路径，应分别提出新范围并重新评审安全边界 |

### A8. todoList i18n

| 维度 | 内容 |
|------|------|
| **UCD 设计位置** | `05-component-specs/tool-output-presentation-policy.md`（todoList kind） |
| **用户场景** | todoList 工具输出的系统摘要、空态和状态标签应按当前界面语言显示；工具/Agent 产生的 `content` 与 `activeForm` 保持原文 |
| **业务价值** | **已实现-主干** — 当前前端系统文案已本地化，同时保持业务内容逐值不变 |
| **设计要点** | 只本地化 presentation-owned 摘要、空态与 `pending/in_progress/completed` 标签，不把任意业务字符串当翻译 key |
| **Spec 状态** | `refine-capability-result-card-presentation` active change 已定义 TodoWrite 本地化要求，代码与测试已进入主干，待归档同步 Stable Spec |
| **实现状态** | `[已实现-主干]` 中英文系统摘要、状态标签、空态和 locale 切换均有定向覆盖；非法 status 仍 fail closed |
| **待补齐工作** | 无独立实现 change；原 `localize-agent-web-todo-result-presentation` 已被当前 active change 吸收 |

### A9. 结构化 onboarding

| 维度 | 内容 |
|------|------|
| **UCD 设计位置** | `06-empty-loading-error-states.md`（欢迎状态章节） |
| **用户场景** | 新用户首次进入系统，不了解有哪些能力、如何提问、有哪些 skill 可用，需要结构化引导流程快速上手 |
| **业务价值** | **中** — 降低新用户上手成本。当前欢迎状态已提供高频问题入口，可部分替代，但缺少 skill 介绍和示例对话引导 |
| **设计要点** | 新用户首次进入时展示结构化引导流程（功能介绍、skill 推荐、示例对话），而非仅静态欢迎页 |
| **Spec 状态** | 无。全目录无 onboarding spec |
| **实现状态** | 仅有欢迎状态（品牌 logo + 高频问题），无结构化引导 |
| **待补齐工作** | 1) 新建 spec 定义 onboarding 流程、步骤、状态持久化；2) 前端实现引导组件 |

---

## B 类：契约部分覆盖（18 项）

### B1. PIU onPiuSubmit 回调

| 维度 | 内容 |
|------|------|
| **UCD 设计位置** | `05-component-specs/expand-panel.md` |
| **用户场景** | ToolMessageType PIU 在扩展面板中修改配置后，将受控结果反馈给 Agent，沿共享 composer/request 路径形成新的用户输入；它不是协作式宿主调用 `sendQuestionToLui` 的反向回调 |
| **业务价值** | **高** — 能形成“PIU 审核配置 → Agent 解释/确认 → 再执行”的受控闭环，避免 PIU 直接修改后端状态 |
| **设计要点** | `[UCD目标/Clarify]` 可暂以 `onPiuSubmit` 描述 PIU 内提交动作，但实施前必须确定自动发送还是仅写草稿、payload schema 与大小上限、序列化失败体验，以及如何复用现有 composer/request owner |
| **现有覆盖** | `PiuMessage` 已向嵌套 PIU 注入面板 open/close/container host fields；`sendQuestionToLui` 是 collaborative host → LUI 的宿主 handler，不应复用为嵌套 PIU → Agent 的 owner |
| **缺口** | nested PIU submit 的受控输入语义与 owner 未定义；当前 payload 不含 submit callback |
| **待补齐工作** | 先完成 Clarify 决策，再由 OpenSpec change 定义 nested PIU submit → shared composer/request 的唯一实现路径、schema、错误处理与安全验证；不得把它写成宿主直接执行配置的通用回调 |

### B2. Workflow Progress Delta 发射

| 维度 | 内容 |
|------|------|
| **UCD 设计位置** | `08-sample-scenarios.md` 场景 22 |
| **用户场景** | 工作流执行多步骤任务时（如"检查 10 个设备 → 汇总 → 生成报告"），用户需要实时看到当前执行到第几步、整体进度如何 |
| **业务价值** | **中** — 提升工作流执行的透明度。当前能力卡片只显示 running 态，用户无法判断工作流是否卡住还是正常执行中 |
| **设计要点** | 工作流执行过程中发射进度增量（progress delta），前端实时展示工作流步骤完成进度 |
| **现有覆盖** | `conversation-ui-state.md` 设计文档 §2 在 `CAPABILITY_RESULT_DELTA` 中提到 `safeProgress` 字段；`refine-ts-workflow-visible-delta-limit` change 和 `tool-structured-delta` spec 涉及 delta 通用机制 |
| **缺口** | 无独立 spec 要求定义 workflow progress delta 的发射时机、字段结构、频率限制 |
| **待补齐工作** | 1) 在 `workflow-execution-engine` 或 `workflow-capability-nodes` spec 中补充 progress delta 发射条款；2) 后端实现 progress delta 发射；3) 前端实现进度展示 |

### B3. 会话列表项高级特性

| 维度 | 内容 |
|------|------|
| **UCD 设计位置** | `05-component-specs/session-list-item.md` |
| **用户场景** | 用户有多个会话时，需要快速识别哪个会话有活跃任务正在执行、哪个会话有新消息、哪些已收藏 |
| **业务价值** | **中** — 提升多会话管理效率。当前列表项只有标题和时间，用户需要逐个点进去才能判断会话状态 |
| **设计要点** | 会话列表项展示 preview marker（最后消息预览标记）、live 指示器（有 active run 时高亮）、收藏标记、时间分组等高级视觉特性 |
| **现有覆盖** | `[已实现-主干]` 独立 Session Activity Projection Stream 与共享 trailing slot 已交付五态注意力投影；conversation preview API 已被当前会话 marker rail 使用；annotation 是 request-run/turn 语义，不是 session 收藏 |
| **缺口** | activity 子项已关闭；sidebar preview 仍需选 inline 或 hover 方案并约束请求成本；session 收藏没有现成同义契约，不能复用 turn annotation 冒充 |
| **待补齐工作** | 1) 不再建设 frontend-only run-awareness 路径；2) preview 由独立 clarify/candidate 决策；3) favorite 只有在产品明确 session-level 语义后才能独立立项 |

### B4. 对话预览

| 维度 | 内容 |
|------|------|
| **UCD 设计位置** | 已交付当前会话轨道见 `04-information-architecture.md`、`05-component-specs/conversation-preview-rail.md`、`03-full-ui-layout.md` §2.8；sidebar 摘要目标见 `session-list-item.md` |
| **用户场景** | 用户在会话列表中浏览多个会话，不点击进入会话就能看到最近一轮对话的预览文本，帮助快速判断要切哪个会话 |
| **业务价值** | **低** — 列表项标题+时间通常足够判断会话内容，预览是增强体验非必需。且多个同名会话场景较少 |
| **设计要点** | 当前会话 preview marker rail 已交付，支持 hover 摘要和点击跳转。Sidebar 摘要仍有两个候选：A) 会话列表项内嵌 1 行截断；B) hover card；两者都必须先解决批量数据与容量边界 |
| **现有覆盖** | `session-conversation-preview` spec 与 API 已实现；`ChatPage` 已消费 preview markers 构建当前会话右侧导航 rail |
| **缺口** | `[部分实现]` sidebar 列表项尚无 preview consumer 或 hover card；不能概括为“前端无 UI 消费” |
| **待补齐工作** | 1) 在 inline 1 行预览与 hover card 中选择一种；2) 明确懒加载/批量请求成本与定位语义；3) 再补 UI 条款和 sidebar 实现，不同时承诺两个候选方案 |

### B5. 工具输出呈现策略框架

| 维度 | 内容 |
|------|------|
| **UCD 设计位置** | `05-component-specs/tool-output-presentation-policy.md` |
| **用户场景** | 不同类型的工具结果（命令输出、文件读取、文件列表等）需要不同的呈现方式，框架统一规范前端如何渲染各类结果 |
| **业务价值** | **中** — 规范化呈现避免每个工具各自实现导致的视觉不一致。当前各 kind 已有独立实现但缺乏统一策略约束 |
| **设计要点** | 结构化工具输出呈现策略应区分 backend/upstream projection、frontend parser、specialized formatter 与 generic fallback，不能用固定 kind 数量代替当前消费状态 |
| **现有覆盖** | `ts-run-status-visibility` 已约束 capability result 只能暴露安全投影；前端 parser、普通结果 formatter、`pendingInputAnswer` 补充信息关联路径与 generic fallback 均已形成明确分层。`conversation-ui-state.md` §2 仍可作历史导航，但其固定矩阵已登记 UCD-R20 漂移 |
| **缺口** | 已实现三档结果披露，但按场景配置截断阈值、内容扫描和 share 一致性的四策略 UCD 目标尚未形成可实施契约；新增 kind 的专门呈现仍应由对应用户可见 vertical change 定义 |
| **待补齐工作** | 先澄清四策略目标的安全 owner、scope、默认值和 live/history/share 一致性；出现可验证用户收益时，再为具体 kind 补 parser/formatter/spec scenario |

### B6. todoList kind 场景覆盖

| 维度 | 内容 |
|------|------|
| **UCD 设计位置** | `05-component-specs/tool-output-presentation-policy.md`、`08-sample-scenarios.md` |
| **用户场景** | Agent 使用 todo-write 工具创建待办列表（如"1. 检查网络连通性 2. 查看告警 3. 分析日志"），前端应渲染为可视化的待办卡片并显示每项状态（进行中/已完成），而非纯文本 |
| **业务价值** | **已实现-主干** — todoList safe result 已由前端消费并呈现，presentation-owned 文案本地化也已交付 |
| **设计要点** | todoList kind 在场景文档中有设计（`todos[]` 含 `content`、`activeForm`、`status`），前端应渲染为待办列表卡片 |
| **现有覆盖** | `[已实现-主干]` `projectTodoWriteSafeResult` 投影 `kind=todoList`；前端 `readSafeCapabilityResult` 与 `processDetails.ts` 已消费 `todos[]` 并生成摘要/详情 |
| **缺口** | 已关闭。系统摘要、状态标签与空态已本地化；工具/Agent 产生的 `content` 与 `activeForm` 保持原文 |
| **待补齐工作** | 无；后续只保留 parser、formatter、locale 切换与 fail-closed 回归覆盖 |

### B7. 长消息折叠/展开

| 维度 | 内容 |
|------|------|
| **UCD 设计位置** | `05-component-specs/message-bubble.md` |
| **用户场景** | Agent 回复非常长时（如详细故障分析报告、批量配置清单），自动折叠显示前几行 + "展开"按钮，避免占满屏幕影响后续对话阅读 |
| **业务价值** | **中** — 提升长内容的阅读体验和对话流畅性。当前长消息直接全量展示，可能影响对话区滚动和后续消息可见性 |
| **设计要点** | 超长 ASSISTANT 消息自动折叠，显示前 N 行 + "展开"按钮，点击后展开全文 |
| **现有覆盖** | `conversation-ui-state.md` §6 提到"思考过程（可折叠）"和过程面板"完成后可折叠"；`agent-web-expand-panel` spec 覆盖 Expand Panel 机制 |
| **缺口** | 无正式 spec 要求定义长消息折叠阈值、折叠/展开交互 |
| **待补齐工作** | 1) 在 `agent-web-chat-pane-styles` 或新建 spec 中补充长消息折叠条款（阈值、交互、持久化）；2) 前端实现完整折叠/展开 |

### B8. settling ExecutionDetailsPhase

| 维度 | 内容 |
|------|------|
| **UCD 设计位置** | `05-component-specs/process-panel.md` |
| **用户场景** | 能力执行完成后，结果不是瞬间闪现的，而是有一个短暂的渐入动画（类似结果"落位"的过程），让用户视觉上感知到"执行完成 → 结果呈现"的过渡 |
| **业务价值** | **低** — 纯视觉体验优化，不影响功能正确性。当前 running → settled 直接切换虽略显突兀但不影响使用 |
| **设计要点** | 过程面板执行详情有三阶段状态机：`running`（能力执行中）→ `settling`（能力刚完成，结果正在渐入呈现的过渡动画）→ `settled`（结果已完整呈现，过程面板自动折叠）。`settling` 是 running 和 settled 之间的短暂过渡态，避免结果瞬间闪现显得突兀 |
| **现有覆盖** | `conversation-ui-state.md` §6 提到"running/settling/settled 动画"；`add-ucd-conversation-interface-contract` task 5.6 引用 `resolveExecutionDetailsPhase` |
| **缺口** | settling phase 无正式 spec 定义，仅设计文档描述 |
| **待补齐工作** | 1) 在 `agent-web-process-panel` spec 中补充 ExecutionDetailsPhase 状态机条款；2) 前端补全 settling 阶段实现 |

### B9. 降级提示卡片未用后端字段

| 维度 | 内容 |
|------|------|
| **UCD 设计位置** | `05-component-specs/degradation-notice.md` |
| **用户场景** | 系统降级时（如某个子系统不可用），降级提示卡片应展示完整的降级信息：降级原因、是否可重试、错误码等，帮助用户理解发生了什么以及下一步该怎么做 |
| **业务价值** | **中** — 当前只展示 code 和 detail 文本，用户无法判断降级是否可恢复、是否需要手动操作 |
| **设计要点** | 降级提示卡片应展示 `code`、`message`、`category`、`retryable`、`reasonCode`、`safeSummary`、`status` 等字段 |
| **现有覆盖** | `conversation-ui-state.md` §1 row 8 列出 `DEGRADATION_NOTICE` 的 safe fields；`ts-run-status-visibility` spec 覆盖降级提示可见性 |
| **缺口** | 后端提供部分字段，前端未全部消费；无"前端必须消费哪些字段"的 spec 要求 |
| **待补齐工作** | 1) 在 `ts-run-status-visibility` 中补充字段消费要求（MUST render）；2) 前端补全字段渲染 |

### B10. 并行工具调用流投影缺口

| 维度 | 内容 |
|------|------|
| **UCD 设计位置** | `01-user-journeys.md` 旅程 27、`08-sample-scenarios.md` 场景 26、`05-component-specs/process-panel.md`（并行组合 + 并行徽标）、`05-component-specs/capability-card.md`（并行徽标） |
| **用户场景** | 模型并行调用多个工具时（如同时查告警、查配置、查日志），用户应能看到"并行 N/M"指示，区分并行执行与串行执行，理解多个工具在同时执行而非依次 |
| **业务价值** | **中** — 并行执行是已有能力但用户无法感知"并行"特性，徽标帮助用户理解执行模式，同时帮助运维人员定位并行执行相关的问题 |
| **设计要点** | `stream-envelope.ts` 的 `copySafeFields` 需补充 `toolBatchExecutionMode`/`toolBatchOrdinal`/`toolBatchSize` 三个字段的投影；前端过程面板消费批次字段渲染"并行 N/M"徽标 |
| **现有覆盖** | 后端 timeline event 已持久化批次元数据（`capability-timeline-payload-schemas.ts`）；Dev Workbench Run Graph 已消费（fan-out/fan-in 渲染）；前端流未投影 |
| **缺口** | `stream-envelope.ts` L284 `copySafeFields` 未包含批次字段；前端 `processDetails.ts` 无并行批次识别逻辑 |
| **待补齐工作** | 1) 在 `ts-run-status-visibility` spec 中补充批次字段投影要求；2) `stream-envelope.ts` 补充 `copySafeFields`；3) 前端 `processDetails.ts` 消费批次字段渲染并行徽标 |

### B11. per-entry auto-collapse/expand（已实现-主干）

| 维度 | 内容 |
|------|------|
| **UCD 设计位置** | `02-dynamic-behavior-and-interaction.md` 第 1.2 节、`05-component-specs/process-panel.md`（动态行为与交互响应章节） |
| **用户场景** | 执行过程中已完成步骤自动折叠、当前步骤展开，形成“跟随执行进度”的视觉效果 |
| **业务价值** | **高** — 多轮 think+tool 场景下减少信息过载，用户可聚焦当前执行步骤 |
| **设计要点** | 条目进入终态后延迟 800ms 自动折叠（让用户看到结果预览），`grid-template-rows: 1fr → 0fr`，200ms ease-out。用户手动展开/折叠后该条目 auto 行为冻结 |
| **现有覆盖** | 新条目 auto-expand、completed entry 800ms auto-collapse、用户手动覆盖和 request terminal 后 150ms panel collapse 均已交付 |
| **当前 disposition** | `[已实现-主干]`，不得继续作为开发缺口领取；可复现回归按 bug 处理 |

### B12. running 条目高亮

| 维度 | 内容 |
|------|------|
| **UCD 设计位置** | `02-dynamic-behavior-and-interaction.md` 第 1.2 节、`05-component-specs/process-panel.md`（动态行为与交互响应章节） |
| **用户场景** | 多个条目同时存在时（尤其并行工具调用），用户需要快速识别哪个正在执行 |
| **业务价值** | **中** — 视觉焦点跟随执行进度，降低认知负担 |
| **设计要点** | running 条目显示左侧色条或背景色区分，与已完成条目形成视觉对比 |
| **现有覆盖** | idle-sweep 扫光效果（`ProcessPanel.tsx` L83-110）在 active entry 上有动画，但无条目级别的边框/背景高亮 |
| **缺口** | 无 running 条目独立高亮视觉 |
| **待补齐工作** | 前端 ProcessPanel 补充 running 条目的边框/背景高亮样式 |

### B13. 新条目 fade-in 动画

| 维度 | 内容 |
|------|------|
| **UCD 设计位置** | `02-dynamic-behavior-and-interaction.md` 第 3.7 节 |
| **用户场景** | 新条目（think/capability/degradation）出现时，用户希望有平滑的视觉过渡而非突然出现 |
| **业务价值** | **低** — 纯视觉体验优化，不影响功能 |
| **设计要点** | 新条目出现时 fade-in + slide-down 200ms ease-out |
| **现有覆盖** | 条目展开/折叠有 grid-template-rows 过渡（L700-707），但新条目首次出现无进入动画 |
| **缺口** | 新条目直接渲染，无进入动画 |
| **待补齐工作** | 前端补充新条目 CSS 进入动画 |

### B14. scroll-to-active 条目滚动

| 维度 | 内容 |
|------|------|
| **UCD 设计位置** | `02-dynamic-behavior-and-interaction.md` 第 2 节 |
| **用户场景** | 过程面板内容超出视口时（多轮 think+tool），用户需要自动滚动到当前执行步骤 |
| **业务价值** | **中** — 面板内容多时用户看不到新条目，需手动滚动 |
| **设计要点** | active 条目复用共享 bottom-following viewport owner，避免条目级 `scrollIntoView` 争抢滚动控制 |
| **现有覆盖** | `[已实现-主干]` active key/sequence 已接入共享 viewport following；会话列表与 slash 命令仍在各自独立视口使用 `scrollIntoView` |
| **缺口** | 无；不得恢复第二个过程面板 viewport controller |
| **待补齐工作** | 无；后续只做共享 owner 内的视觉调优 |

### B15. 通用交互响应模式

| 维度 | 内容 |
|------|------|
| **UCD 设计位置** | `02-dynamic-behavior-and-interaction.md` 第 3 节（7 个维度） |
| **用户场景** | 用户期望一致的 hover/focus/click/disabled 视觉反馈，当前各组件表现不一致 |
| **业务价值** | **中** — 11/14 组件缺 hover，12/14 缺 focus，几乎全缺 click 视觉反馈。交互一致性影响用户信任和操作效率 |
| **设计要点** | 统一 hover（背景色变化 120ms）、click（active scale 0.98 100ms）、focus（focus-visible outline 2px）、disabled（opacity 0.5 + cursor not-allowed）、loading（skeleton/spinner）、error（error 色 + 图标）、appear/disappear（fade-in 200ms / fade-out 150ms） |
| **现有覆盖** | 会话列表项 hover/focus/键盘 已实现；composer 按钮 hover 已实现；消息气泡 hover 按钮已实现 |
| **缺口** | 11/14 组件缺 hover，12/14 缺 focus，13/14 缺 appear/disappear 动画，10/14 缺 disabled 统一规范 |
| **待补齐工作** | 1) 定义前端交互响应 CSS 规范（hover/click/focus/disabled）；2) 各组件按规范补全；3) 定义 appear/disappear 动画 CSS 类 |

### B16. thinking history continuity（已实现-主干）

| 维度 | 内容 |
|------|------|
| **UCD 设计位置** | `process-panel.md` L314（"think 条目 history 可见"）、`08-sample-scenarios.md` L322（"思考过程由持久化消息重建"）、`conversation-ui-state.md` L257/L290（"history 由持久化完整 think 重建"） |
| **用户场景** | 用户浏览历史对话时，可展开过程面板查看每次模型调用完成的 thinking，并与 live 完成后的过程一致 |
| **业务价值** | **高** — 已消除刷新、切换会话和历史浏览造成的 thinking 信息丢失 |
| **设计要点** | 未完成累计 delta 为 LIVE_ONLY；每次模型调用最后一条 `completed=true` 累计 snapshot 持久化；history 通过 run Event 查询恢复 |
| **现有覆盖** | Message 与 Event 分离查询；Event history 渐进加载；live/history 按 `sessionId + runId + rootMessageId + stepId` 合并；fork 携带 durable Event snapshot |
| **剩余边界** | 字段级安全过滤、配置 owner 与 live/history/share 的不可逆 safe projection 仍属于 B17/B18，不因 B16 交付而自动完成 |
| **当前 disposition** | `[已实现-主干]`，不得继续作为开发缺口领取；可复现回归应登记为 bug |

### B17. think/answer 内容可配置安全过滤

| 维度 | 内容 |
|------|------|
| **UCD 设计位置** | `02-dynamic-behavior-and-interaction.md`（第 1.6 节 think/answer 安全过滤）、`05-component-specs/process-panel.md`（think 条目）、`05-component-specs/message-bubble.md`（answer 气泡）、`conversation-ui-state.md`（Think 内容持久化与安全过滤章节） |
| **用户场景** | 模型在推理（think）或回答（answer）中可能泄露两类敏感信息：1) **模式化秘密**——API key、token、密码、文件路径、用户隐私等（可被正则识别；IP 是业务内容，不属于该类）；2) **语义内容泄漏**——模型在 think 自由文本中复述了被字段白名单保护的内容（系统 prompt 原文、工具调用参数、工具 raw 结果正文、skill body），这些内容在 stream 层本已通过字段白名单不投影给用户，但模型在推理时复述它们，think 纯透传管道导致白名单保护被绕过。生产环境下这些信息不应原文呈现给用户；开发调测阶段工程师需要看到完整原文以排查模型行为。平台管理员需要根据环境切换过滤策略 |
| **业务价值** | **高** — 安全合规与调试效率的双向需求。`[已实现-主干]` 已有 terminal `finalContent` 正则替换、REMOTE guardrail 整轮拦截和 completed thinking 持久化，但这些仍不等同于统一的 live thinking/answer 字段级脱敏，因此不能声称 live/history/share 已消费同一不可逆 safe projection |
| **设计要点** | `[历史 UCD 提案，尚未准入]` 原提案包含正则扫描、源内容匹配、prompt 约束和 prod 隐藏 thinking。任何落地不得为了做源内容匹配而把 raw prompt、tool result、skill body 或 args 下放给 Web projection；必须先从数据最小化和 owner 边界出发，决定在何处形成不可逆 safe projection，并定义字段级替换与 REMOTE 整轮阻断的优先级及 fail-closed 行为 |
| **现有覆盖** | 1) `system-output-redaction-guard.ts` 在 `BEFORE_AGENT_TERMINAL` 对 `finalContent` 做 credential-like、Bearer、`sk-` token、手机号和本地/内部路径替换，并可阻断私钥；IPv4/IPv6 保留原文；2) REMOTE 且启用 guardrail 时，经 `GuardrailGatewayPort` 做输入/输出检查，输出命中可投影 terminal `OUTPUT_GUARD_BLOCKED`、清除本轮已渲染内容并把 assistant 终态消息标记为 `visible=false`；3) stream safe-field 白名单继续保护结构化工具字段 |
| **缺口** | 当前是“terminal 字段替换 + 可选 REMOTE 整轮阻断”，不是统一字段级 live stream 过滤；completed thinking 虽已持久化/hydrate，但持久化内容尚未由统一字段级 safe projection 形成，answer live delta 与 terminal 替换也可能呈现不同内容；share/history 的 authoritative safe projection 未统一定义 |
| **待补齐工作** | 作为 `harden-user-visible-agent-content-redaction` clarify：先定义 owner、适用 deployment、字段级替换与整轮阻断的关系、live/history/share 一致性、配置和 fail-closed 行为；确认不会把 raw sensitive sources 下放到 Web/channel 后，再拆出最小实现 change 与 negative security tests |
| **落地节奏** | `[Clarify]` 先由 `harden-user-visible-agent-content-redaction` 形成唯一安全 owner、scope、fail-closed 和持久化路径；随后才能判断需修改哪些 OpenSpec 与代码。不得把本历史 UCD 方案直接视为已批准的实现顺序。 |

### B18. 平台管理员配置管理

| 维度 | 内容 |
|------|------|
| **UCD 设计位置** | `02-dynamic-behavior-and-interaction.md`（安全过滤章节）、`05-component-specs/process-panel.md`、`05-component-specs/message-bubble.md` |
| **用户场景** | 平台管理员需要根据运行环境（开发调测 / 生产运行）调整系统行为，如 think/answer 安全过滤开关（B17）。当前无统一的管理员配置管理基础设施，无法集中管控这类环境敏感的运行时策略 |
| **业务价值** | **高（目标依赖待澄清）** — B17 需要可信、可审计的策略来源，但这不自动等于建设通用动态管理员控制面；启动期系统配置或 Agent 配置也可能是更小的正确方案 |
| **设计要点** | 1) **配置项承载**：提供管理员配置管理入口，承载 think/answer 安全过滤开关（B17）等环境敏感配置项；2) **模式区分**：支持 dev 模式（调测，过滤关闭、完整显示）与 prod 模式（运行，过滤开启）的预设切换，也支持单项独立调整；3) **生效范围**：配置变更对流式请求和 history 重建同时生效，保证 live=history；4) **审计**：配置变更需可审计（谁、何时、改了什么）；5) **默认值**：生产环境默认过滤开启，开发环境默认关闭；6) **B17 配套配置项**：除 dev/prod 过滤开关外，承载 B17 第 4 层"prod 模式可选隐藏 think"配置项——对安全要求极高的场景可配置为完全隐藏思考过程，作为多层防御的兜底措施 |
| **现有覆盖** | `gateway-configuration` spec 覆盖网关级配置；`observability.logging.redaction` 配置项存在但仅作用于 observability 层且不可放宽。无面向 conversation stream 的管理员配置管理 |
| **缺口** | 无统一的管理员配置管理基础设施承载 conversation stream 层的过滤开关；无 dev/prod 模式预设 |
| **当前处置** | `[Clarify]` 配置能力仍是 B17 的目标依赖，但不预设必须建设通用动态管理员控制面。先随 `harden-user-visible-agent-content-redaction` 确认启动期系统配置、Agent 配置或动态管理员配置中的唯一 owner、scope、默认值、请求内冻结时机、变更生效和审计语义 |
| **待补齐工作** | 先完成上述配置边界决策；只有确认需要运行期动态修改时，才新建管理 API/UI change。不得为了一个开关先建设通用配置平台，也不得静默取消 B17 已声明的配置目标 |

### B19. Cron 任务执行结果会话归属策略（架构遗留）

| 维度 | 内容 |
|------|------|
| **UCD 设计位置** | `05-component-specs/cron-task.md`（管理面板章节） |
| **用户场景** | 用户创建定时任务后，任务触发执行产生的 think/tool/answer 结果应该写到哪里、用户如何查看执行结果，是 cron 任务闭环的核心问题。当前实现把执行结果追加到**创建任务时的原会话**，引发多个严重问题（见下） |
| **业务价值** | **高** — 这是超出 UCD 范围的架构层面问题，影响对话上下文正确性、会话模型一致性、用户可追溯性。不解决会让 cron 任务长期运行后污染原会话、扭曲后续对话上下文，且用户无法有效回溯执行结果 |
| **当前实现** | `cron-delivery-composition.ts` L29-38 调用 `runtime.submit({ sessionId: task.sessionId, ... })` 复用任务创建时的原会话。`task.sessionId` 在 `cron-task-gateway-adapter.ts` L34 创建时捕获 |
| **核心问题** | 1) **上下文污染**：`appendSessionMessage`（`sqlite-gateway-core.ts:1950-1961`）原子性地把 cron turn 的消息写入 session timeline **并追加到 active context**。下次用户在该会话发消息时，`assemble-context.ts:247-261` 从 active context 取历史 turn——cron 产生的 think/tool/answer 会进入用户下次对话的 LLM 上下文窗口，扭曲模型行为；2) **会话不可变性违反**：`SessionRecord` 接口（`agent-contracts/src/gateway/index.ts:524-534`）没有 status 字段，不存在"已结束"概念，cron 触发无限追加 turn 违反"会话结束内容不可变"原则；3) **用户难查看**：cron turn 与用户 turn 混在同一会话时间线，无入口反向定位到触发产生的 turn |
| **架构原则约束** | 按"任务输出与上下文解耦原则"（`conversation-ui-state.md` 同名章节），cron 触发执行等价于**选择 2 转后台**——输出不应进入原会话 active context。这为下方三个候选方案提供共同约束：任何方案都必须保证 cron 触发产生的 think/tool/answer 不污染原会话 context |
| **候选方案** | **方案 1：每次触发 fork 独立 session**——真正实现不可变性，复用现有 `forkFromMessage`，但循环任务产生大量 session，需归档/清理策略；fork 复制消息前缀有性能成本；无法跨触发累积上下文。**方案 2：任务创建时 fork 一个执行派生会话**——session 数量可控，但派生会话持续被追加，本身违反不可变性，把问题从原会话转移到派生会话；active context 失控增长最终可能触发上下文窗口限制。**方案 3：执行结果不进会话，写独立任务日志**——隔离最彻底，审计友好，但需新建执行引擎路径、新存储模型、新流式通道、新前端渲染路径，与 agent 运行时脱钩，维护成本高，失去 conversation 体系统一性。三个方案均需满足"输出不进原会话 context"约束 |
| **设计要点** | 待架构层重新评估后确定。三个方案的对比详见 `05-component-specs/cron-task.md` 管理面板章节"执行结果查看（遗留）"小节 |
| **现有覆盖** | `session-fork-from-message` spec 提供 fork 机制（`submit.ts:350-467`），但 cron delivery 未使用。无 cron 执行独立日志机制 |
| **缺口** | cron 执行结果会话归属策略未定义；会话不可变模型未定义；cron 触发结果查看入口未定义 |
| **待补齐工作** | 1) 架构层评估三个候选方案，确定 cron 执行结果归属策略；2) 若选方案 1 或 2：扩展 `cron_tasks` 增加 `executionSessionId`、改 delivery composition 调用 fork、UI 标记派生 session；3) 若选方案 3：新建 cron 执行日志 spec、存储模型、流式通道、前端渲染；4) 会话模型层评估是否引入 status 字段或不可变约束；5) UCD 层补齐执行结果查看入口设计 |
| **UCD 阶段处理** | **遗留至架构层**。UCD 阶段不解决执行结果归属问题，仅设计到"管理面板可查看定时任务本身（任务列表、调度计划、状态、触发时间）"，执行结果查看入口暂不设计。详见 `05-component-specs/cron-task.md` 管理面板章节"执行结果查看（遗留）"说明 |

### B20. 工具协议扩展：background 参数 + outputContextMode 声明 + cancel/progress 接口

| 维度 | 内容 |
|------|------|
| **UCD 设计位置** | `openspec/designs/architecture/conversation-ui-state.md` "任务输出与上下文解耦原则"章节、`05-component-specs/background-task-monitor.md` "taskType 泛化方向"章节、`05-component-specs/capability-card.md`（长时能力扩展态） |
| **用户场景** | 当前只有 Bash 支持 `run_in_background: true` 转后台执行，其他工具调用必须同步等待。用户面对长时网络诊断、配置审计等工具调用时，无法选择"转后台"或"Fork 继续"，只能干等。按"任务输出与上下文解耦原则"，任何长时工具调用都应支持三个选择（等待/转后台/Fork 继续），需工具协议层提供能力声明与生命周期控制接口 |
| **业务价值** | **中** — A3（长时能力扩展态）、A4（Fork-to-Continue）、B19（cron 执行会话归属）三个高价值 gap 的前置基础设施。没有工具协议扩展，"转后台"只能停留在 Bash，长时能力扩展态的 CTA 无法泛化，cron 触发也只能继续追加到原会话 |
| **设计要点** | 1) **`background` 参数泛化**：工具调用支持 `background: true` 参数（泛化自 Bash 的 `run_in_background`），允许任何工具在发起时直接选择"转后台"；2) **`outputContextMode` 声明**：工具在 spec 中声明输出与上下文的关系（`required`/`decoupled`/`user-choice`），决定可用 CTA；3) **`cancel()` 接口**：工具可选实现 cancel 接口，供"转后台"后用户 Kill（未实现 cancel 的工具，Kill 按钮置灰）；4) **`reportProgress()` 接口**：工具可选实现进度上报，供扩展态进度条与 `⚡` 面板展示；5) **`BackgroundTaskView` 泛化**：增加 `taskType`（`shell`/`tool`）字段，shell 保留 stdout/stderr/exitCode，tool 增加 toolName/progress/safeResultRef |
| **现有覆盖** | `agent-web-background-task-control` spec 覆盖 Bash 后台任务的 monitor/kill（SIGTERM），不支持 tool 类型；工具协议无 `background` 参数、`outputContextMode` 声明、cancel/progress 接口 |
| **缺口** | 工具协议未泛化 background 参数；无 `outputContextMode` 声明机制；无 cancel/progress 接口契约；`BackgroundTaskView` 数据模型仅承载 shell 类型 |
| **待补齐工作** | 1) 新建 spec 定义工具协议扩展（`background` 参数、`outputContextMode` 声明、`cancel()`/`reportProgress()` 接口）；2) 扩展 `BackgroundTaskView` 数据模型支持 `taskType`；3) 改造 `killTask` 按 `taskType` 分发（shell → SIGTERM；tool → cancel API）；4) 现有工具按场景声明 `outputContextMode` 并按需实现 cancel/progress；5) `⚡` 监控面板与能力卡片扩展态消费新字段 |
| **依赖关系** | A3（长时能力扩展态）、A4（Fork-to-Continue）、B19（cron 执行会话归属）均依赖本项。本项不落地，三个 gap 的 CTA 与分流逻辑无法泛化到非 Bash 工具 |
| **UCD 阶段处理** | UCD 已在 `conversation-ui-state.md` "任务输出与上下文解耦原则"章节与 `background-task-monitor.md` "taskType 泛化方向"章节记录目标状态。spec 与代码落地待 UCD 定稿后统一推进 |

### B21. 集成方定制能力 UCD 文档集中梳理缺口

| 维度 | 内容 |
|------|------|
| **UCD 设计位置** | `12-integrator-customization-guide.md`（本 change 新建） |
| **用户场景** | 集成方开发者需要一份完整的定制能力清单来规划集成方案。能力曾散落在 `aico-config-contract`/`aico-piu-injection`/`agent-web-multi-host-modes`、产品简报、组件规范与源代码中，集成方难以建立全景认知 |
| **业务价值** | **中** — 集成方接入效率受影响，但不影响终端用户。已有 spec 完整覆盖契约，缺的是 UCD 层面的集中梳理 |
| **设计要点** | `12-integrator-customization-guide.md` 按 7 类组织 40 个定制点（含 `renderKnowledge` 与 `handleHistoricalChatReplay`，并区分已实现、预留、类型未接线与 UCD 目标），给出契约字段映射、实现位置、HostMode 矩阵与场景示例 |
| **现有覆盖** | `[已实现-主干]` 集成指南已集中梳理，并补充 `renderKnowledge`、协作式历史聊天回放、`userAction` 仅类型声明、`$stateChange.theme` 实际行为与 PIU payload 例外 |
| **缺口** | 已关闭；后续只需随 public contract 同步维护 |
| **待补齐工作** | 无独立 change |
| **UCD 阶段处理** | B21 关闭 |

---

## C 类：契约就绪，实现待补（13 项）

### C1. degraded / replayed 连接状态

| 维度 | 内容 |
|------|------|
| **UCD 设计位置** | `06-empty-loading-error-states.md` |
| **用户场景** | 网络不稳定时，用户需要知道连接是否正常、是否有事件遗漏、是否正在同步缺失事件。缺少这些状态指示会导致用户不确定看到的内容是否完整 |
| **业务价值** | **中** — 提升断线重连场景的透明度。当前只有 reconnecting/disconnected 两态，用户无法感知"有事件遗漏"和"事件已补齐" |
| **设计要点** | 连接状态阶梯：`connected`（正常连接）→ `degraded`（检测到断线期间有遗漏事件）→ `disconnected`（已断开）→ `reconnecting`（正在重连）→ `replayed`（遗漏事件已补齐）→ `live-tail`（恢复实时接收），各状态有对应 UI 指示 |
| **Spec 位置** | `conversation-ui-state.md` §4（状态阶梯定义）；`ts-stream-resume-replay` spec；`ts-web-sse-ws-transports` spec；`system-health-check` spec |
| **实现状态** | 前端未实现 `degraded` 和 `replayed` 状态指示 |
| **待补齐工作** | 按 spec 实现前端状态指示组件 |

### C2. workflow-interrupt pending input durable kind 决策

| 维度 | 内容 |
|------|------|
| **UCD 设计位置** | `05-component-specs/pending-input-card.md` |
| **用户场景** | 工作流执行到交互节点（如审批节点）时需要暂停等待用户确认，用户应答后工作流继续执行。缺少此能力则工作流无法在中间步骤暂停等待人工输入 |
| **业务价值** | **高** — 工作流交互节点是工作流引擎的核心能力，缺失则工作流只能全自动执行无法人工介入 |
| **设计要点** | UCD 目标是工作流中断时呈现不可误答的专用等待状态；当前 wire shape 是 `QUESTION + WORKFLOW_NODE/INTERRUPT producerRef + 空 questions`，并不存在已冻结的 `workflow-interrupt` durable kind |
| **Spec 位置** | `workflow-interaction-nodes` 与 conversation UI 设计存在相关表达，但现有 durable pending-input kind vocabulary 与 UCD 名称并未形成可直接消费的一致契约 |
| **实现状态** | `[Clarify]` 这不是单纯增加一个前端分支；必须先决定 workflow interrupt 是新的 durable kind，还是映射到既有 canonical kind，并保持 pending input lifecycle/response owner 一致 |
| **待补齐工作** | 先完成 durable kind 与可信 presentation derivation 的二选一、safe projection 和 fail-closed 决策；若选择新增 durable kind，再同步 backend schema、Web DTO、frontend exhaustive consumer 与 contract/negative tests |

### C3. clipStream* kinds

| 维度 | 内容 |
|------|------|
| **UCD 设计位置** | `05-component-specs/tool-output-presentation-policy.md` |
| **用户场景** | 流式片段输出（如视频/音频/数据流的处理结果），需要特殊的流式渲染方式。当前无明确的业务场景驱动 |
| **业务价值** | **低** — 当前无明确使用场景，标记为 deferred gap，需确认是否有业务需求再决定是否实现 |
| **设计要点** | 3 种 clipStream kind：`clipStreamEvent`、`clipStreamCompletion`、`clipStreamResult`，用于流式片段输出 |
| **Spec 位置** | `conversation-ui-state.md` §2 的历史矩阵与其后 gap 总结相互矛盾，已登记 UCD-R20；当前 CLIP 安全投影由 `agent-core/src/tools/clip-result-safe-projection.ts` 实现，但仍缺少与当前字段一致的稳定 spec scenario |
| **实现状态** | `[部分实现]` `CUSTOM clip_server` 已生成 `clipStreamEvent`/`clipStreamCompletion`/`clipStreamResult` upstream safe projection并由 channel透传；前端 parser/formatter 不识别，当前走 generic safeSummary/detail fallback |
| **待补齐工作** | 当前不单独立项。若出现明确业务场景，再补稳定 spec、前端 parser/formatter 和安全/降级测试；无需重复实现后端 projector |

### C4. Cron kind 前端渲染

| 维度 | 内容 |
|------|------|
| **UCD 设计位置** | `05-component-specs/cron-task.md` |
| **用户场景** | Agent 通过 cron 工具创建/列出/删除定时任务后，前端应渲染为定时任务卡片（展示任务名称、调度表达式、是否循环等），而非纯文本 safeSummary |
| **业务价值** | **中** — 提升定时任务结果的可读性。该价值已由主干中的本地化结构呈现交付 |
| **设计要点** | cron kind 在过程面板中按 create/list/delete 本地化呈现：create 显示任务 ID、可读调度计划和循环标记；list 显示有界任务清单及 cron 表达式；delete 显示被删除任务 ID。当前安全投影不包含 `nextRunAt`，不得在卡片中推导或展示 |
| **Spec 位置** | `cron-tools` change（`openspec/changes/add-ts-cron-tools/specs/cron-tools/spec.md`）含 "Cron 结果安全投影到 LUI" 要求和 LUI safe result projection addendum |
| **实现状态** | `[已实现-主干]` 后端投影、前端 parser 与 create/delete/list 本地化专门 formatter 均已交付 |
| **待补齐工作** | 无；后续仅在修改 Cron safeResult 或 formatter 时保留回归覆盖 |

### C5. httpResponse kind

| 维度 | 内容 |
|------|------|
| **UCD 设计位置** | `05-component-specs/tool-output-presentation-policy.md` |
| **用户场景** | Agent 执行 HTTP 请求工具，结果应以结构化方式展示 HTTP 状态码、响应头、响应体，而非纯文本 |
| **业务价值** | **低** — 前端 parser/history adapter 已能识别或构造 `httpResponse`，但 `processDetails.ts` 没有专门 formatter，当前安全通用摘要已可用；没有专属交互收益前不立项 |
| **设计要点** | httpResponse kind 展示 HTTP 请求/响应结果（status code、headers、body） |
| **Spec 位置** | `conversation-ui-state.md` §2 row 10（标记"前端专用"，无后端投影）；`add-ucd-conversation-interface-contract` design.md Gap 2 |
| **实现状态** | `[部分实现]` 前端 parser 支持，后端通用 projection 无专门分支，且 ProcessPanel 无专门 HTTP 卡片；当前走 generic safeSummary |
| **待补齐工作** | 当前不单独立项。若出现专属交互收益，先确认安全投影 owner，再补 `processDetails` 专门 formatter、相应 spec scenario 与前端测试；不得仅因 parser 已有分支就推断结构化卡片已经交付 |

### C6. SUPERSEDED 终态 UI 指示

| 维度 | 内容 |
|------|------|
| **UCD 设计位置** | `05-component-specs/message-bubble.md` |
| **用户场景** | 用户编辑重发消息或执行中发新消息时，旧请求被取代。被取代的请求应展示"已被新请求取代"标记，让用户理解为什么之前的请求没有继续执行 |
| **业务价值** | **中** — 帮助用户理解被取代请求的终态。当前被取代的请求没有明确视觉标记，用户可能困惑为什么之前的请求"消失"了 |
| **设计要点** | 请求被取代（SUPERSEDED）时，对应消息应展示"被取代"终态指示 |
| **Spec 位置** | `ts-run-status-visibility` spec（RunStatus vocabulary L18，terminal events L54）；`conversation-ui-state.md` §1 row 12、§6 |
| **实现状态** | 后端有 SUPERSEDED 状态，前端无对应视觉标记 |
| **待补齐工作** | 前端实现 SUPERSEDED 终态视觉指示 |

### C7. 安全失败占位检测

| 维度 | 内容 |
|------|------|
| **UCD 设计位置** | `05-component-specs/message-bubble.md`、`05-component-specs/degradation-notice.md` |
| **用户场景** | 请求失败时，如果失败消息是系统占位符（如 "Request failed"），不应作为助手回答展示给用户——这会让用户误以为 Agent 回复了"Request failed" |
| **业务价值** | **高** — 避免用户看到无意义的系统占位文本，直接影响用户体验和对系统能力的信任 |
| **设计要点** | `REQUEST_FAILED` 终态事件的内容如果是安全失败占位符（如 "Request failed"、"Request failed: ..."、"Request failed safely: CODE"），不得渲染为助手回答内容 |
| **Spec 位置** | `ts-run-status-visibility` spec L242-243（显式定义占位符检测规则）；`conversation-ui-state.md` §6 |
| **实现状态** | 检测逻辑不完整 |
| **待补齐工作** | 按 spec 补全前端占位符检测逻辑 |

### C8. 截断指示器

| 维度 | 内容 |
|------|------|
| **UCD 设计位置** | `05-component-specs/tool-output-presentation-policy.md` |
| **用户场景** | 工具输出超长被截断时，用户应知道内容不完整（显示"内容已截断"提示），并有机会查看完整内容（如通过 run-graph drawer） |
| **业务价值** | **中** — 避免用户误以为截断后的内容就是全部，导致基于不完整信息做判断 |
| **设计要点** | 工具输出超长截断时显示 `...` 标记和 `truncated=true` 指示，用户可感知内容被截断 |
| **Spec 位置** | `conversation-ui-state.md` §1（预览容量限制）、§2（`fileRead`/`fileList`/`commandOutput` 的 `truncated`/`stdoutTruncated`/`stderrTruncated` 字段）；`ts-run-status-visibility` spec L193 |
| **实现状态** | 截断指示器实现不完整 |
| **待补齐工作** | 按 spec 补全前端截断指示器渲染 |

### C9. nextRunAt 字段展示

| 维度 | 内容 |
|------|------|
| **UCD 设计位置** | `05-component-specs/cron-task.md` |
| **用户场景** | 定时任务卡片展示下次执行时间，让用户知道任务何时再运行，便于追踪和预期管理 |
| **业务价值** | **中** — 提升定时任务的可追踪性。后端已有字段，前端补渲染成本低 |
| **设计要点** | cron 任务卡片展示 `nextRunAt` 字段（下次执行时间） |
| **Spec 位置** | `gateway-configuration` spec（引用 `nextRunAt`）；`cron-tools` change（含 `nextRunAt`） |
| **实现状态** | 后端有字段，前端未展示 |
| **待补齐工作** | 前端实现 `nextRunAt` 字段渲染 |

### C10. 内联后台任务追踪区

| 维度 | 内容 |
|------|------|
| **UCD 设计位置** | `05-component-specs/background-task-monitor.md` |
| **用户场景** | Agent 在后台执行 Bash 任务时，用户需要看到运行/终态、按需查看 stdout/stderr 并终止异常任务；当前 header `⚡` 已提供主入口，内联区只是可选增强 |
| **业务价值** | **主路径已实现** — header monitor/output/kill 已满足可观测与控制；是否再做 capability-card 内联区需独立用户收益证明 |
| **设计要点** | `[已实现-主干]` header monitor 复用一次 REST seed + session stream + Kill local override；`[UCD目标]` 内联区若准入必须复用同一 snapshot，不得再建 polling lifecycle |
| **Spec 位置** | `agent-web-background-task-control` 只承载当前 Bash header monitor/output/kill，且 polling 条款存在 UCD-R19 漂移；它不定义内联区或 B20 tool 泛化 |
| **实现状态** | header `⚡` monitor、output 与 kill 已实现；内联 capability-card 追踪区未实现、未进入 Ready |
| **待补齐工作** | 不按历史判断直接实施。先同步 UCD-R19 spec/schema；只有证明内联入口的独立收益后再建立最小 presentation change，通用 tool detach 则由 B20 新 OpenSpec 承载 |

### C11. 会话搜索已实现；消息全文搜索需另定义

| 维度 | 内容 |
|------|------|
| **UCD 设计位置** | `04-information-architecture.md`（搜索 dialog 模态框） |
| **用户场景** | 用户通过关键词 + 日期范围查找历史会话；若目标是定位长对话内部的具体消息，则属于另一项消息全文搜索能力 |
| **业务价值** | **中** — 会话级搜索已交付；消息级全文搜索仍需产品价值与检索/高亮边界确认 |
| **设计要点** | `[已实现-主干]` 搜索 dialog 支持关键词 + 日期范围搜索会话标题并打开对应会话；`[Candidate]` 消息全文搜索需要结果计数、高亮、上/下导航与精确定位 |
| **Spec 位置** | `session-history-search` spec（`openspec/specs/session-history-search/spec.md`） |
| **实现状态** | 会话历史搜索 API、dialog、校验、分页、重命名/删除均已实现；现有能力不等于消息正文全文搜索 |
| **待补齐工作** | 关闭“前端搜索 UI 缺失”的历史判断。若需要消息全文搜索，以新的 candidate 定义查询范围、索引、owner scope/agent scope、结果 DTO 与定位交互 |

### C12. 全局服务降级 UI

| 维度 | 内容 |
|------|------|
| **UCD 设计位置** | `06-empty-loading-error-states.md` |
| **用户场景** | 整个系统出现降级（如模型服务不可用、数据库不可用），需要全局提示告知用户当前系统状态受限，而非仅在单个会话中显示降级提示 |
| **业务价值** | **高** — 系统级故障时的用户告知是基本可用性要求。当前只有单会话级降级提示，全局降级时用户可能在多个会话中重复遇到同样的错误而不知是系统级问题 |
| **设计要点** | 全局服务降级时展示降级 UI（区别于单会话降级提示卡片） |
| **Spec 位置** | `DEGRADATION_NOTICE`/SafeError specs 只覆盖会话/request 呈现；`system-health-check` 定义 backend health，但没有冻结浏览器 endpoint/auth/probe budget/polling/hysteresis/submit gating |
| **实现状态** | 会话降级提示与 backend health endpoints 已有；全局浏览器 health/degradation surface 缺失且契约路线未定 |
| **待补齐工作** | `[Clarify]` 先通过 `add-agent-web-service-health-surface` 确认 endpoint、权限、探测预算、状态机和是否阻断提交，再生成实施 OpenSpec；不能按旧表当成纯前端任务 |

### C13. History 模式 Expand Panel 不自动展开（已实现）

| 维度 | 内容 |
|------|------|
| **UCD 设计位置** | `05-component-specs/expand-panel.md` |
| **用户场景** | 用户打开历史会话浏览时，Expand Panel 不应自动弹出展开（避免干扰历史浏览），只在 live 执行时才自动展开 |
| **业务价值** | **已交付** — history 浏览不会被自动展开的面板打断，live 事件仍保留自动展开能力 |
| **设计要点** | history 模式加载会话时，Expand Panel 不自动展开；live 模式按既有规则自动展开 |
| **Spec 位置** | `agent-web-expand-panel` spec（显式规定 `transportHints` 含 `"history-load"` 时 MUST NOT 触发 `expandPanelStore.open()`） |
| **实现状态** | `[已实现-主干]` `useExpandPanelStreamWatcher` 忽略 `history-load` event，并有 negative test 断言不会打开 Expand Panel |
| **待补齐工作** | 无；不进入 backlog。后续仅在改动 watcher 或 history projection 时保留该回归测试 |

---

## 原始快照统计（不可直接用于任务分配）

| 分类 | 数量 | 特征 | 工作量 |
|------|------|------|--------|
| **A 类：契约与实现双空白** | 9 | 需从 spec 定义开始，再到实现 | 高 |
| **B 类：契约部分覆盖** | 21 | 需在现有 spec 上补充条款，再实现 | 中 |
| **C 类：契约就绪，实现待补** | 13 | 按 spec 实现即可 | 低 |
| **合计** | 43 | — | — |

### 原始业务价值分布

| 业务价值 | 数量 | 对应项 |
|---------|------|--------|
| **高** | 14 | A1 文件下载、A2 网管 GUI 链接、A5 Cron 管理面板、A6 内容扫描脱敏、B1 onPiuSubmit 回调、B11 per-entry auto-collapse、B16 think 内容 history 持久化、B17 think/answer 可配置安全过滤、B18 平台管理员配置管理、B19 Cron 执行结果会话归属策略、C2 workflow-interrupt、C7 安全失败占位检测、C10 后台任务追踪区、C12 全局服务降级 UI |
| **中** | 22 | A3 长时能力扩展态、A4 Fork-to-Continue 引导、A7 CSV 附件、A9 结构化 onboarding、B2 Workflow Progress、B3 会话列表项特性、B5 呈现策略框架、B6 todoList kind、B7 长消息折叠、B9 降级字段消费、B10 并行工具流投影、B12 running 条目高亮、B14 scroll-to-active、B15 通用交互响应模式、B20 工具协议扩展（background/outputContextMode/cancel/progress）、B21 集成方定制能力 UCD 文档集中梳理、C1 degraded/replayed 状态、C4 Cron kind 渲染、C6 SUPERSEDED 指示、C8 截断指示器、C9 nextRunAt 展示、C11 会话内搜索 |
| **低** | 7 | A8 todoList i18n、B4 对话预览、B8 settling 动画、B13 新条目 fade-in、C3 clipStream* kinds、C5 httpResponse kind、C13 History Expand Panel |

---

## 原始优先级建议（基于 2026-07-18 的业务价值 × 落地成本）

> 本节为历史记录，当前准入、依赖与并行边界以 roadmap 里程碑为准；顶部 disposition 已标记为已实现或 Clarify 的条目不得按下表直接领取。

> 以下 P0/P1/P2 表保留 2026-07-18 原始优先级，不是当前可认领队列；已实现项、Clarify 和 Ready 状态一律以本页顶部 disposition 与 roadmap 为准。

### P0：高价值 + 低成本（应优先安排）

| 项 | 价值 | 成本 | 理由 |
|----|------|------|------|
| **C7 安全失败占位检测** | 高 | 低 | spec L242-243 规则明确，补检测逻辑即可。避免用户看到无意义占位文本 |
| **C2 workflow-interrupt pending input** | 高 | 低 | `[Clarify]` 原始快照误判为纯前端；需先完成 durable kind 与 owner 决策 |
| **C10 内联后台任务追踪区** | 高 | 中 | `[Obsolete]` header 主路径已实现；内联区不由现有 spec 承载，需先同步 UCD-R19 并证明独立收益 |
| **C12 全局服务降级 UI** | 高 | 低 | `[Clarify]` backend health 已有，但浏览器 endpoint/auth/probe budget/state machine 未冻结，不是纯前端补齐 |

### P1：高价值 + 高成本（需规划排期）

| 项 | 价值 | 成本 | 理由 |
|----|------|------|------|
| **A1 文件下载组件** | 高 | 高 | 需新建 spec + 实现。运维场景核心需求，Agent 生成的文件用户无法获取 |
| **A2 网管 GUI 链接导航卡片** | 高 | 高 | 需新建 spec + 实现。打通 Agent 到网管系统的导航闭环 |
| **A5 Cron 管理面板** | 高 | 高 | 需新建 spec + 实现。定时任务不可管理是用户体验和安全问题 |
| **A6 内容扫描脱敏** | 高 | 高 | `[Clarify]` 主干已有 terminal guard、REMOTE whole-round guard 与 safeResult 白名单；尚缺统一字段级 live/history/share 策略，不能表述为所有敏感信息均直接暴露 |
| **B1 PIU onPiuSubmit 回调** | 高 | 中 | PIU spec 框架已有，补回调条款 + 实现。协作式嵌入的双向交互关键环节 |
| **B11 per-entry auto-collapse** | 高 | 中 | `[已实现-主干]`，保留为历史优先级记录，不再领取 |
| **B16 think 内容 history 持久化** | 高 | 中 | `[已实现-主干]`，保留为历史优先级记录；回归按 bug 处理 |
| **B17 think/answer 可配置安全过滤** | 高 | 中 | `[Clarify]` 主干两条 guard 路径均不等于统一字段级策略；先确认 authoritative owner、整轮阻断与字段替换关系、fail-closed 及 live/history/share 一致性 |
| **B18 安全策略配置来源** | 高 | 中 | `[Clarify]` 先确认启动期系统配置、Agent 配置或动态管理控制面中的最小正确 owner/scope/default/lifetime；不预设必须新增管理 API/UI |
| **B19 Cron 执行结果会话归属策略** | 高 | 高 | 架构遗留问题。当前 cron 触发执行追加到原会话引发上下文污染、会话不可变性违反、用户难查看三大问题。需架构层评估三个候选方案（每次触发 fork 独立 session / 任务创建时 fork 执行派生会话 / 独立任务日志）后确定 cron 执行结果归属策略，再补 UCD 与 spec。UCD 阶段不解决，仅设计到管理面板可查看任务本身 |

### P2：中价值 + 低成本（快速落地，提升体验）

| 项 | 价值 | 成本 | 理由 |
|----|------|------|------|
| **C6 SUPERSEDED 终态指示** | 中 | 低 | spec 明确，前端补视觉标记 |
| **C8 截断指示器** | 中 | 低 | spec 字段已定义，补渲染 |
| **C9 nextRunAt 字段展示** | 中 | 低 | 后端已有字段，前端补渲染 |
| **C13 History 模式 Expand Panel** | 低 | 低 | spec 一行规定，补条件判断 |
| **B6 todoList kind** | 中 | 低 | 后端投影已有，补 spec scenario + 前端渲染 |
| **B9 降级提示卡片字段消费** | 中 | 低 | safe fields 已列，补 MUST render + 前端 |
| **C4 Cron kind 前端渲染** | 中 | 低 | spec 完整，前端实现即可 |
| **C1 degraded/replayed 状态** | 中 | 低 | spec 完整，前端实现即可 |
| **C11 会话内消息搜索** | 中 | 低 | 会话标题/日期搜索 UI 已实现；消息正文全文搜索应另建 candidate，不沿用本项 |
| **B12 running 条目高亮** | 中 | 低 | 前端补 CSS 高亮样式即可。并行工具场景下用户难以识别当前执行步骤 |
| **B14 active-entry viewport following** | 已交付 | — | 复用共享 bottom-following owner；禁止另加 `scrollIntoView` |
| **B21 集成方定制能力 UCD 文档集中梳理** | 中 | 低 | 纯文档工作。本 change 内落地 `12-integrator-customization-guide.md` 即可关闭 |

### P3：中价值 + 中高成本（按需排期）

| 项 | 价值 | 成本 | 理由 |
|----|------|------|------|
| **B2 Workflow Progress Delta** | 中 | 中 | 设计文档有 safeProgress，补 spec 条款 + 后端发射 + 前端展示 |
| **B7 长消息折叠/展开** | 中 | 中 | 设计文档有描述，补 spec 条款 + 前端实现 |
| **B3 会话列表项高级特性** | 中 | 中 | 相关 spec 有，补列表项条款 + 前端实现 |
| **B5 工具输出呈现策略框架** | 中 | 中 | 设计文档 §2 矩阵已完整，提升为 spec |
| **B10 并行工具调用流投影** | 中 | 中 | 后端已持久化批次元数据，补 stream-envelope 投影 + 前端徽标渲染 |
| **B15 通用交互响应模式** | 中 | 中 | 定义 hover/click/focus/disabled/appear CSS 规范，各组件按规范补全。11/14 缺 hover，12/14 缺 focus |
| **A3 长时能力扩展态** | 中 | 高 | 需新建 spec + 实现。按"任务输出与上下文解耦原则"重新定位：扩展态含转后台 CTA + Fork 继续 CTA，可见性受 `outputContextMode` 调控。依赖 B20 工具协议扩展 |
| **A4 Fork-to-Continue 引导** | 中 | 中 | 按"任务输出与上下文解耦原则"重新定位：fork CTA 是"用户不愿等 + 输出需进 context"场景下的唯一非阻塞路径。fork 机制已实现（`forkFromMessage`），补 CTA 契约 + 前端实现 |
| **B20 工具协议扩展** | 中 | 高 | A3/A4/B19 三个高价值 gap 的前置基础设施。需新建 spec 定义 `background` 参数、`outputContextMode` 声明、cancel/progress 接口；扩展 `BackgroundTaskView` 支持 `taskType` |
| **A7 CSV/非 Markdown 附件** | 中 | 中 | `[已实现-主干]` 配置后的 staged composer 已支持；默认 allowlist 与兼容直传路径限制见 UX limits，不再作为本项开发任务 |
| **A9 结构化 onboarding** | 中 | 中 | 需新建 spec + 实现。当前欢迎状态可部分替代 |
| **A8 todoList i18n** | 已交付 | — | 已由 `refine-capability-result-card-presentation` 吸收并进入主干 |

### P4：低价值（暂缓或取消）

| 项 | 价值 | 成本 | 理由 |
|----|------|------|------|
| **B4 对话预览** | 低 | 低 | 列表项标题+时间通常足够判断，增强体验非必需 |
| **B13 新条目 fade-in** | 低 | 低 | 纯视觉优化，补 CSS 进入动画即可 |
| **B8 settling 动画** | 低 | 中 | 纯视觉优化，不影响功能 |
| **C3 clipStream* kinds** | 低 | 高 | 无明确使用场景，需确认是否有业务需求 |
| **C5 httpResponse 专门呈现** | 低 | 中 | parser 已支持但无专门 formatter；generic safeSummary 可用，无明确收益前不立项 |
| **C13 History Expand Panel** | 低 | 低 | 行为细节优化，轻微干扰 |

---

## 附录：相关文件索引

### UCD 设计文档

| 文件 | 内容 |
|------|------|
| `docs/ucd/04-information-architecture.md` | 信息架构、布局、区域职责 |
| `docs/ucd/05-component-specs/*.md` | 15 个组件规范 |
| `docs/ucd/06-empty-loading-error-states.md` | 空/加载/错误/降级状态 |
| `docs/ucd/08-sample-scenarios.md` | 27 个场景 mockup |
| `docs/ucd/01-user-journeys.md` | 27 条用户旅程 |

### OpenSpec 契约文档

| Spec | 覆盖的缺口项 |
|------|-------------|
| `ts-run-status-visibility` | C1, C6, C7, C8, C12, B5, B6, B9 |
| `conversation-ui-state.md`（长期设计导航，已登记 drift） | C1, C2, C3, C5, C6, C7, C8, C12, B2, B4, B5, B6, B8, B9, A3, A4, B19, B20；不能替代 owning specs/contracts/code 核对 |
| `ts-stream-resume-replay` | C1 |
| `ts-web-sse-ws-transports` | C1 |
| `workflow-interaction-nodes` | C2 |
| `cron-tools`（change） | C4, C9, A5, B19 |
| `gateway-configuration` | C9 |
| `agent-web-background-task-control` | 当前 Bash control baseline（且 polling 条款存在 UCD-R19 漂移）；不承载 B20 `taskType="tool"` 泛化，B20 需新 OpenSpec |
| `session-history-search` | C11 |
| `agent-web-expand-panel` | C13, B7 |
| `agent-web-process-panel` | B8 |
| `aico-piu-injection` | B1 |
| `session-conversation-preview` | B3, B4 |
| `session-fork-from-message` | A4, B19（fork 机制已存在，cron delivery 未使用） |
| `todo-write-tool` | B6, A8 |
| `redaction-policy` | A6（仅日志脱敏，不含内容脱敏） |
| `ts-attachment-intake` | A7（已支持配置 allowlist 与 staged intake；兼容直传路径另有边界） |
| `system-health-check` | C1 |
