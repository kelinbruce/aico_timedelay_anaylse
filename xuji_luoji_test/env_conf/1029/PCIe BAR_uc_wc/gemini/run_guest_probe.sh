#!/usr/bin/env bash
# ==============================================================================
# 自动探测并运行 PCIe BAR WC vs UC 实测脚本 (适用于裸机与虚机 Guest OS)
# ==============================================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROBE_BIN="${SCRIPT_DIR}/bar_wc_probe"

echo "===================================================================="
echo " 1. 编译 PCIe BAR 硬件写探针程序"
echo "===================================================================="
if [ ! -f "${PROBE_BIN}" ] || [ "${SCRIPT_DIR}/bar_wc_probe.c" -nt "${PROBE_BIN}" ]; then
    echo "正在编译 bar_wc_probe.c ..."
    gcc -O1 "${SCRIPT_DIR}/bar_wc_probe.c" -o "${PROBE_BIN}"
    echo "编译完成: ${PROBE_BIN}"
else
    echo "探针二进制已就绪: ${PROBE_BIN}"
fi

echo ""
echo "===================================================================="
echo " 2. 自动检索 Ascend NPU PCIe 设备与 BAR 资源"
echo "===================================================================="

# 查找华为昇腾 PCI 设备 (Vendor ID: 19e5)
DEVICES=$(find /sys/bus/pci/devices -maxdepth 1 -name "*19e5*" 2>/dev/null || true)
if [ -z "${DEVICES}" ]; then
    # 若路径未直接体现 vendor id，尝试 lspci 或查找常用类
    if command -v lspci >/dev/null 2>&1; then
        DEV_LIST=$(lspci -D -d 19e5: 2>/dev/null | awk '{print $1}')
    fi
else
    DEV_LIST=$(for d in ${DEVICES}; do basename "$d"; done)
fi

if [ -z "${DEV_LIST}" ]; then
    echo "[WARNING] 未自动识别到 19e5 (Ascend) PCIe 设备，仅运行 DRAM 基线测试..."
    sudo "${PROBE_BIN}"
    echo ""
    echo "请手动指定要测试的 PCIe BAR 路径，例如:"
    echo "  sudo ${PROBE_BIN} /sys/bus/pci/devices/<BDF>/resource2"
    exit 0
fi

echo "发现以下 Ascend NPU 设备:"
echo "${DEV_LIST}"
echo ""

# 选取首个设备进行深度 BAR 扫描测试
TARGET_DEV=$(echo "${DEV_LIST}" | head -n 1)
TARGET_DIR="/sys/bus/pci/devices/${TARGET_DEV}"
echo "--------------------------------------------------------------------"
echo "选中首个设备: ${TARGET_DEV} (路径: ${TARGET_DIR})"
echo "--------------------------------------------------------------------"

# 检查是否存在 prefetchable BAR 或已生成的 resourceX / resourceX_wc
BAR_FOUND=0
for res in "${TARGET_DIR}"/resource[0-9]*; do
    if [ -f "$res" ]; then
        # 排除 0 字节未映射的 resource
        SZ=$(stat -c %s "$res" 2>/dev/null || stat -f %z "$res" 2>/dev/null || echo 0)
        if [ "$SZ" -gt 0 ]; then
            BAR_FOUND=1
            echo ""
            echo ">>> 正在测试 BAR 资源: $(basename "$res") (大小: $SZ 字节)"
            sudo "${PROBE_BIN}" "$res" || echo "[WARN] 测试 $res 失败（可能权限受限或非物理内存映射）"
        fi
    fi
done

if [ "$BAR_FOUND" -eq 0 ]; then
    echo "[ERROR] 未在 ${TARGET_DIR} 找到有效的 resource BAR 文件。"
    echo "请确保已加载 vfio-pci 或 npu 驱动，并拥有 root 权限。"
fi
