#!/usr/bin/env bash
# ==============================================================================
# 宿主机 vCPU 物理独占隔离与低时延排查脚本
# 适用场景: 排查虚机 (如 instance-00000b34) 毫秒级长尾、调度抖动与 CPU 独占配置
# 执行方式: 在宿主机 (Host) 上以 root 权限执行:
#          sudo bash check_host_isolation.sh [VM_NAME]
# ==============================================================================

set -o pipefail

VM_NAME="${1:-instance-00000b34}"
OUTPUT_FILE="host_isolation_check_$(date +%Y%m%d_%H%M%S).log"

echo "========================================================================"
echo " 开始采集宿主机隔离状态与虚机配置"
echo " 目标虚机: ${VM_NAME}"
echo " 采集结果将输出到终端并保存至: ${OUTPUT_FILE}"
echo "========================================================================"

exec > >(tee -a "${OUTPUT_FILE}") 2>&1

echo ""
echo "########################################################################"
echo " 1. 宿主机基本信息与系统内核启动参数"
echo "########################################################################"
echo "--- [1.1] 内核版本与系统信息 ---"
uname -a

echo ""
echo "--- [1.2] 内核启动命令行 (/proc/cmdline) ---"
cat /proc/cmdline
echo ""
echo "--- [1.2.1] 隔离核参数提取检查 (isolcpus / nohz_full / rcu_nocbs) ---"
grep -oE '\b(isolcpus|nohz_full|rcu_nocbs|nosoftlockup|skew_tick|intel_idle|processor.max_cstate)=[^\ ]+' /proc/cmdline || echo "未在 /proc/cmdline 中匹配到低时延隔离参数！"

echo ""
echo "########################################################################"
echo " 2. CPU 架构与 NUMA 拓扑概览"
echo "########################################################################"
if command -v lscpu >/dev/null 2>&1; then
    lscpu | grep -E 'Model name|Architecture|CPU\(s\):|Thread\(s\) per core|Core\(s\) per socket|Socket\(s\)|NUMA node\(s\)|NUMA node[0-9]'
fi

echo ""
echo "########################################################################"
echo " 3. 目标虚机 (${VM_NAME}) QEMU 进程与线程绑核状态"
echo "########################################################################"
QEMU_PID=$(pgrep -f "qemu.*${VM_NAME}" | head -n 1)

if [ -z "${QEMU_PID}" ]; then
    # 尝试按 uuid 检索
    QEMU_PID=$(ps -ef | grep qemu | grep "${VM_NAME}" | grep -v grep | awk '{print $2}' | head -n 1)
fi

if [ -z "${QEMU_PID}" ]; then
    echo "[WARN] 未在宿主机上找到名称包含 ${VM_NAME} 的 QEMU 进程！"
    echo "当前宿主机上运行的 QEMU 进程列表如下:"
    ps -eo pid,user,args | grep -E '[q]emu-kvm|[q]emu-system' | head -n 10
else
    echo "找到 QEMU 主进程 PID: ${QEMU_PID}"
    
    echo ""
    echo "--- [3.1] QEMU 进程 cgroup CPU 配额限制 (检查是否存在 CFS 限流) ---"
    CGROUP_PATH=$(cat /proc/${QEMU_PID}/cgroup | grep 'cpu,cpuacct' | awk -F: '{print $3}')
    if [ -z "${CGROUP_PATH}" ]; then
        CGROUP_PATH=$(cat /proc/${QEMU_PID}/cgroup | grep 'cpu:' | awk -F: '{print $3}')
    fi
    echo "cgroup 路径: ${CGROUP_PATH:-未直接找到cpu子系统}"
    if [ -n "${CGROUP_PATH}" ] && [ -d "/sys/fs/cgroup/cpu${CGROUP_PATH}" ]; then
        echo -n "cpu.cfs_quota_us  = "; cat /sys/fs/cgroup/cpu${CGROUP_PATH}/cpu.cfs_quota_us 2>/dev/null || echo "N/A"
        echo -n "cpu.cfs_period_us = "; cat /sys/fs/cgroup/cpu${CGROUP_PATH}/cpu.cfs_period_us 2>/dev/null || echo "N/A"
        echo -n "cpu.shares        = "; cat /sys/fs/cgroup/cpu${CGROUP_PATH}/cpu.shares 2>/dev/null || echo "N/A"
        echo -n "cpu.stat (throttled stats): "; cat /sys/fs/cgroup/cpu${CGROUP_PATH}/cpu.stat 2>/dev/null || echo "N/A"
    fi

    echo ""
    echo "--- [3.2] QEMU 主线程 (Emulator) 亲和性 ---"
    if command -v taskset >/dev/null 2>&1; then
        echo "主进程 taskset 亲和度:"
        taskset -cp "${QEMU_PID}"
    fi

    echo ""
    echo "--- [3.3] QEMU 关键子线程 (vCPU / iothread / worker) 绑核采样 ---"
    echo "正在列出前 20 个线程及最后 20 个线程的亲和度 (格式: TID 线程名 当前运行CPU 允许运行CPU掩码):"
    printf "%-8s %-20s %-8s %-25s\n" "TID" "COMM" "PSR" "AFFINITY"
    
    # 提取线程亲和性
    TOTAL_TASKS=$(ls -1 /proc/${QEMU_PID}/task/ 2>/dev/null | wc -l)
    echo "QEMU 内部总线程数: ${TOTAL_TASKS}"
    
    ls -1 /proc/${QEMU_PID}/task/ 2>/dev/null | head -n 15 | while read -r tid; do
        comm=$(cat /proc/${QEMU_PID}/task/${tid}/comm 2>/dev/null)
        psr=$(awk '{print $39}' /proc/${QEMU_PID}/task/${tid}/stat 2>/dev/null)
        aff=$(taskset -cp ${tid} 2>/dev/null | awk -F: '{print $2}' | xargs)
        printf "%-8s %-20s %-8s %-25s\n" "${tid}" "${comm}" "${psr}" "${aff}"
    done
    echo "..."
    ls -1 /proc/${QEMU_PID}/task/ 2>/dev/null | tail -n 15 | while read -r tid; do
        comm=$(cat /proc/${QEMU_PID}/task/${tid}/comm 2>/dev/null)
        psr=$(awk '{print $39}' /proc/${QEMU_PID}/task/${tid}/stat 2>/dev/null)
        aff=$(taskset -cp ${tid} 2>/dev/null | awk -F: '{print $2}' | xargs)
        printf "%-8s %-20s %-8s %-25s\n" "${tid}" "${comm}" "${psr}" "${aff}"
    done

    echo ""
    echo "--- [3.4] 是否使用 virsh 查询绑核 (若 virsh 可用) ---"
    if command -v virsh >/dev/null 2>&1; then
        echo "virsh emulatorpin 输出:"
        virsh emulatorpin "${VM_NAME}" 2>/dev/null || echo "virsh emulatorpin 查询失败"
        echo "virsh vcpuinfo 概览 (前 6 个 vCPU):"
        virsh vcpuinfo "${VM_NAME}" 2>/dev/null | head -n 36 || echo "virsh vcpuinfo 查询失败"
    else
        echo "virsh 命令不可用，跳过"
    fi
fi

echo ""
echo "########################################################################"
echo " 4. 辅助网络线程 (vhost) 绑核排查"
echo "########################################################################"
echo "--- [4.1] 宿主机上的 vhost 内核线程列表与亲和性 ---"
VHOST_PIDS=$(pgrep -f "vhost-" || true)
if [ -n "${VHOST_PIDS}" ]; then
    printf "%-8s %-20s %-8s %-25s\n" "PID" "COMM" "PSR" "AFFINITY"
    for vpid in ${VHOST_PIDS}; do
        vcomm=$(cat /proc/${vpid}/comm 2>/dev/null)
        vpsr=$(awk '{print $39}' /proc/${vpid}/stat 2>/dev/null)
        vaff=$(taskset -cp ${vpid} 2>/dev/null | awk -F: '{print $2}' | xargs)
        printf "%-8s %-20s %-8s %-25s\n" "${vpid}" "${vcomm}" "${vpsr}" "${vaff}"
    done
else
    echo "未检测到 vhost 内核线程运行。"
fi

echo ""
echo "########################################################################"
echo " 5. 目标隔离核 (12-47, 60-95, 108-143, 156-191) 干扰排查"
echo "########################################################################"
echo "--- [5.1] 检查是否有除目标 QEMU 以外的常规进程正在使用/绑定这些核 ---"
# 抽样检查 NUMA0 核心 12-15 以及 NUMA1 核心 60-63
CHECK_CPUS="12 13 14 15 60 61 62 63 108 109 110 111 156 157 158 159"
echo "正在对部分代表性核 [ ${CHECK_CPUS} ] 进行正在运行进程的瞬时检查:"
printf "%-6s %-8s %-8s %-25s\n" "CPU" "PID" "TID" "COMMAND"
for cpu in ${CHECK_CPUS}; do
    # 查找运行在特定核上的进程
    ps -e -T -o psr,pid,tid,comm | awk -v c="${cpu}" '$1 == c {printf "%-6s %-8s %-8s %-25s\n", $1, $2, $3, $4}' | grep -v 'qemu' | head -n 5
done
echo "(如果上面没有输出非 qemu 的普通进程，说明常规进程未入侵该核)"

echo ""
echo "########################################################################"
echo " 6. 中断干扰与 irqbalance 服务排查"
echo "########################################################################"
echo "--- [6.1] irqbalance 服务运行状态与配置 ---"
if command -v systemctl >/dev/null 2>&1; then
    systemctl is-active irqbalance 2>/dev/null && echo "irqbalance 状态: active (正在运行)" || echo "irqbalance 状态: inactive / not found"
fi

echo ""
echo "检查 irqbalance 配置文件中的禁止核配置 (IRQBALANCE_BANNED_CPUS):"
for f in /etc/sysconfig/irqbalance /etc/default/irqbalance /etc/irqbalance.env; do
    if [ -f "$f" ]; then
        echo "[$f]:"
        grep -v '^[[:space:]]*#' "$f" | grep -v '^[[:space:]]*$' || true
    fi
done

echo ""
echo "--- [6.2] 隔离核上的硬中断与局部定时器中断 (LOC) 计数采样 ---"
echo "检查核 0 (管家核) vs 核 12, 13 (vCPU 隔离核) 的定时器中断 (LOC / Timer) 累计频次:"
grep -E 'LOC|timer|arch_timer' /proc/interrupts | awk '{
    # 打印前几列及第 0, 12, 13 核对应的数值
    print "中断类型: "$NF
}' | head -n 5
echo "查看 /proc/interrupts 头部核分布以及目标核的中断发生情况 (管家核 vs 隔离核):"
awk '
NR==1 {
    for(i=1; i<=NF; i++) {
        if ($i == "CPU0") c0=i;
        if ($i == "CPU12") c12=i;
        if ($i == "CPU13") c13=i;
        if ($i == "CPU60") c60=i;
    }
}
NR>1 && ($0 ~ /LOC|timer|arch_timer|IPI/) {
    printf "%-18s | CPU0: %-10s | CPU12: %-10s | CPU13: %-10s | CPU60: %-10s\n", $NF, $(c0+1), $(c12+1), $(c13+1), $(c60+1)
}
' /proc/interrupts

echo ""
echo "########################################################################"
echo " 7. CPU 调频策略 (Governor) 与空闲状态 (C-State / Idle) 检查"
echo "########################################################################"
echo "--- [7.1] CPU 调频策略 (scaling_governor) 分布 ---"
if [ -d "/sys/devices/system/cpu/cpu0/cpufreq" ]; then
    cat /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor 2>/dev/null | sort | uniq -c
else
    echo "未找到 cpufreq 调频接口目录 (可能由硬件固化或超频驱动接管)"
fi

echo ""
echo "--- [7.2] CPU 实时主频抽样 ---"
if [ -d "/sys/devices/system/cpu/cpu0/cpufreq" ]; then
    echo "CPU0 频率:  $(cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq 2>/dev/null) kHz"
    echo "CPU12 频率: $(cat /sys/devices/system/cpu/cpu12/cpufreq/scaling_cur_freq 2>/dev/null) kHz"
    echo "CPU60 频率: $(cat /sys/devices/system/cpu/cpu60/cpufreq/scaling_cur_freq 2>/dev/null) kHz"
fi

echo ""
echo "--- [7.3] CPU 空闲低功耗模式 (C-States / cpuidle) 检查 ---"
if [ -d "/sys/devices/system/cpu/cpu12/cpuidle" ]; then
    echo "CPU 12 拥有的 Idle 状态列表:"
    for state in /sys/devices/system/cpu/cpu12/cpuidle/state*; do
        sname=$(cat ${state}/name 2>/dev/null)
        sdesc=$(cat ${state}/desc 2>/dev/null)
        sdis=$(cat ${state}/disable 2>/dev/null)
        echo "  - $(basename ${state}): name=${sname}, desc=${sdesc}, disabled=${sdis}"
    done
else
    echo "未检测到 cpuidle 状态接口"
fi

echo ""
echo "########################################################################"
echo " 8. 内存透明大页 (THP) 与内存状态"
echo "########################################################################"
echo "--- [8.1] Transparent Hugepage (THP) 状态 ---"
cat /sys/kernel/mm/transparent_hugepage/enabled 2>/dev/null || echo "N/A"
cat /sys/kernel/mm/transparent_hugepage/defrag 2>/dev/null || echo "N/A"

echo ""
echo "--- [8.2] 宿主机 Hugepages 配置 ---"
cat /proc/meminfo | grep -i huge

echo ""
echo "========================================================================"
echo " 采集完成！"
echo " 结果文件已保存至: $(pwd)/${OUTPUT_FILE}"
echo " 请将该文件的内容或者核心段落复制返回。"
echo "========================================================================"
