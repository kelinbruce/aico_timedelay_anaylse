# 隐藏无业务标题的 Workflow 节点生命周期

## Why

当 Workflow 内部的 `DELAY`、`CONDITION`、`RESTFUL` 等非 runtime Capability 节点没有配置业务说明时，Agent Web 会把用于关联和诊断的 `nodeId` 当作用户可见标题。节点执行期间用户会看到 `active_delay` 等技术标识；节点完成并产生结构化正文后，该生命周期条目又被正文投影替换，造成过程展示跳变。

当节点已经配置业务标题但 `show_content=false` 时，当前 projector 还会同时抑制 successful `CAPABILITY_COMPLETED`，使页面只能显示标题而无法显示实际完成状态。这与“标题控制步骤可见性、正文控制内容可见性”的职责分离不一致。

`nodeId` 是可信 Workflow lifecycle 的必要身份事实，但不是业务标题。需要在不删除生命周期事实、不改变 Workflow 执行和历史恢复契约的前提下，阻止浏览器把技术身份降级为业务文案，并让实时过程与重新打开后的历史过程保持相同的展示结果。

## 目标与非目标

### 目标

- 没有业务标题的非 runtime Capability Workflow 内部节点在开始、成功完成或跳过时，不形成独立的用户可见生命周期步骤。
- 同一节点产生正文时，正文继续作为当前 Workflow 层级的纯内容 occurrence 展示，不产生空标题、状态图标、完成对勾或第二层展开入口。
- 无业务标题且无正文的节点不论成功、失败或超时均不形成用户可见步骤；无业务标题但有正文的节点仅在非失败终态显示纯正文，失败或超时时不显示该 occurrence。
- 同一 occurrence 已产生业务标题时，无论成功、失败或超时均保留该标题及实际状态。
- 有业务标题但隐藏正文的节点成功完成时，仍投影不含正文的可信终态，使标题显示实际完成状态。
- active live、settled live 与 cold history 对同一组可信 Workflow lifecycle/product facts 形成一致的用户可见过程。

### 非目标

- 不改变 Workflow lifecycle/product Event 的公共字段、状态 vocabulary、持久化结构或正文安全边界。
- 不改变 `nodeId`、`nodeType`、`toolCallId`、`capabilityId`、`capabilityKind` 或 structured product 的公共契约。
- 不新增 `displayName` 配置、节点类型到业务标题的映射表或第二套业务命名机制；节点已有 `description` 仍是业务标题来源。
- 不改变 Tool、Skill、Agent runtime Capability，以及具有合法 `capabilityKind=WORKFLOW` 的 Workflow/Subflow lifecycle 的身份解析和业务标题降级规则。

## What Changes

- Agent Web 将可信 Workflow 内部非 runtime Capability lifecycle 的事实身份与用户可见标题分离。
- 无业务标题的该类节点在 started、successful completed 和 skipped 状态下不再产生独立生命周期条目；matching structured product 按既有 title/detail 层级呈现。
- 无业务标题的该类节点在 failed 或 timed-out 状态下不产生 lifecycle 条目；其 matching structured detail 同样不显示。
- 同一节点 occurrence 已产生非空 structured `TITLE` 或 `SUB_TITLE` 时，successful、failed 或 timed-out 状态合并到该业务标题，不生成第二个 lifecycle 条目。
- `WorkflowRuntimeEventProjector` 在 `show_title=true`、`show_content=false` 的节点成功完成时保留 body-free `CAPABILITY_COMPLETED`，但继续抑制 structured content，使浏览器能够显示标题的实际完成状态。
- Agent Web 的完整过程投影和聚合过程投影使用同一判断规则，实时与历史输入得到相同结果。
- 后端、Web channel、持久化和 stream envelope 保留既有可信 lifecycle/product facts 与安全校验。

## Function 影响（OpenSpec Capabilities）

| Function | canonical name | 对应 spec | 变化边界 | 系统质量属性 |
|---|---|---|---|---|
| `FN-2.4` | 查看请求状态 | `ts-run-status-visibility` | 修改 Workflow 节点 lifecycle 与 structured detail 的用户可见性；标题可见且正文隐藏时补齐 body-free successful terminal fact，不改变公共 shape | 安全：内部标识不作为业务文案泄露且隐藏正文不进入 lifecycle；可靠性/恢复：live 与 history 一致；可维护性：复用单一投影规则 |

## Feature 影响

- **修改 `F-2.4 查看请求状态`**：用户查看 Workflow 执行过程时不再看到无业务语义的技术节点名；无标题 occurrence 只在非失败且具有正文时显示，有业务标题的节点继续显示实际终态。

## 影响范围

- 最终用户：Workflow 过程只展示已配置业务标题及其实际状态，以及非失败无标题 occurrence 的产品正文。
- Agent 开发者：无需新增节点配置；已有 `description` 行为不变。
- 运维人员：标题可见且正文隐藏的成功节点新增既有 shape 的 body-free terminal Event；关联坐标和正文安全边界保持不变。
- 平台集成方：无公共 API、stream schema、配置或持久化迁移。
- 验证范围：Workflow runtime event projector、Agent Web 过程投影单元测试、前端 TypeScript/Vite build，以及 OpenSpec strict validation。
