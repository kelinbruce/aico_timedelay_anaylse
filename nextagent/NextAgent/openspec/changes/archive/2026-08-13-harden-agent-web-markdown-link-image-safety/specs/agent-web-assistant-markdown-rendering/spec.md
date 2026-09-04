## Function

- **所属 Function**：`FN-1.22 展示会话消息正文`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: Markdown 图片仅渲染同源 URL

`agent-web` MUST 只把同源图片 URL 渲染为 `<img>` 元素。非同源图片 URL MUST 以转义文本形式展示，MUST NOT 生成 `<img>` 标签。同源判定基于 `window.location` 的 protocol、hostname 和 port；相对路径、fragment、`data:` URI 视为同源。空或无效 `href` MUST 展示为 alt 文本。

**需求类别**：系统质量属性

**质量属性**：安全
**适用范围**：该 Function

#### Scenario: 同源图片渲染为 img 元素
- **WHEN** 普通 assistant 正文包含相对路径或同源绝对 URL 的图片标记
- **THEN** `agent-web` MUST 生成包含该 `src` 和 `alt` 的 `<img>` 元素

#### Scenario: 跨源图片 URL 展示为文本
- **WHEN** 普通 assistant 正文包含非同源绝对 URL 的图片标记
- **THEN** `agent-web` MUST NOT 生成 `<img>` 元素
- **AND** MUST 把该 URL 以转义文本形式展示

#### Scenario: data URI 图片视为同源
- **WHEN** 普通 assistant 正文包含 `data:image/...` 格式的图片标记
- **THEN** `agent-web` MUST 把其渲染为 `<img>` 元素

#### Scenario: javascript 协议图片 URL 展示为文本
- **WHEN** 普通 assistant 正文包含 `javascript:` 协议的图片标记
- **THEN** `agent-web` MUST NOT 生成 `<img>` 元素
- **AND** MUST 把该 URL 以转义文本形式展示

### Requirement: Markdown 链接安全属性与跨源确认门

`agent-web` MUST 为所有 Markdown 链接添加 `target="_blank"` 和 `rel="noopener noreferrer"` 属性。同源链接 MUST 保留原始 `href` 并允许直接打开。非同源链接 MUST 把真实 URL 存入 `data-external-href`、把 `href` 设为 `#`，并在用户点击时弹出确认提示；用户确认后 MUST 在新标签页打开真实 URL，取消 MUST 阻止跳转。

危险协议 URL（`javascript:`、`vbscript:`、`data:` 等）MUST NOT 进入 `data-external-href` 或 `window.open` 调用路径。click handler MUST 在调用 `window.open` 前校验 URL 协议白名单（仅允许 `http:`、`https:` 和 protocol-relative `//`），不符合白名单的 URL MUST 被静默丢弃。

**需求类别**：系统质量属性

**质量属性**：安全
**适用范围**：该 Function

#### Scenario: 同源链接直接打开并携带安全属性
- **WHEN** 普通 assistant 正文包含同源 URL 的链接标记
- **THEN** `agent-web` MUST 生成包含原始 `href`、`target="_blank"` 和 `rel="noopener noreferrer"` 的 `<a>` 元素
- **AND** MUST NOT 设置 `data-external-href`

#### Scenario: 跨源链接使用 data-external-href 拦截
- **WHEN** 普通 assistant 正文包含非同源 URL 的链接标记
- **THEN** `agent-web` MUST 生成 `href="#"` 并把真实 URL 存入 `data-external-href`
- **AND** MUST 添加 `target="_blank"` 和 `rel="noopener noreferrer"`

#### Scenario: 点击跨源链接弹出确认提示
- **WHEN** 用户点击带有 `data-external-href` 的链接
- **THEN** `agent-web` MUST 弹出确认提示，提示用户即将离开本系统
- **AND** MUST NOT 在用户确认前打开新标签页

#### Scenario: 用户确认后打开跨源链接
- **WHEN** 用户在确认提示中选择继续访问
- **THEN** `agent-web` MUST 在新标签页打开 `data-external-href` 中的真实 URL

#### Scenario: 用户取消后不跳转
- **WHEN** 用户在确认提示中选择取消
- **THEN** `agent-web` MUST NOT 打开新标签页或执行导航

#### Scenario: javascript 协议链接展示为纯文本
- **WHEN** 普通 assistant 正文包含 `javascript:` 协议的链接标记
- **THEN** `agent-web` MUST NOT 生成 `<a>` 元素或 `data-external-href`
- **AND** MUST 把该 URL 以转义文本形式展示

#### Scenario: data-external-href 中的危险协议被 click handler 阻断
- **WHEN** `data-external-href` 包含非 `http`/`https`/protocol-relative 的 URL
- **THEN** click handler MUST NOT 调用 `window.open`
- **AND** MUST NOT 弹出确认提示

## Function 变更汇总

### 描述

- **变更类型**：修改
- **目标内容**：系统在已完成普通 assistant 正文的 Markdown 渲染管线中增加图片同源过滤和链接安全约束：仅同源图片渲染为 `<img>`，非同源图片以文本展示；所有链接携带 `target="_blank"` 和 `rel="noopener noreferrer"`，跨源链接需用户确认后才能跳转，危险协议 URL 被阻断。
- **依据 Requirements**：`Markdown 图片仅渲染同源 URL`、`Markdown 链接安全属性与跨源确认门`

### 规格

- **规格项**：图片同源过滤
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：仅同源 URL（相对路径、fragment、`data:` URI）渲染为 `<img>`；非同源 URL 以转义文本展示
- **依据 Requirements**：`Markdown 图片仅渲染同源 URL`

- **规格项**：链接安全属性
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：所有链接 `target="_blank" rel="noopener noreferrer"`；同源链接保留原始 `href`；跨源链接 `href="#"` 加 `data-external-href`
- **依据 Requirements**：`Markdown 链接安全属性与跨源确认门`

- **规格项**：跨源确认门
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：跨源链接点击时弹出确认提示；确认后 `window.open` 打开；取消则不跳转；协议白名单仅 `http:`、`https:`、`//`
- **依据 Requirements**：`Markdown 链接安全属性与跨源确认门`

### 主规格

- **变更类型**：修改
- **目标内容**：`agent-web-assistant-markdown-rendering`
- **依据 Requirements**：`Markdown 图片仅渲染同源 URL`、`Markdown 链接安全属性与跨源确认门`
