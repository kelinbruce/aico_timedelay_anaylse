## 背景与问题（Why）

`Skill` tool 是模型按需执行 governed Skill 的统一模型侧入口。目标态是：模型只需发起一次 `Skill` tool call，系统就在现有 capability 调用链路内完成目标 Skill 解析、inline 指令装载和单次 tool_result 闭环。为此，当前 change 需要把模型侧 `name` 签名、name 到 governed Skill descriptor 的解析、模式分流、inline body 加载、hidden context 注入、正常结果、scope 和审计边界定义清楚。

## 变更范围（What Changes）

- 新增 `Skill` tool descriptor、input/output schema 和 single tool_result safe result 语义。
- 外层 `Skill` wrapper tool 作为 `kind=TOOL` 的 builtin capability 接入既有 `builtin-tools` provider、`BuiltinToolCatalog` 和 `BuiltinToolsExecutor` 路径，沿用现有 capability registration / invocation 主路径完成模型侧调用。
- 定义模型侧 Skill tool 签名为 `{ name, args? }`：`name` 是 governed Skill capability id / manifest name，`args` 是目标 Skill 任务数据；`Skill` Tool 实现内部通过 `CapabilityInvocationRuntimeContext.capabilityResolver` 把 name 解析到 governed Skill id/descriptor，并由 ToolExecutor/runtime policy 统一治理 timeout。
- 定义 `Skill` Tool 实现是首版 Skill 执行入口：它解析模型可见 `name`、校验当前 agent/owner scope、读取受治理 Skill metadata，并在同一次 invocation 内完成 `context=inline` 的 canonical body 加载、hidden context 注入和 safe acknowledgement 返回。`context=fork` 在本 change 中返回安全 unsupported 结果以保持一致的单次 tool_result 契约。
- 定义 Skill 文档规范实现的单一 owner：`agent-capability` 内部 `SkillDocumentService` 统一负责 `SKILL.md` frontmatter/metadata 解析、descriptor/SkillMetadata 生成、安全诊断和 canonical body 生成。
- 定义 Skill source loading 边界：builtin、system-local、agent-owned-local 三类 Skill discovery/source 负责定位 `SKILL.md`、保存 provider-private loading facts，并通过统一的实现内 `SkillSourceDiscovery` 能力面在调用期加载 canonical body；`Skill` Tool 实现通过 catalog 的实现内 discovery 查询入口找到对应 source，消费 canonical body view。
- 定义模型可见 Skill 清单与 inline 注入边界：context assembly / capability disclosure 按 request-scope catalog view 和 `modelInvocable` 向模型披露 governed Skill name 和 safe description，并使用固定英文段落 `### Available skills` / `### How to use skills` 指导模型选择 `Skill({ name, args? })`；inline 成功时，模型可见结果是固定 safe acknowledgement，实际 Skill body 以 hidden generated message 进入下一轮上下文。
- 定义执行期 resolver contract：`RuntimeCapabilityResolveRequest`、`RuntimeCapabilityResolver`、`CapabilityInvocationRuntimeContext`，其中 resolve request 使用平铺字段 `kind`、`capabilityId`、`providerId?`。
- 将 `SkillMetadata.allowedTools` / `deniedTools` 映射到 `CapabilityContextPatch`，用于 Skill 激活后的 request-local capability disclosure patch；`allowedTools` 激活默认不可见但可用的 Tool，`deniedTools` 由 Context Engine 在最终模型可见 Tool 集合上做最后排除。

## Capability 影响（Capabilities）

### 新增 Capability

- `skill-tool`：模型通过 Tool 入口请求执行已治理 Skill，并获得原始 tool_use 对应的唯一 safe tool_result。

## 影响范围（Impact）

- `agent-capability`：把 `Skill` wrapper tool 作为 builtin `TOOL` 接入既有 builtin tool 执行路径；实现 wrapper Tool behavior、target Skill resolution、inline execution、`SkillDocumentService`、实现内 `SkillSourceDiscovery`、catalog 内部 discovery 查询入口和 safe result mapping。
- `agent-core`：保持通用 capability orchestration；只 resolve 模型实际调用的 `Skill` tool 并通过 `CapabilityInvocationPort` 调用该 Tool 实现，随后把同一次 execution 返回的 `CapabilityInvocationResult` 投影为原始 tool_use 的唯一 tool_result，并保存 request-local generated messages 供下一轮 context assembly 使用。
- `agent-context-engine`：负责每次模型 step 的 governed Skill disclosure render，并在下一轮 context assembly / render 时对 request-local generated messages 执行窗口检查、历史压缩和 protected active Skill message 保留；若仍无法组装模型输入，则在下一次 model invoke 前 safe-fail。
- `agent-app`：composition 中启用 Skill tool 与 Skill capability binding。

## 主要 Owner

- Owner 9 Tool Capability

## 协作 Owner

- Owner 4 Context：拥有可见 Skill 清单的 prompt/disclosure render，以及下一轮 context budget / compression / protected Skill message 保留。
- Owner 3 Agent Core：拥有通用 tool loop orchestration 和 request-local generated message 保存时机。

## 非目标（Non-Goals）

- 不定义 Skill manifest 格式，由 `add-ts-skill-manifest-contract` 承载。
- 不定义 builtin Skill source，由 `add-ts-builtin-skill-source` 承载。
- 不在本 change 内实现 fork child run、isolated context、结果映射和取消级联；这些由 `add-ts-fork-skill-execution` 承接。当前 change 对 `context=fork` 只定义安全拒绝结果。
- 不要求模型理解或选择 `inline` / `fork` 模式；模式只来自受治理 Skill metadata。
- 不定义 Skill resource access；Skill resource refs、资源列表、资源读取边界和 raw path 禁止规则由后续 change 承接。当前 Skill tool 不把 raw source location 放入模型上下文。
- 不新增 `CapabilityRef` 或复用 catalog `CapabilityResolveRequest` 作为 runtime resolver request；runtime resolver request 使用平铺字段。
- 不实现 nested invocation、progressive disclosure 或 Skill installation。
- 不重新定义 Skill source governance 或 provider-private loading fact 存储；本 change 只把现有 builtin、system-local、agent-owned-local source 的 `SKILL.md` 规范实现收敛到 `SkillDocumentService`，并定义 Skill tool 如何通过 source/discovery 边界消费 canonical body view。
- 不允许 `name` 被解释为 path、Tool id、Agent id、raw Skill id 或 provider-private ref。
- 不允许模型输入控制 timeout、执行模式、child budget 或 provider override。
- 不支持后台 accepted/pending Skill invocation；若未来需要，必须另开 change 定义 pending state、resume/wakeup 和最终结果投递机制。
