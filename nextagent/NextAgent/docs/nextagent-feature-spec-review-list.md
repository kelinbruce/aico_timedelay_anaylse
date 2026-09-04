# NextAgent Feature Specification Review List

> 目的：用于设计评审，不用于汇报完成度。
>
> 分组：最终用户（使用网络智能体的运维人员）、智能体开发者、质量属性。
>
> 主要来源：`docs/nextagent-ts-requirements-v2.md`、`docs/nextagent-ts-change-roadmap-v2.md`、`docs/nextagent-ts-roadmap-coverage.md`、`openspec/specs/*`、`docs/developer/*`。

## 评审口径

- Feature 名称优先采用动宾短语，表达“系统/用户/开发者要做什么”；当动宾短语影响可读性时，可以使用稳定领域名词或质量属性名称，但必须能对应明确能力边界。
- “Feature 描述”说明该 feature 的能力语义、使用边界、事实源、owner/scope、禁止项和失败语义。
- “规格项 / 规格值”是 Feature 描述下的可评审 pair，用来列具体数值、范围、枚举、默认值或限制。
- 同一个 feature 描述可以挂多条规格项；评审时逐条确认规格值。
- 电信级韧性评审默认要求每个 feature 至少考虑一类防滥用规格：数量、大小、频率、超时、并发、保留期、重试/熔断、降级或隔离阈值。
- 即使产品语义是“不限制”或“无限”，实现规格也应给出受控上限、分页或配额；不允许无界集合、无界 payload、无界重试或无界等待。
- 需要部署/profile 差异化的规格，在“来源/备注”中使用 `配置：已支持配置`、`配置：需新增配置` 或 `配置：不建议配置` 标记。
- 状态定义：
  - `已定义`：权威规格或现有开发者/用户文档已有明确值。
  - `当前实现值`：现有代码或默认配置中能观察到的值，但尚未固化为目标规格。
  - `建议评审值`：当前文档提出建议值，需评审确认后进入 OpenSpec。
  - `缺失待定`：需要数值规格，但当前未定义；电信级评审中应优先转为建议评审值或明确非目标。
  - `不适用`：该规格项是边界或治理语义，不需要数值。
  - `示例值非规格`：文档有示例配置值，但未被 OpenSpec 固化为目标规格。

## Feature 描述和规格项的关系

Feature 描述回答“这个 feature 面向谁、要解决什么能力、边界和失败语义是什么”；规格项回答“这个 feature 用什么数值、枚举、范围或默认值来验收”。因此，规格项必须附着在 Feature 描述上，否则数值没有上下文；Feature 描述也需要规格项补足容量、性能、安全和兼容性阈值，否则评审时难以判定是否可验收。

## 一、最终用户特性：使用网络智能体的运维人员

| 一级 feature | 二级 feature | Feature 描述 | 规格项 | 规格值 | 值类型 | 状态 | 来源/备注 |
|---|---|---|---|---|---|---|---|
| 访问本地智能体 | 使用本地认证 | 系统 SHALL 支持本地单用户认证；未认证访问受保护页面或 API 时 SHALL 返回安全 challenge 或登录引导。 | 访问绑定范围 | localhost-only | 硬约束 | 已定义 | `P1-B00`、`P1-S09` |
| 访问本地智能体 | 绑定本地端口 | 本地运行时 SHALL 默认只监听 loopback，并允许部署时调整 host/port。 | 默认监听地址和端口 | `127.0.0.1:3000` | 默认值 | 当前实现值 | `packages/agent-app/config/default-system.yaml`；配置：已支持配置（`channel.host`、`channel.port`） |
| 访问本地智能体 | 使用本地认证 | 凭证 SHALL 来自 env/file secret reference，MUST NOT 通过 query parameter 传长期凭证。 | 本地用户数量 | 1 | 硬约束 | 已定义 | `ts-local-configured-auth` |
| 访问本地智能体 | 登录和登出 | 系统 SHALL 支持 login/logout、signed HttpOnly cookie、票据过期和服务重启后失效。 | cookie 过期时长 | 建议值：8 小时 | 硬上限/默认值 | 建议评审值 | 当前规格未定义；配置：需新增配置 |
| 访问本地智能体 | 登录和登出 | 登录失败 SHOULD 有最小限速或退避。 | 登录失败限速阈值 | 3 次失败后阻断 500 ms | 硬上限 | 当前实现值 | `packages/agent-channel-web-auth-local/src/index.ts`；配置：当前代码固定，建议改为可配置并提高默认安全强度 |
| 访问本地智能体 | 登录和登出 | 登录失败 SHOULD 有最小限速或退避。 | 登录尝试频率 | 建议值：10 次 / 5 分钟 / client identity | 频率上限 | 建议评审值 | 韧性补充；配置：需新增配置 |
| 访问本地智能体 | 登录和登出 | 已登录会话 SHOULD 有受控数量，避免 cookie/session 资源无界增长。 | 单用户活动登录票据数 | 建议值：5 | 硬上限 | 建议评审值 | 韧性补充；配置：需新增配置 |
| 管理会话 | 创建会话 | 用户 SHALL 能创建新会话并进入可继续对话的上下文。 | 单 Agent 最大会话数量 | 建议值：5,000 个 session | 容量目标 | 建议评审值 | 当前规格未定义；需 SQLite/history list 压测确认 |
| 管理会话 | 创建会话 | 用户 SHALL 能创建新会话并进入可继续对话的上下文。 | 单租户最大会话数量 | 建议值：5,000 个 session | 容量目标 | 建议评审值 | 当前规格未定义；local 单用户场景可与单 Agent 目标同级 |
| 管理会话 | 创建会话 | 用户 SHALL 能创建新会话并进入可继续对话的上下文。 | 单用户最大会话数量 | 建议值：5,000 个 session | 容量目标 | 建议评审值 | 当前规格未定义；需历史列表和检索延迟指标配套 |
| 管理会话 | 创建会话 | 会话创建 SHOULD 有频率限制，避免恶意创建历史事实。 | 会话创建频率 | 建议值：60 个 session / 小时 / 用户 | 频率上限 | 建议评审值 | 韧性补充；配置：需新增配置 |
| 管理会话 | 列出会话 | 用户 SHALL 能列出已有会话；列表 SHALL 使用 owner scope 过滤。 | 会话列表默认分页大小 | 50 | 默认值 | 当前实现值 | `packages/agent-channel-web/src/routes/requests.ts`；配置：当前代码固定，建议纳入 channel pagination 配置 |
| 管理会话 | 列出会话 | 默认视图 SHOULD 排除被替换或隐藏的历史项。 | 会话列表最大分页大小 | 建议值：200 | 硬上限 | 建议评审值 | 当前规格未定义；配置：需新增配置 |
| 管理会话 | 继续会话 | 用户 SHALL 能打开历史会话并继续工作；系统 SHALL 使用当前会话上下文。 | 单会话最大 message 数量 | 建议值：10,000 条 message | 容量目标 | 建议评审值 | 当前规格未定义；需 DB/history/context 压测确认 |
| 管理会话 | 继续会话 | 用户 SHALL 能打开历史会话并继续工作；系统 SHALL 使用当前会话上下文。 | 会话历史默认分页大小 | 50 | 默认值 | 当前实现值 | `packages/agent-channel-web/src/routes/requests.ts` |
| 管理会话 | 继续会话 | 用户 SHALL 能打开历史会话并继续工作；系统 SHALL 使用当前会话上下文。 | 单会话最大 turn 数量 | 建议值：5,000 个 turn | 容量目标 | 建议评审值 | 按 2 条 message/turn 与 message 目标配套，需评审确认 |
| 管理会话 | 命名会话 | 系统 SHOULD 在首个用户请求完成后生成稳定标题，并允许 owner 手动修改。 | 自动标题长度 | 非空且 <= 40 字符（无下限）；手动标题 trim 后 1-100 字符 | 硬约束 | 已定义 | `session-title-generation`（自动标题）、`session-title-update`（手动标题）；原「4-40 字符」口径混用两个 spec，已拆分更正 |
| 管理会话 | 命名会话 | 自动标题 MUST NOT 阻塞 terminal commit，MUST NOT 覆盖手动标题。 | 自动标题生成模型调用 | 0 次 | 硬约束 | 已定义 | 不调用模型 |
| 提交请求 | 提交用户问题 | 用户提交请求后，系统 SHALL 尽快返回 request/run 坐标并进入 runtime command 生命周期。 | submit 接受时延 | 建议值：<= 1,000 ms | 目标值 | 建议评审值 | `P2-N07` 要求定义指标但无阈值；不含模型首包时间 |
| 提交请求 | 提交用户问题 | 用户提交请求后，系统 SHALL 尽快返回 request/run 坐标并进入 runtime command 生命周期。 | 单次请求最大输入字符数 | 建议值：64 KiB UTF-8 payload | 硬上限 | 建议评审值 | 当前规格未定义；需与 HTTP body limit、context budget 对齐 |
| 提交请求 | 提交用户问题 | 用户 submit SHOULD 受频率限制，避免无界 run、message 和 timeline 写入。 | 用户提交频率 | 建议值：60 次 / 分钟 / 用户，10 次 / 分钟 / session | 频率上限 | 建议评审值 | 韧性补充；配置：需新增配置 |
| 接收流式结果 | 查看增量输出 | 系统 SHALL 以 stream 增量展示模型内容和关键过程。 | 首包流式响应时间 | 建议值：<= 3,000 ms | 目标值 | 建议评审值 | `P2-N07` 要求定义指标但无阈值；需区分 provider 首包和 channel 首包 |
| 接收流式结果 | 使用 SSE/WS | 系统 SHALL 同时支持 SSE 和 WebSocket，并保持同一 lifecycle、timeline、history 和 terminal 语义。 | 支持 transport | SSE、WebSocket | 支持范围 | 已定义 | `P1-S17` |
| 接收流式结果 | 使用 SSE/WS | SSE 与 WebSocket SHALL 共享同一 stream input 和 projection 语义。 | 单实例最大 stream 连接数 | 建议值：500 | 容量目标 | 建议评审值 | 当前规格未定义；需按本地单机 FD/内存压测确认 |
| 接收流式结果 | 使用 SSE/WS | SSE 与 WebSocket SHALL 共享同一 stream input 和 projection 语义。 | stream 心跳间隔 | 建议值：15 秒 | 默认值 | 建议评审值 | 当前规格未定义；需与 proxy idle timeout 对齐 |
| 接收流式结果 | 使用 SSE/WS | 长连接 SHOULD 有最大存活时间和空闲时间，避免断线或恶意连接长期占用资源。 | stream 最大连接时长 | 建议值：30 分钟 | 硬上限 | 建议评审值 | 韧性补充；配置：需新增配置 |
| 接收流式结果 | 使用 SSE/WS | resume/reconnect SHOULD 有频率限制。 | stream 重连频率 | 建议值：30 次 / 分钟 / session | 频率上限 | 建议评审值 | 韧性补充；配置：需新增配置 |
| 查看运行过程 | 查看请求状态 | 用户 SHALL 能区分 accepted、running/executing、waiting input、completed、failed、canceled、superseded 等状态。 | 用户可见运行状态集合 | accepted、running/executing、waiting input、completed、failed、canceled、superseded | 枚举范围 | 已定义 | `ts-run-status-visibility` |
| 查看运行过程 | 查看请求状态 | Web channel MUST NOT 创造与 runtime facts 竞争的状态。 | 状态刷新可见时延 | 建议值：<= 1,000 ms | 目标值 | 建议评审值 | 当前规格未定义；stream 在线时应接近实时，polling 需单独定义 |
| 查看运行过程 | 查看关键步骤 | 系统 SHALL 暴露模型输出、能力调用、降级、失败原因和 pending input 等最小必要过程事实。 | 单请求最大可见步骤数 | 建议值：500 个 projected event | 硬上限 | 建议评审值 | 当前规格未定义；需与 timeline retention/event size 对齐 |
| 查看运行过程 | 查看关键步骤 | 暴露内容 MUST 经过 projection 与 redaction。 | 单个过程事件最大 payload | 建议值：64 KiB | 硬上限 | 建议评审值 | 当前规格未定义；超过应摘要或引用化 |
| 控制请求 | 取消请求 | 用户 SHALL 能取消当前会话中最近可操作的活动请求；取消后 SHALL 产生权威 canceled 终态。 | 取消可见时延 | 建议值：<= 1,000 ms | 目标值 | 建议评审值 | `P2-N07` 要求定义指标但无阈值 |
| 控制请求 | 重试请求 | 用户 SHALL 能对当前会话最近一次已结束请求 retry；retry SHALL 创建新的执行尝试并保留旧结果可追溯。 | 单请求最大 retry 次数 | 建议值：3 次 | 硬上限 | 建议评审值 | 当前规格未定义；防止无限重复副作用和历史膨胀 |
| 控制请求 | 重试请求 | retry SHALL 创建新的执行尝试。 | attempt 递增 | 每次 retry +1 | 语义规则 | 已定义 | `add-ts-request-retry` |
| 控制请求 | 编辑并重提请求 | 用户 SHOULD 能编辑最近一次已结束请求并重新提交。 | 单请求最大 edit 次数 | 建议值：10 次 | 硬上限 | 建议评审值 | 当前规格未定义；需与 attempt/history projection 对齐 |
| 控制请求 | 编辑并重提请求 | 编辑后 SHALL 创建新的 root 用户消息和新 run。 | 编辑输入最大字符数 | 建议值：64 KiB UTF-8 payload | 硬上限 | 建议评审值 | 当前规格未定义；建议与 submit 输入上限一致 |
| 排队执行请求 | 串行同会话请求 | 同一 session lane 中请求 SHALL 默认串行推进。 | 单 session lane 并发执行数 | 1 | 硬约束 | 已定义 | `session-lane-scheduling` |
| 排队执行请求 | 串行同会话请求 | 新 submit MAY supersede 同 lane 旧未完成请求，但 MUST NOT 绕过 scheduler 或 terminal commit。 | 全局并发活动会话数 | 建议值：100 | 容量目标 | 建议评审值 | `P2-N07` 要求定义但无阈值；需和 provider/sandbox 并发预算拆分 |
| 使用附件 | 上传附件 | 用户 SHALL 能上传受支持附件；系统 MUST 校验类型、大小、数量、owner scope 和可用性。 | 单请求最大附件数量 | 3 | 硬上限 | 已定义 | `docs/frontend/user-workflows.md`、`openspec/specs/ts-attachment-intake/spec.md` |
| 使用附件 | 上传附件 | 不合法附件 SHALL 返回 safe error。 | 单附件最大大小 | 5 MiB | 硬上限 | 已定义 | `docs/frontend/user-workflows.md`、`openspec/specs/ts-attachment-intake/spec.md` |
| 使用附件 | 上传附件 | 用户 SHALL 能上传受支持附件。 | 支持附件类型 | Markdown（`.md`、`.markdown`）；Word、Excel、PDF 当前不支持 | 支持范围 | 已定义 | `docs/frontend/user-workflows.md`、`openspec/specs/ts-attachment-intake/spec.md` |
| 使用附件 | 让附件进入上下文 | Runtime SHALL 在请求接受前校验 attachmentIds；Context Engine SHALL 只消费安全 descriptor、summary 或 content reference。 | 单附件摘要最大长度 | 建议值：16 KiB 文本 | 硬上限 | 建议评审值 | 当前规格未定义；超过应引用化或分段摘要 |
| 使用附件 | 让附件进入上下文 | 附件内容进入模型前 SHALL 受 context budget 控制。 | 单请求附件 token 预算 | 建议值：<= 20% 模型窗口 | 目标值 | 建议评审值 | 当前规格未定义；需与 context budget `PRE_SEND_CHECK_REQUIRED`（ratio 0.885）配套 |
| 恢复断连请求 | 恢复 stream | 系统 SHALL 基于 canonical timeline 支持 resume/replay。 | 初始 lastSeenSequence | 0 | 协议值 | 已定义 | `ts-stream-resume-replay` |
| 恢复断连请求 | 恢复 stream | canonical event sequence SHALL 从 1 开始递增。 | canonical sequence 起始值 | 1 | 协议值 | 已定义 | `Timeline 和 Stream` |
| 恢复断连请求 | 恢复 stream | gap 或不可恢复 delta SHALL 触发 safe notice 或 history refresh。 | replay buffer 大小 | 建议值：1,000 个 event/run | 容量目标 | 建议评审值 | 当前规格未定义；应优先基于持久 timeline replay |
| 恢复断连请求 | 保持终态一致 | 用户重新进入会话后看到的终态 SHALL 与 visible history 和 RequestRun terminal state 一致。 | 每个 accepted request 终态数量 | 1 | 硬约束 | 已定义 | terminal consistency |
| 补充人工输入 | 回答澄清问题 | 系统 SHOULD 在原 run 中创建 QUESTION pending input，并在用户回答后恢复原请求上下文。 | QUESTION pending 超时 | 建议值：24 小时 | 默认值/硬上限 | 建议评审值 | 当前规格未定义；本地运维长任务需允许跨班次 |
| 补充人工输入 | 回答澄清问题 | pending input SHOULD 有数量和输入大小上限，避免长期挂起或超大恢复输入。 | 单 run 最大 pending input 数 | 建议值：5 | 硬上限 | 建议评审值 | 韧性补充；超过应 safe reject 或 human handoff |
| 补充人工输入 | 回答澄清问题 | 用户回答 SHALL 重新进入 schema validation 和 context budget。 | pending input 回答最大字符数 | 建议值：16 KiB UTF-8 payload | 硬上限 | 建议评审值 | 韧性补充；不继承 submit 的完整 payload 上限 |
| 补充人工输入 | 确认或授权操作 | 系统 SHOULD 创建 CONFIRMATION / AUTHORIZATION pending input；授权 SHALL 绑定当前 run 内一次受限操作。 | 单次授权覆盖操作数 | 1 | 硬约束 | 已定义 | authorization pending input |
| 补充人工输入 | 确认或授权操作 | 授权 MUST NOT 泛化为长期权限。 | 高风险确认阈值 | 建议值：riskLevel 为 HIGH/CRITICAL，或 riskScore >= 0.7 | 策略阈值 | 建议评审值 | 韧性补充；需在 risk classification change 中固化 |
| 转交人工处理 | 发起人工接管 | 系统 SHOULD 支持将当前 run 转入 human handoff pending；人工处理 SHALL 能终结或恢复原 run。 | human handoff 超时 | 建议值：24 小时 | 默认值/硬上限 | 建议评审值 | 当前规格未定义；需与 pending input 生命周期统一 |
| 转交人工处理 | 发起人工接管 | 人工接管过程 SHALL 可审计。 | 单队列最大 pending handoff 数 | 建议值：100 | 容量目标 | 建议评审值 | 当前规格未定义；local 单实例目标 |
| 指定处理技能 | 指定 Skill | 用户 SHOULD 能显式指定由某个 Skill 处理请求；系统 MUST 执行可用性、权限、Agent scope 和 owner scope 校验。 | 单请求可指定 Skill 数量 | 1 | 目标值 | 建议评审值 | 当前规格写“某个 Skill”，建议固化为 1 |
| 使用双语交互 | 跟随用户语言 | 系统 SHOULD 默认按用户主语言输出。 | 输入语种 | 中文、英文 | 支持范围 | 已定义 | `P2-B13` |
| 使用双语交互 | 跟随用户语言 | 中文请求以中文为主，英文请求以英文为主。 | 输出语种 | 中文、英文 | 支持范围 | 已定义 | `P2-B13` |
| 使用双语交互 | 跟随用户语言 | 系统 SHOULD 识别用户主语言。 | 语言检测置信度阈值 | 建议值：0.8 | 策略阈值 | 建议评审值 | 当前规格未定义；低于阈值应保留用户原语种或询问 |
| 保留电信术语 | 保留专业术语 | 系统 SHOULD 保留电信协议、设备、网元、指标和专有名词的原始语义。 | 术语表规模 | 建议值：10,000 条 / Agent | 容量目标 | 建议评审值 | 韧性补充；需定义术语库来源、owner 和更新机制 |
| 保留电信术语 | 保留专业术语 | 术语库 SHOULD 有单项大小上限，避免提示词和检索结果膨胀。 | 单术语条目大小 | 建议值：term <= 128 字符，aliases <= 20 个，definition <= 1,000 字符 | 硬上限 | 建议评审值 | 韧性补充；超过应拆分或拒绝 |
| 保留电信术语 | 保留专业术语 | 系统 MUST NOT 为翻译而改写成无意义表达。 | 术语误翻译容忍率 | 建议值：0 个 P0/P1 术语误翻译 / release gate | 质量阈值 | 建议评审值 | 需配套电信术语 golden set |
| 处理长输出 | 显式提示截断或降级 | 当输出过长或窗口不足时，系统 SHOULD 继续生成、显式降级或提示部分结果；MUST NOT 静默截断。 | 历史上下文预算占比 | 不设独立占比上限（原 60% cap 已移除） | 范围限制 | 当前实现值 | `packages/agent-context-engine/src/budget/default-proportional-budget-policy.ts`；commit `4a422c232` 从 `context-engine` spec 移除 60% Requirement，代码仅在可用输入占比 <0.885 时发 `PRE_SEND_CHECK_REQUIRED`；配置：已支持配置（`preSendCheckRatio`） |
| 处理长输出 | 显式提示截断或降级 | 系统 SHOULD 提示用户结果是否完整。 | 单次输出最大 token 数 | 2,048 token | 默认值 | 当前实现值 | `packages/agent-app/config/default-system.yaml` `modelOptions.maxOutputTokens` |
| 评价回答 | 提交回答反馈 | 用户 SHOULD 能对已完成 answer 或 turn 提交点赞/点踩和收藏。 | 反馈枚举 | `sentiment`: `"UP"` \| `"DOWN"` \| `null` | 枚举范围 | 已定义 | `conversation-annotation`；原引用 `add-ts-answer-feedback` 不存在、原值「1-5 星」与 spec 不符，已更正为 sentiment 枚举 |
| 评价回答 | 提交回答反馈 | 反馈 SHALL 与 session/run/audit 事实关联。 | 评论字段暴露 | 持久层 `comment: string \| null`（最大 1,000 字符，见归档 change `add-ts-conversation-annotation` 实现记录）；Web upsert DTO 未暴露 comment | 支持范围 | 当前实现值 | `conversation-annotation`（Record 含 comment）；`packages/agent-channel-web/src/schemas/annotation-dto.ts` 仅含 sentiment/isFavorited/isQuestionFavorited；在建 `migrate-question-pin-to-annotation` spec delta 将补回 comment upsert 语义（超 1,000 字符返回 400）；原值「备注最大长度 500 字符」无 spec 依据，已更正 |
| 获取产物 | 查看 artifact 引用 | 首版 SHALL 至少保存 artifact metadata/ref；下载入口需单独定义权限、审计和安全边界。 | 首版下载入口 | 不提供 | 范围限制 | 已定义 | roadmap 明确后置 |
| 获取产物 | 查看 artifact 引用 | 系统 SHALL 保存 artifact metadata/ref。 | 单请求最大 artifact 数量 | 建议值：20 | 硬上限 | 建议评审值 | 当前规格未定义；下载和保留策略需单独评审 |

## 二、智能体开发者特性：二次开发、集成和能力扩展

| 一级 feature | 二级 feature | Feature 描述 | 规格项 | 规格值 | 值类型 | 状态 | 来源/备注 |
|---|---|---|---|---|---|---|---|
| 定义 Agent | 编写 Agent package | 框架 SHALL 支持以 `agents/{agentId}` 为 Agent package root。 | Agent package root | `agents/{agentId}` | 路径规范 | 已定义 | `add-ts-agent-package-assembly` |
| 定义 Agent | 编写 Agent package | `agent.yaml`、`skills/`、`subagents/`、`prompts/` SHALL 作为启动期可信输入参与 assembly compilation。 | package 输入目录 | `agent.yaml`、`skills/`、`subagents/`、`prompts/` | 支持范围 | 已定义 | `add-ts-agent-package-assembly` |
| 定义 Agent | 编写 Agent package | 框架 SHALL 支持 Agent package。 | 单 runtime 可托管 Agent 数量 | 建议值：50 个 Agent | 容量目标 | 建议评审值 | 当前规格未定义；配置：需新增配置 |
| 定义 Agent | 编写 Agent package | Agent package SHOULD 有文件数量和总大小上限，避免启动扫描和 assembly compilation 被超大 package 拖垮。 | Agent package 最大文件数 | 建议值：1,000 files / Agent package | 容量目标 | 建议评审值 | 开发者约束补充；配置：需新增配置 |
| 定义 Agent | 编写 Agent package | Agent package SHOULD 有文件数量和总大小上限，避免启动扫描和 assembly compilation 被超大 package 拖垮。 | Agent package 最大总大小 | 建议值：50 MiB / Agent package | 容量目标 | 建议评审值 | 开发者约束补充；配置：需新增配置 |
| 定义 Agent | 编写 Agent package | Agent package schema SHOULD 显式版本化，用于兼容性诊断和迁移。 | Agent package schema version | 必填且 semver-compatible | 字段约束 | 建议评审值 | 开发者约束补充；配置：需新增 schema 约束 |
| 定义 Agent | 编写 agent.yaml | 开发者 SHALL 能声明 agentId、agentVersion、model profile、prompt template、capability binding、runtime settings 和 workspace。 | request-scoped `maxToolCallsPerTurn` 取值范围 | 建议值：0-5（当前无 schema 约束，默认 30） | 硬上限 | 建议评审值 | `packages/agent-contracts/src/agent-assembly/index.ts`；默认 30 见 `packages/agent-core/src/agent/default-agent.ts` |
| 定义 Agent | 编写 agent.yaml | 开发者 SHALL 能声明 runtime settings。 | 默认每轮 tool 调用上限 | 30 | 当前默认值 | 当前实现值 | `packages/agent-core/src/agent/default-agent.ts` |
| 定义 Agent | 编写 agent.yaml | 开发者 SHALL 能声明 runtime settings。 | 默认 tool round 上限 | 50 | 当前默认值 | 当前实现值 | `packages/agent-core/src/agent/default-agent.ts` |
| 定义 Agent | 编写 agent.yaml | 开发者 SHALL 能声明 request timeout。 | 单请求运行总 timeout | 建议值：300,000 ms 硬上限 | 硬上限 | 建议评审值 | `developer/03-agent-configuration.md` 有示例值；配置：需新增/固化配置 |
| 装配 Agent | 编译 AgentAssembly | App composition SHALL 将 Agent definition 编译为 runtime-ready `AgentAssembly`。 | request path 重新解析 `agent.yaml` 次数 | 0 | 硬约束 | 已定义 | request path MUST NOT reparse |
| 固化 Agent 范围 | 绑定 Agent Scope | 新 session/request 的 Agent Scope SHALL 来自可信 app composition、host selection 或已持久化 Session.agentId。 | 客户端可覆盖 Agent Scope | 否 | 硬约束 | 已定义 | AGENTS 架构约束 |
| 提供开发入口 | 使用 SimpleAgent | 框架 MAY 提供 `SimpleAgent` 风格入口；该 facade MUST 编译为普通 Agent assembly。 | SimpleAgent 可绑定 tools 数量 | 建议值：50 | 硬上限 | 建议评审值 | 当前规格未定义；应与 capability 可见数量上限一致评审 |
| 提供开发入口 | 使用 SimpleAgent | SimpleAgent MUST 通过既有 runtime 主路径运行。 | SimpleAgent 可绑定 skills 数量 | 建议值：20 | 硬上限 | 建议评审值 | 当前规格未定义；避免 facade 绕过 Agent package 治理 |
| 配置应用系统 | 校验 app config | 框架 SHALL 提供 app composition 配置 schema、runtime validation 和 safe config error。 | 配置文件最大大小 | 建议值：1 MiB | 硬上限 | 建议评审值 | 当前规格未定义；配置：需新增配置 |
| 配置应用系统 | 校验 app config | 配置解析 SHOULD 限制递归和集合规模，避免复杂 YAML/JSON 导致启动阻塞。 | 配置嵌套深度 | 建议值：20 层 | 硬上限 | 建议评审值 | 韧性补充；配置：需新增配置 |
| 配置应用系统 | 引用 secret | 配置中 secret SHALL 使用 `env:` 或 `file:` reference。 | SecretReference 允许 scheme | `env:`、`file:` | 支持范围 | 已定义 | `add-ts-secret-configuration-boundary` |
| 配置应用系统 | 引用 secret | raw secret MUST NOT 进入配置、日志、stream、audit、metric 或 model context。 | raw secret 允许出现次数 | 0 | 硬约束 | 已定义 | 安全边界 |
| 编写 Prompt | 定义 prompt template | 框架 SHALL 支持 Agent/builtin prompt template 来源、确定性模板选择、变量渲染、fallback 和 safe error。 | 单 Agent 可绑定 prompt template 数量 | 建议值：50 | 硬上限 | 建议评审值 | 当前规格未定义；需与 purpose/locale/profile 组合数匹配 |
| 编写 Prompt | 定义 prompt template | 模板正文 MUST NOT 嵌入 runtime-facing `AgentAssembly`。 | AgentAssembly 内嵌 prompt 正文 | 否 | 硬约束 | 已定义 | `add-ts-prompt-template-assembly` |
| 编写 Prompt | 定义 prompt template | 模板渲染 SHOULD 有最终输出大小上限，避免 prompt 注入或模板错误放大上下文。 | 单次 rendered prompt 最大大小 | 建议值：<= 80% 模型窗口，且不超过 context budget | 硬上限 | 建议评审值 | 韧性补充；与 Context Engine 预算共同裁剪 |
| 编写 Prompt | 区分稳定和动态段落 | Prompt authoring SHOULD 区分 stable/dynamic sections；动态段落 SHALL 由 Context Engine 渲染。 | section 数量上限 | 建议值：20 | 硬上限 | 建议评审值 | 当前规格未定义；超过应拆分模板或资源 |
| 编写 Prompt | 区分稳定和动态段落 | Prompt authoring SHOULD 区分 stable/dynamic sections。 | 单 section 最大大小 | 建议值：64 KiB 文本 | 硬上限 | 建议评审值 | 当前规格未定义；需防止模板膨胀 |
| 装配上下文 | 选择历史上下文 | Context Engine SHALL 独占 history selection、window budget、compaction、prompt shaping。 | 历史上下文预算占比 | 不设独立占比上限（原 60% cap 已移除） | 范围限制 | 当前实现值 | `packages/agent-context-engine/src/budget/default-proportional-budget-policy.ts`；commit `4a422c232` 从 `context-engine` spec 移除 60% Requirement，代码仅在可用输入占比 <0.885 时发 `PRE_SEND_CHECK_REQUIRED`；配置：已支持配置（`preSendCheckRatio`） |
| 装配上下文 | 压缩长上下文 | 系统 SHALL 通过受控摘要压缩较早历史并保留可追溯引用。 | 摘要最大长度 | 建议值：8 KiB 文本 | 硬上限 | 建议评审值 | 当前规格未定义；摘要生成默认 timeout 30,000 ms 为当前实现值 |
| 装配上下文 | 压缩长上下文 | 系统 SHALL 通过受控摘要压缩较早历史。 | 压缩触发阈值 | 建议值：>= 80% context window | 策略阈值 | 建议评审值 | 当前规格未定义；需与 context budget `PRE_SEND_CHECK_REQUIRED`（ratio 0.885）共同评审 |
| 配置模型 | 定义 model profile | 开发者 SHALL 能配置 provider、model、credential、timeout 和选型策略。 | 单 Agent 最大 model profile 数量 | 建议值：10 | 硬上限 | 建议评审值 | 当前规格未定义；配置：需新增配置 |
| 配置模型 | 定义 model profile | 模型选择 MUST 经过 governance。 | 默认模型调用 timeout | 120,000 ms | 默认值 | 当前实现值 | `packages/agent-app/config/default-system.yaml` `timeoutMs`；配置：已支持配置（`modelProfiles[].timeoutMs`） |
| 配置模型 | 定义 model profile | 模型选择 MUST 经过 governance。 | 默认 context window | 128,000 token | 默认值 | 当前实现值 | `packages/agent-app/config/default-system.yaml` `contextWindowTokens`；配置：已支持配置（`modelProfiles[].contextWindowTokens`） |
| 配置模型 | 定义 model profile | 模型选择 MUST 经过 governance。 | 支持 provider kind | OPENAI、MINIMAX、DEEPSEEK、QWEN | 支持范围 | 已定义 | `docs/ts-migration/java-ts-compatibility-review.md` C09 |
| 配置模型 | 定义 model profile | 模型选择 SHOULD 限制 fallback 链长度，避免 provider 故障导致级联放大。 | 单请求模型 fallback 次数 | 建议值：1 次 | 硬上限 | 建议评审值 | 韧性补充；`fallbackEligible` 已支持配置，fallback 次数需新增配置 |
| 接入模型 | 实现 provider adapter | `agent-model` SHALL 隔离 provider SDK、request construction、stream normalization、tool-use normalization 和 safe error mapping。 | provider stream chunk 最大大小 | 建议值：64 KiB | 硬上限 | 建议评审值 | 当前规格未定义；超过应截断为 safe error 或分片 |
| 接入模型 | 实现 provider adapter | `agent-model` SHALL 归一化 malformed chunk。 | malformed chunk 容忍数量 | 建议值：0 个静默容忍 | 硬上限 | 建议评审值 | 当前规格未定义；应 safe error，不静默吞掉 |
| 开发 Capability | 定义 capability descriptor | Tool、Skill、Agent descriptor SHALL 使用统一 `CapabilityDescriptor` 和 `CapabilityProvider`。 | Capability kind | TOOL、SKILL、AGENT | 枚举范围 | 已定义 | `agent-common` vocabulary |
| 开发 Capability | 定义 capability descriptor | descriptor MUST NOT 携带 raw path、secret、provider response 或权限绕行字段。 | descriptor safe description 最大长度 | 建议值：2,000 字符 | 硬上限 | 建议评审值 | 当前规格未定义；model-visible 描述应保持短文本 |
| 开发 Capability | 定义 capability descriptor | Capability identity SHOULD 使用有界 safe identifier，避免日志、模型上下文和 catalog key 膨胀。 | capability id 长度 | 建议值：1-128 字符 | 硬上限 | 建议评审值 | 开发者约束补充；配置：需新增 schema 约束 |
| 开发 Capability | 定义 capability descriptor | descriptor metadata SHOULD 限制大小，且只能承载安全描述性信息。 | capability metadata 最大大小 | 建议值：8 KiB JSON | 硬上限 | 建议评审值 | 开发者约束补充；配置：需新增 schema 约束 |
| 治理 Capability | 发现和过滤能力 | Capability catalog SHALL 统一处理 discovery、availability、Agent binding filtering、conflict/shadowing 和 invocation eligibility。 | availability 状态 | AVAILABLE、DISABLED、UNAVAILABLE | 枚举范围 | 已定义 | roadmap capability contract |
| 治理 Capability | 发现和过滤能力 | 模型只应看到当前 request scope 可用能力。 | 单 Agent 可见 capability 数量 | 建议值：100 | 硬上限 | 建议评审值 | 当前规格未定义；配置：需新增配置 |
| 治理 Capability | 发现和过滤能力 | model-visible capability 描述总体 SHOULD 有大小上限，超出时通过 routing/search 收敛。 | model-visible capability 描述总大小 | 建议值：64 KiB / request | 硬上限 | 建议评审值 | 开发者约束补充；配置：需新增配置 |
| 调用 Capability | 执行能力 | Capability execution SHALL 使用统一 `CapabilityInvocationRequest/Result`。 | Capability invocation timeout | 建议值：30,000 ms 默认，300,000 ms 硬上限 | 默认值/硬上限 | 建议评审值 | 当前规格未定义；配置：需新增配置 |
| 调用 Capability | 执行能力 | request SHALL 携带 trusted owner/agent/run/request coordinates。 | request 携带 workspaceDir | 否 | 硬约束 | 已定义 | `ts-minimal-agent-kernel` |
| 调用 Capability | 执行能力 | Capability result SHOULD 受大小限制，超出时通过 artifact/ref 返回。 | Capability inline result 最大大小 | 建议值：64 KiB | 硬上限 | 建议评审值 | 韧性补充；避免 tool result 直接撑爆 context/stream/log |
| 开发 Tool | 定义 Tool | 框架 SHALL 提供 provider-neutral Tool metadata、input/output schema、config schema、dependencies、replay policy 和 execute operation。 | Tool input schema 最大大小 | 建议值：64 KiB JSON Schema | 硬上限 | 建议评审值 | 当前规格未定义；配置：需新增 schema 约束 |
| 开发 Tool | 定义 Tool | Tool implementation MUST NOT 接收 raw capability invocation envelope。 | Tool implementation 接收 raw invocation envelope | 否 | 硬约束 | 已定义 | `builtin-tool-framework` |
| 开发 Tool | 定义 Tool | Tool 参数 SHOULD 受 schema 和 payload 上限共同约束。 | Tool invocation input 最大大小 | 建议值：64 KiB JSON | 硬上限 | 建议评审值 | 韧性补充；配置：需新增配置 |
| 开发 Tool | 使用 defineTool | `defineTool` SHOULD 简化 Tool authoring，但 MUST NOT 注册工具、扫描目录、读取配置或生成 catalog entries。 | defineTool 扫描目录次数 | 0 | 硬约束 | 已定义 | `builtin-tool-framework` |
| 开发文件工具 | 使用 workspace file dependency | Read/Write/Edit/Glob/Grep SHALL 通过受控 workspace file dependency 访问文件。 | 工具可见 host absolute path | 否 | 硬约束 | 已定义 | workspace file boundary |
| 开发文件工具 | 使用 workspace file dependency | 工具 MUST NOT 看到 raw filesystem API。 | 单文件最大读写大小 | 建议值：10 MiB | 硬上限 | 建议评审值 | 当前规格未统一定义；大文件应通过附件/引用路径处理 |
| 开发可执行工具 | 执行 Bash/Python | Bash/Python SHALL 通过 sandbox gateway 执行。 | 命令执行 timeout | 建议值：120,000 ms 默认，300,000 ms 硬上限 | 默认值/硬上限 | 建议评审值 | cross-platform semantics 要求定义但当前未列值 |
| 开发可执行工具 | 执行 Bash/Python | Bash/Python SHALL 控制 stdout/stderr 和 env。 | stdout/stderr 最大大小 | 建议值：1 MiB/stream | 硬上限 | 建议评审值 | 当前规格未列值；超过应截断并记录 safe diagnostic |
| 接入业务 API | 开发 API-backed Tool | 外部系统 API SHOULD 建模为受治理 Tool，而不是独立执行通道。 | API 调用 timeout | 建议值：30,000 ms 默认，120,000 ms 硬上限 | 默认值/硬上限 | 建议评审值 | 当前规格未定义；长耗时应建模为异步任务 |
| 接入业务 API | 开发 API-backed Tool | API provider SHALL 复用 schema validation、result mapping、audit 和 safe error。 | API response 最大大小 | 建议值：1 MiB | 硬上限 | 建议评审值 | 当前规格未定义；超过应引用化或分页 |
| 开发 Skill | 编写 SKILL.md | Skill source SHALL 复用统一 `SKILL.md` parser、descriptor mapper 和 diagnostics。 | 单个 SKILL.md 最大大小 | 建议值：256 KiB | 硬上限 | 建议评审值 | 当前规格未定义；配置：需新增配置 |
| 开发 Skill | 编写 SKILL.md | Skill resource SHOULD 有总大小限制，避免受控 root 膨胀并拖慢 discovery。 | Skill resource 总大小 | 建议值：10 MiB / Skill | 容量目标 | 建议评审值 | 开发者约束补充；配置：需新增配置 |
| 开发 Skill | 编写 SKILL.md | 仅支持批准的 custom metadata 扩展。 | 顶层 custom 扩展 | `context` | 支持范围 | 已定义 | `skill-manifest-contract` |
| 开发 Skill | 编写 SKILL.md | 仅支持批准的 metadata 扩展。 | 支持 metadata 扩展 | `metadata.denied-tools`、`metadata.model` | 支持范围 | 已定义 | `skill-manifest-contract` |
| 发现 Skill | 加载内置 Skill | Builtin Skill discovery SHALL 从 package-owned trusted resource root 枚举一级 `SKILL.md` candidate。 | 目录扫描深度 | 1 级 | 硬约束 | 已定义 | `builtin-skill-source` |
| 发现 Skill | 加载内置 Skill | runtime/core/context/model/channel MUST NOT 直接扫描 builtin Skill resource root。 | builtin Skill 数量上限 | 建议值：200 | 硬上限 | 建议评审值 | 当前规格未定义；需 catalog 构建和 listAvailable 压测 |
| 发现 Skill | 加载本地 Skill | Local Skill source SHALL 支持 system-level 和 Agent-owned 两类来源。 | 本地 Skill 来源类型 | system-level、Agent-owned | 支持范围 | 已定义 | `local-skill-source` |
| 发现 Skill | 加载本地 Skill | 每个一级子目录中的 `SKILL.md` 为一个 candidate；隐藏目录和嵌套 Skill 不作为独立 Skill。 | 目录扫描深度 | 1 级 | 硬约束 | 已定义 | `local-skill-source` |
| 获取远端 Skill | 同步 SkillHub | SkillHub SHALL 通过 remote gateway refresh/search/download/install。 | SkillHub package 格式 | zip | 协议格式 | 已定义 | `skillhub-source` |
| 获取远端 Skill | 同步 SkillHub | 安装成功且 manifest/governance 校验通过后才进入 catalog。 | 首版 SkillHub package 内容 | 单文件 rooted at `SKILL.md` | 范围限制 | 已定义 | `skillhub-source` |
| 获取远端 Skill | 同步 SkillHub | 嵌套资源 SHALL 被拒绝。 | 嵌套 `scripts/`、`references/`、`assets/` | 不支持 | 范围限制 | 已定义 | `skillhub-source` |
| 调用 Skill | 使用 Skill Tool | `Skill` Tool SHALL 作为 governed Skill capability 的受控转接点。 | 单 run 最大 Skill 调用次数 | 建议值：15 | 硬上限 | 建议评审值 | 与当前默认 3 tool rounds × 5 calls/round 对齐；需固化为目标规格 |
| 调用 Skill | 使用 Skill Tool | Skill body/resource 注入 SHOULD 受 context budget 限制。 | 单次 Skill 注入上下文最大大小 | 建议值：32 KiB 文本 | 硬上限 | 建议评审值 | 韧性补充；长资源通过受控 resource view 分段读取 |
| 访问 Skill 资源 | 提供受控资源视图 | Skill resources SHALL 通过 execution file access policy 派生受控 roots。 | 资源 root 类型 | `workspace/`、`.nextagent/`、`temp/` | 支持范围 | 已定义 | `add-ts-skill-resource-access` |
| 开发子 Agent | 发现 Agent capability | 框架 SHOULD 支持内置 Agent capability 与 `agents/{agentId}/subagents/` 进入统一 catalog。 | 单 Agent 最大 subagent 数量 | 建议值：20 | 硬上限 | 建议评审值 | 当前规格未定义；需与 capability 可见数量上限一致 |
| 调用子 Agent | 使用 Agent Tool | 本地子 Agent 调用 SHALL 通过 `Agent` Tool 和 `SubagentExecutionPort` 创建隔离 child session/run。 | 子 Agent 调用最大深度 | 1 层 | 硬约束 | 已定义 | `add-ts-agent-tool` 自动 no-nesting 约束 |
| 路由请求 | 执行 Agent routing | Agent Core SHALL 在 request accepted 后、context/model/capability 前执行 routing policy。 | routing decision kind | deterministic flow、model-driven loop、clarify、reject、human handoff | 枚举范围 | 已定义 | `agent-routing-core` |
| 路由请求 | 执行 Agent routing | routing SHALL 只消费 frozen trusted facts。 | routing 决策超时 | 建议值：5,000 ms | 硬上限 | 建议评审值 | 当前规格未定义；模型驱动 routing 需单独区分 model timeout |
| 路由请求 | 指定目标 Skill | 开发者可提供 targeted skill 路由约束；系统 MUST 对约束执行 schema、scope、availability 和 permission validation。 | 单次请求目标 Skill 数量 | 1 | 目标值 | 建议评审值 | 建议与用户侧指定 Skill 对齐 |
| 编排 Workflow | 定义 workflow contract | 框架 MAY 定义 `WorkflowExecutionService`、Recipe DSL、FlowGraph 和节点 DTO。 | WorkflowNodeType 数量 | 28 | 目标范围 | 已定义 | `packages/agent-common/src/index.ts` `workflowNodeTypes` |
| 编排 Workflow | 定义 workflow contract | Workflow SHALL 与 conversation loop 并列，MUST NOT 注册为 Capability。 | 单 workflow 最大节点数 | 建议值：100 | 硬上限 | 建议评审值 | 当前规格未定义；避免 FlowGraph 膨胀 |
| 分发 Workflow | 匹配 recipe | Agent router MAY 支持显式 recipeId 或 intent recognition 分发到 workflow。 | 单 Agent 最大 recipe 数量 | 建议值：50 | 硬上限 | 建议评审值 | 当前规格未定义；recipe catalog 需可分页/诊断 |
| 分发 Workflow | 匹配 recipe | 无法匹配时 SHALL fallback conversation loop 或 safe reject。 | recipe 匹配超时 | 建议值：1,000 ms deterministic，5,000 ms model-assisted | 硬上限 | 建议评审值 | 当前规格未定义；两类匹配路径应分开验收 |
| 扩展 Hook | 编写 lifecycle hook | Hook SHALL 只能挂载在批准 lifecycle stage。 | 完整 hook stage 数 | 9 | 目标范围 | 已定义但需对齐 | `complete-ts-lifecycle-hook-capabilities` |
| 扩展 Hook | 编写 lifecycle hook | Hook 可 observe/control/transform，但 MUST NOT 修改 runtime 状态机、伪造终态或绕过 terminal commit。 | Hook 修改 terminal state 权限 | 0 | 硬约束 | 已定义 | Hook 禁止项 |
| 扩展 Hook | 加载 hook package | App composition SHALL 在启动期扫描 `configRoot/hooks` 下一级 hook package。 | hook package 扫描深度 | 1 级 | 硬约束 | 已定义 | `add-ts-hook-directory-loading` |
| 扩展 Hook | 加载 hook package | request path MUST NOT 做目录扫描。 | request path hook 扫描次数 | 0 | 硬约束 | 已定义 | `add-ts-hook-directory-loading` |
| 扩展 Policy | 执行 risk policy | Risk policy SHALL 在 capability、sandbox、authorization/high-risk confirmation 前执行。 | risk policy 执行超时 | 建议值：1,000 ms | 硬上限 | 建议评审值 | 当前规格未定义；policy 不应成为主路径长耗时边界 |
| 扩展 Plugin | 装配 Agent-scoped plugin | 插件 SHOULD 由 system config 显式清单启动期加载，并只在激活 Agent 中生效。 | 插件加载时机 | 启动期 | 硬约束 | 已定义 | `add-ts-agent-scoped-plugin-composition` |
| 扩展 Plugin | 装配 Agent-scoped plugin | 插件贡献 MUST 进入 Tool/Policy/Hook 治理路径。 | 单 Agent 最大插件数量 | 建议值：20 | 硬上限 | 建议评审值 | 当前规格未定义；需启动期加载和治理路径压测 |
| 集成 Gateway | 接入 local/remote gateway | 开发者接入外部存储、远端服务、SkillHub、business API 或 sandbox 时，SHALL 通过 gateway/adapter boundary。 | gateway 调用 timeout | 建议值：30,000 ms 默认，120,000 ms 硬上限 | 默认值/硬上限 | 建议评审值 | 当前规格未定义；local atomic transaction 不承诺中途 abort |
| 集成 Web API | 调用 REST API | Web API SHALL 只暴露 public DTO；internal DO、gateway Record、DB row/entity MUST NOT 进入 Web response。 | API 最大分页大小 | 建议值：200 | 硬上限 | 建议评审值 | 当前规格未定义；与会话/历史分页上限对齐 |
| 集成 Stream | 消费 SSE/WS | SSE 与 WebSocket SHALL 使用同一 stream input 和 `StreamEnvelope` projection。 | 支持 transport | SSE、WebSocket | 支持范围 | 已定义 | `developer/09-streaming-events.md` |
| 集成 Stream | 消费 SSE/WS | transport framing MAY differ，但 lifecycle/history/terminal semantics MUST equivalent。 | stream event buffer size | 建议值：1,000 event/run | 容量目标 | 建议评审值 | 当前规格未定义；与 replay buffer 对齐 |
| 测试扩展 | 使用 Agent test kit | 框架 SHOULD 提供 schema samples、fake gateway、contract fixtures、architecture helpers。 | test kit 依赖 provider SDK | 否 | 硬约束 | 已定义 | `agent-test-kit/README.md` |
| 验证扩展 | 增加 contract/architecture tests | 开发者新增 contract、gateway、stream、capability 或 scope 行为时，MUST 提供 contract/architecture/characterization tests。 | 违法边界 negative case 数量 | 至少 1/约束 | 评审规则 | 建议评审值 | 与 AGENTS negative case 要求对齐 |
| 打包本地运行时 | 生成 local runtime package | 框架 SHALL 提供本地运行包边界、启动入口、配置样例、版本 manifest 和 release candidate evidence。 | package 启动时延 | 建议值：<= 10 秒 | 目标值 | 建议评审值 | 当前规格未定义；应以 release package gate 实测 |
| 托管前端产物 | 提供 fullstack hosting | 后端 MAY 托管前端构建产物；profile 和 route precedence MUST 可验证。 | package profile | backend-only、with-frontend | 支持范围 | 已定义 | `refine-ts-fullstack-packaging-boundary` |

## 三、质量属性特性：安全、可靠、容量、可诊断、可维护、可测试

| 一级 feature | 二级 feature | Feature 描述 | 规格项 | 规格值 | 值类型 | 状态 | 来源/备注 |
|---|---|---|---|---|---|---|---|
| 隔离用户数据 | 校验 Owner Scope | 所有用户数据访问 SHALL 同时校验 `tenantId` 和 `subjectId`。 | owner scope 字段 | `tenantId`、`subjectId` | 必填字段 | 已定义 | `P0-01` |
| 隔离用户数据 | 校验 Owner Scope | session、message、run、timeline、attachment、artifact、memory、pending input、feedback、audit 等持久化事实 MUST 显式携带 owner scope。 | 跨用户数据泄露容忍次数 | 0 | 硬约束 | 已定义 | 安全红线 |
| 隔离 Agent 数据 | 校验 Agent Scope | 主路径运行数据访问 SHALL 同时校验 Agent Scope。 | Session 绑定 agentId | 是 | 硬约束 | 已定义 | AGENTS 架构约束 |
| 隔离 Agent 数据 | 校验 Agent Scope | `RequestRun` MUST 在 acceptance 固化 `agentId`、`agentVersion`、`agentAssemblyRef`。 | RequestRun 固化 Agent 字段 | `agentId`、`agentVersion`、`agentAssemblyRef` | 必填字段 | 已定义 | `ts-minimal-agent-kernel` |
| 校验不可信输入 | 执行 runtime validation | HTTP、stream、config、gateway response、persisted JSON、capability input/output 等不可信边界 MUST runtime schema validate。 | 最大输入 payload size | 建议值：1 MiB 默认，按边界收紧 | 硬上限 | 建议评审值 | 当前规格未定义；附件、stream event、Tool schema 应有更小专项上限 |
| 校验不可信输入 | 执行 runtime validation | 不可信边界 MUST runtime schema validate。 | schema validation 超时 | 建议值：<= 100 ms/payload | 硬上限 | 建议评审值 | 当前规格未定义；需用 worst-case schema 样本压测 |
| 校验不可信输入 | 执行 runtime validation | schema validation failure SHOULD 受错误详情大小限制，避免错误回显放大。 | validation error detail 最大大小 | 建议值：8 KiB | 硬上限 | 建议评审值 | 韧性补充；不得回显 raw payload |
| 保护错误输出 | 归一化 SafeError | 所有 unknown/internal/provider/tool errors MUST 通过 safe error normalization 后跨边界输出。 | raw prompt/model/tool payload 泄漏次数 | 0 | 硬约束 | 已定义 | SafeError 禁止项 |
| 保护错误输出 | 归一化 SafeError | SafeError MUST NOT 包含 raw prompt、模型输出、tool args/result、path、credential、stack 或 provider raw error。 | safeDetails 最大大小 | 建议值：8 KiB | 硬上限 | 建议评审值 | 当前规格未定义；超过应截断为 reason code/ref |
| 脱敏观测数据 | 应用 redaction policy | 日志、metric、trace、audit、stream diagnostic、health diagnostic MUST 经过统一脱敏策略。 | secret/credential 泄漏次数 | 0 | 硬约束 | 已定义 | `add-ts-redaction-policy`；配置：已支持配置（`observability.logging.redaction`） |
| 脱敏观测数据 | 应用 redaction policy | 敏感内容和高基数字段不得泄漏。 | 高基数字段阈值 | 建议值：单 attribute <= 100 distinct values / 10 min | 策略阈值 | 建议评审值 | 当前规格未定义；超出应降级为 size class/hashless category |
| 隔离动态执行 | 使用 sandbox gateway | 动态 shell、python、脚本和模型生成代码 MUST 走 sandbox gateway。 | sandbox 绕过允许次数 | 0 | 硬约束 | 已定义 | `P1-N04` |
| 隔离动态执行 | 使用 sandbox gateway | 默认 adapter SHALL deny-by-default 或 unavailable。 | 默认 sandbox adapter 行为 | deny-by-default / unavailable | 硬约束 | 已定义 | `sandbox-deny-by-default-adapter`；配置：已支持配置（`sandbox.enabled`） |
| 隔离动态执行 | 使用 sandbox gateway | sandbox SHALL 控制 timeout、stdout/stderr、env 和 cwd。 | 命令执行 timeout | 建议值：120,000 ms 默认，300,000 ms 硬上限 | 默认值/硬上限 | 建议评审值 | 当前规格未定义；配置：需新增配置（`sandbox.limits.*`） |
| 保护 Secret | 使用 SecretReference | Secret MUST 通过 `SecretReference` 或 secret resolver 处理。 | 支持 secret reference scheme | `env:`、`file:` | 支持范围 | 已定义 | `add-ts-secret-configuration-boundary` |
| 保护 Secret | 使用 SecretReference | raw secret MUST NOT 进入 product config、logs、stream、audit、metrics 或 model context。 | raw secret 输出次数 | 0 | 硬约束 | 已定义 | 安全红线 |
| 保护 Secret | 使用 SecretReference | secret resolution SHOULD 有缓存和失败隔离，避免每次请求重复读取慢边界。 | secret resolver timeout | 建议值：1,000 ms | 硬上限 | 建议评审值 | 韧性补充；超时返回 safe config/runtime error |
| 统一执行入口 | 通过 runtime command 执行 | submit、cancel、retry、edit、resume SHALL 通过 runtime command 入口进入执行生命周期。 | competing lifecycle owner 数量 | 0 | 硬约束 | 已定义 | `P1-S01` |
| 提交唯一终态 | 执行 terminal commit | 每个 accepted request MUST 只有一个权威终态。 | 每个 accepted request 终态数量 | 1 | 硬约束 | 已定义 | `terminal-consistency` |
| 提交唯一终态 | 执行 terminal commit | stream、RequestRun 和 visible history MUST 一致。 | 终态不一致容忍次数 | 0 | 硬约束 | 已定义 | `P1-S03` |
| 恢复运行状态 | 重启后恢复 request run | 重启后 runtime SHALL 根据 queued/executing/terminal-pending、checkpoint、message、timeline 和 terminal facts 恢复。 | 恢复扫描周期 | 建议值：启动时立即扫描，后台每 60 秒扫描 | 默认值 | 建议评审值 | 当前规格未定义；需避免与 request lifecycle 并发竞争 |
| 恢复运行状态 | 重启后恢复 request run | 无法安全恢复时 SHALL 显式失败。 | 最大恢复 run 数 | 默认 100，最大 1,000 | 容量目标 | 当前实现值 | `packages/agent-runtime/src/lifecycle/submit.ts` |
| 恢复运行状态 | 重启后恢复 request run | 恢复过程 SHOULD 有整体耗时上限，避免启动被历史积压阻塞。 | 恢复批处理时长 | 建议值：<= 30 秒 / 批 | 目标值 | 建议评审值 | 韧性补充；剩余 run 进入后续批次 |
| 控制副作用 | 检查幂等声明 | 恢复或重试中重新调用有副作用 capability 前，runtime MUST 检查 Tool 幂等声明。 | 非幂等重复副作用容忍次数 | 0 | 硬约束 | 已定义 | `runtime-recovery-idempotency-guard` |
| 保持事务一致 | 使用 composite gateway write | 主路径复合持久化操作 SHALL 由 gateway 提供单一 composite write，并在 gateway-local 中以一个数据库事务完成。 | 每个 composite write 事务数量 | 1 | 硬约束 | 已定义 | AGENTS 架构边界；配置：gateway selection 已支持配置（`gateway.selectedGatewayId`） |
| 定义容量目标 | 设定发布指标 | 系统 SHOULD 定义首包流式响应时间、取消可见时延、历史打开时延、并发活动会话数等发布评估指标。 | 首包流式响应时间 | 建议值：<= 3,000 ms | 目标值 | 建议评审值 | `P2-N07` 要求定义但无阈值；与用户侧保持一致 |
| 定义容量目标 | 设定发布指标 | 系统 SHOULD 定义容量和性能目标。 | 取消可见时延 | 建议值：<= 1,000 ms | 目标值 | 建议评审值 | `P2-N07` 要求定义但无阈值；与用户侧保持一致 |
| 定义容量目标 | 设定发布指标 | 系统 SHOULD 定义容量和性能目标。 | 历史打开时延 | 建议值：<= 1,000 ms / 50 message page | 目标值 | 建议评审值 | `P2-N07` 要求定义但无阈值；基于当前默认分页 50 |
| 定义容量目标 | 设定发布指标 | 系统 SHOULD 定义容量和性能目标。 | 并发活动会话数 | 建议值：100 | 容量目标 | 建议评审值 | `P2-N07` 要求定义但无阈值；与用户侧全局并发目标一致 |
| 控制上下文容量 | 限制历史预算 | 历史、附件、摘要和工具结果进入模型前 SHALL 受统一窗口预算约束。 | 历史上下文预算占比 | 不设独立占比上限（原 60% cap 已移除） | 范围限制 | 当前实现值 | `packages/agent-context-engine/src/budget/default-proportional-budget-policy.ts`；commit `4a422c232` 从 `context-engine` spec 移除 60% Requirement，代码仅在可用输入占比 <0.885 时发 `PRE_SEND_CHECK_REQUIRED`；配置：已支持配置（`preSendCheckRatio`） |
| 控制并行执行 | 限制并行能力 | 后置并行能力执行 SHALL 有预算、依赖图、取消传播、结果聚合、失败降级和可观测聚合。 | 单 run 并行能力上限 | 建议值：5 | 硬上限 | 建议评审值 | 后置能力；需与 `maxToolCalls` 和 provider 并发预算对齐 |
| 控制并行执行 | 限制并行能力 | 后置并行能力执行 SHALL 有预算和依赖图。 | 并行队列长度 | 建议值：50/run | 容量目标 | 建议评审值 | 后置能力；超过应排队或拒绝 |
| 记录审计事实 | 写入 audit event | Capability、hook、policy、pending input、terminal commit、feedback 等关键执行事实 SHOULD 产生安全审计事件。 | audit event 最大大小 | 建议值：16 KiB | 硬上限 | 建议评审值 | 当前规格未定义；正文不得含 raw prompt/tool result |
| 记录审计事实 | 写入 audit event | run-bound audit SHOULD 携带 trusted `agentId`。 | run-bound audit agentId | 必填/可传递 | 字段约束 | 已定义 | `add-agent-id-to-audit-event` |
| 记录审计事实 | 写入 audit event | audit 写入失败 SHOULD 隔离主路径，并按策略降级或阻断高风险操作。 | audit 写入 timeout | 建议值：1,000 ms | 硬上限 | 建议评审值 | 韧性补充；安全关键事件可配置 fail-closed |
| 审计能力调用 | 记录 invocation | 能力调用 SHALL 记录 invocation id、capability id、run/request/session 坐标、status、timeout/cancel/failure safe outcome 和 result refs。 | 单 run 最大 invocation 数量 | 建议值：100 | 硬上限 | 建议评审值 | 当前规格未定义；与可见步骤和 tool 调用预算对齐 |
| 输出结构化日志 | 生成 safe log | 系统 SHALL 使用结构化日志 projector 和安全业务标识字段。 | 日志字段最大长度 | 建议值：2,000 字符 | 硬上限 | 建议评审值 | 当前规格未定义；长文本应转 reason code/ref |
| 输出结构化日志 | 生成 safe log | 业务模块 SHOULD 通过 observation/event envelope 输出。 | 日志采样率 | 建议值：error 100%，info 100%，debug 默认 0% | 默认值 | 建议评审值 | 当前规格未定义；配置：需新增配置 |
| 输出结构化日志 | 生成 safe log | 日志写入 SHOULD 有 backpressure 策略，避免 IO 阻塞 request terminal commit。 | 单 request 最大日志事件数 | 建议值：200 | 硬上限 | 建议评审值 | 韧性补充；超过降级为聚合摘要 |
| 关联 Trace 和日志 | 建立 diagnostic context | 系统 SHOULD 关联 request/run diagnostic context、event envelope snapshot、logs 和 traces。 | trace 采样率 | 建议值：error 100%，normal 10% | 默认值 | 建议评审值 | 当前规格未定义；配置：需新增配置 |
| 关联 Trace 和日志 | 建立 diagnostic context | 不得把 trace/span SDK 类型泄漏进核心契约。 | trace/span SDK 类型进入核心契约次数 | 0 | 硬约束 | 已定义 | observability boundary |
| 暴露健康状态 | 提供 health/readiness | 系统 SHALL 提供 health、readiness/liveness 和核心 metrics。 | health check 超时 | 250 ms（per-probe） | 默认值 | 当前实现值 | `packages/agent-observability/src/health/health-evaluator.ts` |
| 暴露健康状态 | 提供 health/readiness | 诊断输出 MUST 使用 safe facts。 | metric 维度上限 | 建议值：每个 metric <= 5 个 label，单 label <= 20 distinct values | 硬上限 | 建议评审值 | 当前规格未定义；避免高基数爆炸 |
| 控制进程资源 | 限制单实例资源 | local runtime SHOULD 有资源预算和监控阈值，避免资源耗尽影响主路径。 | 单实例 RSS 内存预算 | 建议值：<= 1 GiB steady state，<= 2 GiB peak | 容量目标 | 建议评审值 | 维护规格补充；配置：需新增监控阈值 |
| 控制进程资源 | 限制单实例资源 | local runtime SHOULD 有资源预算和监控阈值，避免资源耗尽影响主路径。 | 单实例文件描述符预算 | 建议值：<= 2,048 FD / instance | 容量目标 | 建议评审值 | 维护规格补充；配置：需新增监控阈值 |
| 控制存储资源 | 限制持久化体量 | 本地持久化 SHOULD 有数据库大小、row payload 和保留期上限。 | SQLite 数据库建议上限 | 建议值：10 GiB / local instance | 容量目标 | 建议评审值 | 维护规格补充；配置：需新增配置/监控阈值 |
| 控制存储资源 | 限制持久化体量 | 大内容 MUST artifact/ref 化，不得塞入通用 JSON 字段。 | 单持久化 JSON 字段大小 | 建议值：64 KiB | 硬上限 | 建议评审值 | 维护规格补充；配置：需新增 schema 约束 |
| 控制存储资源 | 管理历史保留 | timeline 和 audit SHOULD 有独立保留策略，避免诊断历史无界增长。 | timeline event 保留期 | 建议值：30 天或随 session 清理 | 默认值 | 建议评审值 | 维护规格补充；配置：需新增配置 |
| 控制存储资源 | 管理审计保留 | audit SHOULD 长于 timeline，并满足合规评审。 | audit event 保留期 | 建议值：180 天 | 默认值 | 建议评审值 | 维护规格补充；配置：需新增配置 |
| 控制日志资源 | 管理日志轮转 | 日志 SHOULD 有保留期、单文件大小和文件数量限制。 | log 文件保留策略 | 建议值：14 天，单文件 100 MiB，最多 20 个文件 | 默认值/硬上限 | 建议评审值 | 当前已支持 `paths.logDirectory`；轮转配置：需新增配置 |
| 管理启停过程 | 限制启停耗时 | readiness 和 shutdown SHOULD 有目标时延，避免运维过程不可预测。 | 启动 readiness 时延 | 建议值：<= 10 秒 | 目标值 | 建议评审值 | 维护规格补充；配置：需新增发布指标 |
| 管理启停过程 | 限制启停耗时 | shutdown SHOULD 在受控时间内完成 terminal/recovery 安排。 | 优雅关闭时长 | 建议值：<= 30 秒 | 目标值 | 建议评审值 | 维护规格补充；配置：需新增配置 |
| 管理数据迁移 | 执行 migration | migration SHOULD 有单步 timeout、审计证据和失败恢复策略。 | 数据库 migration 单步 timeout | 建议值：60 秒 | 硬上限 | 建议评审值 | 维护规格补充；配置：需新增配置 |
| 管理备份恢复 | 备份本地数据 | 本地数据 SHOULD 有明确 RPO/RTO 或明确非目标。 | 本地数据备份 RPO | 建议值：24 小时 | 目标值 | 建议评审值 | 维护规格补充；配置：需新增运维配置 |
| 管理备份恢复 | 恢复本地数据 | 恢复流程 SHOULD 覆盖 SQLite、config、Agent package 和附件 metadata。 | 本地数据恢复 RTO | 建议值：30 分钟 | 目标值 | 建议评审值 | 维护规格补充；配置：需新增运维配置 |
| 控制发布产物 | 限制 package 规模 | candidate package SHOULD 有大小和完整性检查。 | candidate package 大小 | 建议值：<= 200 MiB | 容量目标 | 建议评审值 | 维护规格补充；配置：需新增发布检查 |
| 维护模块边界 | 禁止 private import | 跨 package MUST 通过 public package exports、`agent-contracts` 和 `agent-common` 协作。 | private path import 允许次数 | 0 | 硬约束 | 已定义 | architecture gate |
| 分离数据对象 | 区分 DO/DTO/PO | 领域服务 SHALL 暴露领域对象或 read model；Web/channel SHALL 暴露 public DTO；gateway SHALL 暴露 `*Record` persistence DTO。 | gateway Record 进入 Web response 次数 | 0 | 硬约束 | 已定义 | AGENTS 架构边界 |
| OpenSpec-first | 执行规格优先 | 新增或修改 Web API、stream event、runtime command、context/capability/gateway contract、persistence owner、安全边界或可观测信号前，MUST 先有 OpenSpec change。 | 无 OpenSpec 修改 public contract 次数 | 0 | 硬约束 | 已定义 | AGENTS 规格优先 |
| 验证发布质量 | 运行验证门禁 | 常规验证 SHOULD 覆盖 build、unit、contract、architecture；OpenSpec change SHOULD 通过 strict validation。 | 标准验证命令 | `npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`openspec validate --all --strict` | 命令集合 | 已定义 | AGENTS 验证门禁 |
| 验证发布质量 | 运行验证门禁 | 没有可重复验证路径的任务不得视为完成。 | 覆盖率阈值 | 建议值：变更触达 package 行覆盖率 >= 80%；P0/P1 contract/security/resilience 场景 100% 用例覆盖 | 质量阈值 | 建议评审值 | 韧性补充；现有门禁以 build/unit/contract/architecture/OpenSpec 为准 |
| 验证发布质量 | 运行验证门禁 | 韧性规格 SHOULD 有可重复压测或边界测试。 | 韧性边界测试数量 | 建议值：每个新增上限至少 1 个正例和 1 个超限反例 | 质量阈值 | 建议评审值 | 韧性补充；适用于数量、大小、频率、超时、并发、保留期 |
| 验证反例 | 断言 negative case | 禁止项、边界逃逸、非法依赖、scope 越权、secret 泄漏、sandbox 绕过等 negative case MUST 由测试或命令实际触发并断言失败。 | 每个禁止项 negative case 数量 | >= 1 | 评审规则 | 建议评审值 | 与 AGENTS 要求对齐 |
| 验证真实产品路径 | 运行 E2E gates | Release E2E SHALL 使用真实 local product process、真实 HTTP/SSE/WS、真实 persistence 和实际 candidate package。 | release package gate 源码 fallback | 不允许 | 硬约束 | 已定义 | `ts-e2e-release-package-gate` |
| 验证依赖安全 | 扫描供应链风险 | 发布候选 SHOULD 阻断未豁免 high/critical dependency vulnerability。 | high/critical dependency vulnerability | 0 个未豁免 | 硬约束 | 建议评审值 | 工程规格补充；配置：不建议 runtime 配置，允许 release waiver |
| 隔离 Provider 失败 | 保护无关来源 | provider failure MUST NOT 阻塞无关 provider 或 request lifecycle。 | provider failure 重试次数 | 建议值：0 次自动重试，caller 显式 retry | 默认值 | 建议评审值 | 当前规格未定义；避免重复副作用和不可解释延迟 |
| 隔离 Provider 失败 | 保护无关来源 | provider failure MUST 被隔离。 | provider 熔断阈值 | 建议值：连续 5 次失败或 1 分钟失败率 >= 50% | 策略阈值 | 建议评审值 | 当前规格未定义；需按 provider/profile 维度隔离 |
| 治理插件扩展 | 限制插件权限 | 插件贡献 MUST 经启动期显式配置、Agent 激活、capability/policy/hook governance。 | 动态热加载 | 不支持 | 范围限制 | 已定义 | `add-ts-agent-scoped-plugin-composition` |
| 治理插件扩展 | 限制插件权限 | 插件不得自动获得权限。 | 单 Agent 最大插件数量 | 建议值：20 | 硬上限 | 建议评审值 | 当前规格未定义；与开发者侧插件目标一致 |
| 公共词汇稳定性 | 统一 durable vocabulary | RunStatus、TimelineEventType、StreamEventType、CapabilityKind、ProviderKind 等 durable vocabulary SHOULD 稳定归属 `agent-common` 或 owning subpath。 | 重复定义等价 enum 允许次数 | 0 | 硬约束 | 已定义 | `establish-ts-core-contracts` |
| 传输等价性 | 对齐 SSE/WS 语义 | SSE 和 WebSocket MAY 使用不同 framing，但 MUST 使用同一 resume input、StreamEnvelope 和 lifecycle/history/terminal 语义。 | 支持 transport 数量 | 2 | 支持范围 | 已定义 | SSE、WebSocket |
| 清理附件 | 提供 cleanup port | Attachment runtime SHOULD 提供显式 cleanup port，并保留 owner scope 与 audit 接入点。 | 附件保留期 | 建议值：30 天或随 session 删除 | 默认值 | 建议评审值 | 当前规格未定义；需区分用户上传、artifact 引用和临时文件 |
| 清理附件 | 提供 cleanup port | 后台 scheduler、retention policy 和 session-linked cleanup 需单独定义。 | cleanup 批大小 | 建议值：100 个对象/批 | 容量目标 | 建议评审值 | 当前规格未定义；需避免长事务 |
| 清理附件 | 提供 cleanup port | cleanup SHOULD 有执行窗口和失败重试上限，避免后台任务长时间占用主路径资源。 | cleanup 单批 timeout | 建议值：30,000 ms | 硬上限 | 建议评审值 | 韧性补充；失败进入下个周期并记录 safe diagnostic |
| 管理长期记忆 | 定义 memory lifecycle | 长期记忆 SHALL 有独立 lifecycle、owner isolation、检索/写入/遗忘/维护边界。 | 单用户最大记忆条数 | 建议值：10,000 条 | 硬上限 | 建议评审值 | 当前规格未定义；需 memory store/query 压测 |
| 管理长期记忆 | 定义 memory lifecycle | memory retrieval 不得默认把全部用户上下文注入模型。 | memory retrieval topK | 建议值：10 默认，50 硬上限 | 默认值/硬上限 | 建议评审值 | 当前规格未定义；需和 context budget 共同裁剪 |

## 设计评审检查问题

| 检查项 | 评审问题 |
|---|---|
| Feature 命名 | 一级和二级 feature 是否优先使用动宾短语；若使用领域名词或质量属性名称，是否仍能对应明确能力边界？ |
| Feature 描述 | 描述是否能判断使用者、能力边界、输入、输出、事实源、owner 和禁止项？ |
| 规格 pair | 是否每个可量化点都有“规格项 / 规格值”？ |
| 数值状态 | 规格值是已定义、建议评审值、缺失待定、示例值非规格，还是不适用？ |
| 作用域 | 数值是否说明了 per Agent、per tenant、per subject、per session、per request、per run、per instance？ |
| 用户价值 | 该 feature 是否能对应最终用户或开发者的明确任务，而不是纯内部机制？ |
| Owner 边界 | 该 feature 的事实源、写入 owner、查询 owner 和 projection owner 是否唯一？ |
| Agent / Owner Scope | 是否明确哪些字段来自可信 Agent Scope 和 Owner Scope？是否拒绝客户端覆盖？ |
| 契约边界 | 是否新增或修改 public contract、stream event、runtime command、gateway Record、Web DTO？如有，是否已有 OpenSpec change？ |
| 安全边界 | 是否对不可信输入、secret、raw provider error、附件内容、路径、模型输出和工具结果做 schema validation / redaction？ |
| 恢复与幂等 | 断连、取消、重试、编辑、重启、重复提交和非幂等能力调用是否有明确行为？ |
| 可观测与审计 | 是否定义 safe diagnostic、audit/log/metric/trace 的最小事实，不泄露敏感内容？ |
| 可配置性 | 规格项是否需要环境/部署/profile 差异化配置？若需要，是否标明已支持配置、需新增配置或不建议配置？ |
| 维护资源 | 是否定义 CPU、内存、FD、磁盘、日志、DB、启动、关闭、迁移、备份恢复等维护规格？ |
| 测试方式 | 是否能通过 black-box、contract、architecture、security、resilience 或 E2E gate 验证？ |
| 非目标 | 是否明确哪些能力不在本 feature 内，避免设计评审时扩大范围？ |
