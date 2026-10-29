# 已完成三项系统优化后的 Runtime 定位

MMIO/VM Exit 相关配置、大页和宿主核隔离均按用户已完成处理；本方案沿用这些配置，定位现有 Launch 中增加的处理或等待成本。

目前独立微基准已经确认：两侧 post6、已记录动态库哈希相同、无业务请求，queue0 下 HostArgs Launch P50 仍差约 10.7–13.0 μs，设备计算相近。因此本轮只使用原 demo 的 Sub、设备0、TASK_QUEUE_ENABLE=0，不增加核数或模型测试矩阵。

## 先用 Level2 获取可见的 Runtime API

旧 `bench.py` 的短采集使用 Level1。官方 torch_npu profiler 定义中，Level2 在 Level1 之上增加 `ACL_PROF_RUNTIME_API` 和 AICPU 数据：

https://raw.githubusercontent.com/Ascend/pytorch/master/torch_npu/csrc/profiler/profiler_mgr.h

新增 `runtime_level2.py` 是独立入口，复用原 `bench.py` 的预分配算子、CPU 分工、预热、无 profiler 计时及正确性检查。它仅替换独立短采集阶段：Level2、关闭 AI Core metrics、保留原始数据、128 次 Sub。

新入口不修改原 `bench.py`、旧 ZIP 和已采结果，也不调整系统配置。TASK_QUEUE_ENABLE 固定为0，在 import torch_npu 前设置。原有无 profiler 计时和 Level2 采集分开保存。Level2 会改变采集开销，因此不要将新 Level2 时长与旧 Level1 的时长直接相减估算真实增量，应在两边相同采集配置下比较。

## 执行

下载 `op_demo_level2.zip`，解压，进入其中的 `op_demo_level2` 目录。使用已经对齐的 post6 环境和相同的无业务请求窗口。

虚机：

```bash
python3 runtime_level2.py --placement vm144 --out results/vm_runtime_l2
```

裸机：

```bash
python3 runtime_level2.py --placement bare192 --out results/bare_runtime_l2
```

默认设备0、Sub `[8]`、queue0、batch256、20轮无 profiler 计时、200次预热（绑核前后各一段）、128次独立短采集。输出目录必须是新的。其他环境约束沿用 README_microbench.md：运行于 Linux Ascend 容器，预设 CPU/NUMA 必须匹配，ASCEND_LAUNCH_BLOCKING=1 会被拒绝。

## 看哪些结果

原有 `summary.json`、`measurements.csv`、`threads.json`、`environment.json` 和 `profile/` 都保留，新增 `runtime_detail.json`：

- `launch_count`：实际 HostArgs 调用数。
- `all_runtime_event_count`：实际看见的 Runtime 层 API 数量。
- `runtime_stats`：同线程、完整包含在每个 HostArgs 内部的 Runtime API 耗时统计。
- `per_launch`：每次 Launch 的墙钟时间、可见 Runtime 区间并集及其外侧时间。
- `observed_cann_names`：所有可见 CANN API 名称，避免因筛选规则而误以为现场没有数据。

Runtime 的父子区间可能嵌套：程序按并集计算覆盖，避免把父子时间相加。`mean_visible_self_us` 仅扣除已采到的嵌套 Runtime 区间，剩余仍可能包含未插桩工作和等待，不能叫纯CPU指令时间。时间边界完全相同的事件不强行指定父子关系，其 self 时间保留为空。

`status=ok` 仅表示找到了嵌套的 Runtime API。**Level2 不是私有 C++ 函数逐段插桩开关**：若只出现一个几乎包住全部 Launch 的 Runtime launch wrapper，内部参数复制/等待/SQ成本仍未拆开，不能宣布完成根因定位。

若没有可用 Runtime 层数据，脚本返回2，已有正式计时和原始trace保留；不要将“未采到”当作0耗时。下一步根据真实可见 API 名称/库符号确定少量探针，避免继续重复升级普通 profiling 等级。

## 根据可见位置决定处理方向

| 额外时间位置 | 继续定位对象 | 需要回答的问题 |
|---|---|---|
| 参数加载/复制 | LoadArgsInfo、H2DMemCopy、实际 BAR-copy/同步复制路径 | 两边copy policy是否相同；复制本身是否变贵 |
| 参数完成等待 | H2DMemCopyWaitFinish及驱动完成接口 | 是否等待DMA完成；是否轮询；等待发生在哪个阶段 |
| SQ发送 | halSqTaskSend或现场等效路径 | 提交阶段是否增加约10μs；是否经过更贵的驱动或设备访问 |
| 回收、分配、锁或限流 | TaskRes/回收/StreamLock等实际热点 | 是否因资源反压或锁而停留在Launch内部 |

这些内部函数来自既有参考源码，不保证 Level2 会输出对应私有函数名，也不保证安装包导出符号。拿到的Runtime API仍过粗时，下一步是**对当前二进制确认符号、做低频CPU栈抽样，再只对命中的少量位置测函数进出**。不建议为每次调用打印日志或给所有函数装探针，避免把原来几微秒的问题淹没在探针开销中。

参数 BAR-copy 与 Doorbell 访问也不是同一阶段。即使相关直通配置完成，资源管理、参数准备、复制完成等待、驱动提交等成本仍然存在；是否慢在其中哪段，应由分段时间选择修复动作。

## 本地验证边界

20 项程序测试通过，其中新增4项验证Runtime区间并集、父子嵌套、错误线程/进程排除、相同边界不虚构self时间。还用已采的裸机 post6 Level1 trace 验证：识别128次HostArgs、0条Runtime，正确输出 `no_nested_runtime_events`。

尚未在现场 NPU 上执行 Level2 入口；实际能输出哪些Runtime API应以现场结果为准。原有性能结论不依赖本次诊断入口。
