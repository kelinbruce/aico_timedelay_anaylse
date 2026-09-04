# watermark-gateway Delta

## MODIFIED Requirements

### Requirement: Watermark is disabled by default and controlled by config

水印默认关闭。集成方通过 agent package 的 `config/config.json` 中 `watermarkEnabled` 字段（boolean）控制是否启用水印。系统 MUST 在**请求时**（而非启动时）读取 `watermarkEnabled`，`config/config.json` 文件缺失、`watermarkEnabled` 字段缺失或类型不正确时 MUST 返回 `false`，MUST NOT 抛异常。系统 MUST 使用文件指纹缓存（`statSync` 的 `size + mtimeMs`）避免重复读取未变更的配置文件，指纹未变化时返回缓存值。channel 层在实际调用时检查 `watermark` port 是否存在——`getWatermarkEnabled()` 返回 `true` 但没有 `watermark` binding 时，transform 不执行，原文返回。

当 `gatewayBindings.watermark` binding 存在时，composition 层 MUST 总是注入 watermark port，不因启动时配置读取失败而跳过 port 注入。水印是否生效由请求时 `getWatermarkEnabled()` 的返回值决定。

#### Scenario: Config file not ready at startup becomes available later

- **WHEN** 应用启动时 `config/config.json` 不存在（如 CSI 卷异步挂载），但首次请求时文件已就绪且含 `watermarkEnabled: true`
- **THEN** 首次请求调用 `getWatermarkEnabled()` MUST 返回 `true`
- **AND** 水印 transform MUST 正常执行

#### Scenario: Config file unchanged uses cached value

- **WHEN** `getWatermarkEnabled()` 被多次调用且 `config/config.json` 的 `statSync` 指纹未变化
- **THEN** 系统 MUST 返回缓存值，不重复读取文件

#### Scenario: Config file changed reloads value

- **WHEN** `config/config.json` 被修改（指纹变化），`watermarkEnabled` 从 `true` 改为 `false`
- **THEN** 下次 `getWatermarkEnabled()` 调用 MUST 重新读取文件并返回 `false`
- **AND** 后续水印 transform MUST 不执行

#### Scenario: Watermark disabled by default

- **WHEN** `config/config.json` 不存在或不含 `watermarkEnabled` 字段
- **THEN** 水印 transform MUST 不执行
- **AND** 所有返回内容 MUST 为原文

#### Scenario: Watermark enabled by config

- **WHEN** `config/config.json` 含 `watermarkEnabled: true` 且 gateway bindings 中存在 `watermark` binding
- **THEN** channel 层 MUST 对满足条件的内容执行水印 transform

#### Scenario: Watermark binding absent disables transform

- **WHEN** `getWatermarkEnabled()` 返回 `true` 但 gateway bindings 中不存在 `watermark` binding
- **THEN** 水印 transform MUST 不执行
- **AND** 所有返回内容 MUST 为原文
