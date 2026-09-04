## Why

最终用户在普通 Web 界面查看长期记忆与 Skill 获取过程时，可能面对包含记忆正文、记忆标识、检索分数或 provider 信息的 Capability 结果。当前平台虽然会因缺少安全 projector 把这些结果收窄为 `STATUS_ONLY`，但启动期内置策略没有明确登记 `search_memory`、`get_memory_detail`、`add_memory` 和 `acquire_skill`，导致平台默认意图依赖“未知结果安全降级”间接成立，集成方也难以从配置文档判断四类结果的默认边界。

现在需要把该安全意图固化为显式基线，并验证集成方请求 `SUMMARY` 或 `DETAIL` 时仍不能突破平台安全上限，从而让用户、Agent 开发者和平台集成方获得一致且可重复验收的显示结果。

## 目标与非目标

目标：

- 未提供呈现配置时，四个精确 Capability 身份均以 `STATUS_ONLY` 作为内置策略基线。
- 集成方可以继续通过精确规则请求 `SUMMARY` 或 `DETAIL`；配置请求会被接受并冻结，但四类结果在没有平台安全 projector 时的有效级别仍为 `STATUS_ONLY`。
- 实时流、运行历史和三种 Web 宿主继续使用同一安全投影，成功结果不向浏览器发送记忆正文、记忆标识、检索分数、SkillHub provider 信息或任意原始结果字段。
- 安全失败继续显示既有事实性安全原因，不因本 change 改变失败可见性。

非目标：

- 不为四类结果新增 `SUMMARY` 或 `DETAIL` 安全 projector。
- 不改变 Capability 的模型可见输入输出、canonical Result Message、请求生命周期、持久化事实或公共 Web schema。
- 不新增运行期管理界面、热更新、按用户配置或按 Agent 配置。
- 不为本地完整服务补建 SkillHub provider 或 `acquire_skill` 绑定；真实环境不可调用时，由配置与共享投影自动化测试验证其呈现契约。

## What Changes

- 将 `search_memory`、`get_memory_detail`、`add_memory` 和 `acquire_skill` 加入 Capability 结果呈现内置策略基线，级别为 `STATUS_ONLY`。
- 保持集成方精确覆盖规则的既有语义：同名规则替换内置请求级别，未覆盖项保留各自基线。
- 保持平台安全上限优先：在四类结果没有平台管理的安全 projector 时，请求 `SUMMARY` 或 `DETAIL` 的有效级别仍为 `STATUS_ONLY`，且不返回成功结果摘要或详情。
- 同步面向集成方的配置使用说明，明确内置基线与覆盖后的实际安全效果。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-2.4 查看请求状态`：修改 canonical spec `ts-run-status-visibility` 中“Capability 结果呈现策略受平台安全上限约束”，显式登记四类 Capability 的内置基线，并冻结默认、`SUMMARY` 精确覆盖和 `DETAIL` 精确覆盖时的黑盒结果。该变化强化安全、可测试性和可维护性，不改变公共 API 或状态模型。

## 影响范围

- 最终用户：四类成功结果在普通 Web 界面只显示业务身份和执行状态，不显示结果摘要或详情。
- Agent 开发者与平台集成方：可以显式覆盖四类 Capability 的请求级别，但只有未来存在平台安全 projector 时，较高级别才可能产生更丰富的有效投影。
- 运维人员：配置仍在应用启动时校验并冻结，修改后必须重启；非法配置仍阻止应用 ready。
- 兼容性：无破坏性公共契约变化；已有安全失败、实时/历史一致性和三种 Web 宿主一致性保持不变。

## 需群内确认

None。本 change 不修改 `agent-contracts`、公共 API、跨 owner 边界、持久化模型或平台安全上限，只把现有安全降级意图显式化为内置配置基线，并保留既有精确覆盖机制。
