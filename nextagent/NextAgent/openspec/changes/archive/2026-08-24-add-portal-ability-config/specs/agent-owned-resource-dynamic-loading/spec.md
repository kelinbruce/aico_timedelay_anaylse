## Function

- **所属 Function**：`FN-5.2 调用能力`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：补充规格

## ADDED Requirements

### Requirement: Portal ability configuration fields and defaults

Agent package 的 `config/config.json` MUST 支持顶层 `portal-ability-config` 对象。系统 MUST 只从以下字段解析 effective 值：

- `suggested-questions-enabled`：boolean，默认 `true`；
- `ask-user-question-time-minutes`：integer，取值 `1..1440`，默认 `30`。

未知字段 MUST 被忽略，MUST NOT 改变 effective config 或使已解析字段失效。

`portal-ability-config` 缺失、不是 object、任一字段缺失或类型与范围非法时，系统 MUST 使用对应字段的安全默认值，MUST NOT 抛出异常、阻断请求或把非法值 clamp 到边界值。配置值 MUST 来自 active Agent package 的受信文件，MUST NOT 来自请求体、客户端 metadata、模型输出或 Capability 参数。

**需求类别**：功能性需求

#### Scenario: 缺失配置使用默认值
- **WHEN** active Agent package 的 `config/config.json` 不存在，或不含 `portal-ability-config`
- **THEN** effective config MUST 为 `suggested-questions-enabled=true` 且 `ask-user-question-time-minutes=30`

#### Scenario: 非法等待时间回到默认值
- **WHEN** `ask-user-question-time-minutes` 为 `0`、负数、非 integer、`1441` 或非 number
- **THEN** effective `ask-user-question-time-minutes` MUST 为 `30`
- **AND** MUST NOT 把非法值截断为 `1` 或 `1440`

#### Scenario: 边界值合法
- **WHEN** `ask-user-question-time-minutes` 为 `1` 或 `1440`
- **THEN** effective `ask-user-question-time-minutes` MUST 分别保持 `1` 或 `1440`

#### Scenario: 非法推荐问题开关回到默认值
- **WHEN** `suggested-questions-enabled` 不是 boolean
- **THEN** effective `suggested-questions-enabled` MUST 为 `true`

#### Scenario: 未知字段不改变有效配置
- **WHEN** `portal-ability-config` 同时包含两个合法字段和一个未知字段
- **THEN** 两个合法字段的 effective 值 MUST 保持不变
- **AND** 未知字段 MUST NOT 改变任何 effective 值

### Requirement: PortalAbilityConfigProvider follows deployment-mode loading policy

App composition MUST 按 deployment mode 选择 `PortalAbilityConfigProvider` 实现。LOCAL 模式 MUST 在首次读取后缓存 effective config，后续 `get()` 返回同一静态值，MUST NOT 做 fingerprint 检测。REMOTE 模式 MUST 在每次 `get()` 时使用 `statSync` 的 `size + mtimeMs` fingerprint 检测 active Agent package 的 `config/config.json`；fingerprint 未变化时返回缓存值，变化时重新读取并更新缓存。REMOTE 模式文件不存在、JSON 解析失败或配置非法时 MUST 返回安全默认值，MUST NOT 抛出异常或阻断请求。

**需求类别**：系统质量属性

**质量属性**：可靠性/恢复

**适用范围**：`FN-5.2 调用能力`

#### Scenario: LOCAL 模式配置不热更新
- **WHEN** LOCAL 模式 provider 已读取 effective config
- **AND** `config/config.json` 之后被修改
- **THEN** 后续 `get()` MUST 返回已缓存的旧值
- **AND** MUST NOT 执行 fingerprint 检测

#### Scenario: REMOTE 模式配置变化后重新加载
- **WHEN** REMOTE 模式 provider 已缓存 effective config
- **AND** `config/config.json` 的 `size` 或 `mtimeMs` 变化
- **THEN** 下一次 `get()` MUST 重新读取文件并返回新的 effective config
- **AND** MUST NOT 返回修改前的缓存值

#### Scenario: REMOTE 模式配置缺失返回默认值
- **WHEN** REMOTE 模式下 `config/config.json` 不存在
- **THEN** `PortalAbilityConfigProvider.get()` MUST 返回默认值
- **AND** MUST NOT 返回 `undefined`
- **AND** MUST NOT 阻断 bootstrap 或 runtime 消费方

#### Scenario: REMOTE 模式非法配置返回默认值
- **WHEN** REMOTE 模式下 `config/config.json` 存在但 JSON 解析失败或 `portal-ability-config` 非法
- **THEN** provider MUST 返回安全默认值
- **AND** MUST NOT 抛出异常
