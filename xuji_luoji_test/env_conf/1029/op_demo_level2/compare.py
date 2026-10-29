#!/usr/bin/env python3
"""Compare paired Ascend dispatch microbenchmark suites using Python stdlib."""
import argparse
import csv
import json
import math
from pathlib import Path
import statistics
import sys

METRICS = (
    'submit_us_per_op', 'drain_us_per_op', 'total_us_per_op',
    'main_cpu_us_per_op', 'process_cpu_us_per_op',
)
LABELS = {
    'submit_us_per_op': 'Host 提交循环墙钟',
    'drain_us_per_op': '末尾同步等待',
    'total_us_per_op': '提交至完成墙钟',
    'main_cpu_us_per_op': '主线程 CPU 记账时间',
    'process_cpu_us_per_op': '全进程 CPU 记账时间',
}
CONFIG_KEYS = ('warmup', 'repeats', 'torch_num_threads', 'batch_sizes')
ENV_KEYS = ('OMP_NUM_THREADS', 'OMP_PROC_BIND', 'LD_PRELOAD', 'ASCEND_LAUNCH_BLOCKING',
            'PYTORCH_NPU_ALLOC_CONF', 'ASCEND_GLOBAL_LOG_LEVEL', 'ASCEND_SLOG_PRINT_TO_STDOUT',
            'CPU_AFFINITY_CONF', 'PER_STREAM_QUEUE', 'ACL_OP_INIT_MODE')


def number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def run_key(data):
    try:
        return (str(data['case']), int(data['device']), int(data['queue']))
    except (KeyError, TypeError, ValueError) as exc:
        raise ValueError('summary is missing case/device/queue: %s' % exc) from exc


def load_runs(root):
    root = Path(root)
    if not root.is_dir():
        raise ValueError('Suite directory not found: %s' % root)
    runs = {}
    warnings = []
    paths = sorted(root.glob('run_*/summary.json'))
    if not paths:
        raise ValueError('No run_*/summary.json found under %s' % root)
    for path in paths:
        data = json.loads(path.read_text())
        key = run_key(data)
        if key in runs:
            raise ValueError('Duplicate case/device/queue %r: %s and %s' % (key, runs[key]['_source'], path))
        data['_source'] = str(path)
        runs[key] = data
        if data.get('status') != 'ok':
            warnings.append('%s: run status=%s; timing excluded' % (path, data.get('status', 'missing')))
    return runs, warnings


def medians(data):
    groups = {}
    if data.get('status') != 'ok':
        return groups
    for record in data.get('measurements', []):
        batch = record.get('batch_size')
        if not isinstance(batch, int) or isinstance(batch, bool) or batch <= 0:
            raise ValueError('%s: invalid batch_size %r' % (data['_source'], batch))
        bucket = groups.setdefault(batch, {metric: [] for metric in METRICS})
        for metric in METRICS:
            value = record.get(metric)
            if value is not None:
                if not number(value) or value < 0:
                    raise ValueError('%s: invalid %s %r' % (data['_source'], metric, value))
                bucket[metric].append(value)
    return {batch: {metric: (statistics.median(values) if values else None)
                    for metric, values in group.items()}
            for batch, group in groups.items()}


def ratio(numerator, denominator):
    return numerator / denominator if numerator is not None and denominator is not None and denominator > 0 else None


def api_stats(data):
    profile = data.get('profile') or {}
    if profile.get('status') != 'ok':
        return {}
    out = {}
    for row in profile.get('api_stats', []):
        name = row.get('name')
        if not name:
            continue
        if name in out:
            raise ValueError('%s: duplicate profile API name %s' % (data['_source'], name))
        if not number(row.get('count')) or row['count'] <= 0:
            continue
        clean = {'count': row['count']}
        for field in ('p50_us', 'p95_us', 'mean_us'):
            value = row.get(field)
            clean[field] = value if number(value) and value >= 0 else None
        out[name] = clean
    return out


def kernel_stats(data):
    profile = data.get('profile') or {}
    if profile.get('status') != 'ok':
        return {}
    out = {}
    for row in profile.get('kernel_stats', []):
        name, task_type = row.get('name'), row.get('task_type')
        if not name or task_type is None or str(task_type) == '':
            continue
        if not number(row.get('count')) or row['count'] <= 0:
            continue
        key = (str(name), str(task_type))
        if key in out:
            raise ValueError('%s: duplicate profile kernel/name/type %r' % (data['_source'], key))
        clean = {'count': row['count']}
        for field in ('p50_us', 'p95_us', 'mean_us'):
            value = row.get(field)
            clean[field] = value if number(value) and value >= 0 else None
        out[key] = clean
    return out


def libraries_by_name(data):
    """Paths may differ between containers; match loaded builds by basename."""
    libraries = {}
    for row in data.get('metadata', {}).get('loaded_libraries', []):
        name = Path(row.get('path', '')).name
        if name:
            libraries.setdefault(name, set()).add(row.get('sha256'))
    return libraries


def compatibility_warnings(key, bare, vm):
    warnings = []
    for side, data in (('bare', bare), ('VM', vm)):
        warnings.extend('%r %s: %s' % (key, side, warning) for warning in data.get('warnings', []))
    bh = bare.get('metadata', {}).get('benchmark_sha256')
    vh = vm.get('metadata', {}).get('benchmark_sha256')
    if bh and vh and bh != vh:
        warnings.append('%r: benchmark source SHA256 differs; use the same benchmark code on both sides' % (key,))
    for field in ('torch_version', 'torch_npu_version'):
        bv, vv = bare.get('metadata', {}).get(field), vm.get('metadata', {}).get(field)
        if bv is None or vv is None or bv != vv:
            warnings.append('%r: %s bare=%r VM=%r' % (key, field, bv, vv))
    for field in CONFIG_KEYS:
        bv, vv = bare.get('config', {}).get(field), vm.get('config', {}).get(field)
        if bv is None or vv is None or bv != vv:
            warnings.append('%r: config.%s bare=%r VM=%r' % (key, field, bv, vv))
    # Older summaries may omit this optional field; compare it when present on both.
    bv, vv = bare.get('config', {}).get('profile_ops'), vm.get('config', {}).get('profile_ops')
    if bv is not None and vv is not None and bv != vv:
        warnings.append('%r: config.profile_ops bare=%r VM=%r; profiler sample sizes differ' % (key, bv, vv))
    for field in ENV_KEYS:
        bv = bare.get('metadata', {}).get('env', {}).get(field)
        vv = vm.get('metadata', {}).get('env', {}).get(field)
        if bv != vv:
            warnings.append('%r: env.%s bare=%r VM=%r' % (key, field, bv, vv))
    bv, vv = bare.get('metadata', {}).get('case_spec'), vm.get('metadata', {}).get('case_spec')
    if bv != vv:
        warnings.append('%r: metadata.case_spec bare=%r VM=%r; workload definitions differ' % (key, bv, vv))
    bl, vl = libraries_by_name(bare), libraries_by_name(vm)
    if not bl and not vl:
        warnings.append('%r: loaded library hashes unavailable on both sides; CANN/runtime build equivalence unverified' % (key,))
    for name in sorted(set(bl) | set(vl)):
        bh, vh = bl.get(name), vl.get(name)
        if bh is None or vh is None:
            warnings.append('%r: library %s missing from %s manifest; build equivalence unverified' %
                            (key, name, 'bare' if bh is None else 'VM'))
        elif None in bh or None in vh:
            warnings.append('%r: library %s has missing/unreadable SHA256; build equivalence unverified' % (key, name))
        elif bh != vh:
            warnings.append('%r: library %s SHA256 differs; different builds, cannot attribute ratio to pure virtualization overhead' % (key, name))
        elif len(bh) != 1:
            warnings.append('%r: library %s has multiple loaded hashes; inspect duplicate builds' % (key, name))
    return warnings


def compare(bare_root, vm_root):
    bare, warnings = load_runs(bare_root)
    vm, more = load_runs(vm_root)
    warnings.extend(more)
    timing_rows, api_rows, kernel_rows = [], [], []
    for key in sorted(set(bare) | set(vm)):
        if key not in bare or key not in vm:
            warnings.append('%r: missing %s run; no paired comparison' % (key, 'bare' if key not in bare else 'VM'))
            continue
        b, v = bare[key], vm[key]
        warnings.extend(compatibility_warnings(key, b, v))
        bm, vm_m = medians(b), medians(v)
        for batch in sorted(set(bm) | set(vm_m)):
            if batch not in bm or batch not in vm_m:
                warnings.append('%r batch=%s: missing peer measurements' % (key, batch))
                continue
            for metric in METRICS:
                bv, vv = bm[batch][metric], vm_m[batch][metric]
                timing_rows.append(dict(case=key[0], device=key[1], queue=key[2], batch_size=batch,
                                        metric=metric, bare_us=bv, vm_us=vv, vm_over_bare=ratio(vv, bv)))
        ba, va = api_stats(b), api_stats(v)
        for side, data in (('bare', b), ('VM', v)):
            profile = data.get('profile') or {}
            if profile.get('status') != 'ok':
                warnings.append('%r %s: profile status=%s; actual ACL API timing unavailable' %
                                (key, side, profile.get('status', 'missing')))
            elif not profile.get('target_api_observed', False):
                warnings.append('%r %s: target HostArgs API not observed; workload may use another launch path' % (key, side))
        for name in sorted(set(ba) | set(va)):
            bapi, vapi = ba.get(name, {}), va.get(name, {})
            row = dict(case=key[0], device=key[1], queue=key[2], name=name,
                       bare_count=bapi.get('count'), vm_count=vapi.get('count'))
            for field in ('p50_us', 'p95_us', 'mean_us'):
                row['bare_' + field] = bapi.get(field)
                row['vm_' + field] = vapi.get(field)
                row[field + '_ratio'] = ratio(vapi.get(field), bapi.get(field))
            api_rows.append(row)
        bk, vk = kernel_stats(b), kernel_stats(v)
        for side, kernels in (('bare', bk), ('VM', vk)):
            if not kernels:
                warnings.append('%r %s: no identified kernel/name/TaskType data; kernel timing unavailable, not zero' % (key, side))
        for kernel_key in sorted(set(bk) ^ set(vk)):
            warnings.append('%r: kernel %r has no matching name/TaskType on %s; no kernel ratio' %
                            (key, kernel_key, 'bare' if kernel_key not in bk else 'VM'))
        for kernel_key in sorted(set(bk) & set(vk)):
            bkernel, vkernel = bk[kernel_key], vk[kernel_key]
            row = dict(case=key[0], device=key[1], queue=key[2], name=kernel_key[0],
                       task_type=kernel_key[1], bare_count=bkernel['count'], vm_count=vkernel['count'])
            for field in ('p50_us', 'p95_us', 'mean_us'):
                row['bare_' + field] = bkernel[field]
                row['vm_' + field] = vkernel[field]
                row[field + '_ratio'] = ratio(vkernel[field], bkernel[field])
            kernel_rows.append(row)
    if not timing_rows:
        raise ValueError('No paired successful timing measurements')
    return dict(timing_rows=timing_rows, api_rows=api_rows, kernel_rows=kernel_rows, warnings=warnings)


def fmt(value):
    return 'n.a.' if value is None else '%.3f' % value


def cell(value):
    return str(value).replace('|', '\\|').replace('\n', ' ')


def write_report(result, out):
    out = Path(out)
    out.mkdir(parents=True, exist_ok=False)
    fields = ('case', 'device', 'queue', 'batch_size', 'metric', 'bare_us', 'vm_us', 'vm_over_bare')
    with (out / 'comparison.csv').open('w', newline='') as stream:
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        writer.writerows(result['timing_rows'])
    kernel_fields = ('case', 'device', 'queue', 'name', 'task_type', 'bare_count', 'vm_count',
                     'bare_p50_us', 'vm_p50_us', 'p50_us_ratio', 'bare_p95_us', 'vm_p95_us',
                     'p95_us_ratio', 'bare_mean_us', 'vm_mean_us', 'mean_us_ratio')
    with (out / 'kernel_comparison.csv').open('w', newline='') as stream:
        writer = csv.DictWriter(stream, fieldnames=kernel_fields)
        writer.writeheader()
        writer.writerows(result['kernel_rows'])
    lines = ['# 算子下发微基准对比', '',
             '数值为各批次重复测量的中位数，单位为 μs/操作；比值为 VM / 裸机。', '',
             'Host 提交循环包含 Python/框架/队列与可能的反压；它不是纯 ACL Launch 时长。末尾同步等待也不能等同设备计算时间。', '',
             '## 无 profiler 的计时', '',
             '| 算例 | NPU | Task queue | 批大小 | 指标 | 裸机 μs/op | VM μs/op | VM/裸机 |',
             '|---|---:|---:|---:|---|---:|---:|---:|']
    for row in result['timing_rows']:
        lines.append('| %s | %s | %s | %s | %s | %s | %s | %s |' % (
            cell(row['case']), row['device'], row['queue'], row['batch_size'], LABELS[row['metric']],
            fmt(row['bare_us']), fmt(row['vm_us']), fmt(row['vm_over_bare'])))
    lines.extend(['', '## 独立 profiling 的实际 API', '',
                  '此表只比较 trace 中实际出现的同名 API；采集开销与上表分开。未采到、采集失败或零调用显示 n.a.，不会当成 0 μs。', '',
                  '| 算例 | NPU | Task queue | API | 裸机次数 | VM 次数 | 裸机 P50 μs | VM P50 μs | P50 比值 | 裸机 P95 μs | VM P95 μs | P95 比值 |',
                  '|---|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|'])
    for row in result['api_rows']:
        lines.append('| %s | %s | %s | %s | %s | %s | %s | %s | %s | %s | %s | %s |' % (
            cell(row['case']), row['device'], row['queue'], cell(row['name']),
            'n.a.' if row['bare_count'] is None else row['bare_count'],
            'n.a.' if row['vm_count'] is None else row['vm_count'],
            fmt(row['bare_p50_us']), fmt(row['vm_p50_us']), fmt(row['p50_us_ratio']),
            fmt(row['bare_p95_us']), fmt(row['vm_p95_us']), fmt(row['p95_us_ratio'])))
    if not result['api_rows']:
        lines.append('| — | — | — | 两侧没有可用 API 数据 | n.a. | n.a. | n.a. | n.a. | n.a. | n.a. | n.a. | n.a. |')
    lines.extend(['', '## 独立 profiling 的设备 kernel', '',
                  '只对相同算例、NPU、Task queue、kernel 名称和 TaskType 配对。单位为单次 kernel 的 μs；它与设备流首尾跨度不同。未识别或类型不同的 kernel 不计算比值，明细见可比性提示。', '',
                  '| 算例 | NPU | Task queue | Kernel | TaskType | 裸机 P50 μs | VM P50 μs | P50 比值 | 裸机 P95 μs | VM P95 μs | P95 比值 |',
                  '|---|---:|---:|---|---|---:|---:|---:|---:|---:|---:|'])
    for row in result['kernel_rows']:
        lines.append('| %s | %s | %s | %s | %s | %s | %s | %s | %s | %s | %s |' % (
            cell(row['case']), row['device'], row['queue'], cell(row['name']), cell(row['task_type']),
            fmt(row['bare_p50_us']), fmt(row['vm_p50_us']), fmt(row['p50_us_ratio']),
            fmt(row['bare_p95_us']), fmt(row['vm_p95_us']), fmt(row['p95_us_ratio'])))
    if not result['kernel_rows']:
        lines.append('| — | — | — | 没有同名且同 TaskType 的可用配对 | — | n.a. | n.a. | n.a. | n.a. | n.a. | n.a. |')
    lines.extend(['', '## 可比性检查', ''])
    lines.extend('- ' + cell(message) for message in result['warnings'])
    if not result['warnings']:
        lines.append('配对的版本和基准参数一致。CPU/内存/设备实际位置仍以各运行元数据为准。')
    lines.extend(['', '比值描述这两次运行的差异。若工作负载、环境变量或所加载的库 build 不同，不能将它称为纯虚拟化开销。', '',
                  '不同 Task queue 模式必须分别比较。不能把 Python 提交时间、ACL API 累计、设备时间和末尾等待直接相加或相减来推算业务收益。', ''])
    (out / 'comparison.md').write_text('\n'.join(lines))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bare', required=True)
    parser.add_argument('--vm', required=True)
    parser.add_argument('--out', required=True, help='New output directory; must not already exist')
    args = parser.parse_args()
    result = compare(args.bare, args.vm)
    write_report(result, args.out)
    print('Saved comparison.csv, kernel_comparison.csv and comparison.md under %s' % args.out)
    for message in result['warnings']:
        print('WARNING: ' + message, file=sys.stderr)


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        sys.exit('ERROR: ' + str(exc))
