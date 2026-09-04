## 背景与问题

TS 首个发布版本需要提供可治理的内置 Skill source，使框架内置的通用电信 Skill 可以通过统一 Capability Catalog 成为所有 Agent 的默认基线能力。Builtin Skill 是框架出于设计目的提供给网络智能体的通用能力，例如电信领域知识问答、告警查询等所有智能体都需要的基础 Skill。首版 framework-default builtin Skill 固定为 `telecom-domain-qa`，用于承载电信领域问答与诊断意图澄清的稳定 capability identity。

当前系统已有 Capability Discovery、Capability Catalog、Skill Manifest Contract 和 Agent Assembly 的基础边界。本 change 的目标是把 builtin Skill 作为可信 bundled source 接入这些既有边界：由 `agent-capability` 负责发现和 manifest facts，由统一 Catalog 负责治理。Framework-default builtin Tools 和 builtin Skills 的默认启用由 Capability Catalog 基于 builtin provider descriptors 计算；Agent App 负责校验并传递用户显式 binding facts，用户可通过 Agent binding 配置禁用具体默认 builtin capability。

## 黑盒需求

从使用者和系统集成视角，本 change 需要达成以下行为：

1. 框架提供的 builtin Skill 在系统启动后作为 `SKILL` capability 进入统一 Capability Catalog 治理。
2. 每个 Agent 默认在 Capability Catalog 的可用视图中拥有框架定义的 framework-default builtin capabilities，包括首版默认 builtin Tool 和首版默认 builtin Skill `telecom-domain-qa`。
3. 用户可以在 Agent definition 的 `capabilityBindings[]` 中通过 `enabled=false` 禁用某个默认 builtin Tool 或 builtin Skill。
4. Agent assembly 必须保留用户显式 binding / disable facts；Catalog 在 `listAvailable` / `resolve` 中应用这些 facts，并且不会向该 Agent 暴露已禁用的 builtin capability。
5. 既有 `TOOL` binding 行为保持兼容，新增 `SKILL` binding 可用于受治理 Skill capability，未知 capability type 继续被安全拒绝。
6. Release readiness 能用稳定 provider id、稳定 Skill identity 和安全 outcome 说明 builtin Skill source 的启动状态。

## 目标方案

本 change 固定以下目标方案：

1. Builtin Skill source 使用稳定 provider identity：`providerId="builtin-skills"`、`providerKind=BUNDLED`。
2. Builtin Skill root 由 `agent-capability` package 拥有，作为 framework packaged resource 的一部分，例如 authoring layout `packages/agent-capability/src/builtins/skills/<skill>/SKILL.md`。
3. 首版必须在该 root 下提供 `telecom-domain-qa/SKILL.md`，并使用标准 manifest `name: telecom-domain-qa` 作为 required framework-default builtin Skill 的稳定 identity。
4. `BuiltinSkillDiscovery` 是唯一 builtin Skill discovery adapter；它实现现有 `CapabilityDiscovery`，使用 `discoveryMode=EAGER`，并由 `DefaultCapabilityDiscoveryFactory` 在 trusted `builtin-skills + BUNDLED` provider 输入下创建。
5. 每个 builtin Skill 候选复用标准 `SKILL.md` manifest parser 和 mapper，产出 manifest-derived descriptor facts。
6. Builtin Skill source 只产生 discovery facts、descriptor input facts、安全 diagnostics/readiness evidence 和 source-owned internal loading facts；最终 availability、conflict、model visibility 和 invocation eligibility 由 Capability Catalog governance 决定。
7. 默认 builtin capability 列表来自 builtin provider discovery 后的 governed descriptors；Agent App 负责传递用户显式 binding facts，Catalog 负责计算默认可见性。
8. Agent assembly compiler 只保留用户 Agent definition 中的显式 capability binding / disable facts，并按 `providerId + capabilityType + capabilityId` 作为 override key 进行结构化去重。
9. Builtin provider/source 默认开启，可由可信 product/test composition 禁用整个 source；用户不能关闭 builtin provider/source。Agent 级禁用只通过 explicit binding disable 作用于具体默认 builtin capability。
10. Provider 注册链固定为：`builtinSkillsProvider` 常量、`DefaultCapabilityDiscoveryFactory` 分支、`createCapabilitySubsystem()` eager discovery、`agent-app` startup resource provider registry。
11. Readiness evidence 保持 implementation-local，不新增 Web API、stream event、audit schema、metric schema 或 `agent-contracts` public readiness DTO。
12. Agent App 在装配阶段只做 binding shape、安全 id、受支持 capability type 和 provider id 有效性校验。Provider id 有效性来自可信 startup resource provider registry；capability existence、availability、冲突和最终可见性由 Capability Catalog 在 `listAvailable` / `resolve` 阶段决定。

## 规格变化

本 change 更新 `builtin-skill-source` 规格，定义以下契约：

1. Builtin Skill 通过统一 Capability Catalog 注册为受治理 `SKILL` descriptor。
2. Builtin Skill provider 使用冻结的 `BUNDLED` provider kind 和稳定 provider id。
3. Builtin Skill root 是 `agent-capability` package-owned bundled resource root。
4. 首版 framework-default builtin Skill 是 `providerId=builtin-skills`、`capabilityType=SKILL`、stable identity `telecom-domain-qa`。
5. Builtin Skill discovery 由 `agent-capability` 内部 `BuiltinSkillDiscovery` 负责。
6. Builtin Skill manifest 复用标准 `SKILL.md` contract。
7. Builtin Skill discovery 保留 source-owned internal loading facts，但不把加载授权放入 public descriptor 或 metadata。
8. Framework-default builtin Tools 和 builtin Skills 由 Capability Catalog 对每个 Agent 默认纳入候选，并支持用户通过 binding 禁用具体默认 capability。
9. Agent definition binding 接受 `SKILL`，保持 `TOOL` 兼容，并继续拒绝未知 capability type。
10. Builtin provider 只通过可信 composition 注册。
11. Readiness evidence 使用安全 outcome code 表达 source disabled、candidate ignored、manifest missing、manifest invalid、governance unavailable 和 registered。

## 影响范围

1. `agent-capability`：新增 builtin Skill provider identity、package-owned root、discovery adapter、readiness evidence 和测试。
2. Capability governance：接收 builtin Skill source 的 provider facts、descriptor facts 和 availability input，默认纳入 framework-default builtin Tool / Skill candidates，并继续拥有最终可见性与可执行性判断。
3. `agent-app`：在 startup resource provider registry 注册 `builtin-skills`，在 Agent assembly 阶段校验 provider id 有效性，并把用户显式 binding / disable facts 传递给 runtime-facing assembly。
4. Agent definition parsing / assembly validation：扩展 binding capability type 到 `SKILL`，保持既有 `TOOL` 兼容、provider id 有效性校验和未知 type 拒绝；`agent-contracts/agent-assembly` 中的 `AgentCapabilityBinding` 需要支持可选 `enabled` fact，缺省按 `true` 处理，`enabled=false` 供 Catalog 识别显式禁用。
5. Release readiness：检查框架默认电信 builtin Skill `telecom-domain-qa` 的稳定 identity 是否已被 discovery 接受并被 catalog governance 解析为可用或降级状态。

## 非目标与边界约束

本 change 不定义以下内容：

1. Skill inline execution、fork execution、tool loop、sandbox、audit、idempotency、prompt 注入或模型调用策略。
2. Local Skill source、agent-scoped Skill source、SkillHub source、远端下载、安装、checksum 或 trust workflow。
3. `telecom-domain-qa` 的知识内容、prompt 内容、回答质量、模型行为或运行时执行过程。
4. 新的 public capability descriptor / invocation / readiness DTO/schema、builtin-only provider kind、descriptor loading key、source registry、provider registry、readiness service 或 plugin-like manifest；本 change 只 refinement `agent-contracts/agent-assembly` 中 existing `AgentCapabilityBinding` 的 binding fact 语义。
5. 由 Agent package、workspace、本地目录、客户端输入、模型输出、外部 provider config 或 descriptor metadata 重定义 builtin Skill root、provider identity 或 source enablement，或关闭 builtin provider/source。
6. Agent assembly、context engine 或 Agent loop 直接扫描 builtin source、读取 `SKILL.md`、维护 builtin capability 清单、消费 source-owned loading key 或绕过 catalog governance。
