#!/usr/bin/env python3
"""Fixed-op Ascend microbenchmark. Standard-library imports until main()."""
import argparse
import collections
import csv
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import platform
import statistics
import subprocess
import sys
import time
import traceback

CASES = {'sub8': {'op': 'sub', 'shape': [8], 'dtype': 'int32', 'expected': 5},
         'add1024': {'op': 'add', 'shape': [1024], 'dtype': 'float32', 'expected': 9}}
ENV_KEYS = ('TASK_QUEUE_ENABLE', 'ASCEND_LAUNCH_BLOCKING', 'ASCEND_RT_VISIBLE_DEVICES',
            'ASCEND_VISIBLE_DEVICES', 'OMP_NUM_THREADS', 'OMP_PROC_BIND', 'LD_PRELOAD',
            'ASCEND_HOME_PATH', 'ASCEND_OPP_PATH', 'ASCEND_GLOBAL_LOG_LEVEL',
            'ASCEND_SLOG_PRINT_TO_STDOUT', 'PYTORCH_NPU_ALLOC_CONF',
            'CPU_AFFINITY_CONF', 'PER_STREAM_QUEUE', 'ACL_OP_INIT_MODE')


def dump(path, data):
    Path(path).write_text(json.dumps(data, indent=2, ensure_ascii=False, allow_nan=False))


def read(path):
    try:
        return Path(path).read_text()
    except OSError as exc:
        return 'UNAVAILABLE: ' + str(exc)


def cpus(text):
    result = set()
    for part in text.split(','):
        bounds = part.split('-')
        lo, hi = int(bounds[0]), int(bounds[-1])
        if len(bounds) > 2 or lo > hi or lo < 0:
            raise ValueError('Invalid CPU list: ' + text)
        result.update(range(lo, hi + 1))
    if not result:
        raise ValueError('Empty CPU list')
    return result


def command(args):
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=15)
        return {'argv': args, 'returncode': result.returncode,
                'stdout': result.stdout[:100000], 'stderr': result.stderr[:10000]}
    except (OSError, subprocess.TimeoutExpired) as exc:
        return {'argv': args, 'error': str(exc)}


def threads():
    result = {}
    for path in Path('/proc/self/task').iterdir():
        try:
            tid = int(path.name)
            fields = path.joinpath('stat').read_text().rsplit(')', 1)[1].split()
            status = dict(line.split(':', 1) for line in path.joinpath('status').read_text().splitlines() if ':' in line)
            sched = [int(x) for x in path.joinpath('schedstat').read_text().split()]
            result[str(tid)] = {
                'tid': tid, 'name': path.joinpath('comm').read_text().strip(),
                'start_ticks': int(fields[19]), 'cpu': int(fields[36]),
                'state': fields[0], 'utime_ticks': int(fields[11]), 'stime_ticks': int(fields[12]),
                'affinity': sorted(os.sched_getaffinity(tid)),
                'runtime_ns': sched[0], 'runqueue_wait_ns': sched[1], 'timeslices': sched[2],
                'voluntary_switches': int(status.get('voluntary_ctxt_switches', 0)),
                'nonvoluntary_switches': int(status.get('nonvoluntary_ctxt_switches', 0))}
        except (OSError, ValueError, IndexError):
            continue
    return result


def thread_deltas(before, after):
    names = ('utime_ticks', 'stime_ticks', 'runtime_ns', 'runqueue_wait_ns',
             'timeslices', 'voluntary_switches', 'nonvoluntary_switches')
    result = []
    for tid, end in after.items():
        start = before.get(tid)
        if start is None or start['start_ticks'] != end['start_ticks']:
            result.append({'tid': int(tid), 'name': end['name'], 'status': 'new_or_reused'})
        else:
            result.append({'tid': int(tid), 'name': end['name'], 'status': 'matched',
                           'affinity_before': start['affinity'], 'affinity_after': end['affinity'],
                           **{name: end[name] - start[name] for name in names}})
    for tid in before.keys() - after.keys():
        result.append({'tid': int(tid), 'name': before[tid]['name'], 'status': 'exited'})
    return result


def bind(placement, allowed):
    pool, main = cpus(placement['pool']), cpus(placement['main'])
    if not pool <= allowed or not main <= pool or not {placement['acl'], placement['release']} <= pool:
        raise ValueError('Placement exceeds initial allowed CPUs or has invalid roles')
    for cpu in pool:
        nodes = list(Path('/sys/devices/system/cpu/cpu' + str(cpu)).glob('node[0-9]*'))
        if nodes and {int(p.name[4:]) for p in nodes} != {placement['numa']}:
            raise ValueError('CPU %s NUMA differs from preset; inspect/update placements.json' % cpu)
    changes = []
    for tid, row in threads().items():
        target = ({placement['acl']} if 'acl_thread' in row['name'] else
                  {placement['release']} if 'release_thread' in row['name'] else main)
        os.sched_setaffinity(int(tid), target)
        if set(os.sched_getaffinity(int(tid))) != target:
            raise ValueError('Kernel/cgroup did not accept affinity for TID ' + tid)
        changes.append({'tid': int(tid), 'name': row['name'], 'before': row['affinity'], 'after': sorted(target)})
    return changes


def library_manifest():
    libraries = set()
    for line in read('/proc/self/maps').splitlines():
        pieces = line.split()
        if len(pieces) >= 6 and pieces[-1].startswith('/') and any(
                word in pieces[-1] for word in ('libascendcl', 'libruntime', 'libopapi', 'libtorch_npu')):
            libraries.add(pieces[-1])
    result = []
    for name in sorted(libraries):
        try:
            path = Path(name)
            digest = hashlib.sha256()
            with path.open('rb') as stream:
                for block in iter(lambda: stream.read(1024 * 1024), b''):
                    digest.update(block)
            result.append({'path': name, 'size': path.stat().st_size, 'sha256': digest.hexdigest()})
        except OSError as exc:
            result.append({'path': name, 'error': str(exc)})
    return result


def percentile(values, fraction):
    ordered = sorted(values)
    if not ordered:
        return None
    pos = (len(ordered) - 1) * fraction
    lo = int(pos)
    return ordered[lo] + (ordered[min(lo + 1, len(ordered) - 1)] - ordered[lo]) * (pos - lo)


def stat(name, values):
    return {'name': name, 'count': len(values), 'mean_us': statistics.mean(values),
            'p50_us': percentile(values, .5), 'p95_us': percentile(values, .95),
            'p99_us': percentile(values, .99), 'min_us': min(values), 'max_us': max(values)}


def parse_traces(root):
    import math
    import re

    paths = sorted(Path(root).rglob('trace_view.json'))
    if not paths:
        return {'status': 'error', 'error': 'Profiler did not export trace_view.json',
                'target_api_observed': False, 'api_stats': []}
    if len(paths) != 1:
        return {'status': 'error', 'error': 'Expected one trace; refusing to double count exports',
                'trace_files': [str(p) for p in paths], 'target_api_observed': False, 'api_stats': []}
    raw = json.loads(paths[0].read_text())
    events = raw.get('traceEvents', []) if isinstance(raw, dict) else raw
    if not isinstance(events, list):
        return {'status': 'error', 'error': 'Trace events are not a list',
                'target_api_observed': False, 'api_stats': [], 'kernel_stats': []}
    # CANN and Ascend Hardware events often have NO cat field. Their Chrome
    # process metadata is authoritative; a Python record_function may use an
    # identical-looking name and must not be counted as a Runtime API.
    process_names = {
        str(event['pid']): str(event.get('args', {}).get('name', ''))
        for event in events if isinstance(event, dict) and event.get('ph') == 'M'
        and event.get('name') == 'process_name' and 'pid' in event
        and isinstance(event.get('args', {}), dict)
    }
    groups, kernels, cats = collections.defaultdict(list), collections.defaultdict(list), collections.Counter()
    api_processes, api_threads = collections.defaultdict(set), collections.defaultdict(set)
    kernel_processes, kernel_threads = collections.defaultdict(set), collections.defaultdict(set)
    hardware_types = collections.Counter()
    api_pattern = re.compile(
        r'AscendCL@(?:aclrtLaunchKernel[A-Za-z0-9_]*|aclmdlRIExecuteAsync|'
        r'aclnn(?:Add|Adds|Sub|Subs)(?:GetWorkspaceSize)?)')
    compute_types = {'AI_CORE', 'AI_VECTOR_CORE', 'MIX_AIC', 'MIX_AIV', 'AI_CPU'}
    for event in events:
        if not isinstance(event, dict) or event.get('ph') != 'X':
            continue
        duration = event.get('dur')
        if (isinstance(duration, bool) or not isinstance(duration, (float, int))
                or not math.isfinite(duration) or duration < 0):
            continue
        name, category = str(event.get('name', '')), str(event.get('cat', ''))
        cats[category] += 1
        process = process_names.get(str(event.get('pid')), '')
        if process == 'CANN' and api_pattern.fullmatch(name):
            groups[name].append(float(duration))
            api_processes[name].add(str(event.get('pid')))
            api_threads[name].add(str(event.get('tid')))
        if process == 'Ascend Hardware':
            arguments = event.get('args', {})
            task_type = str(arguments.get('Task Type', '')) if isinstance(arguments, dict) else ''
            hardware_types[task_type or '<missing>'] += 1
            if task_type in compute_types:
                key = (name, task_type)
                kernels[key].append(float(duration))
                kernel_processes[key].add(str(event.get('pid')))
                kernel_threads[key].add(str(event.get('tid')))
    return {'status': 'ok', 'trace_files': [str(p) for p in paths],
            'duration_unit': 'Chrome trace microseconds',
            'target_api_observed': 'AscendCL@aclrtLaunchKernelWithHostArgs' in groups,
            'api_stats': [{**stat(name, values), 'source_process': 'CANN',
                           'process_ids': sorted(api_processes[name]),
                           'thread_ids': sorted(api_threads[name])}
                          for name, values in sorted(groups.items())],
            'kernel_stats': [{**stat(name, values), 'task_type': task_type,
                              'source_process': 'Ascend Hardware',
                              'process_ids': sorted(kernel_processes[(name, task_type)]),
                              'thread_ids': sorted(kernel_threads[(name, task_type)])}
                             for (name, task_type), values in sorted(kernels.items())],
            'categories': dict(cats),
            'trace_process_names': process_names,
            'hardware_task_type_counts': dict(hardware_types),
            'note': 'API statistics come from a separate instrumented pass, not baseline timing. '
                    'Only CANN process AscendCL API events are included; parent enqueue/dequeue/CPU scopes '
                    'are excluded. Kernels require Ascend Hardware process metadata and a recognized '
                    'compute Task Type; EVENT/NOTIFY/DMA/MODEL and unknown task types are not compute. '
                    'Each kernel name and Task Type is grouped separately; no parent/child durations are added.'}


def measure_batch(operation, synchronize, size):
    synchronize()
    start_main, start_proc = time.thread_time_ns(), time.process_time_ns()
    start = time.perf_counter_ns()
    for _ in range(size):
        operation()
    submitted = time.perf_counter_ns()
    submit_main, submit_proc = time.thread_time_ns(), time.process_time_ns()
    sync_start = time.perf_counter_ns()
    synchronize()
    end = time.perf_counter_ns()
    end_main, end_proc = time.thread_time_ns(), time.process_time_ns()
    divisor = size * 1000
    return {'batch_size': size, 'submit_wall_ns': submitted - start,
            'drain_wall_ns': end - sync_start, 'total_wall_ns': end - start,
            'boundary_overhead_ns': sync_start - submitted,
            'submit_us_per_op': (submitted - start) / divisor,
            'drain_us_per_op': (end - sync_start) / divisor,
            'total_us_per_op': (end - start) / divisor,
            'main_cpu_us_per_op': (end_main - start_main) / divisor,
            'process_cpu_us_per_op': (end_proc - start_proc) / divisor,
            'submit_main_cpu_us_per_op': (submit_main - start_main) / divisor,
            'submit_process_cpu_us_per_op': (submit_proc - start_proc) / divisor}


def run_profile(torch, torch_npu, operation, synchronize, count, root):
    profiler = torch_npu.profiler
    synchronize()
    experimental = profiler._ExperimentalConfig(profiler_level=profiler.ProfilerLevel.Level1)
    with profiler.profile(activities=[profiler.ProfilerActivity.CPU, profiler.ProfilerActivity.NPU],
                          record_shapes=True, profile_memory=False, with_stack=False,
                          experimental_config=experimental,
                          on_trace_ready=profiler.tensorboard_trace_handler(str(root))) as prof:
        with torch.profiler.record_function('launch_microbench_profile'):
            for _ in range(count):
                operation()
            synchronize()
        prof.step()
    result = parse_traces(root)
    result['torch_op_count'] = count
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--case', choices=CASES, required=True)
    parser.add_argument('--device', type=int, required=True)
    parser.add_argument('--queue', type=int, choices=(0, 1), required=True)
    parser.add_argument('--placement', choices=('vm144', 'bare192'), required=True)
    parser.add_argument('--placements', default=str(Path(__file__).with_name('placements.json')))
    parser.add_argument('--out', required=True)
    parser.add_argument('--batch-sizes', default='1,32,256')
    parser.add_argument('--repeats', type=int, default=20)
    parser.add_argument('--warmup', type=int, default=200)
    parser.add_argument('--torch-num-threads', type=int, default=10)
    parser.add_argument('--profile-ops', type=int, default=128, help='0 disables separate short trace')
    args = parser.parse_args()
    sizes = [int(x) for x in args.batch_sizes.split(',')]
    if args.repeats < 2 or args.warmup < 1 or args.profile_ops < 0 or not sizes or min(sizes) < 1 or len(sizes) != len(set(sizes)):
        parser.error('Need repeats>=2, warmup>=1, profile-ops>=0 and distinct positive batch sizes')
    if os.environ.get('TASK_QUEUE_ENABLE') != str(args.queue):
        parser.error('Use run_suite.py: TASK_QUEUE_ENABLE must be set BEFORE importing torch_npu')
    if os.environ.get('ASCEND_LAUNCH_BLOCKING') == '1':
        parser.error('ASCEND_LAUNCH_BLOCKING=1 overrides task_queue; unset it for this experiment')
    if not hasattr(os, 'sched_getaffinity'):
        parser.error('Run in the Linux Ascend container, not on macOS')
    for key in ('ASCEND_RT_VISIBLE_DEVICES',):
        if os.environ.get(key):
            parser.error(key + ' is set; use a container exposing all original device IDs or explicitly adapt placement/device mapping')
    root = Path(args.out).resolve()
    root.mkdir(parents=True, exist_ok=False)
    summary = {'schema_version': 1, 'status': 'error', 'case': args.case,
               'device': args.device, 'queue': args.queue,
               'config': {'repeats': args.repeats, 'batch_sizes': sizes, 'warmup': args.warmup,
                          'torch_num_threads': args.torch_num_threads, 'profile_ops': args.profile_ops},
               'measurements': [], 'profile': {'status': 'disabled', 'target_api_observed': False, 'api_stats': []}}
    try:
        placement = json.loads(Path(args.placements).read_text())[args.placement][str(args.device)]
        summary['placement'] = {'preset': args.placement, **placement}
        allowed = set(os.sched_getaffinity(0))
        # Bind the new benchmark process BEFORE NPU/torch initialization. No existing service is changed.
        if not cpus(placement['pool']) <= allowed:
            raise ValueError('Preset CPU pool is outside the container allowed CPU set')
        os.sched_setaffinity(0, cpus(placement['main']))
        import torch
        import torch_npu
        torch.set_num_threads(args.torch_num_threads)
        torch_npu.npu.set_device(args.device)
        if not torch_npu.npu.is_available():
            raise RuntimeError('NPU is not available')
        metadata = {'utc': datetime.now(timezone.utc).isoformat(), 'hostname': platform.node(),
                    'kernel': platform.release(), 'machine': platform.machine(), 'python': sys.version,
                    'torch_version': torch.__version__, 'torch_npu_version': torch_npu.__version__,
                    'benchmark_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                    'placements_sha256': hashlib.sha256(Path(args.placements).read_bytes()).hexdigest(),
                    'device_name': torch_npu.npu.get_device_name(args.device),
                    'pid': os.getpid(), 'main_tid': __import__('threading').get_native_id(),
                    'initial_allowed_cpus': sorted(allowed), 'clk_tck': os.sysconf('SC_CLK_TCK'),
                    'env': {key: os.environ.get(key) for key in ENV_KEYS},
                    'sched_schedstats': read('/proc/sys/kernel/sched_schedstats').strip(),
                    'cgroup': read('/proc/self/cgroup'), 'cmdline': read('/proc/cmdline'),
                    'cpuinfo': read('/proc/cpuinfo'), 'proc_status': read('/proc/self/status'),
                    'cgroup_v2_cpu_stat': read('/sys/fs/cgroup/cpu.stat'),
                    'cgroup_v2_cpu_max': read('/sys/fs/cgroup/cpu.max'),
                    'cgroup_read_scope': 'mount_root; not necessarily the process cgroup/ancestors; does not exclude quotas',
                    'lscpu': command(['lscpu', '-e=CPU,NODE,SOCKET,CORE,ONLINE']),
                    'numactl': command(['numactl', '--show']),
                    'npu_smi': command(['npu-smi', 'info']),
                    'npu_topology': command(['npu-smi', 'info', '-t', 'topo']),
                    'memory_policy': 'inherited; not changed by this script',
                    'case_spec': CASES[args.case]}
        summary['metadata'] = metadata
        dtype = getattr(torch, CASES[args.case]['dtype'])
        x = torch.full(CASES[args.case]['shape'], 7, dtype=dtype, device='npu:' + str(args.device))
        y = torch.full_like(x, 2)
        out = torch.empty_like(x)
        function = getattr(torch, CASES[args.case]['op'])

        def operation():
            function(x, y, out=out)

        synchronize = torch_npu.npu.synchronize
        with torch.inference_mode():
            for _ in range(args.warmup):
                operation()
            synchronize()
            summary['thread_binding'] = bind(placement, allowed)
            # Warm again after role binding; task_queue threads now have their dedicated CPU.
            for _ in range(args.warmup):
                operation()
            synchronize()
            summary['thread_binding'] = bind(placement, allowed)
            before = threads()
            summary['threads_before'] = before
            summary['acl_thread_count'] = sum('acl_thread' in row['name'] for row in before.values())
            summary['warnings'] = []
            if args.queue == 1 and not summary['acl_thread_count']:
                summary['warnings'].append('No thread named acl_thread found. Queue env is set but dedicated ACL thread placement is unverified; inspect actual Launch TID in trace.')
            empty_sync = []
            for _ in range(20):
                start = time.perf_counter_ns()
                synchronize()
                empty_sync.append((time.perf_counter_ns() - start) / 1000)
            summary['empty_sync_us'] = stat('synchronize_when_idle', empty_sync)
            summary['python_loop_control'] = [
                measure_batch(lambda: None, lambda: None, size) for size in sizes]
            for repeat in range(args.repeats):
                # Rotate order to reduce a fixed size-order/time trend.
                for size in sizes[repeat % len(sizes):] + sizes[:repeat % len(sizes)]:
                    sample = measure_batch(operation, synchronize, size)
                    sample['repeat'] = repeat
                    summary['measurements'].append(sample)
            after = threads()
            summary['threads_after'] = after
            summary['thread_deltas'] = thread_deltas(before, after)
            summary['correctness'] = bool(torch.all(out.cpu() == CASES[args.case]['expected']).item())
            if not summary['correctness']:
                raise RuntimeError('Output correctness check failed')
            # Main/ACL affinity must remain as recorded, including any threads created late.
            expected = {str(change['tid']): change['after'] for change in summary['thread_binding']}
            changed = [tid for tid, row in after.items() if tid not in expected or row['affinity'] != expected[tid]]
            summary['affinity_consistent'] = not changed
            summary['new_or_changed_threads'] = changed
            if changed:
                raise RuntimeError('Threads/affinity changed during timing; results invalid: ' + str(changed))
            dump(root / 'timing_unprofiled.json', {**summary, 'status': 'ok'})
            if args.profile_ops:
                try:
                    summary['profile'] = run_profile(torch, torch_npu, operation, synchronize,
                                                     args.profile_ops, root / 'profile')
                except Exception:
                    summary['profile'] = {'status': 'error', 'error': traceback.format_exc(),
                                          'target_api_observed': False, 'api_stats': []}
        metadata['loaded_libraries'] = library_manifest()
        metadata['npu_smi_after'] = command(['npu-smi', 'info'])
        summary['status'] = 'ok'
        summary['timing_semantics'] = {
            'submit': 'Python/torch_npu call-return wall time; queue1 can primarily measure enqueue and backpressure.',
            'drain': 'Final synchronize duration; includes queued host/device work, not pure kernel time.',
            'total': 'Wall time for batch submit + clock boundary overhead + final synchronize.',
            'cpu': 'OS CPU accounting in this guest/bare kernel; not proof of physical CPU availability.',
            'schedstat': 'Zero wait counters are inconclusive if schedstats disabled; window includes snapshot edges.',
            'profile': 'Separate instrumented pass; actual API durations cannot be substituted for baseline wall time.'}
    except Exception:
        summary['error'] = traceback.format_exc()
    finally:
        dump(root / 'summary.json', summary)
        if summary['measurements']:
            with (root / 'measurements.csv').open('w', newline='') as stream:
                writer = csv.DictWriter(stream, fieldnames=list(summary['measurements'][0]))
                writer.writeheader()
                writer.writerows(summary['measurements'])
        dump(root / 'environment.json', summary.get('metadata', {}))
        dump(root / 'threads.json', {key: summary[key] for key in (
            'thread_binding', 'threads_before', 'threads_after', 'thread_deltas') if key in summary})
    print(json.dumps({'status': summary['status'], 'case': args.case, 'device': args.device,
                      'queue': args.queue, 'profile': summary['profile']['status'],
                      'target_api_observed': summary['profile']['target_api_observed'], 'out': str(root)}))
    if summary['status'] != 'ok':
        print(summary.get('error', 'Unknown error'), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
