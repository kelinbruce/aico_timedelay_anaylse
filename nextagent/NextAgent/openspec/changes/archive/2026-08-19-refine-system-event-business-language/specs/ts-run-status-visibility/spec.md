## Function

- **所属 Function**：`FN-2.4 查看请求状态`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: Agent Web 系统过程事件必须使用事实性业务语言

普通 Agent Web 收到 `DEGRADATION_NOTICE`、`CONTEXT_COMPACTED` 或前端兼容 `HOOK_DEGRADED` 时，系统 MUST 按当前界面语言显示下表定义的固定业务语义。系统 MUST NOT 将 event type、内部阶段名称、Hook 名称或标识作为标题或基础摘要。系统 MUST NOT 从这三类事件推断请求终态、自动恢复、后续行动或最终答复内容。

**需求类别**：功能性需求

| 事件 | 标题语义 | 基础摘要语义 | 严重程度 |
|---|---|---|---|
| `DEGRADATION_NOTICE` | 本次任务有部分内容未完成 | 用户查看执行详情和本次答复，确认未完成的内容 | 警告 |
| `HOOK_DEGRADED` | 本次任务有部分内容未完成 | 用户查看执行详情和本次答复，确认未完成的内容 | 警告 |
| `CONTEXT_COMPACTED` | 已整理较早的对话 | 系统已整理较早的对话内容，以便继续处理本次任务 | 信息 |

表中事件集合是本 Requirement 的完整适用范围。标题和基础摘要 MUST 采用当前界面的受支持语言表达同一语义；缺少本地化资源时，系统 MUST 使用该界面的既有安全本地化回退，不得回退为 event type、内部阶段名称或 payload 文本。

#### Scenario: canonical 降级提示不承诺请求结果
- **WHEN** 普通 Agent Web 呈现一个 `DEGRADATION_NOTICE`
- **THEN** 折叠过程和完整运行图 MUST 将其显示为警告级“本次任务有部分内容未完成”语义
- **AND** 基础摘要 MUST 引导用户查看执行详情和本次答复，确认未完成的内容
- **AND** 折叠过程 MUST 使用橙黄色三角形感叹号警告图标，并 MUST NOT 使用绿色完成图标或红色失败图标
- **AND** 标题或基础摘要 MUST NOT 声称请求已继续、已恢复、已成功或已失败

#### Scenario: 前端兼容 Hook 提示隐藏内部术语
- **WHEN** 普通 Agent Web 的兼容路径收到 `HOOK_DEGRADED`
- **THEN** 可见提示 MUST 使用与 `DEGRADATION_NOTICE` 相同的警告级“本次任务有部分内容未完成”语义
- **AND** 折叠过程 MUST 使用与 `DEGRADATION_NOTICE` 相同的警告图标
- **AND** 标题或基础摘要 MUST NOT 显示 `HOOK_DEGRADED`、Hook 名称、Hook 标识或任意 payload 文本
- **AND** 系统 MUST NOT 因该事件新增 canonical timeline fact 或历史重建结果

#### Scenario: 上下文整理是信息提示
- **WHEN** 普通 Agent Web 呈现一个 `CONTEXT_COMPACTED`
- **THEN** 折叠过程、完整运行图和 live-only 短暂提示 MUST 使用“已整理较早的对话”语义
- **AND** 严重程度 MUST 为信息而不是警告
- **AND** 折叠过程 MUST 使用中性圆形信息图标，并 MUST NOT 使用绿色完成图标、橙黄色警告图标或红色失败图标
- **AND** 系统 MUST NOT 把上下文整理描述为请求失败

#### Scenario: 不适用事件继续由既有呈现规则处理
- **WHEN** 普通 Agent Web 呈现的事件不是 `DEGRADATION_NOTICE`、`CONTEXT_COMPACTED` 或 `HOOK_DEGRADED`
- **THEN** 本 Requirement MUST NOT 改写该事件的标题、摘要、严重程度或详情
- **AND** 请求终态、Pending Input、附件、后台任务、LLM 内容与思考、Capability 生命周期、Workflow 内容和 `OUTPUT_GUARD_BLOCKED` MUST 继续由各自既有呈现规则处理

#### Scenario: 请求终态失败总结保持独立
- **WHEN** 请求以 `FAILED` 结束，并且同一 request/run 还存在 `DEGRADATION_NOTICE`
- **THEN** 系统过程条目 MUST 使用本 Requirement 定义的固定业务标题与基础摘要
- **AND** 请求下方的事实原因、失败阶段、重试判断与行动指导 MUST 继续由既有请求终态失败契约根据可信 terminal fact 和安全错误事实生成
- **AND** 系统过程条目的标题或基础摘要 MUST NOT 覆盖、替代或复制请求终态失败总结

#### Scenario: 产品配置不能改写系统事件语义
- **WHEN** 任一 Agent Web 宿主输入试图为三类适用事件覆盖标题、基础摘要、严重程度或显示级别
- **THEN** 普通 Agent Web MUST NOT 消费该输入选择系统事件呈现
- **AND** 普通 Agent Web MUST 继续使用本 Requirement 定义的固定业务语义

#### Scenario: 产品配置不能整体隐藏降级事实
- **WHEN** `DEGRADATION_NOTICE` 按既有过程投影规则应在当前用户可见 request/run 的过程 surface 形成独立可见条目
- **THEN** 普通 Agent Web MUST 呈现该处理受限事实
- **AND** 任一宿主或产品配置 MUST NOT 额外删除该条目、把该事件改为信息提示或用成功语义替换该事件

### Requirement: 系统过程事件普通界面必须限制技术信息披露

普通 Agent Web 呈现 `DEGRADATION_NOTICE`、`CONTEXT_COMPACTED` 或 `HOOK_DEGRADED` 时，系统 MUST 只使用 event type 选择标题、基础摘要和严重程度。系统 MUST NOT 将 payload 中的 `message`、`content`、`summary`、`detail`、`reason`、`uiMessage` 或 `safeSummary` 文本显示为标题、基础摘要或默认展开内容。系统 MUST NOT 显示被整理的对话内容。仅当 `DEGRADATION_NOTICE` payload 的显式 `code` 字段为非空安全技术码时，系统 MUST 将该 code 作为默认收起的纯文本技术详情；系统 MUST NOT 从其他文本字段解析、合成或猜测技术码。

**需求类别**：系统质量属性

**质量属性**：安全
**适用范围**：该 Function

#### Scenario: 任意事件文本不能替代固定业务语义
- **WHEN** 三类适用事件的 payload 同时携带 `message`、`content`、`summary`、`detail`、`reason`、`uiMessage` 或 `safeSummary` 中的任意一个或多个字段
- **THEN** 普通 Agent Web 的标题和基础摘要 MUST 仍使用 `Agent Web 系统过程事件必须使用事实性业务语言` 定义的固定业务语义
- **AND** 上述任意字段的文本 MUST NOT 出现在标题、基础摘要或默认展开内容中

#### Scenario: 显式技术码仅在用户主动展开后可见
- **WHEN** `DEGRADATION_NOTICE` 的 payload 携带非空显式 `code`
- **THEN** 折叠过程和完整运行图 MUST 默认收起该 code
- **AND** 仅在用户主动展开技术详情后，系统 MUST 将该 code 显示为纯文本
- **AND** code 是否已知 MUST NOT 改变固定标题、基础摘要、严重程度或请求终态

#### Scenario: 缺少显式技术码时不能从文本补充
- **WHEN** 三类适用事件未携带非空显式 `code`，但任意其他 payload 文本包含类似技术码的内容
- **THEN** 系统 MUST 只显示固定业务语义
- **AND** 系统 MUST NOT 从该文本解析、合成或猜测技术详情

### Requirement: 系统过程事件的实时与历史语义必须闭合

对可从 durable fact 重建的 `DEGRADATION_NOTICE` 和 `CONTEXT_COMPACTED`，普通 Agent Web 的 live 与 history 投影 MUST 使用相同的标题语义、基础摘要语义和严重程度。系统 MUST 保留 transport failure notice、上下文整理短暂动画和 `HOOK_DEGRADED` 的既有 live-only 边界，不得为追求界面一致而伪造 durable fact 或历史条目。

**需求类别**：系统质量属性

**质量属性**：可靠性/恢复
**适用范围**：该 Function

#### Scenario: canonical durable 事件刷新前后语义一致
- **WHEN** 同一 request/run 的 canonical `DEGRADATION_NOTICE` 或 `CONTEXT_COMPACTED` 先在 live stream 中呈现，随后从 run event history 重建
- **THEN** 两次呈现 MUST 使用相同的标题语义、基础摘要语义和严重程度
- **AND** 刷新 MUST NOT 改变该事件的业务含义或把信息提示提升为警告

#### Scenario: transport failure notice 保持 live-only
- **WHEN** Web transport 在没有对应 durable event 的情况下生成安全 transport failure notice
- **THEN** 该 notice MUST 只在当前 live 连接中呈现
- **AND** history MUST NOT 合成对应事件或提示

#### Scenario: 上下文整理短暂动画保持 live-only
- **WHEN** live stream 收到 `CONTEXT_COMPACTED` 并显示既有短暂提示
- **THEN** 该短暂提示 MUST 使用与 durable 过程条目相同的上下文整理业务语义
- **AND** history MUST 只重建 durable 过程条目，不得重播短暂动画

#### Scenario: Hook 兼容事件保持 live-only
- **WHEN** 前端兼容路径收到 `HOOK_DEGRADED`
- **THEN** 当前 live 界面 MUST 使用本 change 定义的固定业务语义
- **AND** history MUST NOT 合成 `HOOK_DEGRADED` 条目

## Function 变更汇总

### 描述

- **变更类型**：修改
- **目标内容**：查看请求的当前处理状态、关键过程、系统过程提示和 Capability 执行结果；普通 Agent Web 使用事实性业务语言呈现受治理的系统过程事件，不从过程提示推断请求终态或行动。
- **依据 Requirements**：`Agent Web 系统过程事件必须使用事实性业务语言`、`系统过程事件普通界面必须限制技术信息披露`、`系统过程事件的实时与历史语义必须闭合`

### 输出

- **变更类型**：修改
- **目标内容**：除既有请求状态、Capability 过程与结果外，输出 `DEGRADATION_NOTICE`、`CONTEXT_COMPACTED` 和前端兼容 `HOOK_DEGRADED` 的固定本地化业务标题、基础摘要与严重程度；`DEGRADATION_NOTICE` 的显式安全技术码默认收起。
- **依据 Requirements**：`Agent Web 系统过程事件必须使用事实性业务语言`、`系统过程事件普通界面必须限制技术信息披露`

### 处理过程

- **变更类型**：修改
- **目标内容**：系统依据事件类型选择固定业务语义，忽略任意 payload 文本和宿主配置对标题、基础摘要与严重程度的覆盖；处理受限事实不被产品配置整体隐藏；对 durable canonical 事件保持 live/history 语义一致，并保留已声明的 live-only 边界。
- **依据 Requirements**：`Agent Web 系统过程事件必须使用事实性业务语言`、`系统过程事件普通界面必须限制技术信息披露`、`系统过程事件的实时与历史语义必须闭合`

### 结果

- **变更类型**：修改
- **目标内容**：用户在三种 Agent Web 宿主和受支持语言中看到事实一致、无内部协议标识、无终态推断的系统过程提示；刷新历史不改变 durable 事件语义，也不重播 live-only 提示；既有请求终态失败总结保持独立且不被过程提示覆盖。
- **依据 Requirements**：`Agent Web 系统过程事件必须使用事实性业务语言`、`系统过程事件普通界面必须限制技术信息披露`、`系统过程事件的实时与历史语义必须闭合`

### 规格

- **规格项**：系统过程事件业务呈现范围
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：`DEGRADATION_NOTICE` 与 `HOOK_DEGRADED` 均为警告级“本次任务有部分内容未完成”提示，`CONTEXT_COMPACTED` 为信息级“已整理较早的对话”提示
- **依据 Requirements**：`Agent Web 系统过程事件必须使用事实性业务语言`
