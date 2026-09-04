## Function

- **所属 Function**：`FN-10.6 前端定制`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：`主规格`

## MODIFIED Requirements

### Requirement: AICOConfig configuration type and field definitions

AICOConfig SHALL 为 JSON 兼容的配置对象，用于定制 NextAgent 前端 UI 外观、行为开关、布局和 PIU 渲染注入点。所有字段可选；当整个 AICOConfig 缺失或任一字段缺失时，对应的 UI 元素或行为 MUST 使用当前硬编码默认值。AICOConfig MUST NOT 在未提供任何字段时引入行为变化。

以下字段和类型 SHALL 受支持：

- `containerId?: string` — 协作模式宿主容器元素 ID
- `icon?: string` — 顶栏 / 侧边栏头部图标来源
- `activeIcon?: string` — 激活态图标（保留字段，本 change 不消费）
- `entranceIcon?: string` — 协作入口按钮图标来源
- `guideIcon?: string` — 欢迎页品牌图标来源
- `name?: string` — 替换硬编码 "NextAgent" 的显示标题文本
- `welcome?: string` — 替换 i18n 默认值的欢迎副标题文本
- `modalSize?: ModalSize` — 协作面板尺寸控制（width、height、minWidth）
- `clearStorage?: boolean` — 为 true 时，协作模式 MUST NOT 恢复上一个会话
- `declaration?: boolean | { title: string; tips: string }` — 控制底部声明区域
- `showAskTime?: boolean` — 为 true 时，在用户问题消息上显示时间戳
- `showThinkingChain?: boolean` — 为 false 时，隐藏 ProcessPanel 中的"全流程"入口
- `operators?: Operator[]` — 工具栏 / 侧边栏中的自定义操作按钮
- `answerOperator?: PIUInfoItem` — 替换助手回答的默认 BubbleActions
- `quickInfo?: { type: QuickType; data?: PIUInfoItem }` — 控制输入上方区域
- `inputOperator?: PIUInfoItem` — 替换输入框内的斜杠提示区域
- `layoutConfig?: { expandPanelPosition?: ExpandPanelPosition; operatorPosition?: ToolBarPosition }` — 布局配置
- `guideInfo?: { type: GuideAreaType; data?: PIUInfoItem }` — 控制欢迎页引导区域

所有 icon 字段（`icon`、`activeIcon`、`entranceIcon`、`guideIcon`、`Operator.lightIcon`、`Operator.darkIcon`）SHALL 接受以下四种来源格式之一：

1. **裸 base64 字符串** — 前端 MUST 将其包装为 `data:image/png;base64,{value}`。
2. **`data:` URI** — 前端 MUST 原样使用。
3. **绝对 `http(s)://` URL** — 前端 MUST 原样使用。
4. **相对路径**（以 `/`、`./` 或 `../` 开头）— 前端 MUST 原样使用，由浏览器在宿主页面 origin 下解析。

辅助类型：

- `ModalSize`：`{ width?: number | string; height?: number | string; minWidth?: number | string }`
- `PIUInfoItem`：`{ piuName: string; piuVersion: string; renderFunc: string; data?: Record<string, unknown>; width?: number | string; height?: number | string }`
- `QuickType`：枚举 `SKILL_LIST | SELF_DEFINE | CATEGORY_RECOMMEND`
- `OperatorPosition`：枚举 `OUTER | INNER`
- `OperatorType`：枚举 `PANEL | MODAL`
- `ExpandPanelPosition`：枚举 `LEFT | RIGHT`
- `ToolBarPosition`：枚举 `LEFT | RIGHT`
- `Operator`：`{ lightIcon: string; darkIcon: string; enName: string; zhName: string; position: OperatorPosition; type: OperatorType; data: PIUInfoItem }`
- `GuideAreaType`：枚举 `HIGH_FREQUENCY_RECOMMEND | SELF_DEFINE`

**需求类别**：功能性需求

#### Scenario: 未提供 AICOConfig
- **WHEN** 任何模式下未提供 AICOConfig
- **THEN** 所有 UI 元素和行为 MUST 与当前硬编码默认值完全一致
- **AND** MUST NOT 发出任何错误或警告

#### Scenario: 仅提供部分字段的 AICOConfig
- **WHEN** AICOConfig 仅提供 `{ name: "网络助手" }` 且无其他字段
- **THEN** 显示标题 MUST 变为 "网络助手"
- **AND** 所有其他 UI 元素和行为 MUST 保持当前默认值

#### Scenario: 相对路径图标被渲染
- **WHEN** AICOConfig 提供 `entranceIcon` 为 `/static/icons/agent.svg`
- **THEN** 协作入口按钮 MUST 从该相对 URL 渲染图片
- **AND** 浏览器 MUST 在宿主页面 origin 下解析该路径
- **AND** 如果资源未找到，前端 MUST 回退到默认 logo 并发出 console 警告

#### Scenario: base64 图标字段被渲染
- **WHEN** AICOConfig 提供 `entranceIcon` 为 base64 字符串
- **THEN** 协作入口按钮 MUST 渲染解码后的图片
- **AND** 如果 base64 字符串格式错误，前端 MUST 回退到默认 logo 并发出 console 警告

### Requirement: AICOConfig validation uses hand-written functions

AICOConfig 校验 SHALL 使用手写 TypeScript 校验函数，不使用 TypeBox/Ajv 或其他 schema 校验库。校验 MUST 在 AICOConfig 进入前端的边界（sessionStorage 读取或 `loadAIAgent` handler）执行。

校验规则：
- 顶层值 MUST 是对象或 null/undefined。为 null/undefined 时，全部使用默认值。
- 每个字段 MUST 按其预期类型校验。未知字段 MUST 静默忽略。
- 字符串字段 MUST 在 trim 后非空才视为有效；空字符串视为缺失。
- 数组字段（`operators`）MUST 逐元素校验；无效元素 MUST 被过滤并发出 console 警告。
- 枚举字段 MUST 按其允许值校验；无效值 MUST 回退到该字段的默认值。
- icon 字段 MUST 校验为非空字符串；格式判断（base64、`data:` URI、绝对 URL 或相对路径）MUST 延迟到渲染时由 `resolveIconSrc` 处理。不匹配任何支持格式的值 MUST 在渲染时触发图片加载错误回退并发出 console 警告。
- 如果整个 AICOConfig 无效（非对象），前端 MUST 回退到全部默认值并发出一条 console 警告。

**需求类别**：功能性需求

#### Scenario: 合法的 AICOConfig 被接受
- **WHEN** 提供格式良好的 AICOConfig JSON 对象
- **THEN** 所有合法字段 MUST 被应用
- **AND** 未知字段 MUST 静默忽略

#### Scenario: 非法的 AICOConfig 回退到默认值
- **WHEN** AICOConfig 是字符串、数字或数组而非对象
- **THEN** 前端 MUST 忽略整个配置
- **AND** 所有默认值 MUST 被使用
- **AND** MUST 发出一条 console 警告

#### Scenario: 部分非法 operators 被过滤
- **WHEN** AICOConfig 提供 `operators`，其中一个元素的 `position` 值非法
- **THEN** 该元素 MUST 被过滤并发出 console 警告
- **AND** 剩余合法 operators MUST 被应用

## Function 变更汇总

### 规格

- **规格项**：icon 来源格式
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：裸 base64、`data:` URI、绝对 `http(s)://` URL、相对路径（以 `/`、`./`、`../` 开头）四种格式；校验只要求非空字符串，格式判断在渲染时由 `resolveIconSrc` 处理
- **依据 Requirements**：`AICOConfig configuration type and field definitions`、`AICOConfig validation uses hand-written functions`