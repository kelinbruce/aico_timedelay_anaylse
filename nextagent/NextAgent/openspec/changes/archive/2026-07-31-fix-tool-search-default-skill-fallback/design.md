# Design

## 设计范围

| Function | 目标变化 | delta spec | 设计章节 |
|---|---|---|---|
| `FN-5.14 搜索工具` | 将 ToolSearch 收敛为延迟能力的默认发现入口，并保持默认可见能力不变 | `tool-search-tool` | [FN-5.14 搜索工具](#fn-514-搜索工具) |

本 change 修改 `F-5.8 工具渐进式加载` 的默认发现边界，不新增 Function，不迁移 legacy Requirement，也不修改 `agent-contracts`。

## FN-5.14 搜索工具

### 目标与规范依据

ToolSearch 必须默认可用于发现当前 Agent/run 内受治理的延迟能力，只返回安全元数据，并在请求内激活命中候选。已经默认可见的 Tool 和 Skill 不得因 ToolSearch 启用而被隐藏或重复搜索。

本 Function 的目标 Requirements：

- canonical spec：`tool-search-tool`
- ADDED：`ToolSearch input supports keyword, natural, and bounded list queries`
- MODIFIED：`ToolSearch searches only governed visible tool metadata`
- MODIFIED：`ToolSearch disclosure preserves existing model Tool Calling`
- MODIFIED：`Skill descriptor disclosure can be ToolSearch-deferred by trusted app configuration`
- MODIFIED：`ToolSearch Projects Deferred CLIP Tool Results`

### 当前实现

- `agent-capability` 已有 ToolSearch schema、输入归一化、resolver 查询、排序、安全结果投影和 `CapabilityContextPatch` 生成路径。
- runtime resolver 已支持按 `modelInvocable` 和可选 `kind` 查询当前请求受治理的 descriptors。
- `agent-context-engine` 已有 ToolSearch bootstrap Tool、普通 model Tool、enabled Skill 和 request-local activated Tool 的统一披露路径。
- `agent-capability` 的 CLIP source 已将远端 CLIP API 转换为受治理 Tool descriptor，并由 CLIP source 保有 provider 私有执行事实。
- capability provider guard 会在 startup 后冻结 eager discovery descriptors，并在普通 resolve 中复用该快照。
- 当前 ToolSearch 要求非空 `query`，搜索 `modelInvocable=true` descriptors；ToolSearch 默认可见性依赖 disclosure mode。

### GAP 分析

- 默认未启用 ToolSearch 时，`modelInvocable=false` 候选没有稳定的模型发现入口。
- ToolSearch 搜索 `modelInvocable=true` descriptors 会重复已经默认披露的 Tool 和 Skill。
- 输入契约无法表达有界列表、自然语言任务意图和 metadata scalar filters。
- CLIP ToolSearch 模式下的 descriptor 仍可能保持 `modelInvocable=true`，无法进入统一延迟搜索池。
- startup guard 若对 deferred descriptor 直接返回冻结的轻量快照，搜索后的 explicit resolve 无法水合 concrete schema。
- Skill 加载门禁依赖 disclosure mode，而目标边界应直接由 descriptor 的 `modelInvocable` 和 `disclosurePolicy` 决定。

### 修改方案

唯一实施路径如下：

1. `agent-context-engine` 保留当前 Agent/run 已授权且可用的 ToolSearch bootstrap Tool，不再用 disclosure mode 删除它；普通 `modelInvocable=true` Tool 和 enabled Skill 继续走既有披露路径。
2. `agent-capability` 将 ToolSearch `query` 改为 optional，新增 optional `matchMode` 和 `filters`；省略、trim 后为空或等于 `*` 时执行有界候选列表查询。
3. ToolSearch 通过既有 runtime resolver 查询 `modelInvocable=false` descriptors，再过滤 `AVAILABLE`、非 `HIDDEN`、`TOOL|SKILL` 和 metadata scalar filters。
4. `keyword` 与首版 `natural` 使用同一安全 metadata 池和确定性词法排序；exact `capability_id` 是高优先级 keyword match，不新增第三种 mode。
5. ToolSearch 结果继续使用既有安全 shape。Tool ids 写入 request-local `allowedTools`，Skill ids 写入 request-local `discoveredSkills`，并由既有 tool loop 提交 patch。
6. 下一模型 step 通过既有 context assembly 看见 activated Tool schema；Skill 通过既有 `Skill(name=<capability_id>)` 加载。ToolSearch 不直接执行候选。
7. CLIP source 在 trusted disclosure mode 为 `tool-search` 时把 CLIP-backed Tool descriptor 标记为 `modelInvocable=false`，同时继续在 source 私有 registry 中保有执行事实。
8. provider guard 对普通 eager descriptor 继续复用冻结 startup snapshot；只有 explicit resolve 命中 `DEFERRED` descriptor 时才委托原 discovery 按需水合，失败时安全退回 startup descriptor。
9. no-match 返回既有安全空结果，不查询外部来源，也不回退到 `modelInvocable=true` descriptors。

明确不修改：runtime resolver public request shape、gateway、persistence、SkillHub、Agent Scope、Owner Scope、capability binding 和同 step 执行语义。

质量属性影响：无新增黑盒质量目标。安全信息最小化、结果上限和确定性排序是上述功能性 Requirements 的实现约束；验证重点是 hidden/unavailable/default-visible 候选不泄漏、CLIP 私有事实不进入结果、列表查询保持有界。

## 验证策略

- spec 行为：通过 ToolSearch、Skill、context rendering、config assembly 和 CLIP E2E 测试覆盖默认披露、查询模式、候选过滤、激活以及 no-match。
- design 边界：通过 resolver 调用断言和 CLIP result projection 测试确认复用既有 resolver/patch 路径且不暴露 provider 私有事实。
- negative cases：实际提交 hidden、unavailable、`modelInvocable=true`、非法 filter/mode/limit 和未 discovery Skill，断言安全拒绝或空结果。
- 仓库门禁：运行 build、unit、contract、architecture 和 OpenSpec strict validation。

## 长期基线刷新计划

- stable spec：归并到 `openspec/specs/tool-search-tool/spec.md`。
- Function：刷新 `FN-5.14 搜索工具` 的输入、处理过程、输出和结果；`FN-5.15 渐进式激活工具` 行为不变。
- Feature：刷新 `F-5.8 工具渐进式加载` 的默认发现边界。
- overview：补充 ToolSearch 默认发现延迟能力的稳定事实。
- architecture：刷新 `capability-spi` 中默认披露与 request-local activation 导航。
- modules：刷新 `agent-capability`、`agent-context-engine` 和 `agent-app` 的相关职责导航。
- ADR：无。
- spec-to-design-map：刷新 `tool-search-tool` 的验证入口与长期设计导航。
