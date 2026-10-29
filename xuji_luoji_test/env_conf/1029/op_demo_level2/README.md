# CANN Launch Level 2 诊断包

本轮入口为 `runtime_level2.py`。完整命令见 [执行方法.md](执行方法.md)，采集字段和后续判读见 [Runtime分段定位说明.md](Runtime分段定位说明.md)。

本包可独立运行，不依赖原“算子下发demo验证”目录。`op_demo_level2.zip` 包含相同的源码、配置、测试和说明，解压后进入 `op_demo_level2` 即可执行。

默认只测设备0、INT32 `[8]` Sub、`TASK_QUEUE_ENABLE=0`：先做不带 profiler 的计时，再独立采集128次 Level 2 trace。沿用现有 CPU 分工，不修改系统配置。

```bash
# 虚机
python3 runtime_level2.py --placement vm144 --out results/vm_runtime_l2

# 裸机
python3 runtime_level2.py --placement bare192 --out results/bare_runtime_l2
```

需在原先运行 demo 的 Linux Ascend post6 环境中执行；当前开发机未进行真实 NPU 测试。Level 2 增加 Runtime API 采集，但不保证暴露 CANN 私有函数的完整耗时分段。

`README_microbench.md`、`run_suite.py` 和 `compare.py` 保留原微基准的说明与工具；本轮不需要执行原 Level 1 全量矩阵。
