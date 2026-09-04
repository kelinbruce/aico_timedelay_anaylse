# add-ts-long-running-capability-control

规划入口：[UCD 能力差距交付里程碑](../roadmap/ucd-capability-delivery.md)
所属分组：UCD-P3

状态：clarify
类型：candidate capability group
主要 owner：待拆分；不得由单一 change 同时接管多个 lifecycle owner
认领人：不可认领
依赖：既有 request cancellation、Bash background task、session fork、workflow progress 和 capability metadata

当前状态：
- request cancel、Bash 后台执行、session fork 和 workflow safe progress 已分别存在，但属于不同 authority 和生命周期。
- 当前没有通用 capability 声明能保证任意工具都可取消、转后台、fork 或从 history 恢复 progress。
- Bash model-facing `run_in_background` schema 仍承诺完成后通知，但当前自然完成/Kill 只更新 durable terminal/timeline，不创建 continuation run 或 chat notification；这是必须先做 contract/spec/schema 同步的已知漂移，不能当作产品承诺。

目标：
- 把 A3/A4/B2/B20 拆成可独立交付的用户控制能力，而不是建立一个横跨 runtime、capability、background task、session 和 frontend 的总控 change。

进入 `ready` 前必须先拆分：
- progress authority/projection：哪些 capability 提供 canonical safe progress，live-only 还是可 replay。
- cancellation contract：哪些 invocation 可安全取消，谁确认取消完成及 terminal race。
- background detach：哪些 capability 可脱离当前请求、结果进入哪里、如何查看和 kill。
- fork-to-continue journey：anchor、草稿迁移和原长任务保持规则。

每个拆分必须分别确认：
- 触发阈值与 capability/provider 声明；前端和模型输出不能临时授予能力。
- 单一 lifecycle owner、入口、状态路径、失败/恢复和独立用户可见验收。
- 是否修改 public capability metadata、runtime command、stream event 或 gateway record；有变化先做 contract refinement。
- model-facing capability schema、stable background specs、实际 stream/terminal 行为和 UCD 文案必须同形；若保持 silent completion，就删除“稍后通知”承诺并定义模型如何主动查看结果。

实现约束：
- 复用既有 authority，不创建卡片私有 lifecycle、第二套 scheduler 或通用 workflow engine。
- `outputContextMode` 若保留，必须由受治理 descriptor 定义，不能由前端或模型参数决定。
- 不允许先实现 CTA，再补后端语义。

非目标：
- 不把所有工具声明为可后台化或可取消。
- 不绕过 same-session lane、terminal commit、risk policy 或 authorization pending input。

并行边界：
- clarify 状态不可实施。
- 只有拆分后的 change owner、contract 和冲突面稳定后，才分别评估并行开发。
