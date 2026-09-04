## MODIFIED Requirements

### Requirement: SkillHub Source MUST 是 gateway 支撑的远程 Skill 内容源

NextAgent SHALL 把远程 Skill 获取暴露为一个 provider 中立的 Remote Skill Content Source 能力。该能力 MUST 使用可信 Owner Scope 和 Agent Scope、本地 Agent source 授权、provider 私有的 installed/loading 事实、标准 `SKILL.md` manifest 校验、`CapabilityCatalog` 治理和 `SkillSourceDiscovery` 正文加载。

Remote Skill Content Source MUST NOT 在通用 source contract 中要求 SkillHub 特定的服务协议、endpoint URL、HTTP 路径、wire DTO、credential reference、ZIP 归档、package 字节响应或 `packageBytesBase64` 响应。这些事实属于具体的 remote gateway adapter。

一个已配置的 `SKILL_HUB` 远程 Skill provider MUST 通过稳定的 gateway id 引用一个 remote gateway。App composition MUST 解析该 gateway，把所选 remote gateway adapter 包装成 capability 拥有的 access port 形态，并只把该 access port 和冻结的 provider 事实注入 `agent-capability`。`agent-capability` MUST NOT import 具体的 remote gateway 实现、HTTP client、SkillHub 服务 SDK 或 adapter 私有 DTO。

#### Scenario: Provider 引用 gateway 而不携带服务 URL

- **WHEN** 仓库默认 system configuration 声明一个远程 Skill provider
- **THEN** 该 provider 配置 MUST 使用既有 SkillHub provider 身份（`skill-hub` / `SKILL_HUB`），并包含 provider id、gateway id 引用和 managed install/cache 引用
- **AND** 它 MUST NOT 包含真实 URL、endpoint、credential reference、token、tenant/subject 私有数据、raw remote payload 或 provider 私有加载 key

#### Scenario: Gateway 拥有具体的 SkillHub 服务访问

- **WHEN** 某个部署配置了一个具体的 SkillHub 服务
- **THEN** 其 URL、credential 解析、HTTP 路径、wire DTO 形态和服务特定的安全错误映射 MUST 由所选 remote gateway adapter 或部署 overlay 拥有
- **AND** 切换到使用不同协议的另一个 SkillHub 服务 MUST 要求新增或替换 remote gateway adapter，而不是修改 provider 中立的 capability 核心

#### Scenario: Capability package 只依赖注入的 access port

- **WHEN** 远程 Skill source refresh 抓取候选或内容
- **THEN** `agent-capability` MUST 调用被注入的 capability 拥有的 access port
- **AND** `agent-capability` MUST NOT import 具体 gateway 实现、HTTP client 实现、endpoint 特定的 wire DTO 或服务 SDK
- **AND** 架构校验 MUST 在出现此类边界逃逸时失败

### Requirement: 远程 Skill 内容访问 MUST 返回规范化的 Skill 文件夹

远程 Skill 内容访问 SHALL 建模为候选发现加规范化 Skill 文件夹抓取。候选发现 MUST 返回 provider 中立的候选事实，例如 `skillId`、内容引用和可选的内容一致性事实。内容抓取 MUST 返回一个指向受控 staging root 下规范化 staged Skill 文件夹的引用，外加一个一致性 token，例如内容 hash、版本或等价的 source 拥有的 token。

通用访问 contract MUST NOT 向 `agent-capability` 暴露永久封闭的 `zip | skill-md | tar` union、归档 kind、归档字节、package 字节、单文件 payload 或服务特定的 tree/blob 响应。具体的 remote gateway adapter MUST 拥有服务访问、服务特定的响应映射、内容下载、解码、提取和到 staged Skill 文件夹形态的规范化。

具体 remote gateway adapter 的实现组织是 adapter 私有的。必需的 contract 边界是：服务特定的协议、endpoint 路径、wire DTO 校验、credential 解析、package 或归档解码、内容规范化和 adapter 私有的安全错误映射 MUST NOT 由 `agent-capability` 拥有；它们 MUST 保留在所选 remote gateway adapter 或部署 overlay 之内。OpenSpec 不强制某个具体 adapter 内部的 helper 文件划分。

具体 remote gateway adapter MUST 只把规范化后的文件夹输出写入 capability/provider 受控的 staging root 之下。它们 MUST NOT 把解压或规范化后的内容写入已提交的 install 目录、更新 provider 私有 installed 事实、发布 catalog 可见 descriptor 或以其他方式使一个 Skill 变为可见。只有 `agent-capability` MAY 通过可恢复的发布序列把通过校验的 staged 文件夹提升到已提交的 install 目录。

`agent-capability` SHALL 拥有规范化文件夹接入校验、root `SKILL.md` 校验、managed install 发布、provider 私有 installed 事实更新和 catalog 治理。具体 remote gateway adapter MUST NOT 拥有最终的 NextAgent Skill 安装安全规则、`SKILL.md` 语义校验、managed install 发布或 catalog 治理。

capability 文件夹接入校验 MUST 在以下情况 fail closed：staged 文件夹位于受控 staging root 之外、包含路径逃逸、symlink 或 hardlink 逃逸、超出文件数、总大小或单文件预算、缺少规范的 root `SKILL.md`，或试图暴露额外的 descriptor。安全的子目录文件 MAY 只在接入校验之后作为 provider 私有资源保留，且 MUST NOT 改变 Skill invocation 语义。

通用 source contract MUST NOT 把该操作命名为 `downloadPackage` 或要求 package 字节。具体 gateway adapter MAY 在内部下载 package、解码 base64、抓取单个文件、读取对象存储、clone 一个 tree 或使用其他服务特定机制，但它们 MUST 在进入 `agent-capability` 之前把结果映射为规范化的 staged Skill 文件夹。

#### Scenario: 单个 SKILL.md 远程内容无需 ZIP 即可安装

- **WHEN** 一个 remote gateway adapter 为某个已授权的远程 Skill 候选收到单个 `SKILL.md` 内容
- **THEN** 该 gateway adapter MUST 把它物化为一个规范化的 staged Skill 文件夹，该内容作为 root `SKILL.md`
- **AND** `agent-capability` MUST 在文件夹接入后通过标准 Skill manifest parser 校验该 manifest
- **AND** `agent-capability` MUST 能在无需 ZIP 解压的情况下发布 provider 私有加载事实并贡献一个受治理的 descriptor

#### Scenario: 归档格式在 capability 接入前被规范化

- **WHEN** 一个 remote gateway adapter 收到 ZIP、tar、tar.gz 或其他服务拥有的归档格式
- **THEN** 该 gateway adapter MUST 在把它返回给 `agent-capability` 之前下载、解码并提取该归档为一个规范化的 staged Skill 文件夹
- **AND** `agent-capability` MUST NOT 依据归档格式分支或解析归档格式
- **AND** root `SKILL.md` MUST 在文件夹接入后仍然是唯一的 manifest 和规范 Skill 正文入口
- **AND** 安全的子目录文件 MAY 仅在文件夹接入校验允许时作为 provider 私有资源保留
- **AND** 这些文件 MUST NOT 产生额外 descriptor 或改变 Skill invocation 语义

#### Scenario: 非法 staged 文件夹 fail closed

- **WHEN** 一个 remote gateway adapter 返回的 staged 文件夹位于受控 staging root 之外，或带有不安全链接、不安全路径、缺失 root `SKILL.md`、多个 descriptor 入口或预算违规
- **THEN** `agent-capability` MUST 安全地拒绝该文件夹
- **AND** 来自该文件夹的任何 descriptor MUST NOT 进入 catalog 治理
- **AND** provider 私有 index MUST NOT 为该失败内容更新

#### Scenario: Gateway 不能直接发布到已提交的 install

- **WHEN** 一个 remote gateway adapter 下载、解码、提取或规范化远程 Skill 内容
- **THEN** 它 MUST 只写入受控 staging root 之下的 staged Skill 文件夹
- **AND** 它 MUST NOT 直接写入已提交的 install 目录
- **AND** 它 MUST NOT 更新 provider 私有 installed 事实或 catalog 可见 descriptor
- **AND** `agent-capability` MUST 拒绝任何指向已提交 install 内容而非 staging 内容的返回文件夹引用

#### Scenario: 新的 SkillHub 服务格式不改变 capability 核心

- **WHEN** 一个新的 SkillHub 服务使用不同的协议、响应形态、归档格式、对象存储布局、tree 引用或单文件表示，且可以被规范化为本地 Skill 文件夹
- **THEN** 该变更 MUST 被隔离在新增或替换 remote gateway adapter 或部署 overlay 之内
- **AND** `agent-capability` MUST 继续只消费规范化 staged Skill 文件夹 contract
- **AND** capability 核心 MUST NOT 仅因该服务使用新的压缩、打包或传输格式而改变

#### Scenario: 非文件夹远程源需要新 contract

- **WHEN** 未来的某个服务无法被规范化为本地 Skill 文件夹，例如远程动态执行、远程正文流式传输或按需虚拟文件系统
- **THEN** 该服务 MUST NOT 被强行套用这个 Remote Skill Content Source contract
- **AND** 在实现之前 MUST 存在一个由新 OpenSpec 定义的 contract

### Requirement: Provider 私有 installed 事实 MUST 是 provider 中立的

远程 Skill installed 内容 index、managed install 布局、staging 细节、规范化文件夹引用、remote payload 和 provider 私有加载 key SHALL 保持为 provider 私有实现事实。public descriptor、诊断、stream payload、safe error、日志和 model 可见的 capability 披露 MUST 只暴露安全的 Skill descriptor 字段和安全可用性诊断。

Installed/loading 事实 MUST 围绕远程 Skill 内容而非 SkillHub ZIP package 命名和造型。每个被接受的事实 MUST 绑定可信的 `tenantId`、`subjectId`、`agentId`、`agentVersion`、`agentAssemblyRef`、`providerId`、`skillId` 和一个 provider 中立的内容一致性 token。服务格式特定的一致性事实（例如 ZIP/package 版本或 hash 值）MAY 存在于具体的 remote gateway adapter 之内，但它们 MUST 在进入 `agent-capability` 的 installed/loading 事实、source contract 或 managed index 之前被规范化为 provider 中立的内容一致性。

Provider 私有事实合并 MUST 为每个唯一键 `tenantId + subjectId + agentId + agentVersion + agentAssemblyRef + providerId + skillId` 最多保留一条 active installed/loading 事实。Artifact 版本、内容一致性 token、manifest 路径、source 身份和 frontmatter hash 属于事实内容和一致性输入，而不是唯一性键。

远程 Skill 内容 install 发布对同一可信 scope、provider、skill 和内容一致性 token MUST 是幂等的。已提交 install 目录名 MUST 由一个稳定且安全的 install id 派生，该 id 包含或哈希可信的 `tenantId`、`subjectId`、`agentId`、`agentVersion`、`agentAssemblyRef`、`providerId`、`skillId` 和一个 provider 中立的内容一致性 token（例如内容 hash、内容版本或等价的 source 拥有的 token）。已提交目录名 MUST NOT 包含 wall-clock 时间、随机 UUID 或其他非确定性后缀。

远程 Skill 内容 install MUST 在发布前校验规范化 staged 文件夹。校验成功后，installer MUST 通过可恢复的发布序列替换同一 install id：它 MUST 先把该 install id 既有的已提交目录重命名到一个 provider 私有的 backup 或隔离位置，再把已校验的 staging 目录重命名到已提交位置，并且 MUST 只在新已提交内容可见之后更新 provider 私有 index。失败的文件夹接入、manifest 解析或发布步骤 MUST NOT 更新 provider 私有 index，MUST NOT 发布部分 staging 内容，并且在存在先前已索引的已提交内容时 MUST 保留或恢复它。

成功安装之后，installer MUST 尽力清理同一 `tenantId`、`subjectId`、`agentId`、`agentVersion`、`agentAssemblyRef`、`providerId` 和 `skillId` 下较旧内容版本或 hash 的已提交目录。清理目标 MUST 从 index 事实被替换之前读取的 provider 私有 installed 事实收集；系统 MUST NOT 从一个不透明的哈希目录名推断 owner scope、Agent scope、provider 或 skill 身份。清理失败 MUST NOT 阻塞新安装内容的成功安装、provider 私有 index 发布或 catalog 可见性。

#### Scenario: Installed 事实不泄漏进 descriptor

- **WHEN** 一个远程 Skill 在受治理 refresh 之后从 installed/loading 事实中被发现
- **THEN** 产生的 descriptor MUST NOT 包含 managed install 路径、installed index 行、下载 URL、remote payload、raw 归档 metadata、staged 文件夹引用、具体 gateway 配置或 provider 私有加载 key

#### Scenario: 重装相同内容是幂等的

- **WHEN** 同一远程 Skill 规范化内容在同一可信 owner scope、Agent scope、provider、skill id 和内容一致性 token 下被多次安装
- **THEN** installer MUST 发布到同一个已提交 install id
- **AND** 它 MUST NOT 仅因安装发生在不同时间而创建额外的已提交目录
- **AND** provider 私有 index 对该 skill key MUST 只包含一条事实

#### Scenario: 失败的替换保留先前已索引的内容

- **WHEN** 一个替换用的规范化 staged 文件夹在先前版本已被索引之后，未通过接入校验、manifest 解析或已提交发布
- **THEN** provider 私有 index MUST NOT 被失败的替换覆盖
- **AND** 发现和 Skill 正文加载 MUST 继续使用先前已索引的已提交内容（当其可被恢复或未被替换时）
- **AND** 部分 staging 内容 MUST NOT 贡献 descriptor 候选

#### Scenario: Skill 升级替换内容事实

- **WHEN** 一个具有相同可信 owner scope、Agent scope、provider 和 skill id 的远程 Skill 以较新的内容一致性 token 被安装
- **THEN** provider 私有 index MUST 用新事实替换该 skill key 的先前事实
- **AND** catalog 发现 MUST 使用新的内容一致性事实
- **AND** 同一 scope/provider/skill 的较旧已提交目录 MUST 在成功安装后被尽力清理
- **AND** 清理失败 MUST NOT 回滚新 index 事实或隐藏新安装的 Skill

#### Scenario: Legacy installed index 被安全升级

- **WHEN** 一个 managed install root 包含既有的 `skillhub-index.json`
- **THEN** 该 source MUST 只读取满足 legacy loading 事实 schema 的条目
- **AND** 它 MUST 在写入刷新后的 installed 事实之前把 legacy ZIP package 一致性事实映射为 provider 中立的内容一致性
- **AND** 畸形或 scope 不完整的条目 MUST 被安全忽略
- **AND** 下一次成功 refresh MUST 写入按可信 owner scope、Agent scope、provider id 和 skill id 作键的 provider 中立 installed 事实

### Requirement: 默认配置 MUST 保持结构性

仓库默认 system configuration MAY 在同一文件中声明 remote gateway 和远程 Skill provider 结构，但它们 MUST 保持为相互独立的配置节。provider 节 MUST 通过 id 引用一个 gateway。gateway 节 MAY 声明 gateway id、gateway kind 和 deployment 模式。仓库默认配置 MUST NOT 包含真实 URL、endpoint、credential reference、token、tenant/subject 私有数据、raw remote payload 或 provider 私有加载事实。

部署特定配置、本地 override、环境支撑的 secret/config 解析或具体 gateway 实现配置 MAY 在仓库默认配置之外提供具体的 URL 和 credential 事实。

仓库内建 `default-agent` MAY 显式绑定一个由远程 Skill provider 提供的 Skill。默认 assembly 和 composition 路径 MUST 通过 assembly resource 引用和 startup provider registry 构造传递已配置的 provider 身份，使该显式绑定有效，同时保留其他 assembly resource 引用（例如 plugin policy）。此类默认配置 MUST NOT 绕过 provider 注册、可信 Agent scope、owner scope、本地 source 授权、catalog 治理、规范化文件夹接入校验、root `SKILL.md` manifest 校验或 Skill Tool invocation contract。

#### Scenario: Gateway 和 provider 是相互独立的节

- **WHEN** 仓库默认 system configuration 声明远程 Skill 支持
- **THEN** gateway 配置 MUST 与 provider 配置相互独立地声明 gateway 身份和 kind
- **AND** provider 配置 MUST 通过 id 引用该 gateway
- **AND** provider 配置 MUST NOT 内联具体 gateway 服务访问事实
- **AND** provider 配置 MUST 继续使用既有 SkillHub provider 身份，而不是引入第二种远程 Skill provider kind

#### Scenario: 默认配置不含真实 URL 或引用

- **WHEN** 审查仓库默认 system configuration
- **THEN** 它 MUST NOT 包含具体的 SkillHub URL、endpoint、credential reference、token、tenant/subject 私有数据、raw remote payload 或 provider 私有加载 key

#### Scenario: 默认远程 Skill provider 保持受治理

- **WHEN** 内建 `default-agent` 绑定一个来自默认远程 Skill provider 的 Skill
- **THEN** 该绑定 MUST 保持为显式 Agent capability 绑定
- **AND** 该 Skill MUST 只通过正常的 provider 注册、source 授权、remote gateway 访问、规范化文件夹接入校验、manifest 校验和 catalog 治理变为可见
