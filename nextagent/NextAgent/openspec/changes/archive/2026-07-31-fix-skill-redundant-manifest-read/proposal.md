## Why

Agent 开发者调用 inline Skill 后，系统已经向下一模型步骤提供该 Skill 的正文，但同一加载结果又可能把 `SKILL.md` 作为可枚举资源暴露，并给出无条件枚举资源目录的提示。模型因此可能在正文已加载后继续调用 `Glob` 和 `Read` 读取同一 `SKILL.md`，产生额外模型轮次、工具调用和延迟；同时，正文若进入可见 tool result，会偏离调用方可依赖的固定安全确认边界。

该问题可以在只包含一个 `SKILL.md` 的最小 Skill 上稳定观察，因此需要收敛 Skill 正文加载与附属资源访问的黑盒边界，使模型能够区分“已经加载的正文”和“正文明确引用的附属资源”。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- inline Skill 成功后，可见 tool result 保持为固定安全确认，Skill 正文只作为 request-local hidden context 进入下一模型步骤。
- 模型调用 Skill 后，hidden Skill 正文必须紧邻对应 Skill tool result，并在后续模型步骤中保持该相对位置，不得作为 request-level 尾部消息移动到后续工具结果之后。
- `SKILL.md` 只作为 Skill 正文的权威加载来源，不再作为模型可枚举或可读取的投影资源。
- 只有 Skill 存在可访问附属资源时，模型才获得资源根位置；资源提示只允许模型按已加载正文中的明确引用访问附属资源，不诱导目录枚举。
- 没有附属资源的 Skill 不产生可供模型继续探索的 Skill 资源根提示。

**非目标：**

- 不改变 Skill manifest、Skill discovery、SkillHub 安装、Skill identity 或 capability governance。
- 不改变 `Read`、`Glob`、Bash 或 Python 的通用输入和授权语义，也不在文件工具中维护 Skill 加载状态。
- 不修改公开 `agent-contracts`、Web API、配置或持久化契约。
- 不保证模型永远不会自行请求无关文件；本 change 只移除系统主动暴露的重复正文读取路径和诱导提示。

## What Changes

- 修改 inline Skill 加载结果：Skill 正文不得进入可见 tool result，下一模型步骤必须通过同一调用结果的 hidden context 获得正文。
- 修改 hidden Skill 正文的模型输入顺序：存在对应 Skill tool result 时，正文紧随该结果并保持稳定锚定；不存在模型调用产生的对应结果时，继续作为当前 request-local 输入的尾部上下文。
- 修改 Skill 加载提示：正文已经加载的事实必须明确；系统不得无条件提示模型枚举 Skill 资源目录。
- 修改 Skill 资源暴露边界：`SKILL.md` 不属于模型可读投影资源；只有实际存在的附属资源可以形成模型可见资源根。
- 保持已有 Skill 资源路径授权、只读、scope 隔离、失败和清理行为不变。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-5.9 调用技能` → `specs/skill-tool/spec.md`
  - 功能边界：inline Skill 的可见确认、hidden 正文注入和模型资源使用提示收敛为单一结果边界。
  - 系统质量属性：无新增黑盒质量目标。
  - 映射说明：canonical spec。
- `FN-5.10 访问技能资源` → `specs/skill-resource-access/spec.md`
  - 功能边界：模型可读 Skill 投影只包含附属资源，不包含已经作为正文加载源的 `SKILL.md`；无附属资源时不披露资源根。
  - 系统质量属性：无新增黑盒质量目标。
  - 映射说明：canonical spec。

## 影响范围（Impact）

- Agent 用户可观察到更少的重复工具步骤和更短的无效加载链路。
- Skill 作者继续通过正文引用 `scripts/`、`references/`、`assets/` 或 `api/` 中的附属资源，不需要修改 manifest。
- Skill tool、Skill resource projection 和相关 contract/product tests 需要调整。
- 已经持有附属资源逻辑路径的合法文件工具与 sandbox 调用不受影响。
