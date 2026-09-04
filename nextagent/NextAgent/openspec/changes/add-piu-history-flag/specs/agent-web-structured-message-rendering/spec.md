# agent-web-structured-message-rendering Delta Specification

**所属 Function**：`FN-10.6 前端定制`
**Function 变更类型**：修改
**spec 角色**：主规格

## MODIFIED Requirements

### Requirement: PIU Message Rendering

`PiuMessage` SHALL get the `piu` object from `PiuContext`, use `useId()` to generate a stable `wrapperId`, call `window.Prel.autoLoad(piuName, piuVersion)`, and then emit to the loaded PIU component. The emitted payload 默认形状 MUST 是 `{ ...content, isHistory, wrapperId, containerId, handleExpandPanelOpen, handleExpandPanelClose, expandPanelId }`，即展开整个 content（含 `piuName`/`piuVersion`/`method`/`data`）并附加宿主字段；`wrapperId` 与 `containerId` 取相同值，`expandPanelId` 取固定常量。`isHistory` MUST 是布尔值：`true` 表示该结构化 PIU 内容来自历史回显，`false` 表示该结构化 PIU 内容来自实时问答；该投影 MUST 由结构化 PIU segment 的 `content.data` 形状产生：`content.data` 为数组时 MUST 产生 `isHistory: true`，非数组或缺失时 MUST 产生 `isHistory: false`；该判定 MUST NOT 依赖 `uuid` 或整个 turn 是否存在任意实时事件。`handleExpandPanelOpen` 打开 expand panel 且不设置结构化内容，使 PIU 组件可直接渲染到 `expandPanelId`；`handleExpandPanelClose` 关闭 expand panel。

**受控例外：spread-data payload 形状**。对于 `piuName` 出现在前端 view 层编译期常量白名单 `SPREAD_DATA_PIU_NAMES` 中的 PIU（当前仅 `dte-bi-agent`），emit payload MUST 改为 `{ ...content.data, isHistory, wrapperId, containerId, handleExpandPanelOpen, handleExpandPanelClose, expandPanelId }`，即只展开 `content.data` 的业务字段，MUST NOT 包含路由元信息 `piuName`/`piuVersion`/`method`。该例外用于适配既有 PIU handler 契约，后端 structuredPayload 不需改动。`SPREAD_DATA_PIU_NAMES` MUST 是编译期常量 `ReadonlySet<string>`，MUST NOT 接受运行时外部输入覆盖。`content.data` 来自不可信 stream（`parsePiuContent` 用 `as` 强转，无 runtime 校验），因此 spread-data 分支 MUST 只展开对象类型的 `data`；当 `content.data` 为 `null`、`undefined` 或非对象（字符串、数组、数字等）时，payload MUST 退化为仅含宿主字段，MUST NOT 产生来自非对象展开的 index key。当特例 PIU 数量增长时，SHALL 迁移为后端发声明字段并由前端按声明构造 payload，届时移除受控白名单。

两种形状下 `hostFields`（`isHistory`/`wrapperId`/`containerId`/`handleExpandPanelOpen`/`handleExpandPanelClose`/`expandPanelId`）都 MUST 后置展开，确保宿主能力字段覆盖 `content` 或 `content.data` 中的同名 key。

Invalid `piuName`、缺失 `piu` 或缺失 `window.Prel` SHALL 渲染本地 fallback placeholder，且 MUST NOT 调用宿主 loader。

**需求类别**：功能性需求

#### Scenario: PIU normal rendering with whole content payload

- **WHEN** `piuName` is valid and not in `SPREAD_DATA_PIU_NAMES`, and `piu` and `window.Prel` are available
- **THEN** the component MUST call `window.Prel.autoLoad(piuName, piuVersion)`
- **AND** after loading succeeds it MUST call `piu.emit(method, payload)`
- **AND** payload MUST contain all fields of `content` (including `piuName`, `piuVersion`, `method`, `data`) plus `isHistory`, `wrapperId`, `containerId`, `handleExpandPanelOpen`, `handleExpandPanelClose`, and `expandPanelId`

#### Scenario: PIU in spread-data allowlist emits flattened data

- **GIVEN** `piuName` is `"dte-bi-agent"` (a member of `SPREAD_DATA_PIU_NAMES`)
- **WHEN** the component emits the payload
- **THEN** payload MUST be `{ ...content.data, isHistory, wrapperId, containerId, handleExpandPanelOpen, handleExpandPanelClose, expandPanelId }`
- **AND** payload MUST NOT contain top-level `piuName`, `piuVersion`, or `method`

#### Scenario: spread-data payload degrades to host fields when data is absent

- **GIVEN** `piuName` is in `SPREAD_DATA_PIU_NAMES` and `content.data` is `null`, `undefined`, or a non-object value (string, array, number)
- **WHEN** the component emits the payload
- **THEN** payload MUST contain only `isHistory`, `wrapperId`, `containerId`, `handleExpandPanelOpen`, `handleExpandPanelClose`, and `expandPanelId`
- **AND** payload MUST NOT contain index keys produced by spreading a non-object

#### Scenario: host fields override same-named content keys

- **GIVEN** `content.data` contains keys `wrapperId` with value `"evil"` and `isHistory` with value `true`
- **WHEN** the component emits the payload in either whole or spread-data shape with trusted `isHistory: false`
- **THEN** the payload `wrapperId` MUST equal the `useId()`-generated value, not `"evil"`
- **AND** the payload `isHistory` MUST equal `false`

#### Scenario: PIU distinguishes history replay from live answer

- **GIVEN** a structured PIU answer segment whose `content.data` is an array
- **WHEN** the component emits the payload
- **THEN** payload `isHistory` MUST be `true`
- **GIVEN** a structured PIU answer segment whose `content.data` is not an array
- **WHEN** the component emits the payload
- **THEN** payload `isHistory` MUST be `false`

#### Scenario: PIU history flag is independent of uuid

- **GIVEN** a structured PIU answer segment without a `uuid` and whose `content.data` is an array
- **WHEN** the component emits the payload
- **THEN** payload `isHistory` MUST be `true`
#### Scenario: PIU keeps its history source in a mixed turn

- **GIVEN** a structured PIU answer segment whose `content.data` is an array, while the same turn also contains another live event
- **WHEN** the component emits the payload
- **THEN** payload `isHistory` MUST remain `true`

#### Scenario: PIU re-emits when the trusted history flag changes

- **GIVEN** the same PIU content has already been emitted with `isHistory: true`
- **WHEN** the trusted structured PIU data-shape projection changes `isHistory` to `false`
- **THEN** `piu.emit` MUST be called again with the same content payload and `isHistory: false`
#### Scenario: PIU calls handleExpandPanelOpen

- **WHEN** the PIU component calls `handleExpandPanelOpen()`
- **THEN** the expand panel MUST open
- **AND** the `expandPanelId` div MUST be available for PIU rendering

#### Scenario: PIU calls handleExpandPanelClose

- **WHEN** the PIU component calls `handleExpandPanelClose()`
- **THEN** the expand panel MUST close

#### Scenario: PIU unavailable fallback

- **WHEN** `piuName` is invalid, `piu` is null, or `window.Prel` is unavailable
- **THEN** the component MUST render a fallback placeholder
- **AND** the fallback text MUST use the active i18n locale

## Function 变更汇总

### 描述

- **变更类型**：修改
- **目标内容**：结构化 PIU 的本地不可预览与等待宿主渲染提示使用 active i18n locale 的本地化文案。
- **依据 Requirements**：`PIU Message Rendering`

### 规格

- **规格项**：答案区 PIU 历史标识
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：答案区 PIU emit payload 在 whole-content 与 spread-data 两种形态中都包含可信布尔 `isHistory`；`content.data` 为数组时 `true`，否则 `false`，并覆盖 content/data 同名字段。
- **依据 Requirements**：`PIU Message Rendering`
