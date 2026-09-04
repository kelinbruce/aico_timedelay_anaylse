## Why

电信网络运维任务会产生文件读取、命令执行、脚本运行、知识检索、Workflow 和自定义工具等多种 Capability 结果。当前用户界面只按少量结果形状硬编码安全详情：同一份结果在实时执行与历史会话中可能经过不同的投影路径，集成方也不能按自身安全要求把某类结果收窄为仅状态或仅摘要。结果是安全敏感的内部资源可能被误识别为普通文件读取并展示正文，而需要用户核验的业务结果又可能只显示“已完成”。该缺口属于全部 Capability 结果的平台级投影治理问题，而不是单个 `Read` 工具的展示缺陷。

现在处理该问题，可以在继续增加工具类型之前冻结统一的安全上限、集成呈现策略和 live/history 等价规则，避免每个工具各自决定是否把原始结果交给浏览器，也避免后续通过前端隐藏补救已经泄露的数据。

“平台安全上限”是系统依据 Capability 身份、受支持的结果类型和字段白名单确定的最高可见级别，集成配置不得突破该上限。“呈现级别”是 `STATUS_ONLY`、`SUMMARY`、`DETAIL` 三个有序级别；成功结果至少保留用户可理解的执行状态，`DETAIL` 仍只表示有界、脱敏、白名单化的安全详情，不表示原始输入、原始输出或任意 JSON。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- 用户在实时执行、刷新后的历史会话以及三种 Agent Web 宿主中看到同一条 Capability 结果的同等级安全投影。
- 平台集成方可以在启动配置中按 Capability 精确调整期望呈现级别；最终投影仍受平台安全上限约束。未配置时使用以 `SUMMARY` 为全局默认、对高风险和高交互价值工具显式覆盖的内置策略。
- 平台先应用不可放宽的安全上限，再应用集成配置；内部 Skill 资源、未知结果形状和敏感字段不能因配置而变得可见。
- 文件读取、命令/脚本输出、结构化业务结果和未知自定义结果具有确定的默认投影、降级与截断行为；普通工作区 Read 与内部 Skill 资源的身份碰撞成为强制回归场景。
- 平台内置安全摘要以语言中立 code 与有界参数传输，Agent Web 按当前界面语言渲染；RAG 默认提供不暴露正文和内部来源的召回摘要。
- Capability 失败以本次执行已经确认的事实呈现：用户能理解发生了什么，技术标识默认收起；系统不得仅凭错误码推断用户行动、自动恢复、自动重试或后续处理承诺。
- 用户已经提交并被接受的 AskUserQuestion 答案作为独立公开对话事实，在三种普通结果配置下保持可见且有界。
- Skill 声明的 `allowed-tools` / `denied-tools` 只是 Capability 治理约束；工具被 Skill、ToolSearch 或直接模型调用激活时，结果都必须按最终解析的工具 `capabilityId` 应用同一投影策略，调用来源不得改变可见结果。
- 用数据驱动的分层验证矩阵覆盖所有已支持投影的内置工具、扩展工具安全降级、Skill 激活来源、三种策略、live/history/三宿主等价以及混合工具大历史容量。
- 大数据量多轮会话加载和快速滚动复用随 history 页面返回的安全投影，不为每条结果追加浏览器请求或重复解析原始结果。

**非目标：**

- 不改变 Capability 执行、工具协议、模型上下文、Message 持久化、runtime lifecycle 或 Gateway contract。
- 不允许普通 Agent Web 通过配置展示原始工具参数、原始命令、未脱敏完整输出、内部 Skill 正文或任意未知 JSON；需要受控原始诊断的场景继续使用开发工作台等独立安全边界。
- 不在本 change 中设计每种工具的专属卡片视觉、ProcessPanel 折叠动效、长答案折叠或 thinking/answer 自由文本治理。
- 不改变模型在 Capability 失败后的下一轮决策，不新增自动 Read、自动重试、自动授权或其他恢复编排；后续实际动作仍以新产生的 Capability 事件、用户输入请求或最终 Assistant Message 为准。
- 不新增运行期管理员配置 API/UI、按用户动态策略或热更新；策略在应用启动期校验并冻结。

## What Changes

- 新增统一的 Capability 结果呈现策略：系统对每条结果先计算平台安全上限，再取集成方期望级别与该上限中更保守的一档，产生唯一的用户可见投影。
- 新增启动期集成配置，支持默认呈现级别和按精确 `capabilityId` 覆盖；非法级别、重复规则和未知字段使应用启动校验失败。
- 修改用户可见 Capability 结果投影，按 `STATUS_ONLY`、`SUMMARY`、`DETAIL` 输出相应的状态、摘要或有界安全详情；移除成功结果完全隐藏的公开策略，配置不得影响 canonical Message 内容或模型上下文。
- 修改历史呈现边界：history 与 live 使用同一后端可信事件投影规则，普通会话页面不再请求 Capability Result Message 作为过程详情来源，浏览器不得从原始或隐藏的 Message 重新构造可见详情。
- **BREAKING**：conversation API 即使收到 `includeCapabilityResults=true`，除既有 AskUserQuestion accepted-answer 兼容路径外，也不再把 Capability Result Message 的原始 `content` 返回为 Web 可消费内容；依赖该内部结果正文的客户端必须改用 run-event history 的安全投影。
- 修改只读 share 边界：共享对话保留用户问题和最终 Assistant Message，排除普通 Capability Result Message 及其原始 content/metadata。
- 为需要执行时可信 descriptor 分类的扩展结果新增非正文、版本化的 `resultProjectionKind` completion 控制事实；首个值仅为 `CLIP_STREAM_V1`，不向 Web 返回且不修改 Gateway schema。
- 为平台内置摘要新增闭合集合 `safeSummaryCode` 与白名单 `safeSummaryArgs`，保留现有 `safeSummary` 作为兼容 fallback；后端不按 locale 固化显示文字。
- 收敛 Capability 安全失败投影：已审计且与错误类别一致的具体错误码优先、完整错误类别兜底、未知错误安全降级；三种成功结果呈现配置下都保留同一条事实性失败原因，默认只在二级技术详情中显示安全错误码、错误类别和本地化调用状态标签。
- 禁止把 `CAPABILITY_STARTED`、语义 code 或其他内部协议标识作为用户文案回退；缺少可翻译语义时显示本地化通用状态或省略附加说明。
- 修改结果分类优先级：Capability 身份和已知安全类别优先于通用结果形状；内部 Skill 内容即使具有类似文件读取的字段，也不能落入文件正文预览。
- 使用三级内置默认表提供最小必要披露，同时为未知、自定义或无法安全分类的结果提供不含原始字段的状态级降级。
- 新增调用来源不变式：同一工具直接调用、经 Skill 激活、经 ToolSearch 激活或其他受治理路径调用时，使用相同的平台安全上限、策略匹配和 Web 投影。

## Feature 影响（Features）

### 修改的 Feature

- `F-2.4 查看请求状态`：用户除查看 Capability 生命周期状态外，还能依赖由平台安全上限和集成策略共同决定、且在 live/history 中一致的结果详情质量保证。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-2.4 查看请求状态` → `specs/ts-run-status-visibility/spec.md`
  - 功能边界：修改用户查看 Capability 执行结果时的安全投影级别、配置选择、实时与历史等价、未知结果降级和容量行为；不改变执行事实本身。
  - 系统质量属性：安全、性能/容量、可靠性/恢复、可维护性、可测试性、审计/可追溯性。
  - 映射说明：`ts-run-status-visibility` 是 canonical spec；既有 `actionable-execution-failure` 中同时混合 request terminal 与 Capability 步骤失败呈现的 Requirement 在本 change 原子迁入该 canonical spec 并按职责拆分，来源 Requirement 删除，其他稳定 Requirements 原位保留；canonical spec 内既有 `Capability Path Rejected Failure Visibility` 由本 change 原子修改为 code/category 联合判定，消除与冲突类别兜底的双重权威。

## 影响范围（Impact）

- 平台集成方新增一个可选的启动配置面；沿用内置配置的部署默认以安全摘要呈现普通工具，对受限和高交互价值工具使用显式覆盖。
- Web stream 与 run-event history 的 Capability 结果响应会统一为后端安全投影；conversation history 只负责普通会话消息，前端不再从原始结果内容推导过程详情。
- 受影响实现预计涉及应用配置校验与窄投影、Web channel 共享结果投影、conversation/share/history 输出、CLIP completion 分类和 Agent Web 本地化消费路径；跨 core/runtime/channel 持久化使用的 `CLIP_STREAM_V1` 分类常量由 `agent-common` 单一 owning，不新增 `agent-contracts` 或 Gateway contract。
- 验证将在 contract 层穷举已支持的内置结果类别与三种策略，覆盖普通工作区 Read 与内部 Skill 资源的身份碰撞、Skill 激活工具、扩展工具、未知结果、安全降级、错误码与完整错误类别映射、内部协议标识防泄漏、SSE/WS、live/history/三宿主等价以及 500 个混合工具过程步骤的历史加载与快速滚动。
