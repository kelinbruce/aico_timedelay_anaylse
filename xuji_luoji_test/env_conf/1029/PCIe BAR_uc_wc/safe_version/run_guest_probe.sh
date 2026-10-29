#!/usr/bin/env bash
# ==============================================================================
# 安全只读检查脚本：探测 Ascend NPU PCIe BAR 属性与 sysfs WC 支持状态
# ==============================================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "===================================================================="
echo " [安全只读检查] Ascend NPU PCIe BAR 属性与 WC 支持探测"
echo "===================================================================="
echo "安全声明: 本脚本为严格只读模式，不执行任何 BAR 空间写操作，避免触发硬件故障。"
echo ""

# 查找华为昇腾 PCI 设备 (Vendor ID: 19e5)
DEV_LIST=""
if command -v lspci >/dev/null 2>&1; then
    DEV_LIST=$(lspci -D -d 19e5: 2>/dev/null | awk '{print $1}' || true)
fi

if [ -z "${DEV_LIST}" ]; then
    DEVICES=$(find /sys/bus/pci/devices -maxdepth 1 -name "*19e5*" 2>/dev/null || true)
    DEV_LIST=$(for d in ${DEVICES}; do basename "$d"; done)
fi

if [ -z "${DEV_LIST}" ]; then
    echo "[INFO] 未通过标准路径自动发现 19e5 设备，显示系统所有带有 prefetchable BAR 的设备供参考:"
    lspci -vvv 2>/dev/null | grep -E "(Region.*prefetchable|Capabilities:)" | head -n 20 || true
    exit 0
fi

echo "发现以下 Ascend NPU 设备:"
echo "${DEV_LIST}"
echo ""

for dev in ${DEV_LIST}; do
    echo "--------------------------------------------------------------------"
    echo "检查设备: ${dev}"
    echo "--------------------------------------------------------------------"
    DEV_DIR="/sys/bus/pci/devices/${dev}"
    
    # 检查 lspci 输出中的 BAR 属性（Prefetchable 标志）
    if command -v lspci >/dev/null 2>&1; then
        echo "lspci 报告的 BAR 物理属性:"
        lspci -vvv -s "${dev}" | grep -E "Region.*(Memory at|prefetchable)" || echo "  (无输出)"
        echo ""
    fi
    
    # 检查 sysfs 是否暴露了 resourceX_wc (内核 WC 映射接口)
    echo "sysfs 中的 resource 节点状态:"
    WC_NODES=$(ls -1 "${DEV_DIR}"/resource*_wc 2>/dev/null || true)
    if [ -n "${WC_NODES}" ]; then
        echo -e "\033[1;32m[FOUND] 发现内核暴露的 WC 节点 (内核支持对该 BAR 进行 WC 映射):\033[0m"
        ls -l "${DEV_DIR}"/resource*_wc
    else
        echo -e "\033[1;33m[NOTICE] 未发现 resource*_wc 专用节点（说明内核未自动创建只写合并的 sysfs 映射别名）\033[0m"
    fi
    
    # 读取 resource 文件中的 flags 原始数值
    if [ -f "${DEV_DIR}/resource" ]; then
        echo "PCI 原始 resource 标志位 (最后一位为 flags, 包含 IORESOURCE_PREFETCH 0x2000):"
        nl -v 0 "${DEV_DIR}/resource" | while read -r idx start end flags; do
            if [ "$flags" != "0x0000000000000000" ] && [ -n "$flags" ]; then
                # 检查 0x2000 (IORESOURCE_PREFETCH)
                PREFETCH_STR="Non-Prefetchable"
                FLAGS_HEX=$((flags))
                if (( (FLAGS_HEX & 0x2000) != 0 )); then
                    PREFETCH_STR="\033[1;32mPrefetchable (硬件允许写合并)\033[0m"
                fi
                echo "  BAR${idx}: ${start}-${end} flags=${flags} [${PREFETCH_STR}]"
            fi
        done
    fi
    echo ""
done

echo "===================================================================="
echo "检查完成！"
echo "若要彻底确证 Stage-2 是否降级为 UC，请在【宿主机】运行 check_host_bar_wc.py"
echo "===================================================================="
