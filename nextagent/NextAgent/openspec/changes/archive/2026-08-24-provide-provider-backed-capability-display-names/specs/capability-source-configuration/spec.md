## Function

- **所属 Function**：`FN-5.1 管理能力目录`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: CapabilityDescriptor 提供统一本地化展示事实

`CapabilityDescriptor` MUST 保留既有 required、非 `null` 的 stable `displayName`，并 MUST 支持 optional、非 `null` 的 `locales`。`locales` 存在时 MUST 具有以下公共结构：

```ts
interface LocalizedCapabilityContent {
  readonly displayName: string;
}

interface CapabilityLocales {
  readonly language: Readonly<Record<string, LocalizedCapabilityContent>>;
}
```

**需求类别**：功能性需求

`locales.language` MUST 是包含至少一个 own entry 的 locale tag 到展示内容只读 map。locale tag MUST 包含 2 至 35 个 ASCII 字符并匹配 `^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$`。每个 `displayName` MUST 是 trim 后 1 至 256 个 Unicode code point、且不含 Unicode control character 的纯文本字符串。公共 runtime schema MUST 拒绝 `null`、数组、unknown content field、非法 tag、空 map、空白名称、超长名称或包含 control character 的名称；系统 MUST NOT 通过静默删除非法字段接受 descriptor。

本 change 的完整产品验收 locale MUST 是 `zh-CN` 和 `en-US`。公共结构 MUST 接受满足相同 grammar 的其他 locale tag，并 MUST NOT 把支持语言限制为固定枚举；其他 locale 被 schema 接受 MUST NOT 被解释为对应语言的完整产品资源已经交付。

`locales` MUST NOT 参与 Capability identity、availability、binding、conflict resolution、Provider priority、搜索匹配、Skill acquisition、model visibility、input/output schema、invocation routing、权限或审计。Stable `displayName` MUST 保留其既有消费者语义。Catalog MUST 先按既有规则选择 winner，再保留 winner 自身的 `displayName/locales`；系统 MUST NOT 在 candidates 之间合并、补充或覆盖名称。

Tool authoring MUST 把 optional stable `displayName` 和 optional `locales` 投影到 Tool descriptor，并 MUST 在 stable `displayName` 缺失时使用 canonical Tool `name`。Agent package MUST 把 `AgentAssembly.displayName/locales` 投影到 Agent descriptor。Workflow Recipe MUST 把 `RecipeDefinition.displayName/locales` 投影到 Workflow descriptor。Skill Provider MUST 把既有 `metadata.zh-name`、`metadata.en-name` 分别投影到 `zh-CN`、`en-US`，并 MUST 继续使用 Skill `name` 作为 stable `displayName`。Provider 未提供 `locales` 时 MUST 省略该字段，且 MUST NOT 降低 Capability 可用性。

#### Scenario: Provider 提供中英文展示名称

- **WHEN** 任一 Provider 产生同时包含合法 `zh-CN`、`en-US` 名称的 descriptor
- **THEN** 公共 runtime schema MUST 接受该 descriptor
- **AND** Catalog winner MUST 保留 stable `displayName` 和 winner 自身的两种名称

#### Scenario: Provider 不提供本地化名称

- **WHEN** Provider 产生不含 `locales` 且满足全部既有约束的 descriptor
- **THEN** 公共 runtime schema MUST 接受该 descriptor
- **AND** Capability 的目录可见性、搜索、执行、权限和审计结果 MUST 保持既有语义

#### Scenario: 合法其他 locale 保持开放

- **WHEN** Provider 产生包含合法 `fr-FR` 名称的 descriptor
- **THEN** 公共 runtime schema MUST 接受并保留该名称
- **AND** 系统 MUST NOT 据此声称法语产品资源已经完整交付

#### Scenario: 非法展示事实被拒绝

- **WHEN** descriptor 的 `locales.language` 为空、包含非法 locale tag、unknown content field 或非法 `displayName`
- **THEN** 公共 runtime schema MUST 拒绝完整 descriptor
- **AND** 非法名称 MUST NOT 进入 Catalog 或 presentation resource query

#### Scenario: Catalog 只保留治理胜出者名称

- **GIVEN** 同一 Capability identity 的两个 candidates 提供不同合法名称
- **WHEN** Catalog 选择并返回唯一 winner
- **THEN** winner MUST 只包含自身的 `displayName/locales`
- **AND** loser 的任一名称 MUST NOT 进入 winner

#### Scenario: Tool stable displayName 保留现有消费者语义

- **GIVEN** Tool authoring 同时提供 canonical `name` 和不同的 stable `displayName`
- **WHEN** Provider 产生 Tool descriptor
- **THEN** Tool identity 和模型调用名称 MUST 使用 canonical `name`
- **AND** 既有读取 descriptor stable `displayName` 的目录或搜索结果 MUST 使用该 stable `displayName`

### Requirement: Capability current view 只读取当前受治理事实

系统 MUST 提供可取消的 `CapabilityDiscovery.listCurrent` current-read contract 和 `CapabilityCurrentViewPort`。`listCurrent` MUST 是 SEARCH Provider 的 optional operation；criteria MUST 只包含 trusted Owner Scope、required Session Scope、Agent identity/version/assembly reference，MUST NOT 包含 locale、搜索文本、requested identity、model-invocable filter 或客户端 metadata。

**需求类别**：功能性需求

`CapabilityCurrentViewPort` MUST 在同一 current Agent Assembly 下组合 EAGER Provider 的已加载 descriptors 与 SEARCH Provider 的 current-read descriptors，并 MUST 复用既有 Agent binding、disabled、availability、Provider priority 和 conflict resolution。结果 MUST 包含当前 scope 下全部 available winners，MUST NOT 按 model visibility 排除 wrapper target，MUST NOT 包含 loser 或 unavailable candidate，MUST NOT 创建第二个 Catalog、第二套 conflict resolver 或名称 registry。

EAGER Provider 的 current facts MUST 来自既有启动期已验证 descriptor 集合。SEARCH Provider 的 `listCurrent` MUST 只读取当前本地、已生成或已安装的 descriptor facts。SkillHub current-read MUST 只读取 installed index 和已安装 manifest。`listCurrent` MUST NOT 调用 Provider `search`，MUST NOT 访问远端 candidate service，MUST NOT 同步、下载、安装、更新索引、读取 Skill 正文、创建或删除文件、修改 workspace 或产生其他业务副作用。

`listCurrent` MUST 返回完整通过 descriptor schema 校验的 `CapabilityDescriptor` 数组。Current source 对能够明确归属于单个资源的缺失、读取、解析、descriptor schema 校验或一致性失败 MUST 跳过该资源；失败资源 MUST NOT 形成 descriptor 或进入 Catalog。Source MUST 为被跳过资源记录不含清单正文、credential、token 或内部路径的安全、有界 operational diagnostic。

其他合法 descriptors MUST 继续返回并按既有 governance 形成 winners。Catalog MUST NOT 为被跳过资源保留或抑制 conflict group；若高优先级同名资源未形成合法 descriptor，合法低优先级资源 MUST 继续按既有 binding、availability、Provider priority 与 conflict resolution 参与治理。

未配置的 optional source、locator 明确返回 `not-found`，或 optional Skill root 读取明确返回 `ENOENT`，MUST 表示该 source 当前完整为空，MUST NOT 被误报为读取失败。任一当前 scope 下应参与治理的 SEARCH Provider 未实现 `listCurrent`，已经配置并参与 current-read 的 source/root/index/registry/locator operation 除上述 `ENOENT` 外整体不可读、返回 invalid 或抛错，Provider 整体超时或取消，返回非法 descriptor 数组，或者 EAGER current facts 不完整时，`CapabilityCurrentViewPort` MUST 使本次完整读取失败。系统 MUST NOT 把上述 source-level failure 转换为空成功或部分成功。

#### Scenario: current view 返回当前 winners

- **GIVEN** 当前 Session Agent Scope 包含 EAGER Tool、local Skill、installed SkillHub Skill、Agent 和 Workflow candidates
- **WHEN** 调用方请求 Capability current view
- **THEN** 结果 MUST 返回当前 available winners
- **AND** 结果 MUST 使用与现有 Catalog 相同的 binding、availability、priority 和 conflict verdict

#### Scenario: presentation read 不触发远端 Skill 获取

- **WHEN** SkillHub 远端存在尚未安装的 Skill，且调用方请求 Capability current view
- **THEN** current view MUST NOT 查询、下载或安装该远端 Skill
- **AND** 该 Skill MUST NOT 在安装完成前进入 current view

#### Scenario: runtime-generated 新 identity 可被当前读取发现

- **GIVEN** 当前 Session Scope 已发布一个新的 runtime-generated Skill descriptor
- **WHEN** 后续 current view 读取该 Session Scope
- **THEN** 结果 MUST 可以包含该 Skill winner
- **AND** 系统 MUST NOT 要求生成临时语言文件或重启 Web channel

#### Scenario: 单个非法 current 资源不影响其他合法资源

- **GIVEN** 一个参与治理的 SEARCH Provider 包含 manifest schema 校验失败的 Skill `invalid-skill`
- **AND** 当前 scope 还包含其他合法资源
- **WHEN** 调用方请求 Capability current view
- **THEN** `invalid-skill` MUST 不形成 descriptor且不进入结果
- **AND** 其他合法资源 MUST 继续返回按既有规则确定的 winners
- **AND** source MUST 记录该资源失败的安全、有界 operational diagnostic

#### Scenario: 非法高优先级资源不抑制合法低优先级资源

- **GIVEN** 一个高优先级资源与一个低优先级合法资源使用相同 `capabilityId`
- **AND** 高优先级资源在 current-read 中读取、解析、schema 校验或一致性校验失败，因而未形成 descriptor
- **WHEN** 调用方请求 Capability current view
- **THEN** Catalog MUST 只治理已形成的合法 descriptors
- **AND** 低优先级合法资源 MUST 按既有规则成为 winner

#### Scenario: 单个 SkillHub installed manifest 异常不影响其他已安装 Skill

- **GIVEN** installed index 整体可读，且其中一个 Skill manifest 缺失、非法或与安装时 hash 不一致
- **AND** 同一 index 中还包含其他合法已安装 Skill
- **WHEN** 调用方请求 Capability current view
- **THEN** 异常 Skill MUST 被跳过
- **AND** 其他合法已安装 Skill MUST 继续参与既有 Catalog governance

#### Scenario: current source 不完整时整体失败

- **WHEN** 当前 scope 下任一应参与的 SEARCH Provider 缺少 `listCurrent`，或者已经配置并参与 current-read 的 source/root/index/registry/locator operation 除 optional Skill root `ENOENT` 外整体不可读、返回 invalid、抛错、超时、取消，Provider 返回非法 descriptor 数组或 EAGER current facts 不完整
- **THEN** 本次 `CapabilityCurrentViewPort` 调用 MUST 失败
- **AND** 调用方 MUST NOT 获得部分 winner 或空成功结果

### Requirement: Session Capability 展示资源查询返回安全 current projection

系统 MUST 提供 `GET /api/v1/sessions/:sessionId/capability-presentation-resources`。该接口 MUST 使用 Web channel 形成的 trusted `IdentityContext` 和 path `sessionId` 校验 Owner Scope，并 MUST 从已校验 Session 取得 trusted `agentId`。HTTP 请求 MUST 拒绝 body 以及 query 中的 locale、agentId、Provider selector 或其他未知字段；header 或 metadata 中的 Agent 候选 MUST NOT 覆盖 Session-bound Agent Scope。

**需求类别**：功能性需求

内部 `CapabilityPresentationResourceQueryRequest` MUST 包含 trusted `identityContext`、`sessionId` 和从 Session 得到的 trusted `agentId`。Query MUST 使用该 Agent 的 current active assembly 调用 `CapabilityCurrentViewPort`。每个 `CapabilityPresentationResource` MUST 只包含 `capabilityKind`、`capabilityId`、stable `displayName` 和 optional `locales`；响应 MUST NOT 包含 description、input/output schema、metadata、Provider identity/config、binding、治理证据、credential、token、文件路径、执行参数、执行结果、原始错误或 audit fact。

结果 MUST 按 `capabilityKind + capabilityId` 的确定顺序返回，并 MUST 在同一响应中返回每个合法 winner 的全部合法语言资源。接口 MUST NOT 静默截断合法 winners。Current view、Assembly 或 Session dependency 整体不可用、超时、取消或返回非法结果时，接口 MUST 返回不包含内部细节的 safe failure，MUST NOT 返回空成功列表或 source-level failure 发生后的部分 projection。查询 MUST NOT 写入 Gateway、数据库、timeline、history、stream event、Runtime Bootstrap 或浏览器语言文件。

#### Scenario: 已授权 Session 取得安全展示资源

- **GIVEN** 当前 Session 的 Agent Scope 包含 Builtin Tool、扩展 Tool、Agent、Skill 和 Workflow winners
- **WHEN** Session owner 请求 Capability presentation resources
- **THEN** 响应 MUST 按确定顺序包含这些 winners 的 identity、stable `displayName` 和 optional `locales`
- **AND** 响应 MUST NOT 包含非展示字段、loser 或 unavailable candidate

#### Scenario: 客户端不能覆盖可信范围

- **WHEN** 客户端尝试通过 query 或 body 指定其他 Owner、Agent、Provider 或未知字段
- **THEN** Web input boundary MUST 拒绝不属于公共 contract 的输入
- **AND WHEN** header 或 metadata 中存在其他 Agent 候选
- **THEN** 查询 MUST 继续只使用已校验 Session 的 `agentId`
- **AND** 响应 MUST NOT 暴露其他 Owner Scope、Agent Scope 或 candidate 的名称

#### Scenario: 展示资源依赖失败

- **WHEN** Session、Assembly 或 Capability current view 不可用、超时、取消或返回非法结果
- **THEN** 接口 MUST 返回 safe failure
- **AND** 响应 MUST NOT 包含空成功列表、部分 projection、Provider 原始错误或内部路径

#### Scenario: 展示资源隔离单资源异常

- **GIVEN** current source 已跳过一个未能形成 descriptor 的异常资源，并成功返回其他合法 descriptors
- **WHEN** Session owner 请求 Capability presentation resources
- **THEN** 接口 MUST 成功返回其他合法 winners
- **AND** 响应 MUST NOT 包含异常资源、source diagnostic、Provider identity 或内部错误

## Function 变更汇总

### 描述

- **变更类型**：修改
- **目标内容**：系统通过 winner Capability descriptor 统一管理 stable 与本地化展示事实，并向已授权 Session 返回无副作用的当前安全名称投影。
- **依据 Requirements**：`CapabilityDescriptor 提供统一本地化展示事实`、`Capability current view 只读取当前受治理事实`、`Session Capability 展示资源查询返回安全 current projection`

### 输入

- **变更类型**：修改
- **目标内容**：Provider descriptor 可以包含 optional `locales`；current view 使用 trusted Owner、Session 和 Agent Scope；Web 查询不接收 locale 或客户端 Agent Scope。
- **依据 Requirements**：`CapabilityDescriptor 提供统一本地化展示事实`、`Capability current view 只读取当前受治理事实`、`Session Capability 展示资源查询返回安全 current projection`

### 处理过程

- **变更类型**：修改
- **目标内容**：系统从当前无副作用来源读取合法 descriptors；source 在 descriptor 形成前跳过单个失败资源，Catalog 对合法 descriptors 执行既有治理，source-level failure 使查询整体安全失败。
- **依据 Requirements**：`Capability current view 只读取当前受治理事实`、`Session Capability 展示资源查询返回安全 current projection`

### 结果

- **变更类型**：修改
- **目标内容**：调用方取得当前 Session Scope 下合法 winner 的名称投影；单资源失败、source-level failure、字段缺失和依赖失败均具有确定隔离或失败语义。
- **依据 Requirements**：`CapabilityDescriptor 提供统一本地化展示事实`、`Capability current view 只读取当前受治理事实`、`Session Capability 展示资源查询返回安全 current projection`

### 接口

- **变更类型**：新增
- **目标内容**：无副作用 Capability current-read contract，以及不接收 locale 或客户端 Agent Scope 的 Session Capability presentation resource API。
- **依据 Requirements**：`Capability current view 只读取当前受治理事实`、`Session Capability 展示资源查询返回安全 current projection`

### 规格

- **规格项**：名称选择资源范围
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：`zh-CN`、`en-US` 完整验收；其他匹配既有 BCP 47-compatible grammar 的 locale tag 保持开放；每个名称为 trim 后 1 至 256 个 Unicode code point且不含 Unicode control character
- **依据 Requirements**：`CapabilityDescriptor 提供统一本地化展示事实`

- **规格项**：presentation read 副作用
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：远端搜索、同步、下载、安装、索引写入、Skill 正文读取和 workspace 写入均为 0 次
- **依据 Requirements**：`Capability current view 只读取当前受治理事实`
