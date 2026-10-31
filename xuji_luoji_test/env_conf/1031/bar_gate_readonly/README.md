# 当前 25.5.0：读取 Guest 驱动 BAR-copy 判断条件

本包继续定位当前驱动，不准备或执行升级。执行位置是 **`vnf-mae-1-node22-1792137068` 虚机操作系统、`vm_test` 容器外**。不用在裸机或 KVM 宿主机执行。

已知 Guest 的用户态驱动目录为 `/usr/local/spu/driver`，挂载到容器 `/usr/local/Ascend/driver`；两侧 HAL 哈希一致。原安装根目录 `/usr/local/spu`，安装记录 `full/normal/root:root/install-for-all=yes`。这些是安装事实，不是 BAR-copy 关闭原因。

## 一次执行

从项目远端更新本目录，或传输并解压相邻的 `bar_gate_readonly_1031.zip`。在 **Guest、容器外，以 root** 进入包目录。需要现有 Python 3.8+，无需 perf、strace、编译器、drgn 或额外 Python 包。

```bash
python3 collect.py --guest --device 0
```

这是一条完整单行命令。默认创建独立的 `/tmp/bar-gate-vm-随机字符/` 目录；完成后自动生成同名 `.tar.gz`，终端打印完整路径和 SHA256。**将打印的 `.tar.gz` 整包带回即可，无需复制大量终端输出。**

`--device 0` 是 Guest 驱动编号。它不自动等同于容器内经过可见设备限制/重排后的逻辑编号。先沿用原问题设备；已有该卡映射时结合 `remote_dev_id/slot_id/func_id` 核对，不用本轮 NPU0 代表其他卡。

退出码 0 表示采集完成，不表示修复成功。退出码 2 表示读取受限、身份/一致性校验失败等，仍会生成结果包。保留包内的具体失败原因。

若要指定目录，必须使用不存在的新目录：

```bash
python3 collect.py --guest --device 0 --out /tmp/bar_gate_vm_first
```

## 实际读取的内容

| 字段 | 具体对象 | 回答的问题 |
|---|---|---|
| 模式缓存是否有效、物理机标志 | `drv_devmm_host` 内的 `get_flag.2/get_host_flag.1` | 本构建是否会绕过 WC 检查；未初始化不能判模式 |
| BAR4 WC 位 | `g_ctrls` 匹配对象的 `devdrv_pci_ctrl.bar_wc_flag` | 当前 BAR4 对应的 `0x10` 位是否置位 |
| 已过滤能力缓存 | `devmm_svm->dev_capability[did]` | 当前是否已经是零缓存，而非仅被查询时的禁用位屏蔽 |
| 两项禁用状态 | `g_dev_feature_capabilty_disable[did][1/2]` | 非零缓存是否被后续显式禁用 |
| 两侧基础页大小及初始化状态 | `devmm_svm` | 普通 BAR 是否另受页大小条件阻断 |
| 最终对外能力 | `/proc/svm/dev<id>/feature/bar_mem` 和 `bar_mem_huge` | 与缓存、禁用位计算结果相互核对 |

不会执行内核 getter。因此 `inferred_mode` 是从有效缓存及已核对指令推导的模式；`actual_getter_return_code` 保持 null，不能冒充实测返回码。不会把缺失控制对象当作 WC flag=0。

原始 `info->device_capability.feature_bar_mem` 仅在能力初始化输入中存在，本包不会从过滤后的缓存反推原始值。它始终明确记录为未知。若当前 WC 条件满足但缓存为零，下一步才需要取得初始化输入和能力发布时间顺序。

## 已从当前模块核对的判断分支

在这两个确切模块中，`devmm_set_dev_capability` 的 BAR 部分可归纳为：

```text
R = 初始化输入中的原始 feature_bar_mem
P = devmm_get_host_run_mode 返回 1
W = devdrv_get_bar_wc_flag 成功，并且返回标志的 0x10 位为 1
Q = host_page_size 与 device_page_size 相等

普通 BAR 缓存 = R，前提是 (P 或 W) 且 Q；否则置 0
巨大页 BAR 缓存 = R，前提是 P 或 W；否则置 0
最终对外能力 = 对应缓存非零，且对应禁用位未设置
```

因此本轮需要区分原始输入、模式/WC 条件和后续显式禁用，而不是再次检查 CPU 核数或宿主机 1 GB 大页。上式描述的是函数执行时的条件；只读快照不能保证这些条件从初始化至今未变化。

## 如何判定

| 读数 | 可得出的结论 | 下一步 |
|---|---|---|
| 缓存非零，禁用位为 1，proc 值为 0 | 显式禁用可以解释对应对外能力关闭 | 查 Guest 的禁用设置者与用途，使用受支持方式撤销错误禁用 |
| 缓存为零，禁用位也为 1 | 存在多个阻断条件 | 只清禁用位不能恢复零缓存，继续查初始化 |
| 有效模式推导为 0，WC 的 `0x10` 位为 0 | 当前 WC 条件不满足 | 查能力发布及初始化时序，同时取得原始设备能力；不能直接宣布 KVM 映射错误 |
| 有效模式推导为 1 | 本构建绕过 WC 检查 | 零 WC 标志不能单独解释关闭；查原始设备能力/初始化结果 |
| 当前 WC 位为 1，缓存仍为零 | 当前 WC 值不能直接解释已有零缓存 | 查初始化时是否为零、发布是否过晚、缓存是否未更新，以及原始设备能力 |
| 仅基础页大小不同 | 可解释普通 BAR 的页条件不满足 | 不能单独解释巨大页 BAR 也为零 |
| `READ_UNAVAILABLE` 或不一致 | 采集没有取得可靠值 | 根据包内 error 处理读取入口/构建身份，不能推导能力为零或必须升级 |

这些是**当前状态**。两次相同读取降低状态变化疑虑，但不等于加锁的原子快照，也不能重建历史设备初始化。WC 位是驱动的能力声明，不是 Stage-2 页表属性。

## 读取机制与范围

模块结构布局来自用户上传的 `barcopy-modules.mkEaj5.tar.gz` 内两个实际 `.ko` 的 DWARF；关键偏移及判断逻辑与同一文件的 AArch64 指令交叉核对。`profile_25_5.json` 是**这两个确切构建专用**，不能用于任意标称 25.5.0 的驱动。

采集前强制检查模块文件 SHA256、文件和已加载模块的 `srcversion`、GNU build ID、ELF 符号及运行中模块段地址。构建不同、标识不可读或地址不一致时拒绝套用布局。符号地址来自 `/sys/module/<模块>/sections/`，并与可见的模块限定 `/proc/kallsyms` 项交叉检查，不使用历史绝对地址或猜测内核偏移。

通过只读方式打开 `/proc/kcore`，按其 ELF PT_LOAD 表翻译虚拟地址，只读取上述普通内核内存对象。本轮主要读取两遍约 90 KB 的控制对象表及少量字段；数据读取硬上限 1 MiB，单次上限 128 KiB。读审计只保存字段名、地址和长度，结果包不包含整个控制表、内核内存转储或模块文件。DVPP 大小哨兵用于拒绝未初始化/零填充的能力记录。

该方式依赖现场内核开放 `/proc/kcore`、模块段地址及构建标识。Linux 的 kcore 入口受 `CAP_SYS_RAWIO` 和 lockdown 约束；root 并不保证一定可读。若受限，本包会保存明确错误，**不关闭保护、不修改 sysctl、不改内核启动参数**。平台维护方可用已有受支持诊断机制返回上表相同字段。

采集只写自己的结果目录。它不升级驱动、不改 NUMA/CPU、大页、容器或环境配置，不写 proc/sysfs，不加载模块，不挂探针，不调用 NPU 接口，不读写 BAR，不重置 NPU。正常业务可以保持存活；采集期间不要同时卸载/重载驱动或重置设备。

## 输出文件

- `result.json`：环境、模块身份、两个快照、字段判读、读取审计、明确错误。
- `结论.txt`：中文结论与对应下一步。
- `collect.py`、`elf64.py`、`profile_25_5.json`：该次实际使用的采集代码和布局。
- `SHA256_MANIFEST.json`：输出文件校验清单。

本地已做模拟内存/ELF读取、判断分支、身份不匹配拒绝读取及失败产物测试；**尚未在现场 Guest 执行**。目录中 `test_collect.py` 是开发测试，不是现场采集入口。

## 可复核来源

- 当前工程：`env_conf/1030/bar_copy_diagnosis/result/barcopy-modules.mkEaj5.tar.gz`、`barcopy1030-results.EnyNAS.tar.gz`。
- `build_profile.py`：从确切模块的 ELF 符号和 DWARF 文本生成布局；用于离线开发，不在 Guest 上运行。
- [Linux 6.6 kcore 实现](https://github.com/torvalds/linux/blob/v6.6/fs/proc/kcore.c)：ELF 段与只读内核内存接口、访问条件。现场定制内核可能有额外限制。
- [drgn 用户指南](https://drgn.readthedocs.io/en/latest/user_guide.html)：同类内核状态读取思路；本包不依赖 drgn。
