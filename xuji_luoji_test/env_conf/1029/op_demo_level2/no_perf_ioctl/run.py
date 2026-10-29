#!/usr/bin/env python3
"""Run a controlled libc ioctl diagnostic without perf, strace, or root."""
import argparse
from collections import defaultdict
import ctypes
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import platform
import shutil
import statistics
import subprocess
import sys
import traceback

HERE = Path(__file__).resolve().parent


class Event(ctypes.Structure):
    _fields_ = [('request', ctypes.c_uint64), ('start_ns', ctypes.c_uint64),
                ('duration_ns', ctypes.c_uint64), ('caller_pc', ctypes.c_uint64),
                ('fd', ctypes.c_int32), ('result', ctypes.c_int32),
                ('batch', ctypes.c_uint32), ('reserved', ctypes.c_uint32)]


def dump(path, value):
    Path(path).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')


def stats(values):
    values = sorted(float(x) for x in values)
    def percentile(p):
        i = (len(values) - 1) * p
        low = int(i)
        return values[low] + (values[min(low + 1, len(values) - 1)] - values[low]) * (i - low)
    return {'count': len(values), 'mean': statistics.mean(values),
            'p50': statistics.median(values), 'p95': percentile(.95),
            'min': values[0], 'max': values[-1]}


def dependencies():
    root = HERE if (HERE / 'bench.py').exists() else HERE.parent
    for name in ('bench.py', 'placements.json'):
        if not (root / name).is_file():
            raise FileNotFoundError(str(root / name))
    return root


def load_bench():
    path = dependencies() / 'bench.py'
    spec = importlib.util.spec_from_file_location('ioctl_probe_bench', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def configure_library(path):
    library = ctypes.CDLL(str(path), use_errno=True)
    for name in ('probe_count', 'probe_lost', 'probe_event_size', 'probe_capacity'):
        getattr(library, name).restype = ctypes.c_size_t
    library.probe_events.restype = ctypes.POINTER(Event)
    library.probe_begin.argtypes = [ctypes.c_uint32]
    library.probe_clock_pairs.argtypes = [ctypes.POINTER(ctypes.c_uint64), ctypes.c_size_t]
    library.probe_resolve_pc.argtypes = [ctypes.c_uint64, ctypes.POINTER(ctypes.c_char_p), ctypes.POINTER(ctypes.c_uint64)]
    if not library.probe_ready():
        raise RuntimeError('Cannot resolve the original libc ioctl; capture refused')
    if library.probe_event_size() != ctypes.sizeof(Event):
        raise RuntimeError('Native/ctypes record layout mismatch')
    global_ioctl = ctypes.cast(ctypes.CDLL(None).ioctl, ctypes.c_void_p).value
    wrapper_ioctl = ctypes.cast(library.ioctl, ctypes.c_void_p).value
    if global_ioctl != wrapper_ioctl:
        raise RuntimeError('ioctl is not globally bound to the probe; LD_PRELOAD did not take effect')
    return library


def summarize(records, total_ops):
    groups = defaultdict(list)
    for r in records:
        key = (r['request_hex'], r['fd_path_after_capture'], r['caller_library'], r['caller_offset_hex'])
        groups[key].append(r)
    result = []
    for key, rows in groups.items():
        result.append({'request_hex': key[0], 'fd_path_after_capture': key[1],
                       'caller_library': key[2], 'caller_offset_hex': key[3],
                       'count': len(rows), 'calls_per_op': len(rows) / total_ops,
                       'error_count': sum(r['result'] < 0 for r in rows),
                       'duration_us': stats(r['duration_ns'] / 1000 for r in rows),
                       'total_us_per_op': sum(r['duration_ns'] for r in rows) / 1000 / total_ops})
    return sorted(result, key=lambda r: r['total_us_per_op'], reverse=True)


def gated_measure(original, library, batch, operation, synchronize, size):
    calls = 0
    def gated_sync():
        nonlocal calls
        if calls == 0:
            synchronize()
            library.probe_begin(batch)
        elif calls == 1:
            library.probe_end()
            synchronize()
        else:
            raise RuntimeError('Unexpected synchronization count in benchmark helper')
        calls += 1
    try:
        result = original(operation, gated_sync, size)
        if calls != 2:
            raise RuntimeError('Benchmark timing helper changed; capture window unverified')
        return result
    finally:
        library.probe_end()


def worker(args):
    os.environ['TASK_QUEUE_ENABLE'] = '0'
    os.environ['OMP_NUM_THREADS'] = '1'
    os.environ['OMP_PROC_BIND'] = 'false'
    bench = load_bench()
    library, batch = None, 0
    if args.worker == 'instrumented':
        library = configure_library(args.library)
        library.probe_reset()
        original_measure = bench.measure_batch

        def measure(operation, synchronize, size):
            nonlocal batch
            # The lambda Python control uses the same helper; it is not NPU work.
            if operation.__name__ != 'operation':
                return original_measure(operation, synchronize, size)
            try:
                return gated_measure(original_measure, library, batch, operation, synchronize, size)
            finally:
                batch += 1
        bench.measure_batch = measure
    sys.argv = [str(dependencies() / 'bench.py'), '--placement', args.placement,
                '--device', '0', '--case', 'sub8', '--queue', '0', '--batch-sizes', '256',
                '--repeats', '20', '--warmup', '200', '--profile-ops', '0', '--out', args.out]
    status = bench.main()
    if library:
        output = Path(args.out)
        calibration = (ctypes.c_uint64 * 10000)()
        library.probe_clock_pairs(calibration, len(calibration))
        if any(value == 2**64 - 1 for value in calibration):
            raise RuntimeError('clock_gettime failed during calibration')
        details, resolved = [], {}
        for index in range(library.probe_count()):
            e = library.probe_events()[index]
            if e.caller_pc not in resolved:
                path, offset = ctypes.c_char_p(), ctypes.c_uint64()
                ok = library.probe_resolve_pc(e.caller_pc, ctypes.byref(path), ctypes.byref(offset))
                resolved[e.caller_pc] = (os.fsdecode(path.value) if ok and path.value else 'unknown',
                                         hex(offset.value) if ok else None)
            caller_path, caller_offset = resolved[e.caller_pc]
            try:
                fd_path = os.readlink(f'/proc/self/fd/{e.fd}')
            except OSError:
                fd_path = 'unavailable_after_capture'
            details.append({'batch': e.batch, 'fd': e.fd, 'request_hex': hex(e.request),
                            'start_monotonic_ns': e.start_ns, 'duration_ns': e.duration_ns,
                            'result': e.result, 'caller_library': caller_path,
                            'caller_offset_hex': caller_offset, 'fd_path_after_capture': fd_path})
        maps = Path('/proc/self/maps').read_text()
        dump(output / 'ioctl_events.json', details)
        summary = json.loads((output / 'summary.json').read_text())
        total_ops = sum(r['batch_size'] for r in summary['measurements'])
        state = 'overflow_or_clock_error' if library.probe_lost() else ('ok' if details else 'no_intercepted_ioctl')
        library_hashes = {}
        for caller_path, _ in resolved.values():
            path = Path(caller_path)
            if path.is_file():
                library_hashes[str(path)] = hashlib.sha256(path.read_bytes()).hexdigest()
        dump(output / 'ioctl_summary.json', {'status': state, 'capture_batches': batch,
             'total_ops': total_ops, 'captured_calls': len(details), 'lost_calls': library.probe_lost(),
             'back_to_back_clock_ns': stats(calibration), 'caller_library_sha256': library_hashes,
             'groups': summarize(details, total_ops),
             'scope': 'Selected main-thread submission windows. The pre-batch and final synchronize calls are excluded. Python clock reads remain in the window. Only calls binding through the interposed libc ioctl are visible.',
             'limitations': 'No private Runtime function segmentation or kernel stacks. Direct syscall instructions, private __ioctl and internally bound calls may bypass this probe. fd paths are resolved after capture and are only hints. ioctl duration is wall time including possible scheduling. No captured calls is not proof of no kernel or ioctl activity.'})
        (output / 'loaded_maps.txt').write_text(maps)
    return status


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--placement', choices=('vm144', 'bare192'), required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--check-only', action='store_true', help='Check tools without importing torch or using NPU')
    parser.add_argument('--worker', choices=('baseline', 'instrumented'), help=argparse.SUPPRESS)
    parser.add_argument('--library', help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.worker:
        try:
            return worker(args)
        except Exception:
            print(traceback.format_exc(), file=sys.stderr)
            return 1
    output = Path(args.out).resolve()
    output.mkdir(parents=True, exist_ok=False)
    available = {name: shutil.which(name) for name in ('cc', 'gcc', 'clang')}
    dependency_root = dependencies()
    checks = {'platform': platform.system(), 'machine': platform.machine(), 'compilers': available,
              'python': sys.version, 'dependency_root': str(dependency_root),
              'needs_perf': False, 'needs_root': False,
              'probe_sha256': hashlib.sha256((HERE / 'probe.c').read_bytes()).hexdigest(),
              'runner_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
    compiler = next((path for path in available.values() if path), None)
    checks['status'] = 'ready' if platform.system() == 'Linux' and compiler else 'unsupported_platform' if platform.system() != 'Linux' else 'missing_compiler'
    dump(output / 'preflight.json', checks)
    print(json.dumps(checks, ensure_ascii=False, indent=2))
    if checks['status'] != 'ready':
        print('No NPU test started. Preflight saved. This package needs a native C compiler; it does not substitute an unavailable tool silently.', file=sys.stderr)
        return 3
    library = output / 'libioctl_probe.so'
    build = subprocess.run([compiler, '-O2', '-fPIC', '-shared', '-Wall', '-Wextra', '-Werror',
                            str(HERE / 'probe.c'), '-o', str(library), '-ldl'],
                           stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    (output / 'build.log').write_text(build.stdout)
    if build.returncode:
        checks['status'] = 'build_failed'
        dump(output / 'preflight.json', checks)
        print('Native build failed; see build.log. No NPU test started.', file=sys.stderr)
        return 3
    checks['status'] = 'build_ok'
    checks['library_sha256'] = hashlib.sha256(library.read_bytes()).hexdigest()
    dump(output / 'preflight.json', checks)
    if args.check_only:
        return 0
    for mode in ('baseline', 'instrumented'):
        environment = dict(os.environ, TASK_QUEUE_ENABLE='0', OMP_NUM_THREADS='1', OMP_PROC_BIND='false')
        if mode == 'instrumented':
            # Preserve the existing jemalloc preload; apply the probe to this child only.
            previous = environment.get('LD_PRELOAD', '')
            environment['LD_PRELOAD'] = str(library) + (':' + previous if previous else '')
        command = [sys.executable, str(Path(__file__).resolve()), '--placement', args.placement,
                   '--out', str(output / mode), '--worker', mode, '--library', str(library)]
        with (output / f'{mode}.log').open('w') as stream:
            result = subprocess.run(command, env=environment, stdout=stream, stderr=subprocess.STDOUT)
        if result.returncode:
            print(f'{mode} failed; see {output / (mode + ".log")}', file=sys.stderr)
            return result.returncode
    baseline = json.loads((output / 'baseline/summary.json').read_text())
    measured = json.loads((output / 'instrumented/summary.json').read_text())
    ioctls = json.loads((output / 'instrumented/ioctl_summary.json').read_text())
    baseline_p50 = statistics.median(x['total_us_per_op'] for x in baseline['measurements'])
    measured_p50 = statistics.median(x['total_us_per_op'] for x in measured['measurements'])
    comparison = {'status': ioctls['status'], 'baseline_total_p50_us_per_op': baseline_p50,
                  'instrumented_total_p50_us_per_op': measured_p50,
                  'instrumented_over_baseline': measured_p50 / baseline_p50,
                  'probe_perturbation_warning': measured_p50 / baseline_p50 > 1.2,
                  'captured_calls': ioctls['captured_calls'], 'lost_calls': ioctls['lost_calls'],
                  'note': 'Fresh baseline and probe processes are separate sequential runs. Their difference includes run-to-run variation and probe effects, not only timer overhead. Compare VM/bare baseline performance separately from probe request distributions.'}
    dump(output / 'comparison.json', comparison)
    print(json.dumps(comparison, ensure_ascii=False, indent=2))
    return 0 if ioctls['status'] == 'ok' else 2


if __name__ == '__main__':
    sys.exit(main())
