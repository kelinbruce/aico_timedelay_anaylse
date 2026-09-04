## 1. FN-8.2 检索和写入记忆

- [x] 1.1 区分 L1 检索与 L2 详情读取的未命中、失败和取消诊断码。
- [x] 1.2 保持上下文准入、全有或全无与不重试行为不变。

## 2. FN-10.1 生命周期 Hook

- [x] 2.1 细化 Hook 前置、binding、RequestRun 和根消息诊断码。
- [x] 2.2 补充 Hook 与召回服务的分阶段诊断测试。

## 3. 共享验证

- [x] 3.1 运行受影响单元测试与本 change 的 OpenSpec strict 验证。
- [x] 3.2 对改动执行语义代码检视。

> 仓库级 `openspec validate --all --strict` 当前被无关 change `fix-skill-projection-diagnostics` 阻断；本 change 的 strict 校验已通过。
