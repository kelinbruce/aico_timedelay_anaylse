## 背景与问题（Why）

`add-ts-skillhub-source` 已经把远端 Skill 引入到了统一 Capability Catalog、`SKILL.md` manifest contract、`SkillSourceDiscovery` body loading 和本地 Agent source authorization 路径中。但当前 active change 继续沿用了一个过窄抽象：NextAgent capability 直接认识 SkillHub、SkillHub endpoint、ZIP package 和 `skillhub-index.json`。

这会把通用能力和某一个 SkillHub 服务协议耦合在一起：

- 如果另一个 SkillHub 服务只返回单个 `SKILL.md`，通用 capability 仍被迫走 ZIP/package 语义。
- 如果另一个 SkillHub 服务使用不同 HTTP path、response shape、认证方式或非 HTTP gateway，需要修改 `agent-capability` 而不是只替换 remote gateway。
- 如果默认配置直接携带 URL 或 credential reference，仓库默认装配就绑定了具体环境事实，不再只是可审查的结构性配置。

本 change 的目标是纠正该抽象边界：NextAgent 提供通用的 **Remote Skill Content Source** 能力，并定义它与 remote gateway adapter 之间的 access port 边界；具体 SkillHub 服务由后续 `agent-platform-gateway-remote` 或等价 remote gateway adapter change 对接。新增或替换 SkillHub 服务时，应新增或修改 remote gateway，而不是修改 NextAgent capability 核心。

## 变更范围（What Changes）

- 将通用能力从 SkillHub/ZIP/package 语义收敛为 `RemoteSkillContentSource`：
  - 使用 trusted Owner Scope 和 Agent Scope 查询远端候选。
  - 通过注入的 remote gateway access port 获取 gateway 已归一化的 staged Skill folder。
  - single `SKILL.md`、ZIP bundle、tar bundle、tree/blob reference 或后续服务私有格式都由 concrete remote gateway adapter 归一化为同一类 staged Skill folder。
  - 最终必须形成可验证的 root `SKILL.md`，并复用统一 manifest/body loading contract。
  - installed/cache/loading facts 仍为 provider-private，不进入 public descriptor、stream、Web response 或 model-visible context。
- 将 ZIP/tar extraction、single-file materialization、`packageBytesBase64`、`/skills/search`、`/skills/package`、endpoint URL、credential reference 等降级为具体 gateway/adapter 事实，不属于通用 source contract。
- provider configuration 只表达 NextAgent 侧的远端 Skill source；本 change 继续使用既有 `SKILL_HUB` provider kind 和用户配置类型 `skill-hub`，不新增 `REMOTE_SKILL` provider kind：
  - provider id
  - source/provider type (`skill-hub` / `SKILL_HUB`)
  - referenced gateway id
  - managed install/cache reference
  - enabled/governance inputs
- gateway configuration 表达具体远端服务接入形状：
  - gateway id
  - gateway kind
  - deployment mode
  - adapter-specific settings
  - 默认仓库配置不得提交真实 URL、credential reference、token、tenant/subject 私有数据或 raw remote payload。
- 当前 SkillHub HTTP/ZIP 行为仅作为既有行为迁移/兼容边界保留，不在本 change 新增完整生产级 remote gateway implementation；它不再是通用 capability 的内建假设。
- default-agent 可以显式绑定一个 provider 下的 Skill，但该 binding 不得绕过 provider registration、trusted scope、local source authorization、remote gateway access、normalized folder intake validation、root `SKILL.md` validation、catalog governance 或 Skill Tool invocation contract。

## Capability 影响（Capabilities）

### 新增 Capability

无 public Web/API capability。

### 修改的 Capability

- `skillhub-source` / remote Skill source 方向：将现有 SkillHub-specific source 抽象为 gateway-backed Remote Skill Content Source，并把 SkillHub HTTP/ZIP 细节下沉到 remote gateway adapter。

## 影响范围（Impact）

- `agent-capability`:
  - 将 SkillHub-specific source internals 重命名或重构为 provider-neutral remote Skill content source owner。
  - 通用 source 只依赖 injected remote content access port 返回的 normalized staged Skill folder，不直接依赖 endpoint、HTTP client、SkillHub wire DTO、ZIP/tar package shape 或 gateway implementation。
  - provider-private index/loading facts 应使用 provider-neutral 命名和 content consistency token；不得把 ZIP/package hash 作为唯一通用语义。
- `agent-platform-gateway-remote` / future remote gateway adapter:
  - 作为具体 SkillHub service adapter 的目标 owner，例如后续 SkillHub HTTP v1 ZIP adapter、single-file `SKILL.md` adapter 或其他服务 gateway。
  - 本 change 不新增完整具体远端服务 adapter；只定义这些 adapter 必须拥有 URL、credential resolution、HTTP path、wire DTO validation、response mapping、format normalization 和 safe error normalization。
- `agent-app`:
  - composition 负责解析 provider 的 `gatewayId`，选择对应 gateway adapter，并包装为 `agent-capability` 可消费的 access port。
  - default-system 只能声明 gateway/provider 结构性引用，不提交真实 URL 或 credential reference。
- `agent-contracts` / `agent-common`:
  - 不新增 `CapabilityProviderKind`；继续使用 `SKILL_HUB`。
  - refinement 范围是 `SkillHubOptions` 从 `endpoint`/service access facts 收敛为 `gatewayId` + managed install/cache reference 等 provider-side facts，避免把具体服务 URL 或 credential reference 作为通用能力必需字段。
- 测试:
  - 需要覆盖 provider 与 gateway 分离、无 URL/ref 默认配置、不同 gateway 输入形态归一成同一 staged Skill folder、以及 capability 不直接依赖具体 SkillHub wire protocol 或 archive/content 格式。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/skillhub-source/spec.md` 或后续更名后的 remote Skill source spec：提升 Remote Skill Content Source、gateway-owned adapter config、normalized staged Skill folder、provider-private loading facts 和 catalog governance 规则。
- `openspec/specs/capability-source-configuration/spec.md` / `openspec/specs/app-config-schema/spec.md`：提升 provider `gatewayId` 引用、gateway-owned concrete service config，以及 default-system 不提交真实 URL/ref 的约束。
- `openspec/specs/capability-catalog/spec.md`：如需要，补充 remote Skill content source 与普通 Skill descriptor/collision/governance 的关系。

设计视图：
- `openspec/designs/architecture/capability-spi.md`：补充 Remote Skill Content Source 与 remote gateway adapter 的边界。
- `openspec/designs/modules/agent-capability.md`：补充 provider-neutral content source、normalized folder intake validation、provider-private facts owner。
- `openspec/designs/modules/agent-platform-gateway-remote.md`：补充 SkillHub concrete gateway adapter 的目标 owner 和与 Remote Skill Content Source 的边界。
- `openspec/designs/modules/agent-app.md`：补充 provider -> gatewayId -> adapter injection 的 composition owner。
- `openspec/designs/spec-to-design-map.md`：补充验证入口映射。

验证入口：
- `openspec validate refine-ts-remote-skill-content-source-boundary --strict`
- `openspec validate --all --strict`
- `npm run build`
- `npm test`
- `npm run test:contract`
- `npm run lint:architecture`
- Focused remote Skill source / gateway adapter tests

## 契约确认（Contract Confirmation）

- `agent-common` 的 `CapabilityProviderKind` 继续使用 `SKILL_HUB`，本 change 不新增 `REMOTE_SKILL` 或其它 provider kind。
- `agent-app` 的用户配置类型继续使用 `skill-hub`。
- `agent-contracts/capability` 中 SkillHub provider options 的目标形状改为 provider 引用 gateway：`gatewayId` + managed install/cache reference；具体 URL、credential、HTTP path、wire DTO 和 service-specific safe error 属于 selected remote gateway adapter 或部署 overlay。
