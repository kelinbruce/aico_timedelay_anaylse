## 1. OpenSpec 产物

- [x] 1.1 验证 `proposal.md`、`design.md`、`specs/skillhub-source/spec.md` 和 `tasks.md` 描述同一个黑盒目标：本地 source 授权的 SkillHub refresh/search 在 catalog 注册前安装已校验的 package。
- [x] 1.2 运行 `openspec validate add-ts-skillhub-source --strict`。
- [x] 1.3 在 `docs/ts-migration/change-consistency-checks.md` 中记录生成一致性证据。

## 2. Provider 配置与 composition

- [x] 2.1 验证 `CapabilityProviderConfig` / `SkillHubOptions` 覆盖 endpoint、credential 引用和托管安装引用，不新增平行的 app 自有 provider DTO。
- [x] 2.2 在 provider 配置有效、credential 引用可解析且产品默认或显式覆盖的 SkillHub adapter 可用时，于 app composition 中装配 `SKILL_HUB` provider 注册。
- [x] 2.3 把 `agent-capability` 拥有的 SkillHub 远程访问 port 定义为实现本地 SPI，而不是新的 `agent-contracts/gateway` 公开 port；实现类和 HTTP/wire DTO 必须留在 `agent-platform-gateway-remote`，且 `agent-platform-gateway-remote` 不得 import `agent-capability`。
- [x] 2.4 新增配置测试：endpoint 缺失、credential 引用无效、托管安装引用缺失、默认 adapter 注册、显式 adapter 覆盖、adapter 不可用/失败关闭、重复/保留 provider id 以及 provider 被禁用。
- [x] 2.5 在 proposal/design/spec 中澄清 SkillHub 只支持拥有远程 gateway adapter 的宿主；local-only 模式必须失败关闭，不得仅凭托管安装缓存暴露 SkillHub。

## 3. Catalog 触发的同步 refresh

- [x] 3.1 在 `agent-capability` 的 SkillHub catalog SEARCH/load 路径内实现 SkillHub 同步 refresh，只有在本地 Agent source 授权接受该 provider 之后，才使用可信 tenant/subject/agent/version/assembly scope 和 provider id。
- [x] 3.2 确保 catalog 触发的 refresh 向远程 list/search 和 package 下载调用传递可信 Agent Scope 和 Owner Scope，并忽略客户端/模型/capability 提供的 owner 或 agent 覆盖字段。
- [x] 3.3 把远程候选事实与 catalog 状态分离；SkillHub 返回但未安装的候选不得出现在 `CapabilityCatalog.listAvailable` 或 `resolve` 中。
- [x] 3.4 新增同步 refresh 测试：远程不可用、远程候选 metadata 无效、scope 不匹配、credential 失败，以及 catalog load 期间的请求 capability 收窄。
- [x] 3.5 确保 app startup/readiness 只校验并注册已配置的 SkillHub provider、adapter 依赖和托管安装引用；startup/readiness 不得调用远程 refresh、下载 package、安装 package、修改已安装索引或改变 catalog 可见性。
- [x] 3.6 新增 app composition 集成测试，证明 startup/readiness 不执行 SkillHub 远程调用或托管安装副作用。

## 4. 托管 package 安装

- [x] 4.1 通过远程 gateway 边界以不透明 SkillHub package v1 zip 字节实现 package 下载移交；`agent-capability` 不得直接从 endpoint URL 拉取 package 字节，且 package 下载必须通过 app wrapper 和远程 gateway request 保持可信 Owner Scope 和 Agent Scope。
- [x] 4.2 实现带版本化已提交目录的托管安装 staging、原子 provider 私有索引替换以及并发索引合并安全，使 staging、未完成或校验失败的安装永远不会贡献 descriptor 候选，且先前的已提交 package 在替换被索引之前保持可用。
- [x] 4.3 拒绝不安全的 zip package：加密条目、不支持的压缩方法、目录逃逸、symlink/hardlink/特殊文件条目、重复 canonical 路径、绝对路径、`..` 遍历、带盘符路径、不安全文件名、隐藏的不安全元数据、超限 package 和文件数预算溢出。
- [x] 4.4 在接受已安装 source 事实之前校验 package 结构、单文件 root `SKILL.md` 布局和安全的候选命名。
- [x] 4.5 在托管安装 root 下以 tenant/subject/agent/version/assembly/provider/skill scope 及 package/version/hash 或等价一致性 token 持久化 provider 私有的本地已安装/加载事实；不写 gateway record，也不把这些事实放进公开 descriptor。
- [x] 4.6 新增安装器/安全测试，覆盖 zip 路径遍历、部分安装清理、root `SKILL.md` 缺失、嵌套资源树拒绝、无效候选名、超限 package、scope 不匹配、缺失/过期加载事实、并发安装合并安全以及无原始路径泄漏。
- [x] 4.7 新增替换安装测试，证明失败的替换在原子索引替换之前不会删除或使先前的已提交 package 无效。

## 5. Manifest 复用

- [x] 5.1 通过 `SkillDocumentService.parseMetadataView(...)` 解析已安装 SkillHub `SKILL.md` 元数据，并复用既有 Skill manifest 诊断。
- [x] 5.2 确保 discovery 只解析 descriptor 注册和治理所需的元数据事实；完整正文加载保持延迟到授权的 Skill 调用。
- [x] 5.3 新增测试，证明 SkillHub manifest 校验复用标准的 name/description/context/model-invocable/metadata 规则，并拒绝 manifest/候选不匹配。

## 6. SkillHub discovery 与 source 加载

- [x] 6.1 为已安装的托管 skill 新增 SkillHub discovery 实现，使用 `providerKind=SKILL_HUB` 和 `discoveryMode=SEARCH`。
- [x] 6.2 扩展 `DefaultCapabilityDiscoveryFactory` 或 capability 子系统装配，只为依赖有效的已配置 `SKILL_HUB` provider 创建 SkillHub discovery。
- [x] 6.3 为 SkillHub 已安装 package 实现 `SkillSourceDiscovery.loadCanonicalBodyView(...)`，使用 source 自有的加载事实和 `SkillDocumentService.loadCanonicalBodyView(...)`。
- [x] 6.4 验证 descriptor/正文一致性 token 匹配；source 消失、重新解析不匹配或加载事实缺失必须 safe-fail 或强制受治理的重新解析。
- [x] 6.5 新增 discovery/正文加载测试，证明 descriptor 只包含安全事实，且 canonical 正文只有在 Skill Tool 授权后才被加载。
- [x] 6.6 重构 SkillHub source 内部，使 `SkillHubDiscovery` 成为实现本地远程候选校验、托管安装/索引和正文加载一致性组件之上的薄门面。

## 7. Catalog 治理

- [x] 7.1 确保 SkillHub SEARCH 只有在本地 Agent source 授权接受 provider/source 之后才同步 refresh，且结果只有在托管安装和 manifest 接受之后才进入 request-scope catalog 候选管道。
- [x] 7.2 把显式禁用 binding 和 provider 禁用状态应用于 SkillHub 候选。
- [x] 7.3 应用既有模型可见性语义：`modelInvocable=true` 只控制披露，不控制执行授权。
- [x] 7.4 应用冲突/遮蔽优先级，使 SkillHub 不覆盖显式 Agent binding、Agent 自有 source、builtin source 或系统本地 source。
- [x] 7.5 确保 `Skill` Tool 目标解析和调用时正文加载对受治理的 SkillHub descriptor 通过与其他 Skill 相同的 resolver/source 路径工作。
- [x] 7.6 新增 catalog 测试：未安装候选不可见、已安装候选只在 source 授权时可见、provider 禁用、capability 禁用、冲突/遮蔽以及跨 Agent 隔离。
- [x] 7.7 新增 catalog negative test，证明未获本地 Agent source 授权的已配置 SkillHub provider 不被搜索、匹配的远程 scope 不授权可见性，以及已安装事实在 source 授权被移除后变得不可见。

## 8. App 与远程 gateway 集成

- [x] 8.1 在 `agent-app` 中提供产品默认 SkillHub 远程 gateway factory，允许显式覆盖，把选定的 adapter/factory 包装为 `agent-capability` 拥有的远程访问 port 并注入，不让 runtime/core/context 解析 provider 配置或 endpoint 细节。
- [x] 8.2 在 `agent-platform-gateway-remote` 中实现远程 adapter 失败归一化，为不可用、超时、未授权、无效响应和下载失败提供 safe error，并验证下载 wire request 携带可信 scope 加 `packageRef`，返回不透明的 zip package 字节而不是展开的文件条目。
- [x] 8.3 使用默认或 fake 远程 gateway 以及 fake 托管安装 root 新增集成测试，证明 refresh -> install -> catalog -> Skill Tool 正文加载端到端工作。
- [x] 8.4 新增集成测试，证明 startup/readiness 装配选定的 SkillHub adapter 注册，而不触发远程 refresh 或 package 下载。

## 9. 诊断与脱敏

- [x] 9.1 为 provider 禁用、provider 不可用、refresh 不可用、metadata 无效、scope 不匹配、下载失败、package 被拒绝、manifest 无效、已安装、治理不可用、被遮蔽和已注册等结果，实现实现本地的 SkillHub 诊断/readiness 证据。
- [x] 9.2 新增脱敏测试，证明诊断、safe error、日志、descriptor、stream/模型可见上下文和 tool 结果不暴露 credential、原始远程响应、下载 URL、endpoint token、绝对安装路径、package 布局、原始 manifest、完整正文或加载 key。

## 10. 架构与验证

- [x] 10.1 新增 dependency-cruiser/import-graph architecture 测试，证明 runtime、core、context 和 model package 不 import SkillHub source 实现、远程 adapter 或托管安装读取方。
- [x] 10.2 新增 architecture 测试，证明 `agent-capability` 不 import provider SDK/HTTP client 类型或直接的远程 adapter 实现私有路径，`agent-platform-gateway-remote` 不 import `agent-capability`，且未在 `agent-contracts/gateway` 下新增 SkillHub 远程访问公开 port。
- [x] 10.3 运行 `npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture` 和 `openspec validate --all --strict`。

## 11. 检视 follow-up 修复

- [x] 11.1 移除 startup/readiness 的 SkillHub refresh 行为；startup/readiness 不需要远程 refresh 截止时间，因为它不执行任何远程同步。
- [x] 11.2 把格式错误的 zip/安装器异常 safe-reject 为 SkillHub package 拒绝或安装未完成诊断，不注册 descriptor，也不中断 refresh 循环。
- [x] 11.3 从调用时正文加载输入中移除 runtime Owner/Agent scope（包括 `agentAssemblyRef`）；正文加载只校验受治理 descriptor 的 source 自有不透明 handle 和正文一致性，而 scope 匹配保留在 refresh/install/discovery/catalog 治理中。
- [x] 11.4 重构 SkillHub source 内部，使 `SkillHubDiscovery` 保持为 package 私有的远程候选、安装器、索引和 zip 组件之上的薄编排门面。
- [x] 11.5 用针对性的 SkillHub/app 测试、architecture 边界测试和 `openspec validate add-ts-skillhub-source --strict` 验证 follow-up 修复。
- [x] 11.6 使 SkillHub descriptor 加载 handle 不透明，descriptor metadata 不编码 tenant、subject、Agent、assembly、endpoint、package ref、托管安装路径或其他 source 私有事实。
- [x] 11.7 确保 SkillHub catalog SEARCH 在同步 refresh 之前、读取已安装事实之前和贡献候选之前，都先使用本地 Agent source 授权策略。
