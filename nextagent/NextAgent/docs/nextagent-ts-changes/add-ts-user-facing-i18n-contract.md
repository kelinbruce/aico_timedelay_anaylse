# add-ts-user-facing-i18n-contract

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：反馈与语言

状态：candidate
类型：扩展候选 change
主要 owner：`agent-common`、`agent-channel-web`、`agent-app`
协作 owner：`agent-observability`、`agent-runtime`、`agent-capability`、`agent-context-engine`
依赖：`establish-ts-core-contracts`、`add-ts-provider-error-safe-mapping`、`add-ts-redaction-policy`、`add-ts-web-sse-ws-transports`、`refine-ts-fullstack-packaging-boundary`、`add-ts-bilingual-telecom-output`

目标：
- 为后端返回给客户端的用户可见错误、状态、提示、认证 challenge、stream 降级、pending input、任务管理和配置校验结果建立国际化契约。
- 后端输出稳定 `messageKey`、安全参数、locale-aware fallback 文案和错误/状态 code；前端按 locale 使用本地 bundle 渲染最终展示文本。
- `SafeError.message` 作为安全 fallback 字段，但不得把硬编码英文 `message` 作为唯一用户展示来源。
- 区分“模型回答语言跟随”与“产品 UI / API / stream 文案国际化”：前者由 `add-ts-bilingual-telecom-output` 承载，本 change 只治理客户端可见产品文案。

规格输入：
- `RequestLocale` 仍是核心上下文中唯一的用户语言/区域化输入事实；不得把 `locale`、`language` 或用户画像加入 `IdentityContext`。
- 客户端可见消息 envelope 必须包含稳定 key，例如 `messageKey`；可选包含 `defaultMessage` 或现有 `message` fallback、`params`、`locale?`、`code`、`category` 和 `retryable`。
- `params` 必须是 schema 化、有限集合、redaction-safe 的结构化值；不得包含 raw prompt、raw model output、raw tool args/result、附件内容、credential、provider error、host path、workspace path 或高基数字段。
- 前端拥有 UI 文案 bundle 和最终渲染职责；后端不得要求前端解析英文 fallback 来判断业务语义。
- 后端 fallback 文案必须 presentation-safe，用于缺失翻译、客户端降级和日志诊断；fallback 不等于唯一展示源。
- SafeError、HTTP error response、SSE/WS stream failure、auth challenge、validation error、capability safe error、pending input projection、task/recurring task management result 都必须有一致的 key/params 策略。
- 缺失翻译必须 fail soft：前端显示后端 safe fallback 或稳定 code，不得阻断 request lifecycle。
- message key 必须稳定、可版本化、可测试；改名、删除或语义改变必须先定义 contract impact 和验证策略。

实现约束：
- `agent-common` 负责最小 cross-boundary i18n message shape；不得引入前端框架类型或具体 i18n library。
- `agent-channel-web` 负责把后端 SafeError、stream event、auth challenge 和 validation result 投影为客户端可翻译 shape。
- `agent-app` / frontend hosting 负责打包或暴露默认 locale bundle 的边界；前端运行时负责按 locale 选择 bundle 和渲染。
- `agent-observability` 只记录 message key、code、category 和安全参数摘要；不得记录完整 localized text 或高基数字段作为 metric label。
- 产品代码不得把用户可见文案散落为无 key 的 hard-coded English；允许保留内部日志和开发诊断的英文 safe fallback。

非目标：
- 不实现完整语言检测服务、翻译管理平台、在线翻译、运营后台或远端文案发布系统。
- 不改变模型回答语言规则、不改变电信术语保留规则、不扩展 `RequestLanguage`。
- 不要求首个版本覆盖所有历史内部 diagnostic 文案；正式 change 必须定义首批客户端可见 surface inventory。
- 不把 locale 作为 owner scope、agent scope、auth identity 或权限判断依据。

验收要点：
- Contract：SafeError 或等价客户端 error envelope 同时携带稳定 key、安全 fallback 和 redaction-safe params。
- Web/Auth：未认证、无权限、not found、validation failed 等典型 HTTP response 可由前端用 bundle 渲染中英文。
- Stream：SSE/WS failure、gap、degradation notice 不再只有硬编码英文 message。
- Frontend：缺失 key 或缺失 locale 时使用 safe fallback，且不破坏交互。
- Security：翻译参数 negative tests 证明 raw prompt、工具结果、路径、credential 和 provider error 不会进入 params。
- Architecture：前端不反向依赖后端私有错误类型；后端不依赖具体前端 i18n library；`IdentityContext` 不新增 locale/language 字段。

并行边界：
- 本 change 可以与业务能力开发并行，但正式实施前必须先盘点客户端可见 surface：HTTP response、stream event、pending input、task management、auth challenge、capability safe error 和 frontend shell 文案。
- 若需要修改 `SafeError`、stream event schema、Web DTO 或前端 bundle 交付方式，必须在正式 OpenSpec change 中定义目标 contract、影响范围和验证顺序。
