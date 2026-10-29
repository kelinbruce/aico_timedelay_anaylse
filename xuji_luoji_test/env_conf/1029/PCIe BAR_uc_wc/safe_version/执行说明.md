# PCIe BAR 空间内存属性 (WC vs UC) 安全核验方案

> [!CAUTION]
> **安全红线警告（禁止对未知物理 BAR 执行内存盲写）**：
> 严禁通过用户态 `mmap` 对未经厂商白名单标注的未知 PCIe BAR 执行循环盲写压测！
> 昇腾 NPU 的 `BAR0` / `BAR2` 等 MMIO 空间包含**芯片核心控制寄存器（CSR）、中断控制、硬件复位及门铃寄存器（Doorbell）**，并包含固件保护区（如 Xloader）。向偏移 0 盲写垃圾数据可能直接触发 PCIe AER 致命错误、硬件看门狗复位或整卡掉卡（Link Down）。
>
> **本目录采用全只读、零硬件破坏风险的闭环核验方案。**

---

## 一、 文件清单与安全级别

| 文件名 | 运行环境 | 安全级别 | 说明 |
| :--- | :--- | :--- | :--- |
| **`check_host_bar_wc.py`** | KVM 宿主机 (Python 3.6+) | **100% 只读安全** | **核心证据工具**：只读 dump QEMU 内存映射与 KVM Stage-2 页表（S2PT），直接核验物理 BAR 是 `Normal-NC` (WC) 还是 `Device-nGnRE` (UC)；检查内核 WC 补丁状态。 |
| **`run_host_check.sh`** | KVM 宿主机 (Bash) | **100% 只读安全** | 宿主机执行快捷入口包装脚本。 |
| **`sample_host_kvm.py`** | KVM 宿主机 (Python 3.6+) | **100% 只读安全** | 采样当前 VM 在 KVM debugfs 的退出计数器（`mmio_exit_user`, `mmio_exit_kernel`），对比空闲与推理稳态。 |
| **`run_guest_probe.sh`** | 虚机 / 裸机 (Bash) | **100% 只读安全** | 安全探测 NPU 的 PCI BAR 属性、`[Prefetchable]` 硬件标志位及 sysfs `_wc` 节点支持状态。 |
| **`bar_wc_probe.c`** | 参考代码 (C) | **安全防护版** | 仅保留 DRAM 虚拟内存时钟基准与安全拦截提示，彻底剥离物理 BAR 盲写代码。 |
| **`README.md`** | 文档 | - | 本核验方案与判定指南。 |

---

## 二、 快速执行流程

### 第一步：虚机 / 裸机端只读探测 (耗时 ~10 秒)

在虚机和裸机容器或宿主终端中直接执行：

```bash
chmod +x run_guest_probe.sh
./run_guest_probe.sh
```

**观察要点**：
1. **`Prefetchable` 标志**：
   - 检查各 BAR 是否包含 `Prefetchable`（PCI 配置空间 flags 包含 `0x2000`）。只有带预取标志的 BAR，硬件规范才允许开启 Write-Combining。
2. **`resource*_wc` 节点**：
   - 检查 `/sys/bus/pci/devices/<BDF>/` 目录下是否存在 `resource*_wc`。若存在，表示内核驱动支持创建 WC 映射别名。

---

### 第二步：宿主机 Stage-2 页表核验（最核心、最权威证据）

**推论核心机理**：即使 Guest OS 将 BAR 映射为 Write-Combining (`Normal-NC`)，如果宿主机 KVM Stage-2 将直通设备的 MMIO 物理页标记为 `Device-nGnRE`，根据 ARM64 **两者取其最严格（Most Restrictive）**原则，硬件最终属性会被强制降级为强序非缓存设备内存，导致写缓冲被禁用、总线阻塞。

#### 1. 将本目录复制到 KVM 宿主机

```bash
# 在宿主机进入脚本目录
cd /path/to/safe_version

# 确认目标虚机名称 (例如 instance-00000b34)
sudo virsh --connect qemu:///system list --all
```

#### 2. 执行只读核验与 Stage-2 导出

```bash
# 基础核验 + Stage-2 页表导出 (推荐在业务预热后执行)
sudo ./run_host_check.sh \
  --vm instance-00000b34 \
  --dump-stage2 \
  --out /tmp/host_bar_wc_result
```

*(若宿主机有当前内核完整源码，可追加 `--kernel-src /path/to/kernel-source` 检查补丁情况)*

#### 3. 查看核验结论

```bash
cat /tmp/host_bar_wc_result/report.txt
cat /tmp/host_bar_wc_result/stage2-bar-matches-*.txt
```

**判定标准**：
- **若页表匹配输出包含 `Device-nGnRE`**：
  - **100% 确认根因！** 宿主机 KVM 确实将直通 BAR 限制为强序无缓存设备内存，Stage-1 的 WC 彻底失效，CPU 每次写 Doorbell/参数均发生物理阻塞。
- **若页表匹配输出包含 `Normal-NC`**：
  - **排除宿主 Stage-2 降级！** 宿主机已支持 WC 透传，需进一步排查 Guest OS 驱动的映射行为。

---

### 第三步：宿主机 MMIO Exit 采样（分析退出开销）

如需进一步了解虚机在推理时是否存在异常频繁的 MMIO 退出（VM-Exit），可在宿主机执行：

```bash
# 1. 采集 30 秒空闲基线
sudo python3 ./sample_host_kvm.py \
  --vm instance-00000b34 \
  --label idle \
  --seconds 30 \
  --out /tmp/kvm_idle

# 2. 采集业务推理稳态 30 秒
sudo python3 ./sample_host_kvm.py \
  --vm instance-00000b34 \
  --label workload \
  --seconds 30 \
  --out /tmp/kvm_workload
```

**观察要点**：
- 对比两者的 `mmio_exit_user` 与 `mmio_exit_kernel` 的增量速率（`rate_per_s`）。
- 若用户态 MMIO 随负载急剧上升，说明存在大量陷入 QEMU 的模拟访问；若 MMIO 退出极低但下发依然缓慢，更佐证是直接 MMIO 时的 `Device-nGnRE` 强序阻塞。

---

### 第四步：真实算子下发耗时对比（受官方驱动保护）

如果需要测试算子下发端到端时延（验证 15~20 μs 差异），**请直接使用项目中已有的受保护微基准工具**：
- 路径：`xuji_luoji_test/launch_microbench/`
- 该工具通过 PyTorch / CANN Runtime 官方接口合法下发 `sub8` / `add1024` 小算子，所有寄存器操作完全受驱动保护，绝无踩踏风险。
