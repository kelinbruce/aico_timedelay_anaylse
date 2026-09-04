## 1. Spec

- [x] 1.1 新增 `capability-source-configuration` spec，固定 startup-only 的 capability provider 用户配置校验与解析机制。
  来源：spec requirement "Capability provider configuration is loaded and resolved during startup"
- [x] 1.2 明确配置路径：`adnclaw.system.capability-providers.providers`（第一次落地）
  来源：design 配置路径
  - **2026-06-09 第三次修订**：去掉 `providers` 中间层，配置路径简化为 `adnclaw.system.capability-providers`（值就是数组本身）。理由：user 配置除 `providers` 外没有其它字段，中间层无信息量；平铺后字段更短、YAML 写起来更直接。同步更新 proposal / design / spec。
- [x] 1.3 明确 `type` 闭集与 discoveryMode 默认值规则：`local-directory` → EAGER，`mcp-server` → SEARCH，`agent-registry` → EAGER，`skill-hub` → SEARCH，`custom` → EAGER
  来源：design providerKind 默认值规则

## 2. Design

- [x] 2.1 定义 `ResolvedCapabilityProviders` 为唯一输出（`providers` + `diagnostics` 两个字段）
  来源：design 核心数据结构
  - **2026-06-08 第二次修订**：删除 `FrozenCapabilitySourceConfig` / `frozenAt` / `readinessState` / `disabled` / `disabledCapabilityIdsByProviderId` / `disabledCapabilityIdsByProviderId` 等"冻结"语义。系统不支持 hot-reload，配置启动期一次性解析即可，命名与字段全部收敛。
  - 验证：`grep` 代码库确认这些命名/字段不再出现在最终代码与 spec 中
- [x] 2.2 user 字段名收敛：`id` / `type`（kebab-case）/ `path` / `url` / `credential` / `installDir` / `adapter` / `config`
  来源：design user → internal 字段映射
- [x] 2.3 builtin provider 由 `agent-capability` 内部创建，不进入 user 配置；user 配置即启用，无 `enabled` 字段
  来源：design 非目标
- [x] 2.4 写清 startup 阶段：加载 user 配置 → TypeBox schema 校验 → resolver 逐条处理 → 失败累计进 diagnostics → 输出 `ResolvedCapabilityProviders`
  来源：design 实现流程

## 3. 实现

- [x] 3.1 实现 `CapabilityProvidersConfig` / `CapabilityProviderUserConfig` / `CapabilityProviderUserType` 结构
  来源：design 核心数据结构
- [x] 3.2 实现 `resolveCapabilityProviders` resolver：user → internal 字段映射、必填引用校验、custom adapter 注册前提
  来源：design 实现流程
- [x] 3.3 实现配置校验：id 唯一、type 闭集、按 type 必填、credential `env:` / `file:`、path/url/installDir 引用解析
  来源：design 校验规则
- [x] 3.4 实现 fail-safe：resolver 永不 throw，失败进 diagnostics，builtin 兜底
  来源：design 失败与诊断
- [x] 3.5 平铺 `adnclaw.system.capability-providers.providers` → `adnclaw.system.capability-providers`（数组本身）
  - `CapabilityProvidersConfig` 由 `{ providers?: ... }` 改为 `readonly CapabilityProviderUserConfig[]`（type alias）
  - `RawCapabilityProvidersConfig` 由 `{ providers?: ... }` 改为 `readonly RawCapabilityProviderUserConfig[]`
  - `capabilityProvidersSchema` 由 `Type.Object({ providers: Type.Optional(...) })` 改为 `Type.Array(...)` 直接
  - `normalizeCapabilityProvidersConfig` 接受数组
  - `resolveCapabilityProviders` 入参由 `CapabilityProvidersConfig | undefined` 改为 `readonly CapabilityProviderUserConfig[] | undefined`
  - `default-system.yaml` 同步
  - 测试同步
  - proposal / design / spec 同步

## 4. 验证

- [x] 4.1 覆盖正常路径：配置完整，resolver 产出 `CapabilityProviderConfig[]` 并被下游消费
  来源：AGENTS.md 验证门禁
- [x] 4.2 覆盖边界路径：单条 invalid entry 不影响其它 entry；空配置 / undefined 永不阻塞
  来源：AGENTS.md 验证门禁
- [x] 4.3 覆盖失败路径：duplicate id、unsupported type、missing required field、invalid credential/url/path
  来源：AGENTS.md 验证门禁
- [x] 4.4 覆盖降级路径：每条 invalid entry 都形成一条 diagnostic；resolver 永不 throw
  来源：AGENTS.md 验证门禁
- [x] 4.5 覆盖安全路径：diagnostics 不暴露 raw secret、raw path、raw url、raw config 或 adapter-native exception
  来源：AGENTS.md 验证门禁
- [x] 4.6 运行 `npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`
  来源：AGENTS.md 验证门禁
- [x] 4.7 运行 `openspec validate add-ts-capability-source-configuration --strict`
  来源：AGENTS.md 验证门禁
