# Safe Capability Technical Name Design

## Goal

为业务开发调测提供一个最小、稳定的 Capability 执行身份：当 `Skill`、`Agent` 或兼容的 `ApiCall` 没有安全结果投影时，过程卡片仍能显示本次实际调用的技术名称，同时继续隐藏原始参数、结果正文、路径和内部诊断。

开发环境可以通过现有 `capability-result-presentation` 配置将 `Bash`、`Read` 调整为 `DETAIL`，查看平台已经支持的有界安全详情；本次修改不提高任何 Capability 的平台安全上限。

## Current State

- `agent-channel-common` 已通过 `messageId + sessionId + requestId + runId + toolCallId + capabilityId` 校验 `CAPABILITY_STARTED` 对应的 `ASSISTANT_TOOL_USE` Message。
- 校验后的 Tool Call 包含结构化 `arguments`，但 channel 当前只用它证明事件关联有效，没有投影 wrapper 的目标名称。
- Agent Web 标题最终回退到 `capabilityId`。因此普通扩展 Tool 能看到自己的 `capabilityId`，但 `Skill`、`Agent` 只显示 wrapper 名称，无法知道实际目标。
- `Bash`、`Read` 已有安全结果 projector。配置为 `DETAIL` 时，Bash 可显示 exit code 与有界 stdout/stderr 预览，Read 可显示安全化路径、读取范围与有界内容预览。
- 没有安全结果 projector 的 Capability 即使配置为 `DETAIL`，平台安全上限仍为 `STATUS_ONLY`。

## Considered Approaches

### A. 从已校验的 Tool Call 投影白名单技术名称（采用）

从 channel 已关联成功的 `ASSISTANT_TOOL_USE` Tool Call 中只读取 wrapper 对应的一个白名单字段：

- `Skill` -> `arguments.name`
- `Agent` -> `arguments.agentId`
- `ApiCall` -> `arguments.apiName`

该值经统一的技术标识格式校验后，以可选 `capabilityTargetName` 放入公共 stream payload。前端仅把它拼入已有卡片标题。

优点：复用现有持久化 Message 和关联校验；live/history 同源；不新增 Gateway、表、Record 或结果 projector；修改范围最小。缺点：显示的是技术标识，不提供中英文业务名称。

### B. 从 Capability 结果正文恢复名称（不采用）

从 Skill、Agent 或 ApiCall 的结构化结果中读取 `name`、`agentId` 或 `apiName`。

代码看似更少，但会把公共身份重新耦合到结果披露，并允许不可信结果影响卡片身份；失败或无结果路径也无法稳定显示，因此不采用。

### C. 实现完整本地化公共身份体系（延期）

在执行边界解析业务动作、受治理 display name 和 locale，并把冻结身份写入 lifecycle event。

这是面向最终用户的长期方案，但会涉及配置、Agent/Skill catalog、core lifecycle、channel 和前端，不符合本次“开发调测底线”的最小修改目标。

## Selected Design

### Backend projection

`agent-channel-common` 在投影 `CAPABILITY_STARTED` 时，先沿用现有逻辑解析并验证关联的 Tool Call，再调用一个小型纯函数提取目标名称：

1. 只有 `Skill`、`Agent`、`ApiCall` 进入目标字段映射；其他 Capability 不读取 arguments。
2. 目标字段必须是字符串，trim 后匹配 `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`。
3. 不匹配该格式的 Unicode 文本、空白、路径分隔符、控制字符、换行或回车均不得投影。
4. 校验成功时增加 `capabilityTargetName`；失败或缺失时省略字段，事件继续正常投影。
5. 不复制完整 `arguments`，不读取结果正文，也不把名称放入 `safeResult`。

`CAPABILITY_COMPLETED` 不重新从结果推导名称。Agent Web 已按 `toolCallId` 聚合同一次 started/result/completed；刷新 history 时持久化的 started 事件仍通过相同 Message 关联恢复名称。合法的 completion-only 旧路径继续只显示 wrapper 名称，这是本次最小方案的明确降级边界。

`ApiCall` 只有在走普通 Tool lifecycle 且存在关联的 `ASSISTANT_TOOL_USE` 时才显示 `apiName`。当前不产生普通 Capability 卡片的直接 ApiCall 路径不新增卡片。

### Frontend rendering

Agent Web 在现有标题生成位置读取 `capabilityTargetName`：

- 有合法目标名：`Skill · network-diagnostics · 执行中`、`Agent · network-explorer · 已完成`。
- 无目标名：保持当前 `SKILL · 执行中`、`Agent · 已完成` 等降级显示。
- 普通扩展 Tool：继续显示既有 `capabilityId`，不引入新的名称来源。

三种宿主复用同一个 `processDetails.ts` 投影，不增加宿主分支，不改变卡片顺序、折叠、图标、状态或结果正文。

### Development DETAIL configuration

`Bash`、`Read` 的平台安全 projector 和配置能力已经存在，本次不修改内置默认级别。开发验证环境在自己的 `application.yaml` 中显式覆盖：

```yaml
nextAgent:
  system:
    capability-result-presentation:
      rules:
        - capability-id: Bash
          level: DETAIL
        - capability-id: Read
          level: DETAIL
```

修改配置后必须重启服务。可见内容仍受平台安全上限约束：

- Bash：exit code、最多 4000 字符的 stdout/stderr 安全预览及截断标记，不新增原始命令参数。
- Read：安全化显示路径、读取范围、最多 4000 字符的内容预览及截断标记。
- 失败结果仍使用统一安全失败投影；`DETAIL` 不开放原始异常。
- 无安全 projector 的 Tool 仍为 `STATUS_ONLY`，本次名称投影不改变这一点。

## Security and Ownership

- `agent-channel-common` 继续拥有 Web 安全投影；frontend 不解析 Message 或原始 Tool arguments。
- 名称来自已持久化、已通过完整关联校验的 `ASSISTANT_TOOL_USE` Message，不来自浏览器、结果正文或未关联 event payload。
- allowlist 同时约束 Capability 类型与字段名；不得增加通用“从任意参数猜名称”的逻辑。
- `capabilityTargetName` 只是公开技术身份，不授权查看结果，也不影响 `STATUS_ONLY`、`SUMMARY`、`DETAIL` 的有效级别计算。
- 不修改 `agent-contracts`、Gateway、runtime persistence、Message schema 或数据库。
- 本设计是开发调测所需的临时技术身份底线，不替代 roadmap 中完整的 `add-localized-capability-public-identity`；后者继续负责可信业务名称、本地化类型和执行时冻结身份。

## Verification

后端 characterization tests：

- Skill started event 投影合法 `name`。
- Agent started event 投影合法 `agentId`。
- ApiCall 普通 Tool started event 投影合法 `apiName`。
- 其他参数、额外字段、路径、prompt 和结果正文不进入 payload。
- 缺失关联、错误 toolCallId/capabilityId、空值、超长值、控制字符和多行值均不投影名称。
- `STATUS_ONLY`、`SUMMARY`、`DETAIL` 不改变同一名称，且无 projector 的结果正文仍不可见。

前端 tests：

- 合法 `capabilityTargetName` 拼入 Skill/Agent/ApiCall 标题。
- 缺失名称保持现有降级标题。
- started 后 completed 的同一工具步骤保留名称。
- 结果详情、折叠和状态逻辑不变。

手工验证：

- 使用真实 Skill 和 Agent 调用，确认执行中、完成后以及刷新历史后名称一致。
- 在本地配置 Bash/Read 为 `DETAIL`，确认显示有界详情；恢复默认配置后重新启动，确认仍为 `SUMMARY`。

## Non-goals

- 不新增中文或英文业务名称配置。
- 不翻译 Capability 类型或技术名称。
- 不显示 Bash 命令、Python 脚本名、Agent prompt、Skill args 或 ApiCall 请求参数。
- 不为直接 ApiCall 路径新增普通过程卡片。
- 不给未知扩展 Tool 开放结果正文。
- 不修改生产默认 disclosure level。
- 不改变或解除完整本地化公共身份 change 的现有准入条件。
