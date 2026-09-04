# add-ts-skillhub-dynamic-discovery-registration

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：Capability

状态：ready
类型：实施 change
主要 owner：`agent-capability`
协作 owner：`agent-app`、gateway remote port
依赖：`add-ts-capability-core-governance`、`add-ts-capability-source-configuration`、`add-ts-skillhub-source`

目标：
- 支持 SkillHub 候选 Skill 的动态发现、注册、注销和状态同步。
- 将远端发现结果收敛为受治理的本地 registration，再交由 `add-ts-skillhub-source` 的下载、校验、安装、启用路径接入统一 catalog。
- 避免每次新增远端 Skill 都依赖人工改静态配置文件或重建 provider 清单。

规格输入：
- 系统 MUST 支持对 SkillHub 执行显式 discovery/refresh，并返回当前 Agent scope 下可注册的 remote Skill 候选。
- discovery 结果 MUST 先进入本地 registration 边界，再决定是否下载、安装、启用；远端 metadata 本身不得直接进入可执行 catalog。
- registration 记录 MUST 至少包含 `providerId`、`skillId`、`version`、`agentId?`、`registrationStatus`、`discoveredAt`、`updatedAt` 和 safe diagnostic metadata。
- `registrationStatus` MUST 区分至少 `DISCOVERED`、`REGISTERED`、`INSTALLED`、`ENABLED`、`DISABLED`、`UNAVAILABLE`，并且只有满足既有安装/启用条件的 Skill 才能进入模型可见 capability list。
- 动态发现 MUST 支持新增候选、已有候选更新、远端下线/失效候选标记为 unavailable 或 removed-safe 状态，而不是静默保留脏注册记录。
- 注册和注销 MUST 产生 audit event，并保留 safe explanation，便于排查某个远端 Skill 为何未进入 catalog。
- registration MUST 受 Agent Scope 和 Owner Scope 治理：Agent-scoped registration 只影响对应 Agent；全局 registration 也不得绕过 capability conflict resolution。
- 同名 remote Skill 的动态注册仍需复用既有 capability conflict resolution；不得因 discovery 自动覆盖本地、内置或 agent-scoped source。

契约输入：
- `SkillHubRegistrationRecord`（gateway-owning persistence DTO 或等价 registration contract）：承载动态注册 durable fact。
- `SkillHubRegistrationGateway` 或等价 capability-owned logical port：查询、写入、更新、注销注册记录。
- audit event：`skillhub.registration.discovered`、`skillhub.registration.registered`、`skillhub.registration.unregistered`、`skillhub.registration.unavailable`。
- `CapabilityDescriptor` / `CapabilityProvider` / availability 语义继续复用 `add-ts-capability-core-governance`。

实现约束：
- `add-ts-skillhub-source` 继续拥有远端 metadata 获取、下载、校验、安装和 managed directory 接入；本 change 只补 registration lifecycle，不再创建第二套 download/install 流程。
- `agent-capability` 拥有 registration lifecycle、状态机和 catalog 可见性判断。
- `agent-app` 或 provider configuration 只负责启停、credential reference、managed dir 与显式 refresh wiring，不负责 runtime 决策 registration 状态。
- 动态 registration 不得演变为动态插件热加载；进入可执行 catalog 仍需经过 manifest 校验、安装启用和统一治理。

非目标：
- 不定义 SkillHub package 发布审批后台。
- 不定义远端 Skill 运行时热替换。
- 不改变 Skill manifest contract。
- 不替代 `add-ts-skillhub-source` 的 package acquisition/install 语义。

验收要点：
- integration test：refresh 后能发现新候选并形成 registration record。
- integration test：注销或远端下线后，registration 状态被安全更新且不再暴露为可执行 capability。
- security test：远端 metadata 本身不会直接进入模型可见 catalog。
- architecture test：registration lifecycle 不绕过 capability governance 或 conflict resolution。
- 验证：`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`。

并行边界：
- 不修改 `add-ts-skillhub-source` 已定义的 refresh/list/search/download/install 基线，只在其上补 registration lifecycle。
- 不侵入 `add-ts-agent-package-assembly` 的 Agent binding 语义；registration 结果只是 provider 候选输入之一。
- 不引入第二套 capability descriptor、provider identity 或 availability vocabulary。

后续维护：
- 本文件承载该 change 的详细规格输入、契约输入、实现约束、非目标、验收要点和并行边界。
- 如果本 change 需要修改已冻结核心契约，必须先提出 contract refinement change。
