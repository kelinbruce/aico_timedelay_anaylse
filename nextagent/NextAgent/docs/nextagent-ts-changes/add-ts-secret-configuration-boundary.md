# add-ts-secret-configuration-boundary

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：Runtime Configuration

状态：active
类型：实施 change
主要 owner：`agent-app`
依赖：`add-ts-app-config-schema`

目标：

- 使用冻结的 `SecretReference` grammar，在 ready 前校验 active credential reference 的可解析性。
- 固定一个 app-composed resolver 同时服务启动校验和 adapter/provider 注入。
- 禁止 raw secret、完整 reference、secret path 和 native resolver error 泄漏到可见输出。

规格输入：

- `SecretReference` 归 `agent-common`，只允许 `env:` / `file:`，本 change 不修改该核心契约。
- 各 owning schema 声明 credential-bearing entry、active/inactive 和 required 状态。
- secret validation 只向 app-config 提供 app-internal safe issue contribution。
- `add-ts-app-config-schema` 独占 criticality、viable set、最终 `ConfigReadinessState` 和 `ConfigValidationEvidence`。
- model、gateway、capability source 和 local auth 继续消费各自窄投影和 injected resolver，不消费共享 secret snapshot。

实现约束：

- 基于现有 `packages/agent-app/src/config/validation.ts`、`env.ts`、`system-config.ts` 和 `composition/create-app.ts` 增量实施。
- 启动校验和 adapter/provider 注入必须复用同一个 resolver 实例。
- 不新增 `SecretReadinessState`、`SecretUsageSnapshot`、共享 `SecretValidationResult`、公共 resolver port 或第二套 loader/validator。
- operator-visible 和 request-visible 输出不得包含 raw secret、完整 `env:` / `file:` reference、文件路径、环境变量值、文件内容或 native error。
- resolved secret 只作为 resolver 的瞬时返回值进入目标 adapter/provider 调用。

非目标：

- secret manager、加密 envelope、轮换、缓存和热更新。
- provider/gateway/capability/local auth 业务协议。
- redaction policy 全量编排。
- 修改 `agent-contracts` 或创建新的跨 package secret contract。

验收要点：

- active `env:` / `file:` reference 在 ready 前完成可解析性校验。
- inactive grammar-valid reference 不因当前不可解析阻断 active branch。
- secret failure 只贡献 safe issue，最终 readiness 由 app-config 判定。
- composition test 证明启动校验与 runtime consumer 使用同一 resolver。
- negative tests 证明不存在共享 secret snapshot、第二 resolver、下游源配置读取或 secret 泄漏。

并行边界：

- `agent-app` 拥有配置读取、secret validation 和 resolver composition。
- 各配置组 owner 只声明 credential-bearing 字段及窄运行投影。
- observability/redaction owner 只守护安全输出，不参与配置读取或 readiness 判定。

后续维护：

- 如果需要新的跨 package secret contract 或修改 `SecretReference`，必须先提出 contract refinement change。
