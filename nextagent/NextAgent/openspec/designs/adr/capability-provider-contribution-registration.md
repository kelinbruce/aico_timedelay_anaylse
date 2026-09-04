# ADR: Capability Provider 贡献注册

## 状态（Status）

Accepted

## 背景与现状（Context）

Capability provider 是 Tool、Skill 和 Agent capability 的框架扩展点。早期基线文本允许 `agent-app` 持有启动期 resource/provider registry，并知晓具体 provider id，如 builtin tool、builtin skill、local skill、local agent 和 memory tool。该形态使 app composition 对本应由 capability 或拥有 provider 业务语义的 package 拥有的事实负责。它还迫使 AgentAssembly 校验在 assembly 物化期间依赖 provider 事实，使启动顺序变得脆弱。

扩展注册边界需要三个属性：

- 框架/保留 provider 在 ready 之前作为启动事实可见；
- owner package 保持 provider 专属业务语义的归属；
- `agent-app` 可以执行跨模块 ready 校验，而不必手工编写 provider catalog。

## 决策（Decision）

Provider 注册使用仅启动期的 `CapabilityProviderContribution` 事实。`agent-contracts/capability` 拥有公开贡献 contract、provider 绑定的 `CapabilityDiscovery` SPI 和 provider 中立的 `CapabilityExecutor` SPI。`agent-capability` 拥有贡献组装，并冻结 restart 范围的 provider 事实快照。

每个贡献将恰好一个 `CapabilityProvider` 绑定到恰好一个 discovery 对象和至多一个 executor 对象。Discovery 保持 provider 绑定，因为 discovery 拥有 source 专属枚举，且必须为单一 provider 身份发布 descriptor。Executor 保持 provider 中立，因为执行是在 catalog 治理解析出 descriptor 之后才被选择；provider 绑定由 `agent-capability` 在 executor 查找组装期间应用。因此在安全的前提下，同一 executor 对象可以服务多个 provider 贡献。

`agent-capability` 从三个来源组装贡献：

- 内部 owner 拥有的贡献，如 builtin Tool、builtin Skill、builtin Agent、local Skill、local Agent 和 local subagent provider；
- 由 package 拥有的公开工厂返回的外部 owner 贡献，例如 `agent-memory` 返回 `memory-tools` 贡献；
- 由已校验的 `ResolvedCapabilityProviders.providers` 转换而来的 config 驱动贡献。

内部和外部 owner 贡献在 config 驱动贡献被规范化之前组装，使 capability 子系统能够拒绝与框架/保留或 owner 贡献 provider 身份冲突的用户 provider 配置。这在不需要 `agent-app` 维护自己的保留 provider 列表的情况下保持了 owner 边界。

`agent-app` 可以调用公开 owner 工厂并将返回的贡献传递给 `agent-capability`，但它不是权威 provider registry owner。它消费 `CapabilitySubsystem.capabilityProviders` 用于启动图校验和 ready 状态发布。AgentAssembly 物化只执行创建 runtime 安全 assembly 事实所需的结构检查；跨资源有效性检查（包括 provider id 有效性）在 capability 贡献和其他启动资源组装完成之后运行。

## 结果（Consequences）

新增框架/保留 provider 只改变所属 package 的贡献来源和测试，而不是 app 侧的 provider 列表。App composition 仍是装配根，但它不为了构建清单事实而导入 provider 内部实现，不手写 memory Tool 定义，也不拥有 `WorkspaceFilePort` 或 capability cleanup 策略。

Capability 拥有的校验发生在 `agent-capability` 内部。贡献形态、重复 provider id、provider/discovery 不匹配、不支持的 provider 支持项、本地依赖形态、discovery 支持和 executor 支持都由 capability 子系统拒绝或以安全启动诊断形式呈现。App 级校验限于所需资源组装完成后的跨模块图检查。

这保持了启动顺序的确定性：

1. 加载并冻结 app config。
2. 仅以结构校验物化 AgentAssembly 事实。
3. 组装 capability 贡献并冻结 provider 事实。
4. 组装其他依赖 AgentAssembly 或 capability 事实的 resource registry。
5. 运行跨模块启动图校验。
6. 仅在校验通过时进入 ready。

## 被否决的选项（Rejected Options）

### 保留 app 拥有的保留 provider 列表

被否决，因为它使 `agent-app` 知晓具体 provider id、provider kind，有时还包括 Tool 或 memory provider 细节。这违反黑盒归属，并要求为 provider 侧的变更更新 composition root。

### 使用 import 副作用或全局可变 registry

被否决，因为启动顺序变得隐式，且 request 时变更难以排除。扩展注册必须是确定性的、仅启动期的且冻结的。

### 让 discovery provider 中立

被否决，因为 discovery 本质是 source/provider 枚举。创建 descriptor 和归属安全诊断时都需要 provider 身份。Provider 中立的 discovery 会把 provider 绑定推入 catalog 或 app 代码。

### 在公开 SPI 中让 executor provider 绑定

被否决，因为执行发生在 catalog 治理解析出携带 provider 的 descriptor 之后。公开的 provider 绑定 executor 会在 executor 对象中重复 provider 身份，使共享 executor 实现更难复用，又不能提升安全性。
