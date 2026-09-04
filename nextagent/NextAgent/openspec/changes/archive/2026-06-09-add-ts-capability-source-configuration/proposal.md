## 背景与问题（Why）

启动期需要把用户在 `adnclaw.system.capability-providers` 声明的 provider 列表解析为 `agent-capability` 消费的 `CapabilityProviderConfig[]`。第一性原理是：

1. 用户在启动期声明"我要加载哪些 provider"。
2. 系统在启动时把声明解析为单一 `ResolvedCapabilityProviders` 供下游消费。
3. 任何解析失败的条目形成 safe diagnostic；resolver 永不 throw；builtin provider 由 `agent-capability` 内部创建，对外部配置零依赖。

之前的中间命名（`FrozenCapabilitySourceConfig` / `frozenAt` / `readinessState` / `disabled` 等）和"providerKind 默认值规则"语义已被 design 推翻——本 change 是单次启动期解析，不存在 hot-reload，不需要"冻结"命名强化。

## 变更范围（What Changes）

- **定义配置路径**：`adnclaw.system.capability-providers`（值就是数组本身，没有 `providers` 中间层）
- **user 字段**：短而直观——`id` / `type`（kebab-case 闭集）/ `path` / `url` / `credential` / `installDir` / `adapter` / `config`
- **user 配置即启用**：无 `enabled` 字段。列入数组即视为启用，未列入即不参与。
- **类型闭集**：`local-directory` / `mcp-server` / `agent-registry` / `skill-hub` / `custom`。闭集校验由 resolver 完成，不在 schema 层 throw——未知值（含 `BUNDLED` / `builtin` 别名）一律进入 `UNSUPPORTED_PROVIDER_TYPE` safe diagnostic。
- **空配置语义**：`[]`（或缺失 `adnclaw.system.capability-providers`）→ resolver 返回 `{ providers: [], diagnostics: [] }`，系统照常启动；builtin 由 `agent-capability` 内部可信创建。
- **输出收敛为 2 字段**：`ResolvedCapabilityProviders.providers` + `ResolvedCapabilityProviders.diagnostics`。`readinessState` / `frozenAt` / `disabled` / `disabledCapabilityIdsByProviderId` 等"冻结"产物全部删除。
- **诊断是 read-only**：resolver 返回前对 `providers` 和 `diagnostics` 数组调用 `Object.freeze`，避免 request-time 代码误改启动期配置事实。

## Capability 影响（Capabilities）

- `CapabilityProviderConfig` 沿用 `capability-catalog/spec.md` 既有定义，本 change 不修改契约。
- 新增 `CapabilityProviderUserConfig` / `CapabilityProvidersConfig` / `CapabilityProviderDiagnostic` / `ResolvedCapabilityProviders` 四个 user-facing DTO + 一个 `CapabilityProviderConfigurationError`。
- `agent-capability` 仍只消费 `ResolvedCapabilityProviders.providers`；builtin provider 由其内部创建，user 配置无贡献。

## 主要 Owner

- Owner 9 Tool Capability

## 非目标（Non-Goals）

- 不定义 catalog 冲突解析、capability 优先级、descriptor schema、invocation 语义、routing 决策。
- 不实现 hot-reload（启动期一次性解析）。
- 不修改 `CapabilityProviderConfig` 契约（闭集 / options 形状由 `capability-catalog` 规范固定）。
