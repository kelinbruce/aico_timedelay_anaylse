## 实现

- [x] 为可采取行动的 sandbox 拒绝 safe error 新增 OpenSpec delta。
- [x] 更新本地 sandbox 拒绝 code，使被拒绝的请求在 gateway 边界不再被标记为 unavailable。
- [x] 把不支持的 Python 调用拒绝映射为带纠正提示的 capability 输入校验 safe error。
- [x] 为 gateway 和 capability 映射新增聚焦的回归测试。
