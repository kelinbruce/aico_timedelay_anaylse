#!/usr/bin/env python3
"""Read-only Linux ARM64 KVM/VFIO BAR mapping evidence collector (Python 3.6+)."""

import argparse
import datetime
import gzip
import json
import os
from pathlib import Path
import platform
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET


PATCHES = [
    ("c034ec84e879", "KVM: arm64: Introduce new flag for non-cacheable IO memory"),
    ("5c656fcdd6c6", "mm: Introduce new flag to indicate wc safe"),
    ("8c47ce3e1d2c", "KVM: arm64: Set io memory s2 pte as normalnc for vfio pci device"),
    ("a39d3a966a09", "vfio: Convey kvm that the vfio-pci device is wc safe"),
]
SOURCE_FILES = [
    "arch/arm64/kvm/mmu.c", "arch/arm64/include/asm/kvm_pgtable.h",
    "arch/arm64/include/asm/pgtable-prot.h", "arch/arm64/kvm/hyp/pgtable.c",
    "drivers/vfio/pci/vfio_pci_core.c", "drivers/vfio/pci/vfio_pci.c",
    "include/linux/mm.h",
]
MARKERS = re.compile(r"VM_ALLOW_ANY_UNCACHED|VM_VFIO_ALLOW_WC|"
                     r"vfio_allow_any_uc|KVM_PGTABLE_PROT_NORMAL_NC|"
                     r"KVM_PGTABLE_PROT_DEVICE|PAGE_S2_DEVICE|PAGE_S2_MEMATTR")


def read(path):
    try:
        return Path(path).read_text(errors="replace")
    except OSError:
        return ""


def invoke(argv, timeout=20):
    try:
        p = subprocess.run(argv, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                           universal_newlines=True, timeout=timeout)
        return p.returncode, p.stdout
    except (OSError, subprocess.TimeoutExpired) as exc:
        return 125, str(exc) + "\n"


def bdf(node):
    if node is None:
        return None
    a = node.attrib
    return "{:04x}:{:02x}:{:02x}.{:x}".format(
        *[int(a.get(k, "0"), 0) for k in ("domain", "bus", "slot", "function")])


def parse_domain(xml):
    root = ET.fromstring(xml)
    devices = []
    for item in root.findall("./devices/hostdev[@type='pci']"):
        alias = item.find("alias")
        devices.append({"host_bdf": bdf(item.find("./source/address")),
                        "xml_guest_bdf": bdf(item.find("./address")),
                        "alias": alias.get("name") if alias is not None else None})
    return root.findtext("uuid"), devices


def find_qemu(uuid, vm, explicit=None):
    candidates = [Path("/proc") / str(explicit)] if explicit else Path("/proc").glob("[0-9]*")
    found = []
    for proc in candidates:
        try:
            args = (proc / "cmdline").read_bytes().split(b"\0")
            args = [v.decode(errors="replace") for v in args if v]
        except OSError:
            continue
        if not args or "qemu" not in Path(args[0]).name:
            continue
        proc_uuid = args[args.index("-uuid") + 1] if "-uuid" in args[:-1] else None
        name_arg = args[args.index("-name") + 1] if "-name" in args[:-1] else ""
        names = [v[6:] if v.startswith("guest=") else v for v in name_arg.split(",")]
        matches = (proc_uuid == uuid) if uuid else (vm in names)
        if matches:
            found.append(int(proc.name))
        elif explicit and not proc_uuid and vm in names:
            found.append(int(proc.name))
    return sorted(found)


def pci_regions(qmp, devices):
    """Match live XML hostdev aliases to QMP qdev_id; never assume XML bus == live bus."""
    aliases = {d["alias"]: d for d in devices if d.get("alias")}
    result = []

    def walk(entries, default_bus):
        for dev in entries:
            ident = dev.get("qdev_id", "")
            hostdev = aliases.get(ident)
            if hostdev:
                for region in dev.get("regions", []):
                    if region.get("type") != "memory":
                        continue
                    start, size = region.get("address", -1), region.get("size", 0)
                    if not isinstance(start, int) or not isinstance(size, int) or start < 0 or size <= 0:
                        continue
                    result.append(dict(hostdev, bar=region.get("bar"), ipa_start=start,
                                       ipa_end=start + size,
                                       prefetch=region.get("prefetch"),
                                       qmp_guest_bdf="{:02x}:{:02x}.{:x}".format(
                                           dev.get("bus", default_bus), dev["slot"], dev["function"])))
            bridge = dev.get("pci_bridge", {})
            walk(bridge.get("devices", []), bridge.get("bus", {}).get("number", default_bus))

    for bus in qmp.get("return", []):
        walk(bus.get("devices", []), bus.get("bus", 0))
    return result


def match_stage2(text, regions):
    """Ranges are [start, end). Keep raw attributes; do not decode raw PTEs or guess WC."""
    spans = []
    for line in text.splitlines():
        match = re.match(r"^\s*(?:0x)?([0-9a-fA-F]+)\s*-\s*(?:0x)?([0-9a-fA-F]+)\s+", line)
        if match:
            lo, hi = (int(v, 16) for v in match.groups())
            if hi > lo:
                spans.append((lo, hi, line))
    lines = ["以下为 Guest BAR IPA 与 Stage-2 导出的交集，区间按 [start, end) 处理。",
             "仅是 BAR 候选区域；仍须用 Runtime 的参数地址确认具体 BAR/offset。",
             "有地址范围不代表已有有效页表项，请检查原始行的属性和有效映射标记。"]
    for region in regions:
        lines.append("\nHost {} / qdev {} / Guest {} / BAR{} / IPA {:#x}-{:#x} / prefetch={}".format(
            region["host_bdf"], region["alias"], region["qmp_guest_bdf"], region["bar"],
            region["ipa_start"], region["ipa_end"], region["prefetch"]))
        count = 0
        for lo, hi, raw in spans:
            if max(lo, region["ipa_start"]) < min(hi, region["ipa_end"]):
                lines.append(raw)
                count += 1
        if not count:
            lines.append("UNKNOWN：未匹配；可能尚未触发缺页映射、dump 不完整或格式不同。")
    return "\n".join(lines) + "\n"


class Collector:
    def __init__(self, out):
        self.out = out
        self.log = (out / "report.txt").open("w")

    def say(self, message):
        print(message, flush=True)
        self.log.write(message + "\n")
        self.log.flush()

    def save(self, name, content):
        (self.out / name).write_text(content)

    def command(self, name, argv, timeout=20, show=True):
        rc, output = invoke(argv, timeout)
        self.save(name, "$ " + " ".join(shlex.quote(v) for v in argv) +
                  "\nexit_code={}\n".format(rc) + output)
        self.say("{}: exit_code={}".format(name, rc))
        if show:
            self.say(output.rstrip())
        return rc, output


def kernel_evidence(c, source):
    release = platform.release()
    c.command("kernel.txt", ["uname", "-a"])
    c.save("os-release.txt", read("/etc/os-release"))
    if shutil.which("lscpu"):
        c.command("lscpu.txt", ["lscpu"], show=False)
    config = ""
    config_path = "UNKNOWN"
    for path in [Path("/proc/config.gz"), Path("/boot/config-" + release),
                 Path("/lib/modules") / release / "build/.config"]:
        try:
            config = gzip.open(str(path), "rt").read() if path.suffix == ".gz" else path.read_text()
            config_path = str(path)
            break
        except OSError:
            continue
    keys = r"CONFIG_(ARM64|KVM|VFIO|IOMMU|ARM_SMMU|DEBUG_FS|PTDUMP|IKCONFIG|KALLSYMS|KPROBES|BPF)"
    selected = [line for line in config.splitlines() if re.match(r"(?:# )?" + keys, line)]
    c.save("kernel-config.txt", "source={}\n".format(config_path) + "\n".join(selected) + "\n")
    c.say("kernel config: {}；Stage-2 dump 配置请看 kernel-config.txt".format(config_path))
    if shutil.which("modinfo"):
        for module in ["kvm", "vfio_pci", "vfio_pci_core"]:
            c.command("modinfo-{}.txt".format(module), ["modinfo", module], show=False)
    if not source:
        for candidate in [Path("/lib/modules") / release / "source", Path("/lib/modules") / release / "build"]:
            if (candidate / "arch/arm64/kvm/mmu.c").is_file():
                source = candidate.resolve()
                break
    if not source:
        c.say("补丁状态 UNKNOWN：未找到完整内核源码；版本号和内核头文件不足以确认。")
        return
    source = Path(source).resolve()
    chunks = ["kernel source: {}".format(source),
              "源码标记和 Git 历史仅是线索，须另行确认与正在运行的内核二进制对应。"]
    for rel in ["include/config/kernel.release", "include/generated/utsrelease.h"]:
        chunks.append(rel + ": " + (read(source / rel).strip() or "UNKNOWN"))
    for rel in SOURCE_FILES:
        content = read(source / rel).splitlines()
        hits = [i for i, line in enumerate(content) if MARKERS.search(line)]
        indices = set(j for i in hits for j in range(max(0, i - 5), min(len(content), i + 8)))
        if indices:
            chunks.append("\nFILE " + rel)
            chunks.extend("{}:{}".format(i + 1, content[i]) for i in sorted(indices))
    if shutil.which("git"):
        rc, head = invoke(["git", "-C", str(source), "rev-parse", "HEAD"])
        if rc == 0:
            chunks.append("\nsource HEAD: " + head.strip())
            for sha, title in PATCHES:
                present, _ = invoke(["git", "-C", str(source), "cat-file", "-e", sha + "^{commit}"])
                if present == 0:
                    ancestor, _ = invoke(["git", "-C", str(source), "merge-base", "--is-ancestor", sha, "HEAD"])
                    state = "原始提交为 HEAD 祖先" if ancestor == 0 else "原始提交可见，祖先关系未确认"
                else:
                    state = "UNKNOWN：原始对象不可见；backport/rebase/shallow 均可能"
                chunks.append("{} {}: {}".format(sha, title, state))
    c.save("kernel-source-evidence.txt", "\n".join(chunks) + "\n")
    c.say("源码线索已保存 kernel-source-evidence.txt；未据此断言运行内核已修复。")


def host_devices(c, devices):
    rows = []
    for device in devices:
        host = device.get("host_bdf")
        if not host:
            continue
        base = Path("/sys/bus/pci/devices") / host
        driver = (base / "driver").resolve().name if (base / "driver").is_symlink() else "UNKNOWN"
        group = (base / "iommu_group").resolve().name if (base / "iommu_group").is_symlink() else "UNKNOWN"
        rows.append("\n{} alias={} configured_guest={} driver={} iommu_group={} numa={}".format(
            host, device["alias"], device["xml_guest_bdf"], driver, group,
            read(base / "numa_node").strip() or "UNKNOWN"))
        for index, line in enumerate(read(base / "resource").splitlines()[:6]):
            fields = line.split()
            if len(fields) != 3:
                continue
            lo, hi, flags = [int(v, 16) for v in fields]
            if flags:
                rows.append("BAR{} HostPA={:#x}-{:#x} flags={:#x} prefetch={}".format(
                    index, lo, hi, flags, bool(flags & 0x2000)))
        if shutil.which("lspci"):
            c.command("pci-{}.txt".format(host), ["lspci", "-Dnnk", "-s", host], show=False)
    c.save("host-pci-bars.txt", "\n".join(rows) + "\n")
    c.say("Host PCI BAR/驱动信息已保存 host-pci-bars.txt。HostPA 不可直接拿来匹配 Guest Stage-2。")


def stage2_evidence(c, pid, regions, dump):
    roots = set()
    for line in read("/proc/mounts").splitlines():
        fields = line.split()
        if len(fields) > 2 and fields[2] == "debugfs":
            roots.add(Path(fields[1].replace("\\040", " ")) / "kvm")
    paths = []
    for root in sorted(roots):
        if not root.is_dir():
            continue
        for directory in root.glob(str(pid) + "-*"):
            paths.extend(directory.glob("stage2_page_tables"))
    c.save("stage2-paths.txt", "\n".join(str(p) for p in paths) + "\n")
    if not paths:
        c.say("Stage-2 属性 UNKNOWN：未找到目标 QEMU PID 对应的 stage2_page_tables。")
        c.say("可能是内核未提供接口、CONFIG 未启用或 debugfs 未挂载；这不代表没有 WC 修复。")
        return
    for path in paths:
        c.say("找到目标 VM 的 Stage-2 接口：" + str(path))
        if not dump:
            continue
        # timeout is an external process boundary: a slow debugfs read cannot hang Python indefinitely.
        if not shutil.which("timeout"):
            c.say("缺少 timeout 命令，跳过自动 dump；保留路径供现场管理员读取。")
            continue
        rc, output = c.command("stage2-{}.txt".format(path.parent.name),
                               ["timeout", "-k", "2s", "30s", "cat", str(path)],
                               timeout=36, show=False)
        if rc == 0 and regions:
            c.save("stage2-bar-matches-{}.txt".format(path.parent.name), match_stage2(output, regions))
            c.say("Guest BAR 与 Stage-2 范围交集已保存 stage2-bar-matches-{}.txt。".format(path.parent.name))
        elif rc != 0:
            c.say("Stage-2 dump 未完整完成（exit_code={}），不可据不完整结果下结论。".format(rc))
    if not dump:
        c.say("未请求页表导出；需要时加 --dump-stage2，放在业务预热后且避开性能计时窗口。")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--vm", default="instance-00000b34", help="libvirt VM name or UUID")
    parser.add_argument("--uri", default="qemu:///system", help="local libvirt URI")
    parser.add_argument("--qemu-pid", type=int, help="optional PID, validated against the domain")
    parser.add_argument("--kernel-src", type=Path, help="matching full host kernel source tree")
    parser.add_argument("--dump-stage2", action="store_true", help="read existing per-VM Stage-2 debugfs")
    parser.add_argument("--out", type=Path, help="new output directory; must not already exist")
    args = parser.parse_args()
    if platform.system() != "Linux":
        parser.error("请将本脚本复制到 Linux 宿主机执行。")
    if args.uri not in ("qemu:///system", "qemu:///session"):
        parser.error("仅支持本机 libvirt URI，避免把远端 VM 与本地 /proc、PCI、Stage-2 混配。")
    if os.geteuid() != 0:
        parser.error("请使用 sudo python3 check_host_bar_wc.py ... 以读取目标进程和 debugfs。")
    os.umask(0o077)
    if args.out:
        args.out.mkdir(parents=True, exist_ok=False)
        out = args.out.resolve()
    else:
        out = Path(tempfile.mkdtemp(prefix="host_bar_wc_" + datetime.datetime.now().strftime("%Y%m%d_%H%M%S_") ))
    c = Collector(out)
    c.say("OUTPUT_DIR=" + str(out))
    c.say("采集时间：" + datetime.datetime.now().astimezone().isoformat())
    c.say("只读采集运行状态，写入本次结果目录；未执行任何 PCI BAR 数据读写。")
    kernel_evidence(c, args.kernel_src)
    if platform.machine() not in ("aarch64", "arm64"):
        c.say("当前不是 ARM64；本报告不能套用 ARM64 Device-nGnRE 的判断。")
    if not shutil.which("virsh"):
        c.say("缺少 virsh，已完成内核检查；VM/Guest BAR/Stage-2 未确认。")
        return 2
    virsh = ["virsh", "--connect", args.uri]
    rc, domain_id = invoke(virsh + ["domid", args.vm])
    if rc or not domain_id.strip().isdigit():
        c.save("domain-error.txt", domain_id)
        c.say("目标域未运行或 domid 查询失败；请核对虚机名称和连接 URI。")
        return 2
    rc, xml = invoke(virsh + ["dumpxml", args.vm])
    if rc:
        c.save("domain-error.txt", xml)
        c.say("读取运行域 XML 失败，详见 domain-error.txt；未使用本地历史 XML 替代。")
        return 2
    try:
        uuid, devices = parse_domain(xml)
    except (ET.ParseError, ValueError) as exc:
        c.say("域 XML 解析失败：" + str(exc))
        return 2
    # Only retain PCI hostdev mappings, not disk/network credentials from complete domain XML.
    c.save("live-pci-devices.json", json.dumps({"vm": args.vm, "uuid": uuid, "devices": devices}, indent=2) + "\n")
    host_devices(c, devices)
    pids = find_qemu(uuid, args.vm, args.qemu_pid)
    c.say("匹配目标域的 QEMU PIDs: " + str(pids))
    if len(pids) != 1:
        c.say("无法唯一确认 QEMU PID，停止自动 VM 页表读取；可核验后传 --qemu-pid。")
        return 2
    pid = pids[0]
    c.save("qemu-pid.txt", str(pid) + "\n")
    c.save("qemu-vfio-maps.txt", "\n".join(
        line for line in read("/proc/{}/maps".format(pid)).splitlines()
        if re.search(r"vfio|/sys/.*/resource|/dev/iommu", line)) + "\n")
    c.say("QEMU maps 仅用于关联，不代表 Guest Stage-2 属性。")
    c.command("qemu-info-pci.txt", virsh + ["qemu-monitor-command", args.vm, "--hmp", "info pci"], show=False)
    c.command("qemu-info-mtree.txt", virsh + ["qemu-monitor-command", args.vm, "--hmp", "info mtree"], show=False)
    rc, output = c.command("qemu-query-pci.txt", virsh + ["qemu-monitor-command", args.vm,
                              '{"execute":"query-pci"}'], show=False)
    regions = []
    if rc == 0:
        try:
            regions = pci_regions(json.loads(output), devices)
        except (ValueError, KeyError, TypeError) as exc:
            c.say("query-pci 解析失败：" + str(exc))
    c.save("guest-bar-ipa.json", json.dumps(regions, indent=2) + "\n")
    c.say("已识别 {} 个直通设备 memory BAR 区间；详情 guest-bar-ipa.json。".format(len(regions)))
    if not regions:
        c.say("Guest BAR IPA UNKNOWN；请结合 qemu-info-pci.txt/mtree 人工核验，未按 XML 总线号猜测。")
    stage2_evidence(c, pid, regions, args.dump_stage2)
    c.say("本次不能确认 Runtime 参数 BAR、Guest Stage-1 属性或 Launch 内部分段耗时。")
    c.say("Device-nGnRE 候选范围还需与真实参数 BAR/offset 对齐；Normal-NC 也不单独证明有效 WC。")
    c.say("完成。OUTPUT_DIR=" + str(out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
