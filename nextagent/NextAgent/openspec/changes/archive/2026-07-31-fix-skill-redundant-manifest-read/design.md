## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-5.9 调用技能` | 恢复固定可见确认与唯一 hidden 正文注入，把正文稳定放在对应 Skill tool result 之后，并按实际附属资源生成非枚举式提示 | `skill-tool` | `FN-5.9 调用技能` |
| `FN-5.10 访问技能资源` | 从模型可读 projection 中排除 `SKILL.md`，仅投影附属资源 | `skill-resource-access` | `FN-5.10 访问技能资源` |

## `FN-5.9 调用技能`

### 目标与规范依据

inline Skill 成功后，模型应直接使用已经加载的 canonical 正文；可见 tool result 只确认加载状态。模型调用 Skill 时，正文应稳定紧随对应 Skill tool result，而不是在每个后续模型步骤中重新置于全部消息末尾。只有正文实际附带可读资源时，系统才披露资源根，并明确该根只服务正文中的显式资源引用。

#### 本 Function 的目标 Requirements

canonical spec：`skill-tool`

- `ADDED`：`Inline Skill 正文必须保持单一隐藏注入`

### 当前实现

`agent-capability` 的 builtin `Skill` Tool 已通过现有 source/discovery 路径加载 canonical body，返回固定 `structuredPayload` 和一条 `<skill_content>` generated message，并且只投影合规附属资源。Agent Core 把 generated message 保存在 request-local state，不写入 session message。

`agent-context-engine` 当前先渲染全部 `selectedMessages`，再把全部 `capabilityGeneratedMessages` 作为 USER messages 统一追加到模型输入尾部。request-local state 在同一 request 的后续轮次保持，因此 Skill 正文会在每次模型调用时移动到最新消息之后；当 Skill 后续又执行 `Read` 时，正文从 Skill result 邻域移动到 Read result 之后。

现有 Skill Tool 和 Agent Core tests 已覆盖正文只存在于 generated message、可见 result 不含正文、projection 不含 `SKILL.md`，但没有覆盖多轮模型输入中的相对位置。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 可见结果精确为 `{ name, status: "loaded" }` | `structuredPayload` 额外包含 `body` | Skill 正文进入可见 tool result |
| canonical 正文通过恰好一条 hidden generated message 注入 | Skill Tool 已返回单条 generated message | 已闭合 |
| 无附属资源时不披露资源根 | Skill Tool 已按 `projectedCount` 生成 notice | 已闭合 |
| 有附属资源时只按正文显式引用访问 | Skill Tool 已移除枚举提示 | 已闭合 |
| 模型调用 Skill 后正文稳定紧随对应 result | Context Engine 把 request-local generated messages 统一追加到全部 selected messages 之后 | 后续工具轮次改变正文相对位置和注意力顺序 |

### 修改方案

Skill 正文构造 owner 保持为 `agent-capability`。Skill Tool 在资源投影完成后使用 `projectedCount` 作为唯一分支事实：

- `projectedCount === 0`：构造只含 canonical body 的 `<skill_content>` envelope，不添加 resource root 或资源工具提示。
- `projectedCount > 0`：在 canonical body 前添加 resource root 和一条受限提示，明确正文已经加载，只访问正文明确引用的附属资源，不枚举目录、不读取 `SKILL.md`。

Skill Tool 返回 `structuredPayload: { name, status: "loaded" }` 和恰好一条 `{ role: "USER", meta: true, content: skillBody }` generated message。Agent Core 和 capability result projection 继续使用现有通用路径，不修改 public contract。

消息位置 owner 为 `agent-context-engine`。`DefaultModelInputRenderer` 在完成 selected message 的 Tool pairing 校验后执行一次 Skill generated message 定位：

1. 从 `<skill_content name="...">` envelope 取得受治理 Skill name。
2. 在已渲染的 selected messages 中查找 `toolName: "Skill"` 且安全输出 `{ name: ... }` 匹配的最近一个 tool result，并把其后连续的同 batch tool results 纳入锚点边界。
3. 找到时，把该 generated USER message 插入完整 tool-result batch 之后；未找到时保留现有尾部追加语义，用于模型 loop 前定向加载等没有模型 tool result 的路径。
4. 非 Skill generated messages 保持既有尾部追加语义。

该定位每次都基于当前 selected messages 重建，不持久化 Skill 正文，也不修改 `CapabilityGeneratedMessage`、`ContextAssemblyRequest` 或其他 public `agent-contracts`。同名 Skill 在一个 request 内重复加载时，以最近一个匹配的 Skill tool result 为稳定锚点。

删除 `Glob` Tool 描述和 `path` schema 中通用的 Skill 专用搜索示例。附属资源存在时，resource root 与受限访问说明只由该次 Skill 加载产生的 hidden message 披露；`Glob` 不维护 Skill 状态，也不改变输入、授权或执行逻辑。

失败路径保持不变：body 校验、projection、取消或授权失败仍返回现有 safe failed result，且不得生成部分 hidden Skill message。

#### 质量属性影响

无新增黑盒质量目标。实现通过移除重复正文载荷和无条件枚举提示减少无效模型步骤，并通过现有 unit/contract tests 固定可见与隐藏边界。

## `FN-5.10 访问技能资源`

### 目标与规范依据

`SKILL.md` 是 Skill 正文的权威加载源，不是附属资源。模型可读 projection 只承载正文可能引用的受治理附属资源；没有附属资源时仍可以成功加载正文，但不向模型披露可探索的资源根。

#### 本 Function 的目标 Requirements

canonical spec：`skill-resource-access`

- `ADDED`：`SKILL.md 必须保持为内部正文来源`

### 当前实现

Skill source discovery 的资源 contract 已把允许的附属资源根限制为 `scripts`、`references`、`assets` 和 `api`。但是 Skill Tool 的 `prepareSkillResourcesForProjection(...)` 会额外把 `loaded.value.documentSource` 编码为一个 `relativePath: "SKILL.md"` 的 synthetic resource，插入 provider 返回的资源列表，并由 projection service 写入模型已授权 subtree。

`WorkspaceFilePort.projectSkillResources(...)` 已经负责 resource count、路径安全、只读 projection、marker、刷新、scope authorization 和失败清理。它不需要理解 `SKILL.md` 的正文语义，只消费 Skill Tool 提供的资源列表。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| `SKILL.md` 只作为内部正文来源 | Skill Tool 把 document source 转换成 synthetic projected resource | 同一正文同时通过加载结果和文件 projection 暴露 |
| projection 只包含允许的附属资源 | Skill Tool 在 source resource contract 之外插入根级 `SKILL.md` | projection 内容超过附属资源边界 |
| 只有附属资源时才披露 resource root | synthetic `SKILL.md` 令 `projectedCount` 至少为一 | 没有附属资源的 Skill 无法被识别为零资源 |

### 修改方案

`prepareSkillResourcesForProjection(...)` 不再接收或转换 `documentSource`，只把当前 source 的 `listSkillResources(...)` 和 `readSkillResource(...)` 适配给 `WorkspaceFilePort`。允许资源根和内容一致性继续由既有 `SkillSourceDiscovery` contract 与 projection service 校验。

projection service、marker shape、projection key、刷新策略、scope authority 和 physical layout 均不修改。零附属资源仍可走现有 projection commit 路径并返回 `projectedCount: 0`；该内部结果用于 Skill Tool 决定不向模型披露 root，不改变 projection 的清理或一致性语义。

现有明确依赖 `SKILL.md` 被投影的测试改为断言其不存在；包含 `scripts/` 或 `references/` 的测试继续验证对应资源可读。`Read`、`Glob` 和 sandbox 不增加“是否已加载 Skill”的状态或分支。

#### 质量属性影响

无新增黑盒质量目标。模型可读 projection 缩小到既有允许资源根，减少重复内容暴露，同时保留现有 scope、只读和完整性校验。

## 跨 Function 协作与端到端流程

`FN-5.9` 与 `FN-5.10` 共享一次 Skill 激活流程：Skill Tool 先通过 source 加载 canonical body，再由 `FN-5.10` 投影并计数附属资源，最后由 `FN-5.9` 根据该计数组装固定可见确认和唯一 hidden message。附属资源计数只决定提示是否包含 resource root，不改变 Skill 是否成功加载，也不改变资源授权。

## 验证策略（Verification Strategy）

- unit：覆盖 Skill Tool 的固定 `structuredPayload`、单条 generated message、零资源无 root、有资源受限 root 提示，以及 projection callback 不再列出 `SKILL.md`。
- contract/integration：覆盖 Agent Core 下一模型步骤只出现一次 `<skill_content>`，持久化 capability result 不包含正文；Context Engine 在 Skill 后继续执行 `Read` 时仍把正文放在 Skill result 与 Read tool-use 之间，并在并行 tool-use 时放在完整 result batch 之后；文件工具无法在 projection subtree 枚举或读取 `SKILL.md`，但仍能读取合法附属资源。
- negative case：断言提示中不存在目录枚举指令，零资源 Skill 不披露 resource root，非法资源和 projection failure 继续安全失败。
- architecture/build：确认没有修改 `agent-contracts`、没有新增跨 package private import，并通过受影响 workspace build 与 architecture gate。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/skill-tool/spec.md`：归档时加入 inline Skill 正文单一隐藏注入 Requirement。
- `openspec/specs/skill-resource-access/spec.md`：归档时加入 `SKILL.md` 内部正文来源 Requirement。
- `openspec/designs/functions/D5-Capability能力体系/D5.3-Skill与检索/FN-5.9-调用技能.md`：刷新输出、处理过程和结果摘要。
- `openspec/designs/functions/D5-Capability能力体系/D5.3-Skill与检索/FN-5.10-访问技能资源.md`：刷新描述、输出和结果摘要。
- Feature：无。
- `openspec/overview.md`：无。
- `openspec/designs/architecture/skill-invocation-and-disclosure.md`：刷新正文加载与附属资源披露边界。
- `openspec/designs/modules/agent-capability.md`：刷新 Skill Tool result 与 projection 输入职责。
- ADR：无。
- `openspec/designs/spec-to-design-map.md`：现有 spec 导航不变，无需新增条目。

## 风险与取舍（Risks / Trade-offs）

- 某些 Skill 正文可能隐式假设模型会先枚举整个目录。目标契约要求 Skill 作者显式引用所需附属资源；相关 Skill 应修正文，而不是保留全目录枚举提示。
- `SKILL.md` 从 projection subtree 移除后，已生成的旧 committed projection 可能仍包含该文件。现有每进程首次 activation refresh 会重建 projection；验证必须覆盖重建后旧文件被移除。
- 模型仍可能基于用户输入自行请求其他文件。本 change 不在通用文件工具中引入语义拦截，避免 Read/Glob 反向依赖 Skill 生命周期。
- Skill generated message 的位置由稳定 envelope name 与安全 Skill result name 关联，不引入新的 public correlation field；同名 Skill 重复加载时选择最近结果，避免旧正文被放回更早的调用位置。

## 待确认问题（Open Questions）

无。
