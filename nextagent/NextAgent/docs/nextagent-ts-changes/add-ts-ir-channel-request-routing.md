# add-ts-ir-channel-request-routing

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：Channel / Service Integration

状态：assumption-ready
类型：实施 change
主要 owner：`agent-channel-ir`
协作 owner：`agent-app`、`agent-runtime`
依赖：`establish-ts-core-contracts`、`ship-ts-minimal-agent-kernel`、`add-ts-agent-package-assembly`

目标：
- 新增面向服务间 IR 接口的 channel adapter，让服务侧请求可以通过受控接口进入统一 runtime 主路径。
- 支持按 IR schema 校验请求、解析 trusted service identity，并把请求路由到 `RuntimeCommandPort`。
- 保持 channel 只做 transport、validation、projection，不拥有业务语义路由。

规格输入：
- 系统 MUST 新增独立 `IRChannel`/`agent-channel-ir` 适配层，承载服务间接口请求接入。
- IR 请求 MUST 通过显式 schema validation；不可信 body、query、header 不得直接形成 runtime fact。
- IR channel MUST 从可信服务凭证、签名或等价 auth boundary 解析 `IdentityContext`；不得信任请求体自报 `tenantId`、`subjectId` 或 `agentId`。
- IR channel MUST 把 submit/control 类请求统一转换为既有 runtime command（如 submit、cancel、retry），不得旁路 runtime lifecycle。
- 服务间接口路由只负责 transport 到 runtime command boundary 的映射；MUST NOT 在 channel 层直接决定 model、tool、skill、workflow 或 capability 业务路径。
- 若 IR 请求需要目标 Agent，channel MUST 只传递 trusted host-selected `agentId` 或 assembly reference，具体运行路径仍由 runtime/core/context/capability 消费已固化的 Agent Scope。
- IR channel 的 safe response MUST 复用既有 safe error、accepted/result projection 原则，不暴露内部路径、secret、provider raw error 或未脱敏 payload。
- IR channel SHOULD 支持与现有 Web channel 等价的 request submission 结果语义；若首版不做 stream，则必须明确返回 accepted/result 查询引用，不得伪造同步完成语义。

契约输入：
- `RuntimeCommandPort`（`agent-contracts/runtime`）：IR channel 提交请求的唯一入口。
- `IdentityContext`（`agent-common` / `agent-contracts/core`）：由可信服务身份边界注入。
- `RequestAccepted`、safe error、相关 command DTO：复用既有 runtime/channel contract。
- IR request/response schema：由 `agent-channel-ir` owning contract 定义，不侵入 Web DTO。

实现约束：
- `agent-channel-ir` 是独立 transport adapter；不得把 IR 请求处理塞回 `agent-channel-web` 的浏览器/HTTP DTO 中。
- `agent-app` 是唯一 composition root，负责是否装配 IR channel、其监听配置和 trusted auth adapter。
- `agent-runtime` 继续拥有 request lifecycle、terminal commit 和 canonical timeline；IR channel 不得新增平行状态机。
- 若要对接现有 IR/OpenAPI 契约，必须在 adapter 层做协议映射，不得把外部 IR 字段形态直接上升为核心 contract。

非目标：
- 不定义业务能力路由策略。
- 不定义新的 capability、tool 或 skill 执行语义。
- 不绕过既有 Web channel 去重写 session/history API。
- 不引入动态多 channel 插件热加载。

验收要点：
- contract test：IR request schema 非法输入会被拒绝。
- integration test：合法 IR submit 请求能进入 `RuntimeCommandPort` 并获得 accepted 结果。
- security test：请求体覆盖 identity 或 agent scope 会失败或被忽略。
- architecture test：`agent-channel-ir` 不直接依赖 capability implementation、gateway local schema 或业务 routing 实现。
- 验证：`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`。

并行边界：
- 不修改 `agent-channel-web` 的浏览器产品语义；IR channel 是并行的服务间入口。
- 不改变 `RuntimeCommandPort` 作为 channel 提交入口的 ownership。
- 不引入第二套 session/message/read-model API；如需 IR 专属查询接口，必须另起 change。

后续维护：
- 本文件承载该 change 的详细规格输入、契约输入、实现约束、非目标、验收要点和并行边界。
- 标为 `assumption-ready` 的原因：具体 IR auth 方案、stream/回调形态、以及是否复用现有 interservice OpenAPI 字段集需要在 proposal 阶段显式固化。
- 如果本 change 需要修改已冻结核心契约，必须先提出 contract refinement change。
