## MODIFIED Requirements

### Requirement: PIU Message Rendering

`PiuMessage` SHALL get the `piu` object from `PiuContext`, use `useId()` to generate a stable `wrapperId`, call `window.Prel.autoLoad(piuName, piuVersion)`, and then emit to the loaded PIU component. The emitted payload 默认形状 MUST 是 `{ ...content, wrapperId, containerId, handleExpandPanelOpen, handleExpandPanelClose, expandPanelId }`，即展开整个 content（含 `piuName`/`piuVersion`/`method`/`data`）并附加宿主字段；`wrapperId` 与 `containerId` 取相同值，`expandPanelId` 取固定常量。`handleExpandPanelOpen` 打开 expand panel 且不设置结构化内容，使 PIU 组件可直接渲染到 `expandPanelId`；`handleExpandPanelClose` 关闭 expand panel。

**受控例外：spread-data payload 形状**。对于 `piuName` 出现在前端 view 层编译期常量白名单 `SPREAD_DATA_PIU_NAMES` 中的 PIU（当前仅 `dte-bi-agent`），emit payload MUST 改为 `{ ...content.data, wrapperId, containerId, handleExpandPanelOpen, handleExpandPanelClose, expandPanelId }`，即只展开 `content.data` 的业务字段，MUST NOT 包含路由元信息 `piuName`/`piuVersion`/`method`。该例外用于适配既有 PIU handler 契约，后端 structuredPayload 不需改动。`SPREAD_DATA_PIU_NAMES` MUST 是编译期常量 `ReadonlySet<string>`，MUST NOT 接受运行时外部输入覆盖。`content.data` 来自不可信 stream（`parsePiuContent` 用 `as` 强转，无 runtime 校验），因此 spread-data 分支 MUST 只展开对象类型的 `data`；当 `content.data` 为 `null`、`undefined` 或非对象（字符串、数组、数字等）时，payload MUST 退化为仅含宿主字段，MUST NOT 产生来自非对象展开的 index key。当特例 PIU 数量增长时，SHALL 迁移为后端发声明字段并由前端按声明构造 payload，届时移除受控白名单。

两种形状下 `hostFields`（`wrapperId`/`containerId`/`handleExpandPanelOpen`/`handleExpandPanelClose`/`expandPanelId`）都 MUST 后置展开，确保宿主能力字段覆盖 `content` 或 `content.data` 中的同名 key。

Invalid `piuName`、缺失 `piu` 或缺失 `window.Prel` SHALL 渲染本地 fallback placeholder，且 MUST NOT 调用宿主 loader。

#### Scenario: PIU normal rendering with whole content payload

- **WHEN** `piuName` is valid and not in `SPREAD_DATA_PIU_NAMES`, and `piu` and `window.Prel` are available
- **THEN** the component MUST call `window.Prel.autoLoad(piuName, piuVersion)`
- **AND** after loading succeeds it MUST call `piu.emit(method, payload)`
- **AND** payload MUST contain all fields of `content` (including `piuName`, `piuVersion`, `method`, `data`) plus `wrapperId`, `containerId`, `handleExpandPanelOpen`, `handleExpandPanelClose`, and `expandPanelId`

#### Scenario: PIU in spread-data allowlist emits flattened data

- **GIVEN** `piuName` is `"dte-bi-agent"` (a member of `SPREAD_DATA_PIU_NAMES`)
- **WHEN** the component emits the payload
- **THEN** payload MUST be `{ ...content.data, wrapperId, containerId, handleExpandPanelOpen, handleExpandPanelClose, expandPanelId }`
- **AND** payload MUST NOT contain top-level `piuName`, `piuVersion`, or `method`

#### Scenario: spread-data payload degrades to host fields when data is absent

- **GIVEN** `piuName` is in `SPREAD_DATA_PIU_NAMES` and `content.data` is `null`, `undefined`, or a non-object value (string, array, number)
- **WHEN** the component emits the payload
- **THEN** payload MUST contain only `wrapperId`, `containerId`, `handleExpandPanelOpen`, `handleExpandPanelClose`, and `expandPanelId`
- **AND** payload MUST NOT contain index keys produced by spreading a non-object

#### Scenario: host fields override same-named content keys

- **GIVEN** `content.data` contains a key `wrapperId` with value `"evil"`
- **WHEN** the component emits the payload in either whole or spread-data shape
- **THEN** the payload `wrapperId` MUST equal the `useId()`-generated value, not `"evil"`

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
