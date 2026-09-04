# Tasks

- [x] 更新 `skill-resource-access` spec，覆盖当前 run 重授权与重披露。
- [x] 新增 capability 拥有的已提交 Skill 投影重授权。
- [x] 在模型调用前重披露匹配的先前 Skill roots。
- [x] 为跨 run 重授权、sandbox 可见性和只读强制执行新增聚焦测试。
- [x] 运行聚焦验证。
- [x] 扩展重授权契约与设计，覆盖被选中的先前 tool-call 参数，同时拒绝宿主绝对路径。
  - 实际：更新了 proposal、design 和 delta spec；`openspec validate fix-skill-resource-projection-refresh --strict` 通过。
- [x] 为先前 Bash tool-call 参数中的逻辑 Skill 路径和宿主绝对路径不授权新增失败的 `agent-core` 回归测试。
  - 实际：逻辑路径测试在实现前复现了零次重授权调用，宿主绝对路径 negative 用例通过。
- [x] 扩展渲染上下文候选提取，纳入序列化 tool-call 参数，不改变 descriptor 或已提交 marker 校验。
  - 实际：`modelMessageSearchableText()` 现在搜索序列化的 `toolCall.arguments`；聚焦的逻辑路径和宿主绝对路径测试均通过。
- [x] 通过生产 capability 子系统和 app composition root 接线已提交投影重授权。
  - 实际：`WorkspaceFilePort` 校验投影身份和已提交 marker，`CapabilitySubsystem` 暴露窄域 port，request-runtime composition 把它注入 `DefaultAgent`。
  - 证据：新的跨 run 投影测试在实现前以 `port.reauthorizeSkillResources is not a function` 失败；组合 characterization 也因缺少生产注入而失败。修复后两个目标断言均通过。
- [x] 运行聚焦测试、build、架构检查和严格 OpenSpec 校验。
  - 实际：聚焦 `agent-core` 33/33；capability 投影/tool 测试 59 通过、2 个既有跳过；根 build；unit 1161/1161；contract 332/332；architecture 247/247；前端 build 和 1696/1696 测试；严格 OpenSpec 267/267；`npm run pack:release -- skip` 含归档自检。
