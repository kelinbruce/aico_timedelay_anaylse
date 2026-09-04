## 背景和现状（Context）

capability provider configuration 的第一性原理是：用户在启动期声明"我要加载哪些 provider"，系统在启动时把声明解析为 `CapabilityProviderConfig[]` 供 `agent-capability` 消费。任何解析失败的 provider 都形成一条 safe diagnostic；系统本身**不阻塞**启动——builtin provider 始终由 `agent-capability` 内部创建，对外部配置零依赖。

本 change 业务边界只覆盖 provider 的 user → internal 字段映射、必填引用校验、custom adapter 注册前提；它不负责 capability descriptor 结构、capability invocation、catalog conflict resolution、cross-provider priority、routing 决策。

## 目标和非目标（Goals / Non-Goals）

### 目标

- 定义 user-facing 配置路径：`adnclaw.system.capability-providers`
- 定义 user 字段到 internal `CapabilityProviderConfig` 的映射
- 启动期完成 user 配置校验、字段映射、引用解析
- 向下游暴露 `CapabilityProviderConfig[]` 加 safe diagnostics

### 非目标

- 不定义 catalog 冲突解析、capability 优先级、descriptor schema
- 不定义 invocation 语义、routing、provider 内部实现
- 不实现 hot-reload（启动期一次性解析）

## 配置路径和 user 字段

### 配置文件

配置路径：`adnclaw.system.capability-providers`（值就是数组本身，没有 `providers` 中间层）

```yaml
adnclaw:
  system:
    capability-providers: []   # 不写就是空；不写 ≠ 禁用
```

### user → internal 字段映射

| user 字段 | 必填性 | 适用 type | 映射到 internal |
|----------|--------|----------|-----------------|
| `id` | 必填 | 所有 | `provider.providerId` |
| `type` | 必填 | 所有 | `provider.providerKind`（kebab → SCREAMING_SNAKE） |
| `path` | local-directory 必填 | local-directory | `options.directoryRef`（启动期解析为绝对路径） |
| `url` | mcp-server / agent-registry / skill-hub 必填 | 同上 | `options.endpoint`（mcp-server、skill-hub）/ `options.registryRef`（agent-registry） |
| `credential` | 可选 | mcp-server / agent-registry / skill-hub | `options.credentialRef`（必须是 `env:` 或 `file:` SecretReference） |
| `installDir` | skill-hub 必填 | skill-hub | `options.managedInstallRef` |
| `adapter` | custom 必填 | custom | `provider.providerType` |
| `config` | 可选 | custom | `options.customOptions` |

> **`type` 闭集**：`local-directory` / `mcp-server` / `agent-registry` / `skill-hub` / `custom`。
> 任何不在闭集内的 `type` 立即产生 `UNSUPPORTED_PROVIDER_TYPE` diagnostic。
> `BUNDLED` / `builtin` / 其它别名都不接受——builtin 由 `agent-capability` 内部可信创建。

> **`enabled` 字段删除**：user 配置即启用。未列入数组的 provider 不参与；列入即视为启用。`enabled: true/false` 视为非法字段被 TypeBox 拒收。

> **空配置语义**：`[]`（或缺失 `adnclaw.system.capability-providers`）→ resolver 返回 `providers: []`，diagnostics 为空。系统照常启动；`agent-capability` 内部注册 builtin provider 即可，user 配置无贡献。

### 配置示例

```yaml
adnclaw:
  system:
    capability-providers:
      providers:
        - id: workspace-tools
          type: local-directory
          path: ./capabilities/workspace
          credential: env:MY_TOKEN  # 可选

        - id: filesystem-mcp
          type: mcp-server
          url: http://localhost:3000
          credential: env:FILESYSTEM_MCP_TOKEN  # 可选，但若写必须 env:/file:

        - id: hub-a
          type: skill-hub
          url: http://hub.example
          installDir: ./skills  # skill-hub 必填
          credential: env:HUB_TOKEN  # 可选

        - id: custom-a
          type: custom
          adapter: vendor-a  # custom 必填
          config:  # 可选，透传到 options.customOptions
            mode: test
```

## 核心数据结构

### `CapabilityProviderUserConfig`（user-facing YAML DTO）

```typescript
interface CapabilityProviderUserConfig {
  readonly id: string;
  readonly type: "local-directory" | "mcp-server" | "agent-registry" | "skill-hub" | "custom";
  readonly path?: string;
  readonly url?: string;
  readonly credential?: SecretReference;
  readonly installDir?: string;
  readonly adapter?: string;
  readonly config?: JsonObject;
}
```

### `CapabilityProvidersConfig`（user-facing 顶层，平铺为数组）

```typescript
type CapabilityProvidersConfig = readonly CapabilityProviderUserConfig[];
```

> 平铺后，`adnclaw.system.capability-providers` 本身就是这个数组的 YAML 序列化形式。中层 `providers` 包装删除：user 配置除 providers 外无其它字段，中间层无信息量。
> 内部字段（`DefaultSystemConfig.userCapabilityProviders`）保留 `CapabilityProvidersConfig` 命名，但语义就是数组。

### `ResolvedCapabilityProviders`（resolver 唯一输出）

```typescript
interface ResolvedCapabilityProviders {
  /** 校验通过、可被 agent-capability 消费的 provider 配置数组 */
  readonly providers: readonly CapabilityProviderConfig[];

  /** 校验期间产生的安全诊断（不暴露 raw secret/path） */
  readonly diagnostics: readonly CapabilityProviderDiagnostic[];
}
```

> **设计简化（2026-06-08 第二次修订）**：
> - 删除 `FrozenCapabilitySourceConfig` 命名——系统不支持 hot-reload，配置启动期一次性解析即可，不需要类型名强调"冻结"
> - 删除 `CapabilitySourceConfig` / `CapabilitySourceProviderConfig` 等含 `Source` 中缀的类型——`capability source` 是抽象层术语，下游只关心 `provider`
> - 输出收敛为 2 字段：`providers` + `diagnostics`。`readinessState` / `disabled` / `disabledCapabilityIdsByProviderId` / `frozenAt` 全部删除
> - 永不 throw：resolver 永远返回 `ResolvedCapabilityProviders`；失败条目进 `diagnostics`，不阻塞启动；builtin 兜底
> - user 字段名重命名：`providerId` → `id`、`providerKind` → `type`（kebab-case）、`locationRef` → `path`、`credentialRef` → `credential`、`managedInstallRef` → `installDir`、`providerType` → `adapter`、`customOptions` → `config`
> - 删除 `enabled` 字段：user 配置即启用
> - 闭集严格化：`type` 仅接受 `local-directory` / `mcp-server` / `agent-registry` / `skill-hub` / `custom`；`BUNDLED` 拒收

> **配置路径平铺（2026-06-09 第三次修订）**：
> - 去掉 `adnclaw.system.capability-providers.providers` 的 `providers` 中间层，配置路径简化为 `adnclaw.system.capability-providers`（值就是数组本身）
> - `CapabilityProvidersConfig` 由 `{ providers?: readonly CapabilityProviderUserConfig[] }` 改为 `type alias = readonly CapabilityProviderUserConfig[]`
> - `RawCapabilityProvidersConfig` 同步平铺
> - 内部字段 `DefaultSystemConfig.userCapabilityProviders` 保留原命名，类型就是 `CapabilityProvidersConfig`（即数组）
> - `default-system.yaml` 同步：`-` 列表项直接挂在 `capability-providers` 下

### `CapabilityProviderConfig`（capability-catalog 规范定义，本设计直接复用）

```typescript
interface CapabilityProviderConfig {
  readonly provider: CapabilityProvider;        // { providerId, providerKind, providerType? }
  readonly discoveryMode: CapabilityDiscoveryMode;  // EAGER | SEARCH
  readonly options: CapabilityProviderOptions;   // LocalDirectoryOptions | McpServerOptions | ...
}
```

> **决策**：使用 `capability-catalog/spec.md` 定义的嵌套结构 `{ provider, discoveryMode, options }`，而非扁平结构。
>
> **discoveryMode 默认值**（按 `type`）：
>
> | type | discoveryMode |
> |------|---------------|
> | `local-directory` | EAGER |
> | `mcp-server` | SEARCH |
> | `agent-registry` | EAGER |
> | `skill-hub` | SEARCH |
> | `custom` | EAGER |

## 实现流程

```
[App Startup]
    │
    ▼
[1. 加载 adnclaw.system.capability-providers（TypeBox schema 校验，拒非法字段）]
    │
    ▼
[2. resolver 逐条处理 user entry]
    │   - id 唯一性
    │   - type 必须在闭集内
    │   - 按 type 校验必填字段
    │   - 解析 path / url / credential / installDir
    │   - 检查 custom adapter 是否注册
    │
    ▼
[3. 失败的 entry 累计进 diagnostics，继续处理下一条]
    │
    ▼
[4. 校验通过的 entry 映射为 CapabilityProviderConfig]
    │   - id → providerId
    │   - type → providerKind
    │   - adapter → providerType
    │   - path/url/installDir/credential/config → options.*
    │   - discoveryMode 按 type 默认
    │
    ▼
[5. 返回 ResolvedCapabilityProviders]
    │   - providers（成功条目）
    │   - diagnostics（失败条目 + 失败原因）
    │
    ▼
[6. agent-capability 接收 providers，builtin 由自身内部创建]
    │   - 不论 user 配置如何，builtin provider 永远存在
    │   - 不存在 BLOCKED / DEGRADED_READY 状态——失败不进 providers 就完事
    │   - 不存在 throw
```

## 失败与诊断

每条失败 user entry 对应一条 diagnostic，**不**影响其它 entry。Reason code 闭集：

| Reason code | 触发条件 |
|-------------|---------|
| `DUPLICATE_PROVIDER_ID` | `id` 在 user 配置内重复 |
| `UNSUPPORTED_PROVIDER_TYPE` | `type` 不在闭集内 |
| `MISSING_REQUIRED_FIELD` | 按 type 必填的字段未提供（如 `local-directory` 缺 `path`） |
| `INVALID_CREDENTIAL_REFERENCE` | `credential` 不符合 `env:` / `file:` 语法 |
| `INVALID_PATH` | `path` 解析失败（非字符串、空白、绝对路径转换失败） |
| `INVALID_URL` | `url` 不可解析为合法 http(s) URL |
| `CUSTOM_ADAPTER_UNREGISTERED` | `custom` 的 `adapter` 不在 app composition 注册集内 |
| `PROVIDER_ADAPTER_UNREGISTERED` | type 对应的 builtin adapter 未注册（composition 注入失败） |

每条 diagnostic 包含 `reasonCode` / `severity` / `message` / `providerId`。`message` 是 static 字符串或只含 `id` / `type` / `adapter` 的安全模板，**绝不**回显 `path` / `url` / `credential` / `config` 的原始值。

## 影响模块

- `agent-app`：持有 `ResolvedCapabilityProviders`，负责 user → internal 映射
- `agent-capability`：只消费 `ResolvedCapabilityProviders.providers`；builtin provider 由自身内部创建
- `agent-core/agent-runtime`：只消费 catalog 结果，不消费 provider 配置
