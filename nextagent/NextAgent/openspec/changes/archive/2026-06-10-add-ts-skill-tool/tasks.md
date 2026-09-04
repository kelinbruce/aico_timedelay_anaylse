## 1. Descriptor 与 schema

- [x] 1.1 把外层 `Skill` wrapper 定义为既有 `builtin-tools` provider 路径上的 builtin `TOOL` descriptor，复用已建立的 builtin tool 注册和执行家族。
- [x] 1.2 把模型可见的 Skill tool 输入定义为 `{ name, args? }`，并确保 `name` 是只能通过 `CapabilityInvocationRuntimeContext.capabilityResolver` 解析的 Skill `CapabilityDescriptor.capabilityId` / manifest 名称。
- [x] 1.3 把首个发布的 Skill tool 结果语义定义为针对原始 tool_use 的终态 `SUCCEEDED` / `DEGRADED` / `FAILED` / `TIMED_OUT` 结果，cancel/abort 映射为 `FAILED` 加稳定的 safe failure reason `ABORTED`。
- [x] 1.4 保持模型可见 schema 聚焦于受治理的 Skill 选择和任务数据，把 timeout、child budget、mode、provider 覆盖和等价的执行治理字段校验掉。

## 2. 执行器

- [x] 2.1 校验 schema 和 args 预算：`args` 必须是 JSON object 根、可 JSON 序列化、无治理字段、不大于 `skillToolArgsMaxBytes` 默认 8192 字节且不深于 `skillToolArgsMaxDepth` 默认 8。
- [x] 2.2 通过 `RuntimeCapabilityResolver.resolveCapability(...)` 按精确受治理 Skill 名称解析目标，其中 name 等于 Skill capabilityId / manifest 名称，并把它映射为内部 Skill id/descriptor。
- [x] 2.3 把 `modelInvocable` 强制为仅模型披露资格：Context Engine 只披露 `modelInvocable=true` 的 capability，而 Skill Tool 目标解析要求受治理的可用性，不要求目标 Skill `modelInvocable=true`。
- [x] 2.3a 显式定义 resolver 边界：新增 `RuntimeCapabilityResolveRequest`、`RuntimeCapabilityResolver` 和 `CapabilityInvocationRuntimeContext`；执行时查找 MUST NOT 使用 ContextAssembly `visibleCapabilities`，且 MUST NOT 用 `availableCapabilities` request 字段替代 resolver 语义。
- [x] 2.3b 保持 runtime resolve request 的 KISS 形态：扁平字段 `kind`、`capabilityId`、可选 `providerId`；不引入 `CapabilityRef`，也不复用 catalog 的 `CapabilityResolveRequest`。
- [x] 2.3c 把 `RuntimeCapabilityResolver` 的范围保持为 KISS 的受治理 descriptor 查找：它不得接收 `RequestLocalCapabilityState`，也不得应用 request-local 的 `allowedTools` / `deniedTools`。
- [x] 2.4 从受治理的已解析 Skill metadata 实现 `Skill` Tool 行为；模型输入不得作为分发权威，且本 change 中 `context=fork` 必须返回 safe 的 `SKILL_CONTEXT_UNSUPPORTED`。
- [x] 2.5 在 Skill tool 执行内实现 inline 模式：通过已注册的 Skill source/discovery 边界进行授权后的延迟正文加载、确定性注入边界检查、稳定的隐藏生成消息 envelope 和固定的安全可见确认。
- [x] 2.6 把目标 Skill 执行保持在同一个 `Skill` tool 调用内，使 wrapper 路径为原始 tool_use 产生一个权威的 `CapabilityInvocationResult`。
- [x] 2.7 在 `agent-capability` 中引入实现本地的 `SkillDocumentService` 作为唯一的 `SKILL.md` 格式 owner，其元数据解析和 canonical 正文加载操作共享前沿 frontmatter 检测、字段解释、descriptor/SkillMetadata 映射、safe 诊断、正文切片和一致性 token 规则。
- [x] 2.8 为调用时正文加载新增实现本地的 `SkillSourceDiscovery` 能力面，由既有 builtin 和本地 Skill discovery/source 类实现，不向 `Skill` Tool 实现暴露 provider 私有加载事实。
- [x] 2.9 新增实现本地的 catalog 查询，用于按 `providerId` 查找已注册的 Skill source/discovery；该查询不进入公开的 `CapabilityCatalog`。
- [x] 2.10 验证调用时正文视图与已解析 descriptor 的 provider id、Skill 身份/名称、source 身份/版本/hash 或等价一致性 token 匹配；不匹配必须 safe-fail 或强制受治理的重新解析。
- [x] 2.11 从 request/run 截止时间、AbortSignal、capability policy 和 ToolExecutor 默认值派生有效 timeout；不得使用模型输入设置 timeout。

## 3. 结果契约

- [x] 3.1 为原始 `Skill` tool_use 返回一个 `CapabilityInvocationResult`。
- [x] 3.2 投影恰好一个与原始模型 tool_use id 关联的 provider tool_result。
- [x] 3.3 把 inline 生成消息、请求的 context patch 和 audit ref 视为同一执行结果的侧面，而不是第二个模型可见结果。
- [x] 3.4 保持 runtime timeline/history 为安全的观察输出，同时 provider tool_result 仍是权威的 Skill 执行结果投递路径。
- [x] 3.5 inline 结果使用 `structuredPayload={ name, status:"loaded" }` 作为常规可见确认，隐藏的生成消息承载 inline Skill 正文效果。
- [x] 3.6 inline 生成消息正文 MUST 在授权后加载为 canonical parser 产出的不含 frontmatter 的正文，通过 descriptor/正文一致性以及确定性文本/大小/wrapper 边界/泄漏边界检查，并在返回生成消息之前遵守 `inlineSkillBodyMaxBytes` 默认 65536 字节。
- [x] 3.7 把 `SkillMetadata.allowedTools`、`deniedTools`、`model` 和 `modelOptions` 映射进请求的 `contextPatch`，并把下游治理保留为后续校验点。
- [x] 3.8 用恰好一个安全的终态 tool_result 结算 pending/running/interrupted/recovered 的 Skill tool call。
- [x] 3.9 确保模型可见的 Skill 披露只包含可见的 Skill 名称和安全描述，其中 name 是 Skill capabilityId / manifest 名称，绝不是正文、位置、loader key、资源路径或原始资源引用。
- [x] 3.10 更新 Context Engine 渲染语义：按 `CapabilityDescriptor.modelInvocable=true` 过滤、按 `kind` 划分可见 capability、从 `TOOL` 子集投影 provider tool、从 `SKILL` 子集渲染固定的英文 `### Available skills` / `### How to use skills` 段落，并在该步 `Skill` tool 不可见时省略该段落。
- [x] 3.10a 把模型可见性过滤移到 `CapabilityCatalogRequest.modelInvocable`，把该条件传入 discovery/search criteria，并把 allowedTools 校验保持在受治理的可用 catalog 视图上。
- [x] 3.10b 把 allowedTools 解释完全移到 Context Engine：Agent Core 传递整个 `CapabilityContextPatch` 而不校验，Context Engine 把基线模型可见 descriptor 与受治理可用的 allowed TOOL descriptor 求并集。
- [x] 3.10c 在 Context Engine 中把 `CapabilityContextPatch.deniedTools` 完全应用为对合并后模型可见 TOOL descriptor 的最终排除，不经过 Agent Core 校验或 runtime resolver 介入。
- [x] 3.11 在下一回合 Context Engine assembly/render 时强制生成 Skill 消息预算：保持既有 tool-loop 先保存后下一回合的顺序，保护最新激活 Skill 生成消息用于下一 model step，先压缩较旧上下文，如果 assembly 仍放不下则在下一次模型调用前 safe-fail。

## 4. 下一回合治理

- [x] 4.1 确保 Skill metadata 请求的 modelName/modelOptions 在后续 model step 之前通过模型选择治理；如果当前 Agent Core 只存储 patch，则在本 change 中补上缺失的治理调用。

## 5. 安全测试

- [x] 5.1 覆盖 Skill 不可用、路径式名称、Tool/Agent id 混淆、scope 不匹配、timeout 和原始内容脱敏。
- [x] 5.2 覆盖单一 tool_result 关联和同一调用内的目标 Skill 执行所有权。
- [x] 5.3 覆盖 `modelInvocable` 仅披露语义：Context Engine 向模型披露隐藏 `modelInvocable=false` 的 Skill，而 Skill Tool 可以加载一个可用的 Skill，即使目标 Skill 不可被模型调用。
- [x] 5.3a 覆盖 resolver 所有权：Skill Tool 目标解析使用 `CapabilityInvocationRuntimeContext.capabilityResolver`，不依赖模型可见的 `visibleCapabilities`。
- [x] 5.3b 覆盖方案 B 契约形态：runtime resolver request 使用扁平 `kind/capabilityId/providerId?` 字段且没有 `CapabilityRef`。
- [x] 5.3c 覆盖 resolver 范围收窄：Agent Core runtime resolver 忽略 request-local `allowedTools`，同时 Context Engine 保持 allowedTools 披露过滤。
- [x] 5.4 覆盖 inline 超限正文、二进制/控制字符内容、下一回合 assembly/render 时受保护的生成消息上下文预算处理、原始路径/source key 泄漏、固定的 `structuredPayload` 确认形态以及禁止使用 `resultRef`/`artifactRefs`。
- [x] 5.5 覆盖 tool metadata 和 patch 委托：`allowedTools` 映射到 `CapabilityContextPatch.allowedTools`，`deniedTools` 映射到 `CapabilityContextPatch.deniedTools`，而 `model` / `modelOptions` 由 Agent Core 保存并在后续由 Context Engine / 模型选择治理校验，而不是由 Skill tool 校验。
- [x] 5.6 覆盖 `Skill` Tool 实现内部对 `context=fork` 的安全不支持处理，并断言单一结果 wrapper 语义。
- [x] 5.7 覆盖稳定的 `<skill_content name="...">` 生成消息 envelope、属性转义、wrapper 边界检查以及 abort/中断/恢复时的 provider tool_result 结算。
- [x] 5.8 覆盖常规结果正文：inline `loaded` 无结果 payload、不暴露 mode/context，以及禁止原始正文/路径泄漏。
- [x] 5.9 覆盖 `SkillDocumentService` 与 source/discovery 协作：discovery metadata 视图不暴露完整正文；调用时 source 加载只在授权后返回 canonical 正文；Skill tool 使用已注册的 source/discovery 而不是第二个 parser；descriptor/正文 source 身份不匹配时 safe-fail；原始路径/加载 key/内容权威不泄漏。
- [x] 5.10 覆盖 args 校验：非 object args、超限序列化 args、超深 args、非 JSON 值和治理字段被安全拒绝。
- [x] 5.11 覆盖 observability 脱敏：日志只包含 tool id、safe reason code、时长和目标安全 id。
- [x] 5.12 覆盖 Context Engine 披露渲染：`TOOL` 与 `SKILL` 划分、英文固定标题、精确 Skill 名称条目、`Skill` tool 被过滤掉时省略段落，以及无路径/文件/base 目录泄漏。
- [x] 5.12a 覆盖 catalog 自有的 `modelInvocable` 过滤：Context Engine 传入 `modelInvocable=true`，catalog 过滤并把该条件转发给 discovery。
- [x] 5.12b 覆盖 allowedTools 激活：`allowedTools` 列出的隐藏可用 TOOL descriptor 变为模型可见，非法 ref 在 Context Engine 失败，Agent Core 不校验或拆分 patch。
- [x] 5.12c 覆盖 deniedTools 最终排除：基线和 allowed 的 TOOL descriptor 在被拒绝时移除，缺失的 denied ref 被忽略，拒绝 `Skill` wrapper 时该步省略 Skill 披露。

## 6. 验证

- [x] 6.1 运行 `npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`openspec validate add-ts-skill-tool --strict`。
- [x] 6.2 针对catalog 自有的模型可见性变更，运行目标 catalog/context 测试和 OpenSpec 校验。
- [x] 6.3 针对 resolver 范围收窄，运行目标 resolver/context 测试和标准校验。
- [x] 6.4 运行目标 allowedTools 激活测试和标准校验。
- [x] 6.5 运行目标 deniedTools 最终排除测试和标准校验。
