#!/usr/bin/env python3
"""Sample existing per-VM KVM counters without enabling tracing (Python 3.6+)."""

import argparse
import csv
import datetime
import json
import os
from pathlib import Path
import platform
import shutil
import sys
import tempfile
import time
import xml.etree.ElementTree as ET

sys.dont_write_bytecode = True
from check_host_bar_wc import find_qemu, invoke, read


METRICS = ("exits", "mmio_exit_kernel", "mmio_exit_user", "wfi_exit_stat", "wfe_exit_stat")


def utc_now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def process_identity(pid):
    # Fields after the final ')' start with field 3; starttime is field 22.
    text = read("/proc/{}/stat".format(pid))
    fields = text.rsplit(")", 1)[-1].split()
    return fields[19] if len(fields) > 19 else None


def snapshot(directory):
    result = {}
    for metric in METRICS:
        value = read(directory / metric).strip()
        result[metric] = int(value) if value.isdigit() else None
    return result


def differences(before, after, seconds):
    result = {}
    for metric in METRICS:
        lo, hi = before.get(metric), after.get(metric)
        if lo is None or hi is None:
            result[metric] = {"status": "unavailable", "delta": None, "rate_per_s": None}
        elif hi < lo:
            result[metric] = {"status": "reset_or_invalid", "delta": None, "rate_per_s": None}
        else:
            result[metric] = {"status": "ok", "delta": hi - lo, "rate_per_s": (hi - lo) / seconds}
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--vm", default="instance-00000b34")
    parser.add_argument("--label", required=True, help="e.g. idle, workload, microbench")
    parser.add_argument("--seconds", type=float, default=30, help="sample duration, 1..60 seconds")
    parser.add_argument("--interval", type=float, default=1, help="sample interval, >=0.2 seconds")
    parser.add_argument("--out", type=Path, help="new output directory")
    args = parser.parse_args()
    if not 1 <= args.seconds <= 60 or not 0.2 <= args.interval <= args.seconds:
        parser.error("Need seconds in [1,60] and interval in [0.2,seconds].")
    if platform.system() != "Linux" or os.geteuid() != 0:
        parser.error("请在 Linux 宿主机以 sudo python3 运行。")
    if not shutil.which("virsh"):
        parser.error("未找到 virsh。")
    rc, domain_id = invoke(["virsh", "--connect", "qemu:///system", "domid", args.vm])
    if rc or not domain_id.strip().isdigit():
        parser.error("目标域未运行或查询失败。")
    rc, xml = invoke(["virsh", "--connect", "qemu:///system", "dumpxml", args.vm])
    if rc:
        parser.error("无法查询目标域 XML：" + xml.strip())
    try:
        uuid = ET.fromstring(xml).findtext("uuid")
    except ET.ParseError as exc:
        parser.error(str(exc))
    if not uuid:
        parser.error("域 XML 缺少 UUID。")
    pids = find_qemu(uuid, args.vm)
    if len(pids) != 1:
        parser.error("无法唯一确定 QEMU PID：" + str(pids))
    pid = pids[0]
    identity = process_identity(pid)
    if identity is None:
        parser.error("无法读取目标 QEMU 的启动时间。")
    directories = set()
    for line in read("/proc/mounts").splitlines():
        fields = line.split()
        if len(fields) > 2 and fields[2] == "debugfs":
            root = Path(fields[1].replace("\\040", " ")) / "kvm"
            directories.update(p.resolve() for p in root.glob(str(pid) + "-*") if p.is_dir())
    if len(directories) != 1:
        parser.error("无法唯一确定目标 VM 的 KVM debugfs 目录：" + str(sorted(directories)))
    directory = next(iter(directories))
    first_values = snapshot(directory)
    if all(value is None for value in first_values.values()):
        parser.error("目标目录中的计数均不可读或不是单一整数。")
    os.umask(0o077)
    if args.out:
        args.out.mkdir(parents=True, exist_ok=False)
        out = args.out.resolve()
    else:
        out = Path(tempfile.mkdtemp(prefix="host_kvm_sample_"))
    start = time.monotonic()
    samples = [{"utc": utc_now(), "elapsed_seconds": 0.0, "values": first_values}]
    status = "ok"
    print("OUTPUT_DIR={}\nVM={} PID={} KVM_DIR={}\nlabel={} duration={}s".format(
        out, args.vm, pid, directory, args.label, args.seconds), flush=True)
    try:
        with (out / "samples.csv").open("w", newline="") as f:
            writer = csv.writer(f)
            writer.writerow(["utc", "elapsed_seconds", "metric", "value", "delta", "rate_per_s", "status"])
            for metric, value in first_values.items():
                writer.writerow([samples[0]["utc"], 0, metric, value, "", "", "baseline"])
            f.flush()
            deadline = start + args.seconds
            next_tick = start + args.interval
            while time.monotonic() < deadline:
                wake = min(next_tick, deadline)
                time.sleep(max(0, wake - time.monotonic()))
                if process_identity(pid) != identity:
                    status = "qemu_exited_or_restarted"
                    break
                now = time.monotonic()
                sample = {"utc": utc_now(), "elapsed_seconds": now - start, "values": snapshot(directory)}
                previous = samples[-1]
                delta = differences(previous["values"], sample["values"],
                                    sample["elapsed_seconds"] - previous["elapsed_seconds"])
                for metric in METRICS:
                    d = delta[metric]
                    writer.writerow([sample["utc"], sample["elapsed_seconds"], metric,
                                     sample["values"][metric], d["delta"], d["rate_per_s"], d["status"]])
                samples.append(sample)
                f.flush()
                next_tick = max(next_tick + args.interval, now + 0.001)
    except KeyboardInterrupt:
        status = "interrupted_partial"
    elapsed = samples[-1]["elapsed_seconds"]
    total = differences(first_values, samples[-1]["values"], elapsed) if elapsed > 0 else {}
    result = {"status": status, "vm": args.vm, "uuid": uuid, "qemu_pid": pid,
              "qemu_starttime_ticks": identity, "kvm_directory": str(directory),
              "label": args.label, "requested_seconds": args.seconds,
              "actual_seconds": elapsed, "samples": samples, "totals": total,
              "limits": ["Per-VM counters include unrelated guest device activity.",
                         "A counter increment is not a unique NPU doorbell or Launch count.",
                         "These counters do not reveal effective WC or Stage-2 attributes."]}
    (out / "summary.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"status": status, "actual_seconds": elapsed, "totals": total}, indent=2))
    print("OUTPUT_DIR=" + str(out))
    return 0 if status == "ok" else 2


if __name__ == "__main__":
    sys.exit(main())
