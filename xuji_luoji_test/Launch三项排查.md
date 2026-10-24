# Launch 三项排查结果

已完成现有两份 rank 0 profiling 能支持的线程确认、异常窗口提取和设备时间线对齐。**第 2 项的来宾/宿主调度归因、第 3 项的跨 rank 因果验证仍缺数据，不能宣布闭环。**

## 1. 确认实际调用线程：已完成

| 环境 | Worker PID | Launch TID | 次数 | 平均 μs | ≥1 ms 次数 |
|---|---:|---:|---:|---:|---:|
| 虚机 | 16881 | 16965 | 9206 | 48.34 | 3 |
| 裸机 | 33217 | 33302 | 9931 | 7.08 | 0 |

从 `CANN_API.globalTid` 拆出 PID/TID，并以 trace 的 `AscendCL@aclrtLaunchKernelWithHostArgs` 的 Thread Id 核验。全部 Launch 各自集中于上述一条线程。trace 线程名仅为 Thread 16965 / Thread 33302，不能据此认定线程名为 ACL，也无法确定所在 CPU 或绑核策略。此前 PID 2247 的亲和性不适用于本次 PID 16881。

## 2. 提取持续变慢和长尾窗口：已完成；调度对齐：缺少记录

持续窗口的可复现选择规则：在每个 execute_model scope 内，检查每 100 次连续 Launch，排除包含 ≥1 ms 调用的窗口，选择中位数最高者。这是定位用窗口，不是同 shape 对照实验。

| 环境 | execute_model 序号 | 起始时间 ns | 结束时间 ns | 次数 | 中位 μs | 平均 μs | 最小–最大 μs |
|---|---:|---|---|---:|---:|---:|---|
| 虚机 | 1 | 1792826269665148580 | 1792826269705658090 | 100 | 56.31 | 64.25 | 32.88–142.38 |
| 裸机 | 13 | 1792826684988922070 | 1792826685028278560 | 100 | 10.895 | 11.43 | 3.23–22.62 |

两环境窗口分别选择，并未逐次匹配形状，不用两行比值估计虚拟化净开销。窗口内还包含其他 Host 工作，窗口墙钟时长不是 Launch 累计时长。

虚机全部 3 次毫秒级长尾均在第 12 个 execute_model（eager_heavy）中：

| API connectionId | 起始时间 ns | 结束时间 ns | API μs | 对应 kernel | API 返回至 kernel 开始 μs |
|---:|---|---|---:|---|---:|
| 105925 | 1792826272149016250 | 1792826272153498140 | 4481.89 | ScatterNdUpdateSk | 71029.81 |
| 105952 | 1792826272153663130 | 1792826272155526470 | 1863.34 | QuantBatchMatmulV3 | 68964.24 |
| 104812 | 1792826272076098830 | 1792826272077122030 | 1023.20 | HcPre | 79345.96 |

关联方法：同 TID 上完整包含该 API 的最小 `launch` scope → 该 scope 的 connectionId → TASK → COMPUTE_TASK_INFO。不能直接拿 Launch API 本身的 connectionId 连接 TASK：本数据那样会得到零条匹配。虚机 9206、裸机 9931 次调用全部找到了计算任务。

现有数据库没有 sched_switch、sched_wakeup、CPU 运行区间或 QEMU vCPU 调度表；profiler 配置 `_host_sys=[]`、`with_stack=false`。现有输入也没有对应宿主的调度记录和 vCPU 映射。因此 **无法把上述 API 时长拆成 on-CPU、runnable 等待和阻塞时间**，也无法判断哪次调用遇到了宿主抢占。Host/FRAMEWORK 的 scope 不是操作系统调度事件。

## 3. 对齐设备空档和通信：本 rank 已检查，其他 rank 缺失

将 `OVERLAP_ANALYSIS` 的 COMPUTE 与 COMMUNICATION 区间取并集，再求并集内部空档。该指标仅表示“采集的计算/通信区间均未覆盖”，不等于整颗 NPU 的所有硬件单元完全空闲。API 与 kernel 的时间差也不是纯队列等待或纯下发延迟。

**三次毫秒级长尾调用期间，计算/通信并集空档均为 0 μs。** 对应 kernel 在 API 返回后约 69–79 ms 才开始，说明这些样本没有显示“该 API 长尾期间设备立即断粮”。设备上已有工作或依赖尚未完成等解释仍需进一步区分，不能由此反推已证实 Runtime 队列反压，也不能排除对后续关键路径的影响。

有一个更适合检查 Host→设备空档的样本：

- 虚机 connectionId **97231**，TID **16965**，第 11 个 execute_model（graph）。
- API：`1792826271582078880–1792826271582624130 ns`，持续 **545.25 μs**。
- 计算/通信空档：`1792826271580083290–1792826271582775390 ns`，共 **2692.10 μs**。
- 关联 Fill kernel 起点：`1792826271582775390 ns`，API 返回后 **151.26 μs**，恰好结束上述空档。
- 空档在 API 开始前已存在 **1995.59 μs**。因此不能把 2692.10 μs 全部归给这个 API；这只是可追查的时间关联，未量化缩短 Launch 后能消除多少空档。

通信核查也不能只看“后面出现了长通信”：

| API connectionId | API 返回后下一条通信 | 距返回 μs | 通信持续 μs |
|---:|---|---:|---:|
| 105925 | hcom_allReduce__503_513_1 | 5570.49 | 7700.24 |
| 105952 | hcom_allReduce__503_513_1 | 3542.16 | 7700.24 |
| 104812 | hcom_allReduce__503_507_1 | 4766.02 | 4579.08 |
| 97231 | hcom_allReduce__503_261_1 | 9806.16 | 17982.04 |

这些只是按开始时间找的邻近通信，不是经过依赖图证明的下游任务。前两次还指向同一通信，不能重复累计。尤其三次毫秒级长尾的上述通信均早于对应 kernel 执行，不能套成“该 kernel 执行晚导致这条通信等待”的链条。

两份 `RANK_DEVICE_MAP` 都仅含 rank 0/device 0；通信组元数据写有 rank 0–7，不代表采集了其他 rank。故尚不能验证“本 rank 下发晚 → 其他 rank collective 等待”，也不能把通信增长定量归因于这些 Launch。

## 要闭环必须补齐的记录

下一次需在同一次复现窗口内同步取得：

1. 来宾的 sched_switch / sched_wakeup 和必要的运行栈；保存当次 worker PID、Launch TID、每线程 affinity 及 CPU 编号。用 sched_switch 的退出状态和 wakeup 分开 runnable 等待与阻塞，不能只统计 off-CPU 总时长。
2. 宿主同窗口的 QEMU vCPU 线程调度事件、vCPU→QEMU TID→pCPU 映射、CPU quota/throttling 与线程 affinity。同步记录来宾与宿主时钟校准点及误差；不能直接将两侧时间戳视为同一时钟。
3. rank 0–7 的 profiling、通信组/序号和时钟对齐信息，以及固定请求/shape/执行阶段。逐 collective 比较各 rank 的提交、开始和结束时间，检查早到 rank 是否等待晚到 rank。

历史窗口没有采下来的调度状态不能通过重跑恢复。新采集可检验同类现象，不能替代原来那 3 次调用的确切调度证据。当前无需先调整 ACL 核数；先补齐能区分四类原因的观测。

## 复现和明细

- `investigate_launch.py`：只读原始 SQLite，时间戳全程用整数 ns；从本目录 `summary.json` 获取输入路径。
- `launch_investigation.json`：线程、分位数、窗口、异常样本和数据表清单。
- `{xuji,luoji}_launch_calls.csv`：全部 Launch 及关联 kernel。
- `{xuji,luoji}_sustained_launch_window.csv`：各 100 次持续窗口。
- `{xuji,luoji}_launch_tail_cases.csv`：各前 5 次长尾及时间线邻近事件。

从仓库根目录运行 `python3 outputs/xuji_luoji_profiling_20261024/investigate_launch.py`。若临时解包目录已被清理，先运行同目录 `analyze_profiles.py` 重建。
