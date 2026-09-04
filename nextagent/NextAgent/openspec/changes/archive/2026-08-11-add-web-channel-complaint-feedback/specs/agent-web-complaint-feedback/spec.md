## ADDED Requirements

### Requirement: 投诉能力可见性由报告风险配置探针决定

`agent-web` SHALL 在进入服务时探测一次 `GET /rest/naie/guardrail/config/v1/report/risks`。当响应 HTTP 200 且返回体含 `records` 数组时，答案反馈图标与投诉历史入口 SHALL 可见，且 `records`（每项含 `id`、`name_en`、`name_zh`）SHALL 被缓存作为投诉类型列表来源。当响应非 200 或请求失败时，两块投诉能力 SHALL 静默隐藏，且 MUST NOT 向用户报错。探针结果 SHALL 在当前页面生命周期内缓存，刷新页面 SHALL 重新探测。弹框打开时 MUST NOT 重复发起探针请求。

鉴权信息由 `apiClient` 拦截器自动注入，调用方 MUST NOT 手动设置鉴权头。

#### Scenario: 探针成功使投诉能力可见并缓存投诉类型

- **WHEN** 进入服务时探测 `GET /rest/naie/guardrail/config/v1/report/risks` 返回 HTTP 200 且 `records` 含 8 项
- **THEN** 答案反馈图标 MUST 可见
- **AND** 投诉历史入口 MUST 可见
- **AND** 投诉中心弹框的投诉类型列表 MUST 取自该 `records`
- **AND** 弹框打开时 MUST NOT 再次发起探针请求

#### Scenario: 探针失败静默隐藏投诉能力

- **WHEN** 探测 `GET /rest/naie/guardrail/config/v1/report/risks` 返回非 200 或请求失败
- **THEN** 答案反馈图标 MUST NOT 可见
- **AND** 投诉历史入口 MUST NOT 可见
- **AND** MUST NOT 向用户展示错误提示

#### Scenario: 刷新页面重新探测

- **GIVEN** 探针已成功并缓存 `records`
- **WHEN** 用户刷新页面
- **THEN** 探针 MUST 重新发起一次

### Requirement: 答案反馈图标触发投诉中心弹框

`agent-web` SHALL 在已完成的助手答案的操作区渲染投诉反馈图标。反馈图标的显示条件 SHALL 与点赞/点踩一致：当 `showAnnotations` 为真且存在 `sessionId` 与 `runId` 且该轮 `isTerminal`，且探针使能时可见。当 AICOConfig 配置了 `answerOperator` 时，操作区被整体替换，反馈图标 SHALL 随之消失。反馈图标 MUST NOT 套用 NextAgent AICO Write 权限门禁。点击反馈图标 SHALL 打开投诉中心弹框。

#### Scenario: 已完成答案显示反馈图标

- **GIVEN** 一轮已完成（`isTerminal`）的助手答案且探针使能
- **THEN** 反馈图标 MUST 在操作区可见
- **AND** 反馈图标 MUST 与点赞/点踩位于同一操作区

#### Scenario: answerOperator 在场时反馈图标消失

- **GIVEN** AICOConfig 配置了 `answerOperator`
- **WHEN** 助手答案渲染
- **THEN** 反馈图标 MUST NOT 可见（与点赞/点踩一同被替换）

#### Scenario: 探针未使能时反馈图标不可见

- **GIVEN** 探针失败或未使能
- **THEN** 反馈图标 MUST NOT 可见

#### Scenario: 点击反馈图标打开弹框

- **WHEN** 用户点击反馈图标
- **THEN** 投诉中心弹框 MUST 打开

### Requirement: 投诉中心弹框渲染与校验

投诉中心弹框 SHALL 以"投诉中心"为标题，包含投诉类型与投诉描述两块内容，下方提供提交与取消按钮。投诉类型 SHALL 以探针缓存的 `records` 渲染为带边框文本项，按当前语言显示 `name_zh`（`zh-CN`）或 `name_en`（`en-US`）；选中与 hover 时边框颜色变化；投诉类型为必选。投诉描述 SHALL 为多行文本框。当选中的投诉类型 `id === "8"` 时，投诉描述为必填；其余 `id` 时非必填。投诉描述在填写时 MUST 匹配 `/^[^\s].*/`（不以空白字符开头）且长度 MUST NOT 超过 2600。点击取消 SHALL 关闭弹框。点击提交 SHALL 在校验通过后调用投诉提交接口。

#### Scenario: 投诉类型按语言显示

- **GIVEN** 探针返回 `records` 含 `{ id: "1", name_zh: "类型一", name_en: "Type One" }`
- **WHEN** 当前语言为 `zh-CN`
- **THEN** 投诉类型列表 MUST 显示"类型一"

#### Scenario: 投诉类型必选

- **GIVEN** 投诉中心弹框已打开且未选择投诉类型
- **THEN** 提交按钮 MUST 禁用

#### Scenario: reason_id 为 8 时描述必填

- **GIVEN** 已选择 `id === "8"` 的投诉类型且投诉描述为空
- **THEN** 提交 MUST 失败校验
- **AND** MUST NOT 发起提交请求

#### Scenario: 描述以空白开头被拒绝

- **GIVEN** 投诉描述内容为" 投诉内容"（以空格开头）
- **THEN** 校验 MUST 失败

#### Scenario: 描述长度上限 2600

- **GIVEN** 投诉描述长度超过 2600 字符
- **THEN** 校验 MUST 失败

#### Scenario: 取消关闭弹框

- **WHEN** 用户点击取消
- **THEN** 弹框 MUST 关闭

### Requirement: 投诉提交接口调用

点击提交且校验通过后，`agent-web` SHALL 调用 `POST /rest/naie/guardrail/config/v1/report/create`，请求体为 `{ alog_card, tenant_id, user_id, reason_id, reason_detail }`。`tenant_id` MUST 为空字符串。`user_id` SHALL 取当前用户身份：remote 模式取 `useAppHostContext().site?.user?.id`，local 模式取 `"subject-1"`。`reason_id` SHALL 为已选投诉类型的 `id`。`reason_detail` SHALL 为投诉描述文本。`alog_card` SHALL 拼接为 `[Q]${question}\n[A]${textAnswers}`，其中 `question` 为该轮用户问题，`textAnswers` 为该轮答案中所有 Text 类型段（`LLM_CONTENT_DELTA` 文本与 `TOOL_STRUCTURED_DELTA` ANSWER 中 `toolMessageType === "TEXT"`）的内容，多个 Text 段以 `\n` 拼接；无 Text 段时 `[A]` 后为空字符串。鉴权信息由 `apiClient` 拦截器注入。调用成功 SHALL 提示成功并关闭弹框，调用失败 SHALL 提示错误且保留弹框与草稿。

#### Scenario: 提交参数正确

- **GIVEN** 已选 `reason_id === "3"`，投诉描述为"网络诊断不准"，用户问题为"为什么丢包"，答案 Text 段为两段"诊断A"与"诊断B"
- **WHEN** 用户点击提交
- **THEN** MUST 调用 `POST /rest/naie/guardrail/config/v1/report/create`
- **AND** 请求体 `reason_id` MUST 为 `"3"`
- **AND** 请求体 `tenant_id` MUST 为 `""`
- **AND** 请求体 `reason_detail` MUST 为"网络诊断不准"
- **AND** 请求体 `alog_card` MUST 为"[Q]为什么丢包\n[A]诊断A\n诊断B"

#### Scenario: 无 Text 答案时 alog_card 的 A 段为空

- **GIVEN** 答案无任何 Text 类型段
- **WHEN** 用户点击提交
- **THEN** 请求体 `alog_card` MUST 为"[Q]{question}\n[A]"

#### Scenario: 提交成功关闭弹框

- **WHEN** 提交接口返回成功
- **THEN** MUST 展示成功提示
- **AND** 弹框 MUST 关闭

#### Scenario: 提交失败保留弹框

- **WHEN** 提交接口返回失败
- **THEN** MUST 展示错误提示
- **AND** 弹框 MUST 保持打开
- **AND** 已选投诉类型与描述草稿 MUST 保留

### Requirement: 投诉历史入口在多宿主下渲染 RobotRouterPIU

`agent-web` SHALL 在 immersive 与 collaborative 宿主下提供投诉历史入口，入口可见性受探针控制。投诉历史 SHALL 通过 `PiuRenderer` 渲染 PIU `{ piuName: "RobotRouterPIU", piuVersion: "1.0.0", renderFunc: "renderComplaintList" }`。immersive 左布局 SHALL 在侧边栏提供导航按钮，点击切换内容视图至投诉历史并渲染 PIU。immersive 右布局 SHALL 在顶部栏提供按钮，点击切换面板视图至投诉历史并渲染 PIU。collaborative 宿主 SHALL 在面板头部提供按钮，点击打开模态弹框内嵌渲染 PIU。local 宿主 MUST NOT 渲染投诉历史入口。当 `window.Prel` 不可用时，PIU 渲染区 SHALL 显示占位符且 MUST NOT 抛错。

#### Scenario: immersive 左布局侧边栏入口

- **GIVEN** immersive 左布局且探针使能
- **THEN** 侧边栏 MUST 出现投诉历史导航按钮
- **WHEN** 用户点击该按钮
- **THEN** 内容视图 MUST 切换至投诉历史
- **AND** MUST 通过 PiuRenderer 渲染 RobotRouterPIU 的 renderComplaintList

#### Scenario: immersive 右布局顶部栏入口

- **GIVEN** immersive 右布局且探针使能
- **WHEN** 用户点击顶部栏投诉历史按钮
- **THEN** 面板视图 MUST 切换至投诉历史
- **AND** MUST 通过 PiuRenderer 渲染 renderComplaintList

#### Scenario: collaborative 宿主弹框入口

- **GIVEN** collaborative 宿主且探针使能
- **WHEN** 用户点击面板头部投诉历史按钮
- **THEN** MUST 打开模态弹框
- **AND** 弹框内 MUST 通过 PiuRenderer 渲染 renderComplaintList

#### Scenario: local 宿主不渲染入口

- **GIVEN** local 宿主
- **THEN** 投诉历史入口 MUST NOT 可见

#### Scenario: 探针未使能时入口不可见

- **GIVEN** 探针失败或未使能
- **THEN** 投诉历史入口 MUST NOT 可见（任意宿主）

#### Scenario: window.Prel 不可用时显示占位符

- **GIVEN** `window.Prel` 不可用
- **WHEN** 投诉历史视图渲染
- **THEN** MUST 显示占位符
- **AND** MUST NOT 抛出错误
