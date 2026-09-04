## 1. Spec

- [x] 1.1 定义 `bash` timeout 兼容性：canonical `timeout` 保持稳定，同时接受别名 `timeout_ms`。
  验证：OpenSpec 评审和 `openspec validate --all --strict`。

## 2. 实现

- [x] 2.1 扩展 `bash` 输入处理以接受兼容别名 `timeout_ms`，不改变既有 `timeout` 语义。
  验证：针对 canonical 和别名 timeout 输入的 Bash capability 测试。
- [x] 2.2 当两个 timeout 字段同时存在时保持 `timeout` 权威。
  验证：Bash capability 优先级测试。

## 3. 验证

- [x] 3.1 运行针对 timeout 兼容性的聚焦 bash capability 测试。
- [x] 3.2 运行 `openspec validate --all --strict`。
