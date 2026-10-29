# 无 perf 的 ioctl 定位包

本轮不使用perf、strace、bpftrace、内核探针或CANN私有函数探针。用一个小C共享库记录同一个Sub提交循环内、主线程经过libc `ioctl` 的调用。

最新结果见 [ioctl结果分析_20261029.md](ioctl结果分析_20261029.md)。当前下一步是只读能力检查，无需再编译探针：

```bash
# 虚机
python3 query_copy_capability.py --device 0 --out results/vm_copy_capability.json
# 裸机
python3 query_copy_capability.py --device 0 --out results/bare_copy_capability.json
```

提供两份JSON即可查看实际HAL哈希、driver版本记录，以及BAR-copy能力0x2/0x8的返回值。该脚本只查询，不强制打开能力或修改系统配置。以下保留ioctl实验的执行方法。

目标：检验此前VM新增系统态CPU成本是否主要落在某个驱动ioctl请求上，并区分“请求次数更多”和“同请求单次更慢”。这一步不承诺覆盖Runtime全部内部工作，也不是完整系统调用跟踪。

需要Linux、原torch_npu post6环境，以及可用的cc/gcc/clang之一。**脚本自动检测并编译；不用先手工确认编译器。**普通用户运行，无需root。没有编译器时生成 `preflight.json` 后退出3，不启动NPU测试；编译失败时另保留 `build.log`。

## 直接运行

本目录已包含bench.py和placements.json，可独立运行。如果使用ZIP，将 `ioctl_probe_noperf.zip` 解压后进入其中的 `ioctl_probe_noperf` 目录。

虚机：

```bash
python3 run.py --placement vm144 --out results/vm_ioctl
tar -czf vm_ioctl.tar.gz -C results vm_ioctl
```

裸机：

```bash
python3 run.py --placement bare192 --out results/bare_ioctl
tar -czf bare_ioctl.tar.gz -C results bare_ioctl
```

每侧自动运行两个独立子进程：先跑无探针基线，再跑ioctl计时。仍为Sub INT32 `[8]`、设备0、queue0、batch256、20轮；绑核和预热沿用原demo。无Level2采集。本次明确设置OMP_NUM_THREADS=1，与已有Level2两侧一致。

`LD_PRELOAD`仅为计时子进程增加探针，并保留原jemalloc预加载；不修改shell环境、业务进程、驱动或系统配置。输出目录必须是新的。

若只想检查能否编译，不使用NPU：

```bash
python3 run.py --placement vm144 --check-only --out results/compiler_check
```

## 记录内容

- `preflight.json`、`build.log`：工具可用性、编译结果、源码与生成库哈希。
- `baseline/`：无探针的原始计时、环境、正确性和CPU分工。
- `instrumented/`：同一测试的探针计时、原始计时及环境。
- `instrumented/ioctl_events.json`：每条已拦截调用的请求码、fd、返回值、批次、起点和耗时，以及调用方库/相对地址。
- `instrumented/ioctl_summary.json`：按请求码、fd目标提示及调用位置分组，给出次数、次数/op、P50/P95及总耗时/op。
- `instrumented/loaded_maps.txt`：调用方地址解析依据。
- `comparison.json`：有探针和无探针的完成耗时对照，暴露探针引入的扰动。

捕获区间由原计时函数的两次同步划定：**排除批前同步及末尾同步，只覆盖提交窗口**。不在每次调用中打印日志、做文件I/O、解析fd、做dladdr或加锁；记录保存在固定内存数组，窗口结束后导出。仅所选主线程开启记录。

计时使用CLOCK_MONOTONIC；另记录10000组连续读时钟的成本分布。该值不等于全部探针成本，不能盲目从每条调用耗时扣除。ioctl耗时是调用墙钟时间，可能包含调度，不等于纯内核指令执行时间。基线与探针进程顺序执行，两者差异还包括窗口波动。

## 判读

| 观测 | 后续动作 |
|---|---|
| 两侧每op请求次数相同，VM某请求耗时明显增加，增量接近主要差距 | 优先沿该请求码和调用方库/偏移定位驱动处理，再选择少量HAL/内核边界计时 |
| VM每op出现额外请求或次数显著增加 | 核实相同Runtime为何选择不同路径及请求用途 |
| 已捕获ioctl总增量只占少量时间 | 继续检查Runtime用户态参数处理、轮询和资源管理；不能宣布内核路径全部排除 |
| 没捕获到调用 | 标记 `no_intercepted_ioctl`，表示覆盖不足；不等于系统调用耗时为0 |

只有分组请求实际指向NPU设备并与提交循环关联，才用于解释NPU下发。fd路径在采集后解析，期间可能关闭或复用，只是提示；调用方库和偏移更适合后续核实。同名请求码在不同设备上未必有相同含义。

LD_PRELOAD只覆盖动态绑定到这个libc ioctl入口的调用；驱动内联syscall、私有 `__ioctl`、内部绑定或其他系统调用可以绕过它。此探针不读取请求载荷，也不生成任何HAL弱符号，避免把原本不存在的可选HAL接口变成“存在”。

退出0：捕获到调用且没有记录丢失。退出2：未捕获或记录溢出/时钟错误，已有结果保留。退出3：预检/编译不可用。初始化或基准错误按错误退出码返回，并保留相应log。以上状态都需要结合summary里的正确性、亲和性和探针扰动检查，不能只凭退出0认定已经定位根因。

将两侧整个结果目录打包。若自动检查发现缺少编译器，保留预检文件即可，不必重复跑NPU测试。

## 开发验证与资料

16项不依赖NPU的测试覆盖真实ioctl参数/返回值和errno透传、线程与区间过滤、统计、元数据子进程环境隔离、查询ABI及错误清理。开发机验证为macOS原生C动态库与Python逻辑。原版LD_PRELOAD已在现场捕获VM请求；**新查询和元数据隔离修正尚未在现场Linux/NPU验证**。

```bash
python3 -m unittest discover -s . -p 'test_*.py'
```

CANN OSRT并非当前替代路径：其官方说明仍要求perf和ltrace，见 [CANN 9.1采集说明](https://www.hiascend.com/document/detail/zh/CANNCommunityEdition/910/devaids/Profiling/atlasprofiling_16_0042.html)。libc调用签名和动态绑定机制可参考 [glibc ioctl实现](https://github.com/bminor/glibc/blob/master/sysdeps/unix/sysv/linux/ioctl.c) 与 [glibc动态链接器文档](https://sourceware.org/glibc/manual/latest/html_node/Dynamic-Linker.html)。
