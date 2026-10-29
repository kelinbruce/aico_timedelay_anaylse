# Ascend 算子准备与下发微基准

目标：不加载 vLLM、不加载模型、不进行 HCCL 通信，用固定小算子检验虚机与裸机之间的 Host 路径差距。正式计时关闭 profiler；独立短 trace 用于确认实际调用的 ACL API、设备 kernel 和线程。

这是一份可以先在现有 torch_npu 容器运行的复现程序。它测量 Python → torch_npu → CANN → NPU 这条短路径，不声称 Python 循环时间就是 `aclrtLaunchKernelWithHostArgs` 时间，也不预先假定底层一定使用这个接口。如果短 trace 没有命中该接口，会明确报告。

## 首轮运行

需要 Linux、现有 PyTorch/torch_npu/CANN 环境、可访问的 Ascend NPU。无需新增 pip 包、编译器、vLLM 或模型文件。激活你原来运行 VA 的容器环境即可；不在 Mac 上进行真实性能测试。

建议停止同一张卡上的模型服务，或选空闲卡；两边都使用相同的独占测试方式。`npu-smi info` 会保存在结果内，便于识别其他进程。微基准不负责停止服务。

把本目录复制到两边的容器中，在目录内运行。默认会依次测试逻辑设备 0 和 6，各自运行，不是 TP8、也不是原业务中的 rank6 进程。首轮需要更短时可以先只用 `--devices 0`。

虚机：

```bash
python3 run_suite.py --placement vm144 --out results/vm
```

裸机：

```bash
python3 run_suite.py --placement bare192 --out results/bare
```

`--out` 必须是新目录，避免覆盖之前的结果。两条命令默认使用完全相同的算子、张量值、数据类型、批大小、重复次数和队列模式；只有 CPU 位置采用各自现有日志中的分工。

如果需要先查看将执行什么（不初始化 NPU、不写结果）：

```bash
python3 run_suite.py --placement vm144 --out results/vm --dry-run
```

## 实际测什么

| 算例 | 操作 | shape / dtype | 用途 |
|---|---|---|---|
| sub8 | `torch.sub(x, y, out=z)` | INT32 `[8]` | 对应历史 profiling 中已出现的短 Sub 算子类型，突出准备/下发成本 |
| add1024 | `torch.add(x, y, out=z)` | FP32 `[1024]` | 用另一个固定短算子检查差距是否仅存在于单一路径 |

输入恒为 7 和 2；输出预分配，整个测试期间保持张量存活，重复写同一输出；没有计时区内的分配、CPU↔NPU 输入传输、打印、`.item()` 或逐算子同步。结果在同步之后、计时之外验证。重复固定参数可能命中缓存，首版衡量的是稳态小算子路径，不覆盖业务的所有 tiling、参数大小、融合 kernel 和动态形状。

每个独立进程：初始化 → 预热 200 次 → 设置线程角色 → 再预热 200 次 → 正式计时 → 正确性校验 → 独立短 profiler。

每个正式样本：

```text
先同步清空前序工作（不计时）
开始计时
连续调用同一算子 N 次
记录 Python 提交循环结束
执行一次 NPU synchronize
记录完成
```

批大小为 `1、32、256`，各重复 20 次，尺寸执行顺序轮换以降低固定顺序偏差。先看 32/256 的结果；batch=1 对同步和计时边界更敏感，仅作补充。还记录空闲同步成本和 Python 空循环参考值，但不把它们从结果中强行扣除。

## 为什么测两个 TASK_QUEUE 模式

默认 `--queues 1,0`。每个模式都在独立新进程中、import torch_npu 之前设置变量：

- `1`：保留当前业务使用的 Host task_queue 路径，包含准备、入队、后台下发及可能的反压。
- `0`：关闭这层 Host task_queue，检查差距是否仍然存在。它不代表设备同步执行，结尾仍需 synchronize。

脚本发现 `ASCEND_LAUNCH_BLOCKING=1` 时会拒绝运行，因为它会覆盖队列设置。这里不要为了“测纯下发”打开 blocking。

## CPU 与 NUMA 位置

`placements.json` 已按 `env_conf/1028` 的两份日志填写全部 8 张卡的 main/ACL/release/NUMA 分工。例如设备 6：

| 环境 | main 允许集合 | ACL | release | NUMA |
|---|---|---|---|---|
| vm144 | 38–51 | 52 | 53 | 1 |
| bare192 | 50–69 | 70 | 71 | 2 |

仅对新建的微基准进程及其线程设置亲和性，不修改已有服务、IRQ、XML 或系统配置。main 仍使用原来的一组核；不做主线程专核优化，不把两边缩成相同核数。

脚本检查 CPU 是否在容器允许集合内、sysfs NUMA 是否符合预设；不符就报错，避免在错误位置测完后再误判。现场拓扑改变时先修正本文件中的位置。内存分配策略继承当前环境；程序不设置持久 membind，元数据会保存 `numactl --show`。CPU 正确不等于所有参数内存已证实本地。

`ASCEND_RT_VISIBLE_DEVICES` 可能重排逻辑设备编号：首版发现该变量非空会停止，避免把设备号与预设 CPU 池错误配对。请使用暴露原始设备编号的测试环境，或明确调整脚本的设备/位置映射。`ASCEND_VISIBLE_DEVICES` 仅记录，不自动更改。

## 输出和计时含义

每个 `run_<case>_device<N>_queue<Q>/` 包含：

| 文件 | 内容 |
|---|---|
| `summary.json` | 全部结果、运行/采集状态、正确性、分布、线程、环境和实际 API 统计 |
| `measurements.csv` | 无 profiler 的逐轮计时 |
| `timing_unprofiled.json` | 短 profiler 开始前保存的正式计时结果 |
| `threads.json` | 线程名、当前 PID/TID、affinity、CPU 记账、runqueue 等待、切换次数及差值 |
| `environment.json` | 版本、允许名单中的环境变量、CPU 拓扑、设备状态、已加载库路径和 SHA256 |
| `profile/` | 单独采集的原始 profiler 数据和 `trace_view.json`（默认 128 次操作） |

根目录还有 `suite.json` 和每个子进程的 `.log`。出现失败时先看对应 `.log` 和 `summary.json.error`；不会用空数据伪装成功。

三个关键计时：

- `submit_us_per_op`：Python/torch_npu 调用返回的摊销耗时。queue1 时可能主要是入队，也可能含反压，不能称为真实 ACL Launch 耗时。
- `drain_us_per_op`：最后一次同步的等待摊销，可能同时含尚未下发的 Host 工作和设备工作，不能称纯 NPU 计算时间。
- `total_us_per_op`：整批提交到完成的摊销耗时。同步开始前少量 CPU 计时读取的边界开销也单独记录。

同时保存主线程与全进程 CPU 时间。全进程包含后台线程；主线程 CPU 时间不能代表 ACL 线程。`threads.json` 可以看到后台线程的运行与排队记账。Guest 的 CPU 记账不证明对应物理核始终运行；schedstats 关闭时零排队计数也不能证明没有调度影响。cgroup 挂载根的计数仅作信息，不足以排除进程祖先配额。

短 trace 的 `api_stats` 才是实际被 profiler 记录的 CANN API 时长。它是独立采集阶段，不能代替正式无 profiler 计时。若 `target_api_observed=false`，当前算例没有确认命中 `aclrtLaunchKernelWithHostArgs`；检查实际 API 名称，不能直接与历史该 API 的 5.55/25.76 μs 比较。

kernel 时长来自设备 trace；流上总跨度可能含 Host 断粮间隙，不能把它视作纯 kernel 时间，也不能将多层 API/设备累计相加推算 E2E 收益。

## 汇总两边结果

把两个结果根目录放到同一台机器，不需要 NPU 即可比较：

```bash
python3 compare.py --bare results/bare --vm results/vm --out results/comparison
```

输出 `comparison.md`、`comparison.csv` 和 `kernel_comparison.csv`。按算例、设备、队列模式、批大小精确配对，给出中位数及 VM/裸机比值；实际 API 另表比较 P50/P95，设备 kernel 按名称和 Task Type 配对。不同模式不混合成一个平均数。版本、参数、环境或已加载库 build 不一致会提示；这些比值不能直接称作纯虚拟化净开销。

## 根据结果决定下一步

| 结果 | 能缩小到的方向 |
|---|---|
| queue1、queue0 的小算子都有明显 gap，实际 HostArgs API 也慢 | 已在业务外复现；继续分解参数搬运、完成等待、Runtime/驱动提交 |
| queue1 gap 大，queue0 差距明显缩小 | 优先查 Host 队列、生产者/消费者交接及相关调度；不能仅据开关认定唯一根因 |
| Python 提交接近，但 total 和末尾等待拉开 | 差距可能位于后台准备/下发或设备工作，结合 ACL 线程及设备 trace 判断 |
| 大 batch 才逐步拉开 | 检查队列反压/提交节奏，不把排队时间都算成单次调用的固有成本 |
| 正式计时接近，只有 profiler 内差距大 | 优先确认采集扰动及路径可比性 |
| 两个小算例都接近，但业务仍慢 | 当前简单稳态路径未复现；下一步替换成业务实际慢的算子/参数，不能宣称业务下发没有问题 |

首轮不做多卡通信；若单卡复现，已经可以显著缩小范围。只有单卡接近而多进程业务慢时，才增加并行 worker，检查共享争用和交接。

## 可调参数

```bash
# 更短首测：只测设备0、Sub，两个队列模式仍保留
python3 run_suite.py --placement vm144 --devices 0 --cases sub8 --out results/vm_sub

# 延长稳态重复，保留同样的短 trace
python3 run_suite.py --placement vm144 --repeats 50 --out results/vm_long

# 只测无 profiler 计时；此时不具备真实 ACL API 时长
python3 run_suite.py --placement vm144 --profile-ops 0 --out results/vm_no_profile
```

两边使用同一组可调参数。正式比较建议在每个环境独立重复一次，用不同输出目录，确认差异超过重复波动后再下结论。

## 官方接口依据与验证边界

- [TASK_QUEUE_ENABLE 与 ASCEND_LAUNCH_BLOCKING](https://www.hiascend.com/document/detail/en/Pytorch/2610/apiref/ENV/docs/en/environment_variable_reference/TASK_QUEUE_ENABLE.md)
- [torch_npu stream / synchronize 实现](https://raw.githubusercontent.com/Ascend/pytorch/master/torch_npu/npu/streams.py)
- [torch_npu profiler 配置与 Level1](https://www.hiascend.com/document/detail/zh/Pytorch/700/apiref/apilist/ptaoplist_001391.html)

本地 Mac 已验证参数与输出流程、异步批次边界、线程差值、trace 解析、比较配对及失败状态处理。使用假后端的测试只验证程序流程，不验证 NPU 行为或性能。尚未在你的现场 torch_npu 2.10.0.post6 / CANN 9.1 上真实运行；如某项 profiler API 不支持，保留正式计时，并明确记录采集失败。
