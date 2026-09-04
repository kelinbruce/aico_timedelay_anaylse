## 背景和现状（Context）

当前实现中，`agent-capability` 通过 `skillhub-*` internals 完成远端候选搜索、ZIP bytes 下载、ZIP 解包、managed install、`skillhub-index.json` 维护和 `SKILL.md` body loading。该实现满足了首个 SkillHub HTTP/ZIP 场景，但把三类不同层次的事实混在了一起：

1. NextAgent 通用能力事实：远端 Skill source、trusted scope、manifest validation、catalog governance。
2. Gateway 接入事实：URL、credential reference、HTTP path、wire DTO、safe remote error mapping。
3. Remote content 格式事实：ZIP/tar extraction、single `SKILL.md` text、tree/blob reference、package hash。

这导致替换 SkillHub 服务时，服务协议或 remote content 格式变化会扩散到 `agent-capability`。本 change 将这些事实重新分层。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 将 NextAgent 侧抽象定义为 Remote Skill Content Source，而不是 SkillHub ZIP package source。
- `agent-capability` 只消费 provider-neutral access port，不直接知道 URL、HTTP path、credential resolution 或具体 SkillHub wire DTO。
- remote content 格式由 gateway adapter 消化并归一化，通用 source 不要求 ZIP、tar 或 single-file 语义。
- remote gateway adapter 负责将 single `SKILL.md`、ZIP/tar bundle、tree/blob reference 或其他服务私有格式归一化为 staged Skill folder；`agent-capability` 只消费 normalized folder，并统一执行 folder intake validation、root `SKILL.md` validation、managed install publication 和 catalog governance。
- default-system 只提交 gateway/provider 结构性引用，不提交真实 URL、credential reference、token、tenant/subject 私有数据或 raw remote payload。
- 让新增或替换具体 SkillHub 服务主要通过后续新增/修改 remote gateway adapter 完成；本 change 只定义并接入该 adapter 边界，不新增完整生产级远端服务 adapter。

**非目标：**

- 不引入远端 Skill 直接执行、远端 body streaming 或未安装候选执行。
- 不新增 Web API、stream event、runtime command、gateway durable Record/table 或 public readiness DTO。
- 不在本 change 定义 signature verification、license policy、vulnerability scan 或 trust-chain policy。
- 不让 single-file remote content 支持额外资源文件。
- 不让 ZIP 子目录资源改变当前 Skill invocation 语义。
- 不新增完整生产级 `agent-platform-gateway-remote` concrete service adapter；现有 SkillHub HTTP/ZIP 行为最多作为兼容迁移/包装被保留。

## 设计决策（Decisions）

### D1: 通用能力命名为 Remote Skill Content Source

通用 source 表达“远端提供 Skill 内容”，不表达某个服务品牌或 package 格式。

通用核心只拥有：

```text
provider id
provider/source kind
gateway id/reference resolved by app composition
trusted Owner Scope
trusted Agent Scope
managed cache/install reference
provider-private loading facts
SKILL.md manifest/body validation
catalog governance handoff
```

通用核心不得拥有：

```text
endpoint/url
credential value or credentialRef for concrete remote service
HTTP path/method
SkillHub wire DTO
packageBytesBase64
ZIP-only contract
service-specific safe error payload
```

### D2: Provider 配 gatewayId，gateway 配具体服务接入

provider configuration 只表达 NextAgent 里有一个远端 Skill source，并引用一个 gateway：

```yaml
nextAgent:
  system:
    capability-providers:
      - id: hub-local
        type: skill-hub
        gatewayId: skillhub-main
        installDir: ./skillhub-managed
```

gateway configuration 表达具体 adapter 形状：

```yaml
gateway:
  gateways:
    - gatewayId: skillhub-main
      gatewayKind: skillhub-http-v1
      deploymentMode: REMOTE
```

仓库默认配置不得包含真实 `baseUrl`、`url`、`credentialRef`、token、tenant/subject 私有数据或 raw remote payload。具体部署可以通过环境专属配置、overlay、secret manager 或 remote gateway implementation 自有配置提供这些事实。

放弃方案：在 capability provider 中继续配置 `url` / `endpoint` / `credentialRef`。该方案会让通用 provider 直接知道具体远端服务访问细节，违背 provider 与 gateway 分层。

契约确认：本 change 不新增 `REMOTE_SKILL` provider kind；`agent-common` 继续使用既有 `SKILL_HUB` vocabulary，`agent-app` 用户配置继续使用 `skill-hub`。需要 refinement 的是 `agent-contracts/capability` 中 SkillHub provider options 的字段归属：provider-side options 只保留 `gatewayId` 与 managed install/cache reference，具体服务访问事实转入 gateway adapter 或部署 overlay。

### D3: Gateway adapter 拥有具体 SkillHub 服务协议和格式归一化，本 change 只定义边界

`agent-platform-gateway-remote` 或等价 remote gateway package owning 具体服务接入，但完整生产级 adapter 应由后续 change 实现。本 change 只要求 `agent-capability` 与 app composition 面向如下边界：

- URL / endpoint / credential resolution
- HTTP path / method
- service-specific request/response DTO validation
- response -> candidate/normalized staged Skill folder mapping
- service-specific content download, decode, extraction and folder normalization
- safe remote error normalization

例如后续 SkillHub HTTP v1 ZIP adapter 可以拥有：

```text
POST /skills/search
POST /skills/package
packageBytesBase64
safe ZIP extraction into normalized staged Skill folder
```

另一个后续 SkillHub single-file adapter 可以拥有：

```text
POST /skills/search
POST /skills/manifest
skillMarkdown
single file materialization into normalized staged Skill folder
```

二者都应包装成同一个 provider-neutral access port 注入 `agent-capability`。本 change 的测试可以使用 fake/compatibility adapter 证明该边界，不要求真实远端服务 adapter 可用。

### D4: Access port 返回 normalized staged Skill folder，而不是 package bytes

`agent-capability` consume 的 access port 形状应以 normalized staged Skill folder 为中心：

```ts
interface RemoteSkillContentAccessPort {
  listCandidates(input, signal): Promise<RemoteSkillCandidateResult>;
  fetchContent(input, signal): Promise<RemoteSkillFolderResult>;
}
```

candidate 使用 provider-neutral facts：

```text
skillId
contentRef
contentVersion?
contentHash?
optional consistency facts
```

content result 返回 gateway-owned staging root 下的 normalized folder reference：

```text
stagedFolderRef
stagingOwner/gatewayId/providerId correlation facts
contentVersion/contentHash or equivalent consistency token
```

`downloadPackage(...)`、`packageBytes`、archive kind、archive bytes 和 single-file payload 只能出现在具体 adapter 或 legacy compatibility layer 中，不应作为通用 source contract。

### D5: Gateway 归一化远端格式，Capability 接收并治理 Skill folder

通用 source 负责从 normalized staged Skill folder 得到一个 provider-private installed/loading fact。远端格式归一化的 owner 是 concrete remote gateway adapter，而不是 `agent-capability`。Remote gateway adapter 负责把具体服务协议、wire DTO、URL、credential、package/base64/blob/tree、ZIP/tar/single-file 等服务私有响应下载、解码、解压或转换为受控 staging root 下的 normalized Skill folder。

`agent-capability` 不按 archive/content format 分派，也不直接解析 ZIP、tar、single-file payload 或 service-specific tree/blob response。它只对 gateway 产出的 normalized folder 执行 intake validation，再执行 root `SKILL.md` validation、managed install publication 和 catalog governance。

- gateway format normalization：
  - ZIP、tar、tar.gz、single `SKILL.md`、tree/blob reference 或其他服务私有内容形态由 concrete gateway adapter 消化。
  - gateway 必须把输出限制在 capability/provider 管理的受控 staging root 下的一个 Skill folder，并提供 content consistency token。
  - gateway 不得把解压或归一化结果写入 committed install directory，也不得直接更新 provider-private index 或 catalog-visible descriptor。
  - 新增 SkillHub 服务或新增远端内容格式时，应新增或修改 gateway adapter，不应修改 `agent-capability` 主流程。
- capability folder intake：
  - staged folder 必须位于受控 staging root 下，并绑定 trusted owner/agent/provider/skill correlation facts。
  - 不接受 path escape、symlink/hardlink escape、超出预算的文件数量、总大小或单文件大小。
  - root `SKILL.md` 是唯一 manifest/body 入口；子目录文件只能作为 provider-private resources，不得产生额外 descriptor 或改变 invocation 语义。
  - gateway 输出的 staged folder 不得直接成为 committed install；必须经过 capability validation 和 recoverable publication 后，才可移动到 committed install directory。
- future non-folder source：
  - 若未来服务无法归一化为本地 Skill folder，例如远程动态执行、远程 body streaming 或按需虚拟文件系统，则不是本 change 的同一 contract，必须先新增 OpenSpec。

### D6: Provider-private facts 使用 provider-neutral 命名

installed/loading facts 应描述远端 Skill content source，而不是某个 SkillHub ZIP 实现：

```text
tenantId
subjectId
agentId
agentVersion
agentAssemblyRef
providerId
skillId
contentVersion/contentHash or consistencyToken
manifestFile or manifestBlobRef
sourceIdentity
frontmatterHash
```

index 文件名、internal type 和 evidence code 应避免把 `skillhub` 当作通用事实。SkillHub-specific outcome 可以保留在 concrete gateway adapter 内，通用 source 对外只暴露 safe provider-neutral diagnostics。

### D7: Catalog governance 不感知 gateway 和 remote content 细节

Catalog 只看到通过 manifest validation 后的普通 `SKILL` descriptor candidate。它不消费 URL、gateway wire DTO、archive bytes、ZIP layout、single-file payload 或 provider-private loading key。

Remote source priority、disabled binding、source authorization、modelInvocable disclosure、conflict/shadowing 和 invocation eligibility 继续由统一 catalog path owning。

### D8: 默认配置只声明结构，不声明具体服务秘密

`packages/agent-app/config/default-system.yaml` 可以声明：

```text
gatewayId
gatewayKind
deploymentMode
provider id
provider type
provider gatewayId reference
managed install/cache reference
```

不得声明：

```text
real URL
credentialRef
token
tenant/subject private data
raw remote payload
provider-private loading key
```

如果开发环境需要本地 URL，应使用 local override 文件、环境变量、secret manager 或部署配置注入，不写入仓库默认配置。

### D9: Concrete adapter implementation organization is adapter-private

OpenSpec constrains ownership boundaries, not the exact file layout of a concrete remote gateway adapter. Service-specific protocol, HTTP path, wire DTO validation, credential resolution, package/archive decoding, content normalization and adapter-private safe error mapping are owned by the selected remote gateway adapter or deployment overlay.

`agent-capability` MUST NOT own those gateway-private protocol or content-format concerns. It consumes only the provider-neutral access port and the normalized staged Skill folder, then owns folder intake validation, root `SKILL.md` validation, managed install publication, provider-private installed facts and catalog governance.

A concrete adapter may keep closely related private protocol and normalization logic together as one cohesive implementation unit. Shared helper modules should be introduced only when the same concern is reused across multiple adapters or package owners, rather than to satisfy a speculative generic split.

Capability-owned production names SHOULD use remote content or staged folder semantics rather than package/download semantics. Concrete gateway adapters MAY keep service-private package/hash names when those names map legacy SkillHub HTTP/ZIP wire facts, but adapter-private format facts MUST be normalized to provider-neutral content consistency before they are consumed by `agent-capability`, provider-private installed facts, managed indexes or catalog governance.

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | 通用 source 不接触 raw credential、URL、remote payload、wire DTO 或 archive bytes；folder intake fail closed；descriptor 不泄漏 provider-private facts。 | source/gateway boundary tests、diagnostic redaction tests、architecture tests |
| 可替换性 | 新 SkillHub 服务通过后续新增/修改 gateway adapter 接入；通用 capability 不因 HTTP path、response shape 或 remote content/archive format 变化而修改。 | fake gateway boundary tests、single-file/ZIP normalization tests |
| 可靠性/恢复 | provider-private facts 和 managed cache 仍在 `agent-capability` owning；folder validation/publication 不完成则不贡献 descriptor。 | failed intake/index tests |
| 可维护性 | `agent-capability` provider-neutral；SkillHub-specific code 位于 remote gateway adapter 或 legacy adapter wrapper。 | dependency-cruiser / architecture assertions |
| 可配置性 | provider 与 gateway 同文件可共存但分段配置；provider 通过 `gatewayId` 引用 gateway；default-system 不提交真实 URL/ref。 | config validation tests、diff review |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| 继续使用 `SKILL_HUB` provider kind，provider options 只引用 gatewayId | 1.2, 2.2, 4.1 | contract/config schema tests、default-system diff review |
| gateway owning concrete SkillHub URL/protocol/DTO | 3.1, 3.2 | fake/compatibility gateway boundary tests |
| access port 返回 normalized staged Skill folder，不返回通用 package bytes | 2.2, 2.3 | TypeScript compile、focused source tests |
| single `SKILL.md` 与 ZIP 等服务格式由 gateway 归一化后走同一 capability folder path | 2.4, 2.5, 3.2 | remote source single-file/ZIP normalization tests、capability integration tests |
| catalog 不感知 gateway/remote content/private facts | 2.1, 2.6, 4.2 | catalog/list/resolve tests |
| default-system 不含真实 URL/ref/token/private data | 4.1 | diff review、config tests |
| architecture boundary prevents capability importing concrete gateway implementation | 2.2, 3.3, 5.3 | `npm run lint:architecture` |

## 文档承载决策（Documentation Ownership）

- 行为契约：active spec 承载 Remote Skill Content Source、normalized staged Skill folder、gateway reference 和 provider-private facts。
- 架构设计：`capability-spi.md`、`agent-capability.md`、`agent-platform-gateway-remote.md`、`agent-app.md` 在归档前承载稳定事实。
- ADR：暂不新增。

## 风险与取舍（Risks / Trade-offs）

- [风险] 重命名范围较大，可能影响已完成的 SkillHub ZIP tests。 -> 先用 active change 文档明确分层，再按任务重构实现和测试。
- [风险] default-system 无 URL/ref 后本地开箱即用性降低。 -> 使用 local override 或开发环境配置承载真实连接事实，仓库默认配置只承载结构。
- [风险] gateway 过度承担 Skill 语义治理。 -> gateway 只做服务接入和格式归一化；root `SKILL.md` validation、managed install、provider-private index 和 catalog governance 仍归 `agent-capability`。
- [风险] gateway 与 provider 都在同一配置文件中容易混淆。 -> 允许同文件，但必须分段；provider 只能引用 `gatewayId`，不能内联 concrete service config。

## 迁移计划（Migration Plan）

当前 SkillHub HTTP/ZIP 实现可作为第一阶段 compatibility boundary 迁移：

1. 保留现有行为测试作为 ZIP normalization compatibility 回归测试。
2. 新增 single `SKILL.md` normalization 测试证明通用 source 不依赖 ZIP。
3. 将 provider config 中 endpoint/url 从 capability provider contract 移出，目标归属为 gateway-owned adapter config 或环境 overlay；真实 adapter 配置落地可由后续 change 承载。
4. 将 provider-private index/loading facts 从 SkillHub-specific 命名迁移到 provider-neutral naming。

### 旧 `skillhub-index.json` 兼容策略

首版迁移 MUST 兼容读取既有 `skillhub-index.json`，并在下一次成功 refresh 后写出 provider-neutral index。读取旧 index 时：

- 只接受通过既有 loading fact schema 校验的条目。
- 将旧 ZIP/package consistency fact 归一化为 provider-neutral content consistency fact 后再进入新的 installed fact。
- 若旧 index 条目缺少 owner scope、Agent scope、provider id、skill id、manifest file 或 frontmatter hash，MUST fail closed 并忽略该条目。
- 不得把旧 index 文件名、旧 private loading key 或服务格式私有 hash 作为新的唯一 key。
- 迁移后仍按 `tenantId + subjectId + agentId + agentVersion + agentAssemblyRef + providerId + skillId` 合并为每个 Skill 一条 active fact。

## 待确认问题（Open Questions）

无。
