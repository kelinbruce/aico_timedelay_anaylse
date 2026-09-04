## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-2.4 查看请求状态` | Capability 过程标题可显示受限技术目标名称，同时不扩大结果披露边界 | `ts-run-status-visibility` | `FN-2.4 查看请求状态` |

## `FN-2.4 查看请求状态`

### 目标与规范依据

本设计闭合 proposal 中“让业务开发调测者识别实际执行对象，同时保持现有结果安全上限”的目标。名称只用于过程标题身份，不改变 Capability 结果级别、状态、折叠或最终答案。

#### 本 Function 的目标 Requirements

canonical spec：`ts-run-status-visibility`

- `ADDED`：`Capability 生命周期可显示受限技术目标名称`
- `ADDED`：`技术目标名称不得扩大结果披露边界`

### 当前实现

- `agent-channel-common` 的 `stream-envelope` projector 已在 `CAPABILITY_STARTED` 上通过已解析 `ASSISTANT_TOOL_USE` Message 校验 `messageId`、session、request、run、`toolCallId`、`capabilityId` 和 `metadata.toolCallIds`，关联失败时输出 `contentUnavailable`，不会投影模型工具参数。当前 `readReferencedToolCall` 使用首个匹配项，未拒绝同一 Message 内重复的 `(toolCallId, toolName)`，因此尚不能证明关联唯一。
- 上述 projector 当前只把 `capabilityId`、`toolCallId` 和状态等闭集字段放入公共 Web payload，没有从已关联的工具调用形成可见目标名称。
- Agent Web 的 `processDetails` 以 `toolCallId` 聚合同一 Capability 的启动、结果和完成事件，并保留前序条目的详情和状态；标题目前只使用 wrapper `capabilityId`。后续完成事件携带 `Agent`、`Skill` 或 `ApiCall` 时，会继续显示 wrapper 名称。
- Capability 成功结果由后端三档展示策略与平台安全 projector 决定。没有安全 projector 的 Capability 即使配置为 `DETAIL` 仍降级为 `STATUS_ONLY`；`Bash` 和 `Read` 已有独立的有界安全详情 projector。
- run-event history 复用同一 Web stream projector；Agent Web 三种宿主复用同一过程详情模块，不需要新的历史接口或宿主专用状态。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| `Skill`、`Agent`、普通 Tool 生命周期下的 `ApiCall` 显示合法技术目标名称 | 后端可关联对应模型工具调用，但当前只取首个匹配项，且公共 payload 只输出 wrapper 身份 | 缺少“恰好一个匹配”的关联门禁，以及三个白名单字段的最小安全提取和公共投影 |
| 同一调用完成后和 history 中继续显示名称 | 前端按 `toolCallId` 聚合事件，但完成事件的 wrapper 名称会覆盖前序显示值 | 缺少按同一调用保留已验证目标名称的聚合规则 |
| 名称不得开放其他参数或提高结果披露级别 | 现有结果 projector 已隔离结果级别，但没有目标名称投影 | 新字段必须从完整关联后的单一白名单标量形成，并与结果 projector 完全解耦 |
| 旧事件与非法名称安全降级 | 旧事件没有目标名称 | 前后端需要把字段视为 optional，并在缺失或非法时继续显示现有 wrapper 标题 |

### 修改方案

唯一实现路径如下：

1. `agent-channel-common` 收紧现有 `readReferencedToolCall`：同一已解析 Message 内只有恰好一个工具调用同时匹配 `toolCallId`、`toolName` 且 `arguments` 为对象时才返回；零个或多个匹配均执行既有 `contentUnavailable` 路径。在 `CAPABILITY_STARTED` 唯一关联成功后，把该函数返回的工具调用交给一个纯安全投影 helper。
2. helper 同时使用已经匹配的 `toolName` 与 `arguments`，只允许以下映射：

   | wrapper `toolName` | 唯一参数字段 | 输出 |
   |---|---|---|
   | `Skill` | `name` | `capabilityTargetName` |
   | `Agent` | `agentId` | `capabilityTargetName` |
   | `ApiCall` | `apiName` | `capabilityTargetName` |
   | 其他值 | 无 | 省略字段 |

3. helper 对候选值 trim 后执行 canonical spec 定义的闭合格式校验。值缺失、不是 string 或校验失败时只返回 `undefined`。不得读取或复制其他 `arguments` 字段，也不得从 Capability Result Message、结果正文或 metadata 恢复名称。
4. `capabilityTargetName` 只加到已经通过关联门禁的 `CAPABILITY_STARTED` 公共 payload。`CAPABILITY_COMPLETED` 和结果事件不增加新的 Message 查询或重复名称字段，避免改变持久化和历史容量模型。
5. Agent Web 增加同格式的防御性 reader。聚合某个 `toolCallId` 时，合法的新名称与 wrapper 组合成 `<wrapper> · <target>`；后续事件未携带名称时优先保留条目已有标题，只有不存在已有标题时才回退到当前 wrapper。非法字段按缺失处理。
6. legacy 单事件描述与主聚合路径复用同一标题形成 helper，防止不同页面或回放路径形成平行语义。`displayToolName` 的既有 `Skill` → `SKILL` 显示规则继续生效。

本 change 不修改 Runtime event、Message schema、Gateway port、数据库、Capability 结果策略配置、生产默认值、折叠状态和 PIU/结构化结果路径。`Bash`、`Read` 的 `DETAIL` 仍由已有安全 projector 生成；本 change 不显示 Bash 命令或 Read 原始路径以外的新信息。

该方案选择在后端投影受限名称，而不是把全部工具参数发送给浏览器后再筛选：后端拥有 Message 关联事实和安全边界，浏览器只消费公共 DTO。选择只在启动事件携带名称并由前端按 `toolCallId` 保留，而不是在每个事件复制，是为了避免冗余 payload 和持久化改动。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 安全 | `技术目标名称不得扩大结果披露边界` | 后端完整关联门禁、wrapper/字段白名单和闭合字符格式；前端再次防御校验 | 非白名单参数、非法名称、普通 Tool 伪造同名参数均不可见；结果级别不变 |
| 可靠性/恢复 | `Capability 生命周期可显示受限技术目标名称` | optional 字段与 wrapper 降级；同一 `toolCallId` 本地保留名称 | completion-only、旧 history 和非法字段不影响过程步骤与最终答案 |
| 可维护性 | 无新增黑盒质量目标 | 单一映射表语义和共享标题 helper；不建立第二套结果 projector | 后端映射、前端 reader 和标题聚合语义一致 |
| 可测试性 | 无新增黑盒质量目标 | 纯投影 helper 行为通过公共 payload 与过程条目验证 | 后端 contract 测试和前端 projection 测试同时覆盖正向与负向路径 |

## 验证策略（Verification Strategy）

- 后端 unit/contract 层验证 `CAPABILITY_STARTED` 的公共 payload：三个白名单 wrapper 正确投影，其他参数和非法值不出现，关联失败保持既有不可用投影。
- 前端 unit 层通过公开过程条目验证启动到完成的名称保留、wrapper 降级和同一标题格式；测试断言可观察标题和状态，不锁定私有 Map 或 helper 形状。
- characterization 验证现有 `STATUS_ONLY`、`SUMMARY`、`DETAIL` 结果 projector 行为以及 `Bash`、`Read` 安全详情不因名称字段改变。
- build 和 OpenSpec strict validation 覆盖 TypeScript 契约兼容与规范结构；人工审查确认没有 Gateway、Runtime persistence、Message schema、生产默认配置或三宿主分叉。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/ts-run-status-visibility/spec.md`：归档时合并两个新增 Requirements。
- `openspec/designs/functions/D2-请求运行时/D2.2-请求状态与处理/FN-2.4-查看请求状态.md`：补充受限技术目标名称输入、处理与降级摘要。
- `openspec/designs/features/D2-请求运行时/D2.2-请求状态与处理/F-2.4-查看请求状态.md`：补充开发调测者识别实际执行对象的用户价值摘要。
- `openspec/overview.md`：无。
- `openspec/designs/architecture/stream-projection.md`：补充技术目标名称由后端可信关联后投影的边界。
- `openspec/designs/modules/agent-channel-web.md`：补充安全名称 projector 职责。
- `openspec/designs/modules/agent-web.md`：补充按 `toolCallId` 保留目标名称的消费规则。
- `openspec/designs/adr/`：无；本次不引入需要独立保留的架构取舍。
- `openspec/designs/spec-to-design-map.md`：更新 `ts-run-status-visibility` 的设计摘要与验证入口。

## 风险与取舍（Risks / Trade-offs）

- 技术标识可能不够面向最终业务用户，但本 change 明确服务开发调测且不替代后续本地化公开身份 change；标题保留 wrapper 类型可以避免把技术 id 误解为业务名称。
- 只在启动事件投影名称意味着 completion-only 历史无法恢复名称；该路径按 wrapper 安全降级，避免为边缘路径增加结果反推或网络请求。
- 闭合字符集会拒绝包含空格、中文或路径分隔符的名称；这是有意的最小安全边界，后续公开身份 change 应通过受治理配置提供本地化名称，而不是放宽此技术字段。

## 待确认问题（Open Questions）

无。
