## ADDED Requirements

### Requirement: Skill 工具是面向 model 的 Skill 执行入口

系统 SHALL 把 `Skill` 工具暴露为按名称执行受治理 Skill 的面向 model 的 Tool 入口。面向 model 的输入 schema MUST 是 `{ name: string, args?: object }`；`name` MUST 通过 `CapabilityInvocationRuntimeContext.capabilityResolver` 标识一个 Skill。在首个版本中，该 Skill 名称 MUST 是由 manifest `name` 产生的 Skill `CapabilityDescriptor.capabilityId`，并且 model 可见的披露 MUST 包含其 descriptor 具有 `modelInvocable=true` 的子集。可选的 `args` MUST 包含目标 Skill 任务数据。一次 model `Skill` tool_use MUST 恰好产生一个相关联的面向 model 的 tool_result。Agent Core MUST 把 `Skill` 当作普通的 capability invocation 对待：它解析 model 调用的 `Skill` 工具，并通过 `CapabilityInvocationPort` 进入该 Tool 的实现。`Skill` Tool 实现 MUST 通过 `RuntimeCapabilityResolver.resolveCapability(...)` 把 `name` 解析为内部 Skill id/descriptor，并在同一次 invocation 内完成目标 Skill 执行，由一个权威的 `CapabilityInvocationResult` 驱动最终的 provider tool_result。

#### Scenario: Skill 工具按受治理名称解析目标
- **WHEN** model 以有效的 `name` 调用 `Skill`
- **THEN** 系统只把 `name` 当作目标 Skill 名称
- **AND** 该名称 MUST 等于 Skill `CapabilityDescriptor.capabilityId` / manifest `name`
- **AND** 目标解析使用带 `kind="SKILL"` 的 `RuntimeCapabilityResolver.resolveCapability(...)`，并把该名称映射为内部 Skill id/descriptor。
- **AND** 目标 Skill 执行 MUST 由受治理的 availability 授权，而不是由 `modelInvocable` 授权。
- **AND** 已解析的 Skill metadata `context` MUST 只被 `Skill` Tool 实现用于内部分发。

#### Scenario: Skill 工具 descriptor 指引 model 调用
- **WHEN** Context Engine 投影 model 可调用的 `Skill` 工具 descriptor
- **THEN** 该 descriptor 的 description MUST 告诉 model `Skill` 在主对话内执行一个受治理的 Skill
- **AND** 当列出的可用 Skill 明确匹配用户请求时，它 MUST 指示 model 在回答任务之前调用 `Skill`
- **AND** 只有当 `/` 之后的文本与某个可用 Skill 完全匹配时，它 MUST 才把诸如 `/commit` 这样的斜杠命令视为可能的 Skill 名称
- **AND** 它 MUST 指示 model 诸如 `/help` 或 `/clear` 这样的内建 CLI 命令保持在既有 CLI 路径上
- **AND** 它 MUST 要求精确的可用 Skill 名称和任务特定的 JSON object `args`
- **AND** 它 MUST 把 model 输入定义为精确的可用 Skill 名称加上任务特定的 JSON object `args`
- **AND** 它 MUST 指示 model 只有在 `Skill` 工具确实被成功调用之后才声称使用了 Skill。

#### Scenario: 执行模式由 metadata 驱动
- **WHEN** model 以 `name` 调用 `Skill`
- **THEN** 面向 model 的 contract MUST 对 `inline` 和 `fork` 模式无关
- **AND** 分发权威 MUST 是受治理的已解析 Skill metadata
- **AND** `Skill` Tool 实现 MUST 只从受治理的已解析 Skill metadata 推导行为
- **AND** 可见的 tool_result 内容 MUST 使用本 change 定义的安全确认/错误表面。

#### Scenario: Timeout 由 ToolExecutor 策略治理
- **WHEN** model 调用 `Skill`
- **THEN** 面向 model 的输入 schema MUST 只接受受治理的 Skill 选择和目标 Skill 任务数据
- **AND** 有效 timeout MUST 从当前 request/run deadline 和 AbortSignal、capability invocation 策略、受治理 Skill metadata 提示以及 ToolExecutor 默认值推导
- **AND** 最严格的适用 timeout MUST 生效。

#### Scenario: Args 使用有界的 JSON 目标数据封装
- **WHEN** model 以 `args` 调用 `Skill`
- **THEN** `args` MUST 是 JSON object 根节点
- **AND** `args` MUST 只包含可 JSON 序列化的目标任务数据
- **AND** `args` 在序列化为 UTF-8 JSON 时 MUST 保持在 `skillToolArgsMaxBytes` 之内
- **AND** `args` MUST 保持在 `skillToolArgsMaxDepth` 之内
- **AND** 除非产品配置提供更小的值，首版默认值 MUST 为 `skillToolArgsMaxBytes=8192` 和 `skillToolArgsMaxDepth=8`
- **AND** 每个 Skill 的语义参数校验属于之后的 Skill input schema contract。

#### Scenario: Model 可调用性控制披露资格
- **WHEN** 某 Skill descriptor 具有 `modelInvocable=false`
- **THEN** Context Engine MUST 只披露 descriptor 具有 `modelInvocable=true` 的 Skill
- **AND** model 发起的 `Skill` tool_use 只有当其 `name` 通过 `CapabilityInvocationRuntimeContext.capabilityResolver` 解析时，才 MAY 执行该 Skill
- **AND** 任何可信的 user/channel 显式 Skill 调用 MUST 由带有自身治理的单独 channel/core 入口路径处理
- **AND** 该显式路径 MUST 通过 agent scope、owner scope、catalog 可见性和 Skill 工具结果 contract 进入 agent 执行。

#### Scenario: 受治理名称解析安全处理非 Skill 输入
- **WHEN** `name` 看起来像路径或 provider 私有 ref
- **THEN** 目标查找 MUST 使用受治理的 resolver 查找
- **AND** 未解析或不可用的目标返回安全的失败结果。

#### Scenario: Skill 工具为原始 tool_use 返回一个结果
- **WHEN** Skill 执行成功、降级、失败、超时或被取消/中止
- **THEN** Agent Core MUST 为原始 `Skill` tool_use 收到一个 `CapabilityInvocationResult`
- **AND** Agent Core MUST 投影恰好一个与该原始 tool_use id 相关联的 provider tool_result
- **AND** 生成的消息、context patch、audit ref 和安全结果投影 MUST 保持为同一执行结果的侧面。

#### Scenario: 被中断的 Skill 工具调用得到结算
- **WHEN** 某 `Skill` tool_use 处于 pending 或 running 且 run 被中止、中断、恢复或因无效结果形状被拒绝
- **THEN** Agent Core MUST 为原始 tool_use id 产生恰好一个安全的 terminal tool_result
- **AND** 执行期间的 cancel/abort MUST 以带稳定安全失败原因 `ABORTED` 的 terminal `FAILED` 结果语义结算
- **AND** provider turn MUST 只在每个 `Skill` tool_use 都有 terminal 结算之后继续。

#### Scenario: 可见 Skill 列表排除正文和位置
- **WHEN** model context 披露可用 Skill
- **THEN** 它 MUST 呈现对当前 Agent scope 和 Owner scope 可见的受治理 Skill 名称和安全描述
- **AND** 受治理的 Skill 名称 MUST 是由 manifest `name` 产生的 Skill `CapabilityDescriptor.capabilityId`
- **AND** 披露表面 MUST 限于受治理 Skill 名称和安全描述。

#### Scenario: 可见 Skill 列表由 context 能力披露组装
- **WHEN** 准备某个 model step
- **THEN** 现有 context assembly 和 capability disclosure 路径 MUST 在 Agent Scope、Owner Scope、binding、availability 和 policy 门禁之后，通过请求带 `modelInvocable=true` 的当前 request-scope catalog view 来构建 model 可见 Skill 列表
- **AND** Capability Catalog MUST 应用 `modelInvocable` 条件并把它传递给 search/discovery provider，使 provider 实现能够在可能时避免返回默认隐藏的 capability
- **AND** `Skill` Tool 实现 MUST 消费 `CapabilityInvocationRuntimeContext.capabilityResolver` 进行目标解析
- **AND** model 可见 Skill 列表刷新 MUST 仍然由现有 context assembly 和 capability disclosure 路径拥有。

#### Scenario: 执行时 capability 解析由 resolver 拥有
- **WHEN** Skill Tool 或未来的内部 capability 路径需要在执行时解析目标 Skill、MCP tool、CLIP capability 或其他默认隐藏的 capability
- **THEN** 它 MUST 使用 `CapabilityInvocationRuntimeContext.capabilityResolver`，其实现绑定到当前请求的可信 Agent Scope 和 Owner Scope
- **AND** 执行时查找权威 MUST 是 `CapabilityInvocationRuntimeContext.capabilityResolver`
- **AND** `visibleCapabilities` MUST 仍然保持为 ContextAssembly/RenderedModelInput 的 model 可见结果
- **AND** resolver MUST 应用 catalog binding、availability、provider 策略以及精确的 `kind + providerId? + capabilityId` 匹配
- **AND** request-local 的 `allowedTools` / `deniedTools` 策略 MUST 由 context disclosure、invocation 策略或未来的内部执行门禁应用。

#### Scenario: Runtime resolver 使用 scheme-B contract 形状
- **WHEN** capability contract 定义执行时解析支持
- **THEN** `agent-contracts/capability` MUST 定义带扁平字段 `kind`、`capabilityId` 和可选 `providerId` 的 `RuntimeCapabilityResolveRequest`
- **AND** 它 MUST 定义带 `resolveCapability(request, signal)` 的 `RuntimeCapabilityResolver`
- **AND** 它 MUST 定义带可选 `capabilityResolver` 的 `CapabilityInvocationRuntimeContext`
- **AND** 它 MUST 在本 change 中使用扁平的 scheme-B runtime resolver 请求形状。

#### Scenario: Context render 按 kind 划分可见 capability
- **WHEN** Context Engine 从受治理的可见 capability view 渲染某个 model step
- **THEN** 它 MUST 按 `kind="TOOL"` 选择 model 可调用的 tool，而不是仅按 `inputSchema` 是否存在选择
- **AND** 它 MUST 从可见 `TOOL` 子集投影 provider tool descriptor，这些子集的 descriptor 要么具有 `modelInvocable=true`，要么被 request-local 的 `CapabilityContextPatch.allowedTools` 激活，且其 `inputSchema` 满足 model tool descriptor contract
- **AND** 它 MUST 按 `kind="SKILL"` 选择 Skill 披露条目
- **AND** 它 MUST 披露 descriptor 具有 `modelInvocable=true` 的 Skill
- **AND** request-local 的 `CapabilityContextPatch.allowedTools` MAY 使受治理可用的 `TOOL` capability 对下一个 model step 可见，包括具有 `modelInvocable=false` 的 descriptor
- **AND** Context Engine MUST 依据受治理可用的 catalog view 校验 `allowedTools`，无效条目 MUST 在 Context Engine 治理边界失败
- **AND** request-local 的 `CapabilityContextPatch.deniedTools` MUST 由 Context Engine 在 baseline model 可见 descriptor 与 `allowedTools` 激活合并之后应用
- **AND** `deniedTools` MUST 按 `capabilityId` 或 `@providerId/capabilityId` 从当前 model 可见集合中排除匹配的 `TOOL` descriptor，且不在当前可见集合中的被拒绝 ref MUST 被忽略
- **AND** 非默认激活的 provider（包括 MCP Server 和 CLIP provider）MUST 把发现的 capability 默认设为 `modelInvocable=false`，除非每个 capability 显式声明 `modelInvocable=true`。

#### Scenario: Skill 披露使用固定的英文 prompt 格式
- **WHEN** 当前 model step 具有可见的 `Skill` 工具条目和一个或多个可见的 model 可调用 Skill
- **THEN** Context Engine MUST 追加一个英文 system-prompt 小节，带有精确的标题 `### Available skills` 和 `### How to use skills`
- **AND** `### Available skills` 列表 MUST 为每个可见 Skill 包含一个 bullet，形式为 `- <skill-name>: <safe description>`
- **AND** `### How to use skills` 小节 MUST 指示 model 对列出的 Skill 调用 `Skill` 工具，使用精确列出的 `name`，保持 `args` 为任务特定的 JSON，使用受治理名称，并在没有列出的 Skill 明确匹配时用普通 tool 安全继续
- **AND** 该小节 MUST 保持英文，以匹配已实现的 system-prompt 语言 baseline
- **AND** 该小节表面 MUST 限于标题、受治理 Skill 名称、安全描述和使用说明。

#### Scenario: Skill 披露跟随 Skill 工具可见性
- **WHEN** 当前 model step 在 request-local 工具过滤之后缺少可见的 `Skill` 工具条目
- **THEN** Context Engine MUST 以基础 system prompt 和当前可见的 provider tool 渲染 model 输入
- **AND** `allowedTools` 激活 MUST 使已解析的受治理 `TOOL` descriptor 对 model 可见
- **AND** `deniedTools` 最终排除 MAY 从当前 model 可见 `TOOL` 集合中移除 `Skill` 包装工具，这同时省略该 step 的 Skill 披露。

#### Scenario: SkillDocumentService 是唯一的 SKILL.md 格式 owner
- **WHEN** 系统解析或加载 `SKILL.md`
- **THEN** `agent-capability` MUST 使用单一实现内部的 `SkillDocumentService` 作为 leading-frontmatter 检测、metadata 字段解释、descriptor/SkillMetadata 映射、安全 diagnostic、canonical 正文切片和源一致性 token 构造的 owner
- **AND** discovery 时 metadata view 和 invocation 时 body view MUST 共享相同的解析原语和一致性规则
- **AND** catalog resolve、provider 选择、source root 查找和加载权威 MUST 仍然由既有的 catalog/source 边界拥有
- **AND** Skill 工具、Agent Core、Context Engine、runtime 和 source 特定 adapter MUST 使用共享的 `SkillDocumentService` 解析和正文切片路径。

#### Scenario: Discovery 使用 metadata view，invocation 使用 canonical body view
- **WHEN** Skill source 执行 discovery、索引或 model 可见 Skill 列表准备
- **THEN** 它们 MUST 使用 `SkillDocumentService.parseMetadataView(...)` 只解析 descriptor 注册、model 可见性、availability 和治理所需的标准 manifest 与 metadata 事实
- **AND** 它们 MUST 保持 discovery/索引只在 metadata view 上进行
- **AND** source 拥有的加载事实 MAY 只保留在 provider/source 实现边界内部。

#### Scenario: Skill 工具通过已注册 source 加载 canonical 正文
- **WHEN** 一次经授权的 inline Skill 执行需要 Skill 正文内容
- **THEN** Skill 工具 MUST 通过以已解析 descriptor 的 provider id 为 key 的实现内部 catalog 查询，解析已注册的 Skill source/discovery
- **AND** 它 MUST 通过实现内部的 source/discovery 操作（例如 `SkillSourceDiscovery.loadCanonicalBodyView(...)`）请求正文
- **AND** 该 source/discovery 操作 MUST 使用 `SkillDocumentService.loadCanonicalBodyView(...)` 或与 discovery 时解析属于同一实现家族的等价共享文档操作
- **AND** 返回的 canonical body view MUST 按照 discovery 时使用的同一 Skill spec/parser/mapper 家族排除 frontmatter
- **AND** 该 body view MUST 包含足以与已解析 descriptor 比较的安全内部 source 身份、版本、hash 或等价一致性 token
- **AND** descriptor metadata、model context、可见 tool_result、stream payload、safe error、audit 细节和日志 MUST 保持在安全的受治理标识符和安全结果字段上。

#### Scenario: Descriptor 与 body view 保持一致
- **WHEN** invocation 时的正文加载返回一个 canonical body view
- **THEN** Skill 工具 MUST 校验 provider id、Skill 身份/名称、source 身份、版本、hash 或等价一致性 token 与已解析 descriptor 匹配
- **AND** source 变更、消失、重新解析身份变化或缺失 descriptor/body 一致性证明 MUST 按 catalog 策略通过安全失败或受治理重新解析结算
- **AND** 不匹配的正文 MUST 通过安全失败或受治理重新解析结算。

#### Scenario: Inline 模式通过同一结果添加隐藏 context
- **WHEN** 已解析的 Skill 声明 `context=inline`
- **THEN** inline 执行路径 MAY 在 Skill 工具执行结果内部返回 request-local 的隐藏生成消息
- **AND** 这些生成消息 MUST 只作为下一个 model step 的 request-local 隐藏生成 context 交付。

#### Scenario: Inline 模式返回固定确认加隐藏 context
- **WHEN** 一次 inline Skill 执行成功
- **THEN** 原始 `Skill` tool_use 的可见 tool_result MUST 是固定的安全确认 `{ name, status: "loaded" }`，由受治理 Skill 名称和加载状态等可信事实派生
- **AND** 该确认 MUST 通过 `CapabilityInvocationResult.structuredPayload` 返回
- **AND** 同一结果中的隐藏生成消息 MUST 为下一个 model step 携带经授权的 canonical Skill 正文
- **AND** 可见确认表面保持限于该固定确认形状。

#### Scenario: Inline 生成消息使用稳定封装
- **WHEN** inline Skill 执行把 Skill 正文添加到隐藏生成 context
- **THEN** 生成消息 MUST 使用稳定的 `<skill_content name="{safe skill name}">...</skill_content>` 封装
- **AND** 该封装 MUST 在 `skill_content` 内部直接包含排除 frontmatter 的经授权 canonical markdown 正文
- **AND** `name` 属性 MUST 在针对属性上下文的确定性转义之后使用经授权的 model 可见 Skill 名称
- **AND** 加载的正文 MUST 通过封装边界检查，防止在最终消息渲染/解析规则下发生逃逸或封装伪造，包括能够终止或创建 `<skill_content>` 边界的原始或转义形式
- **AND** 封装表面限于 inline 指令加载所需的安全 skill 名称和 canonical 正文内容。

#### Scenario: Inline 正文通过确定性的加载与注入检查
- **WHEN** inline 执行从 bundled、system-local 或 agent-owned-local source 加载 Skill 正文
- **THEN** 系统 MUST 在把正文加入 `generatedMessages` 之前应用确定性边界检查
- **AND** 这些检查 MUST 覆盖先授权后加载、排除 frontmatter 的 canonical 正文、descriptor/body 一致性、预期文本编码、非空正文、不允许的二进制/控制内容、inline 正文大小预算、封装边界逃逸，以及 source 私有 ref、原始路径、package 布局或凭据的泄漏
- **AND** 这些检查 MUST 是确定性的 runtime 检查。

#### Scenario: Inline 正文大小由 runtime context 策略拥有
- **WHEN** 加载的 inline Skill 正文超出配置的 inline Skill 正文字节预算
- **THEN** `Skill` Tool 实现 MUST 在返回生成消息之前安全失败
- **AND** 该上限 MUST 来自 NextAgent 的 runtime/context 策略
- **AND** 除非产品配置提供更小的值，首版默认的 `inlineSkillBodyMaxBytes` MUST 为 65536 bytes。

#### Scenario: Inline 生成消息尊重当前 model context 预算
- **WHEN** 一次成功的 inline Skill 执行已经为下一轮产生了隐藏生成消息
- **THEN** 现有 tool 循环顺序 MUST 保持：先保存已结算的 Skill 工具结果和 request-local 生成消息，然后在下一轮调用 Context Engine
- **AND** Context Engine MUST 在 assembly/render 期间校验下一轮 model context 预算，而不是重写已结算的 `Skill` tool_result
- **AND** 来自紧邻前一个 tool 轮次的最新激活 Skill 生成消息 MUST 在为该下一个 model step 压缩期间受到保护
- **AND** 压缩 MUST 首先针对更旧的已选/历史 context，而不是静默截断受保护的 Skill 消息
- **AND** Context Engine 在旧 context 压缩之后的预算耗尽 MUST 在下一次 model invocation 之前使 run 安全失败
- **AND** 已结算的 `Skill` tool_result MUST 在结算之后保持稳定。

#### Scenario: Skill metadata 只产生请求的 context patch
- **WHEN** 类型化 Skill metadata 包含 `allowedTools`、`deniedTools`、`model` 或 `modelOptions`
- **THEN** Skill 工具 MAY 返回一个包含 `allowedTools`、`deniedTools`、`modelName` 或 `modelOptions` 的请求 `contextPatch`
- **AND** 当目标 Skill 声明 `allowedTools` 时，`CapabilityContextPatch.allowedTools` MUST 等于 `SkillMetadata.allowedTools`
- **AND** 当目标 Skill 声明 `deniedTools` 时，`CapabilityContextPatch.deniedTools` MUST 等于 `SkillMetadata.deniedTools`
- **AND** Skill 工具把这些字段作为请求的变更返回给下游治理
- **AND** Agent Core MUST 只为当前 run 保存 request-local 的 patch 状态
- **AND** `RuntimeCapabilityResolver` MUST 保持限定为面向之后执行时解析的受治理 descriptor 查找
- **AND** Agent Core MUST 把整个 request-local 的 `CapabilityContextPatch` 传递给 Context Engine
- **AND** Context Engine MAY 使用已保存的 request-local `allowedTools`，从受治理可用的 catalog view 激活之后的 model 可见 tool 披露
- **AND** Context Engine MUST 使用已保存的 request-local `deniedTools` 作为对之后 model 可见 `TOOL` 集合的最终排除
- **AND** Context Engine / model 选择治理 MUST 依据当前 request scope、model 治理和 context 策略，在之后的 model step 之前校验并应用或拒绝 model patch。

#### Scenario: 本 change 中 fork metadata 产生受治理的 unsupported 结果
- **WHEN** 已解析的 Skill 声明 `context=fork`
- **THEN** `Skill` Tool 实现 MUST 为原始 `Skill` tool_use 返回安全的 `SKILL_CONTEXT_UNSUPPORTED` 失败
- **AND** 它 MUST 通过该单一安全结果结算原始 `Skill` tool_use
- **AND** 实际的 fork 执行属于 `add-ts-fork-skill-execution`。

#### Scenario: 首版返回 terminal Skill 工具结果
- **WHEN** inline 内容加载仍在运行
- **THEN** 首版 `Skill` Tool 执行 MUST 返回 terminal 的 `SUCCEEDED`、`DEGRADED`、`FAILED` 或 `TIMED_OUT` 结果
- **AND** cancel/abort MUST 表示为带稳定安全失败原因 `ABORTED` 的 terminal `FAILED` 结果。
