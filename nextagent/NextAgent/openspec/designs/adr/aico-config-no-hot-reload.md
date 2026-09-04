# ADR: AICOConfig 一次性加载

## 状态（Status）

Accepted.

## 背景与现状（Context）

AICOConfig 定制宿主 shell 外观、PIU 注入点和 panel/layout 行为。支持实时重配置需要在对话运行期间协调活跃 modal、自定义 panel、stream 渲染的答案动作、composer 布局和宿主 shell 几何。

## 决策（Decision）

AICOConfig 在每个宿主生命周期内只读取一次。Local 和 immersive 模式使用单一的宿主中立 loader，在页面启动期间读取 `sessionStorage["AICOConfig"]`，只在页面 reload 后刷新。Collaborative 模式在 `loadAIAgent` 发出时应用 payload；后续发出被视为完整替换而不是热合并，并重置活跃自定义 PANEL 状态。

## 理由（Rationale）

一次性加载保持集成的确定性，避免部分 UI 变更，同时为再次调用 `loadAIAgent` 的 collaborative 宿主保留受控的替换路径。把同一 loader 扩展到 local 模式消除了此前 local 宿主静默忽略有效产品定制的分歧，同时仍拒绝 runtime watcher、轮询或增量 patch API。

## 结果（Consequences）

不存在针对 `sessionStorage` 的 runtime watcher 或增量 patch API。需要不同 local 或 immersive 配置的宿主 reload 页面。需要不同配置的 collaborative 宿主发出完整 AICOConfig payload 并接受替换语义。此前依赖 AICOConfig 被忽略的 local 宿主现在必须确保任何遗留的 `sessionStorage["AICOConfig"]` 值得到有意识管理，因为缺失、畸形或部分非法的条目会被校验并 fail-soft 到默认值，而不是阻塞启动。
