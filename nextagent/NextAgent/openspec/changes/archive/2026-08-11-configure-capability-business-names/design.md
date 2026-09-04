## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-10.6 前端定制` | AICOConfig 接收有界扩展 Capability 双语名称，local 与 immersive 统一使用启动期 sessionStorage 快照 | `aico-config-contract` | `FN-10.6 前端定制` |
| `FN-2.4 查看请求状态` | 过程标题在平台固定名称之后消费有效 AICOConfig 名称，并保留构建期与技术标识降级 | `ts-run-status-visibility` | `FN-2.4 查看请求状态` |

## `FN-10.6 前端定制`

### 目标与规范依据

本 Function 需要在不建立第二套配置生命周期的前提下，让三种 Agent Web 宿主通过既有 AICOConfig 提供扩展 Capability 产品名称，并对不可信配置执行有界、逐项、fail-soft 校验。

#### 本 Function 的目标 Requirements

canonical spec：`aico-config-contract`

- `MODIFIED`：`AICOConfig configuration type and field definitions`
- `MODIFIED`：`AICOConfig injection paths per host mode`
- `MODIFIED`：`AICOConfig validation uses hand-written functions`
- `MODIFIED`：`AICOConfig default behavior when fields are absent`

### 当前实现

- `frontend/agent-web/src/aico-config/types.ts` 定义一个 frontend-only `AICOConfig`，当前不包含 Capability 名称字段。
- `validateAICOConfig.ts` 在配置进入前端时使用 hand-written validator，按字段和 `operators` 数组逐项过滤，并返回可直接进入 store 的不可变配置 snapshot。
- `AICOConfigStore.ts` 是唯一配置 store；`useAICOConfig()` 已被 shared `TurnBlock` 消费。无需新增 React context 或 parallel store。
- immersive entry 在模块启动时调用 `loadImmersiveAICOConfig()`，从 `sessionStorage["AICOConfig"]` 读取一次；local entry 不调用该 loader。
- collaborative `loadAIAgent` 对完整 payload 调用同一个 validator，并通过 `aicoConfigStore.setConfig` 完整替换 snapshot，同时重置 custom panel state。
- 当前 loader、validator 和 store 不订阅 storage event，也没有 polling 或 hot update。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| AICOConfig 接收有界的扩展 Capability 双语名称 | 类型和 validator 没有 `capabilityBusinessNames` | 缺少公共字段、逐项校验、容量边界、重复处理和安全文本约束 |
| local 与 immersive 使用同一个启动期 sessionStorage 快照 | 只有 immersive 调用专用命名 loader | local 缺少一次性加载，loader 命名和测试仍绑定 immersive |
| 缺失或部分非法配置不阻塞其他定制 | 现有数组仅对 `operators` 逐项过滤 | 新数组尚无独立过滤和 warning 行为 |
| 保持一个配置生命周期 | 已有 store 与 collaborative replace 路径满足 | 需要扩展既有对象，避免新 store、env 或 backend config |

### 修改方案

1. 在既有 `AICOConfig` 中增加 spec 定义的 `CapabilityBusinessNameKind`、`CapabilityBusinessNameEntry` 与 `capabilityBusinessNames`。公共字段保持 JSON-compatible、readonly、optional；缺失时 validator 不写入字段，消费方按空数组处理。
2. 在现有 validator 中增加一个专用逐项函数，复用 object/enum/string 基础校验。该函数按数组顺序处理至多 1000 项，以规范化后的 `${kind}:${id}` 作为重复判定键：首个有效条目进入结果，后续重复条目告警并跳过；单个语言非法时只删除该语言，两个语言均无效时删除整项。validator 输出仍是 `AICOConfig` snapshot，不引入持久化或第二种内部配置 shape。
3. 将 `loadImmersiveAICOConfig` 收敛为宿主中性的 sessionStorage loader，并由 local 与 immersive entry 在首次 render 之前各调用一次。loader 继续复用同一 JSON parse、validator、store 写入和异常降级路径，不监听 `storage` event，不缓存第二份 snapshot。
4. collaborative 路径保持现有 `loadAIAgentWithConfig → validateAICOConfig → aicoConfigStore.setConfig` 调用链。名称字段随完整配置一起替换；active PANEL 的既有 reset/unmount 语义不变。
5. 不修改 Runtime Bootstrap、`window.__NEXTAGENT_CONFIG__`、Vite env、backend app config 或 public Web API。AICOConfig 仍只拥有 browser presentation customization，不取得 Capability authority 或执行事实。

私有校验结果直接保留经过 trim 的 entry array。标题消费侧基于该 snapshot 和当前 locale 生成只读 lookup；lookup 是 render 派生值，不写回 store，不成为新的配置 truth。

#### 备选方案（Alternatives Considered）

- 将名称写入 Capability registration metadata：会把产品语言与执行/授权身份耦合，并要求 backend、contract 和 Plugin SDK 扩面，不满足最小前端定制目标。
- 新增独立 `CapabilityNameConfig` store 或 Runtime Bootstrap 字段：会复制 AICOConfig 的宿主注入、校验和替换生命周期，增加冲突来源。
- 使用按 kind 嵌套的多层 object：可以查表，但公共 JSON shape、未知 key 校验和文档示例更复杂。单数组能复用既有逐项过滤模式，并通过一次派生 lookup 保持查询效率。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 安全 | `AICOConfig validation uses hand-written functions` | 不可信名称有 type、长度、control character、语言 key 与容量校验；React 只按文本渲染 | HTML-like/Markdown-like 值不能形成 markup 或可执行内容 |
| 可靠性/恢复 | `AICOConfig validation uses hand-written functions` | 顶层非法全量降级，数组项非法局部降级，sessionStorage access/JSON parse 失败沿用默认值 | 单项失败不丢弃其他字段，三宿主无配置均可启动 |
| 可维护性 | `AICOConfig validation uses hand-written functions` | 复用一个 type、validator、store 和两种既有宿主输入路径 | 不出现 parallel store、env 或 backend config |
| 可测试性 | `AICOConfig validation uses hand-written functions` | 纯 validator 与一次性 loader 可独立验证，store snapshot 可观察 | 边界长度、1000/1001、重复、部分语言非法和完整替换 |

## `FN-2.4 查看请求状态`

### 目标与规范依据

本 Function 需要把有效 AICOConfig 名称插入既有集中标题解析优先级，同时保持平台固定名称不可覆盖、构建期兼容 fallback、当前语言选择和过程结构/结果策略正交。

#### 本 Function 的目标 Requirements

canonical spec：`ts-run-status-visibility`

- `MODIFIED`：`Agent Web 必须集中维护 Capability 业务名称映射`

### 当前实现

- `capabilityProcessTitle.ts` 是唯一标题 resolver；平台映射与构建期集成 i18n-key 映射均使用 `${kind}:${id}` key。
- resolver 先查平台 mapping，再查构建期 integration mapping；Tool 返回完整名称，Agent/Skill/Workflow 由平台模板包装，未命中时按既有合法 id 或中性标题降级。
- `processDetails.ts` 的 timeline 与 process entry 两条纯投影路径都调用该 resolver，live/history 使用同一组 `StreamEnvelope` 公开身份。
- `TurnBlock` 已订阅 AICOConfig，且是调用两条 process builder 的 shared React owner；当前只把 `aiEvents` 与 `t` 传入 builders。
- 配置名称不在 stream/history 中持久化，locale 变化会因 `t` 变化重新计算现有标题。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 平台固定映射之后使用 AICOConfig 名称 | resolver 只接受构建期 integration key map | 缺少当前配置、当前 locale 与直接文本名称输入 |
| 当前语言缺失时继续构建期 fallback | 现有 resolver 只解析 i18n key | 缺少“配置 miss 而非跨语言借用”的分支 |
| timeline/process 两种 projection 一致 | 两者复用 resolver但没有配置参数 | 需要把同一派生 lookup 传入两条 builder |
| 保持纯投影和 owner 边界 | process helper 当前不依赖 store | 必须避免在 helper 内直接订阅或读取 AICOConfigStore |

### 修改方案

1. 在 `TurnBlock` 中从已订阅的 `aicoConfig?.capabilityBusinessNames` 与 `getCurrentLocale()` 派生当前语言的 readonly `${kind}:${id} → name` lookup。使用 `useMemo` 保证同一 config snapshot/locale 下复用一个 lookup，并把它作为显式参数同时传给 `buildProcessEntries` 与 `buildProcessTimelineEntries`。
2. 扩展 process builder 与 `resolveCapabilityProcessTitle` 的纯函数参数，使 resolver 依次检查 platform i18n key、configured direct name、build-time integration i18n key。平台 lookup 与模板逻辑保持原实现；configured name 不经过翻译函数，只作为已校验文本参与模板插值或 Tool 完整标题。
3. locale 选择只读取 `zh-CN` 或 `en-US` 对应值；缺失时不访问另一个 key。locale 或 config snapshot 变化会触发 `TurnBlock` 重新派生 lookup并重建显示条目，历史 envelope 本身不变化。
4. `processDetails.ts` 和 `capabilityProcessTitle.ts` 不 import AICOConfigStore 或 React hook。这样标题解析仍可用纯输入测试，process projection 也不取得配置生命周期 ownership。
5. 不修改 `StreamEnvelope`、event producer、history API、process entry key/order/merge/disclosure、`STATUS_ONLY | SUMMARY | DETAIL` 或 safe result projection。

名称解析 decision table：

| 条件 | 结果 |
|---|---|
| platform mapping 命中 | 使用平台名称，忽略配置与构建期集成值 |
| platform miss，当前 locale 配置命中 | Tool 使用完整配置标题；Agent/Skill/Workflow 用平台模板包装配置名称 |
| 配置 miss，当前 locale 构建期映射命中 | 沿用当前构建期标题 |
| 全部 miss且 identity 合法 | 沿用合法 id/template 降级 |
| identity 非法 | 沿用中性标题降级 |

#### 备选方案（Alternatives Considered）

- 在 `capabilityProcessTitle.ts` 直接读取 store：调用点更少，但把纯投影函数与 React 外部状态耦合，测试和 live/history 一致性更难证明。
- 校验阶段把配置名称转换为 i18n resource key：AICOConfig 值不是前端构建产物资源，动态注册 i18n key 会引入资源生命周期和冲突处理。直接使用当前 locale 的已校验文本更小。
- 移除构建期 integration mapping：会给已发布集成产品造成不必要迁移。本 change 将它保留为配置缺失时的 fallback。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 安全 | 无新增黑盒质量目标；功能性 Requirement 禁止配置覆盖平台映射和解释 markup | 平台 mapping 固定优先，configured value 只进入 React text/template interpolation | platform collision、HTML-like text、未知 kind/id negative cases |
| 可靠性/恢复 | 无新增黑盒质量目标；功能性 Requirement 定义确定性 fallback | 显式四级优先级且所有 miss 均落到既有降级 | 当前语言缺失、配置空数组、旧 history 和 invalid identity |
| 可维护性 | 无新增黑盒质量目标 | 一个 resolver、一个派生 lookup、两条 builder 显式消费，不引入 hidden global dependency | process helper 保持纯函数，构建期 fallback 保留 |
| 可测试性 | 无新增黑盒质量目标 | resolver unit test 与 shared process projection test 分层覆盖 | Tool/wrapper、双语、live/history 与三宿主一致性 |

## 跨 Function 协作与端到端流程

`FN-10.6` 的修改方案拥有宿主输入、校验和 AICOConfig snapshot；`FN-2.4` 的修改方案只消费该 snapshot 派生的当前语言 lookup。共享链路固定为：host input → existing AICOConfig validator/store → shared `TurnBlock` 派生 lookup → existing process builders/resolver → React text title。任一配置字段或条目校验失败都在前一 Function 局部降级；后一 Function 只接收已校验数据，不重做公共 contract 校验，也不回写配置。

## 验证策略（Verification Strategy）

- unit 层覆盖 AICOConfig 字段 shape、逐项过滤、长度/容量、重复、部分语言非法、默认值，以及标题 resolver 的四级优先级、Tool/wrapper 差异和纯文本输出。
- component/integration 层覆盖 `TurnBlock` 将同一 configured lookup 传入 process 与 timeline projection，config/locale 变化重渲染、历史 identity 不被改写。
- host integration 层覆盖 local 与 immersive 的一次性 sessionStorage loading，以及 collaborative 完整 payload replacement；无配置与 parse/access failure 使用默认值。
- e2e 或 artifact mode journey 覆盖 local、immersive、collaborative 对同一身份/config/locale 输出相同标题，且现有 process structure 与结果披露不变化。
- architecture review 覆盖无 backend/runtime/gateway/Capability metadata 变化，无 process helper → store 依赖，无第二配置 truth。
- negative cases 覆盖平台名称覆盖尝试、unsupported locale key、duplicate identity、control character、1001st entry、HTML-like text、当前语言缺失和旧 history。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/aico-config-contract/spec.md`：合并字段、宿主注入、校验和默认值目标态，并补齐 `FN-10.6` 元数据。
- `openspec/specs/ts-run-status-visibility/spec.md`：合并名称解析优先级目标态。
- `openspec/designs/functions/D10-二次开发与平台集成/D10.2-集成与定制/FN-10.6-前端定制.md`：更新输入、处理结果和关键规格。
- `openspec/designs/functions/D2-请求运行时/D2.2-请求状态与处理/FN-2.4-查看请求状态.md`：更新过程标题输入、优先级和关键规格。
- `openspec/designs/features/D10-二次开发与平台集成/D10.2-集成与定制/F-10.6-前端定制.md`：增加 AICOConfig 名称定制用户价值。
- `openspec/designs/features/D2-请求运行时/D2.2-请求状态与处理/F-2.4-查看请求状态.md`：增加宿主配置业务语言的用户价值与边界。
- `openspec/overview.md`：补充前端产品定制可通过 AICOConfig 提供扩展 Capability 业务名称。
- `openspec/designs/architecture/agent-web-host-modes.md`：更新 local/immersive AICOConfig 启动注入一致性与 collaborative 边界。
- `openspec/designs/architecture/request-status-visibility.md`：更新过程标题名称来源优先级与不变执行/结果边界。
- `openspec/designs/modules/agent-web.md`：更新 AICOConfig loader/validator/store 与 process resolver 数据流。
- `openspec/designs/adr/aico-config-no-hot-reload.md`：把 local 纳入一次性启动快照决策，保持 no-hot-reload。
- 其他 architecture/modules：无。
- 新增或修改 ADR：除上述既有 ADR 更新外无。
- `openspec/designs/spec-to-design-map.md`：更新 `aico-config-contract` 与 `ts-run-status-visibility` 的设计导航和验证入口。

## 风险与取舍（Risks / Trade-offs）

- local 开始读取过去被忽略的 sessionStorage key，可能暴露开发环境遗留配置；以只读一次、严格校验、缺失/非法降级和 focused host test 缓解。
- 历史名称随当前配置变化，有利于统一产品术语但不保留执行时文案；执行身份仍是持久事实，审计不依赖展示名称。
- 1000 项容量上限会拒绝超大配置；上限仅约束展示映射，不影响 Capability 注册或执行，并防止不可信宿主输入造成无界校验与 lookup 成本。
- 保留构建期 integration mapping 会暂时存在两个集成名称来源；固定优先级使行为确定，后续是否移除 fallback 需要独立兼容性 change。

## 待确认问题（Open Questions）

无。
