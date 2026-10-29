#!/usr/bin/env python3
"""Single-case Runtime Level2 diagnostic, reusing the original unprofiled benchmark."""
import argparse
from decimal import Decimal
import importlib.util
import json
import os
from pathlib import Path
import statistics
import sys


def events_from(path):
    data = json.loads(Path(path).read_text(), parse_float=Decimal)
    return data.get('traceEvents', []) if isinstance(data, dict) else data


def union_length(intervals):
    total, end = Decimal(0), None
    for start, stop in sorted(intervals):
        if end is None or start > end:
            total += stop - start
            end = stop
        elif stop > end:
            total += stop - end
            end = stop
    return total


def analyze_runtime(trace):
    events = events_from(trace)
    processes = {str(e['pid']): e.get('args', {}).get('name') for e in events
                 if e.get('ph') == 'M' and e.get('name') == 'process_name'}
    cann, runtime, launches = [], [], []
    for event in events:
        if event.get('ph') != 'X' or processes.get(str(event.get('pid'))) != 'CANN':
            continue
        try:
            start = Decimal(str(event['ts']))
            duration = Decimal(str(event['dur']))
        except (KeyError, ArithmeticError):
            continue
        if not start.is_finite() or not duration.is_finite() or duration < 0:
            continue
        row = {'name': str(event.get('name', '')), 'pid': str(event['pid']),
               'tid': str(event['tid']), 'start': start, 'end': start + duration,
               'duration': duration}
        cann.append(row)
        level = str(event.get('args', {}).get('level', '')).lower()
        if row['name'].startswith('Runtime@') or level == 'runtime':
            runtime.append(row)
        if row['name'] == 'AscendCL@aclrtLaunchKernelWithHostArgs':
            launches.append(row)
    matched, per_launch, totals = [], [], {}
    for launch in launches:
        children = [r for r in runtime if (r['pid'], r['tid']) == (launch['pid'], launch['tid'])
                    and launch['start'] <= r['start'] and r['end'] <= launch['end']]
        if len(children) > 5000:
            raise ValueError('Too many runtime children; refusing unexpectedly expensive nested analysis')
        covered = union_length([(r['start'], r['end']) for r in children])
        per_launch.append({'launch_duration_us': float(launch['duration']),
                           'runtime_event_count': len(children),
                           'visible_runtime_union_us': float(covered),
                           'outside_visible_runtime_us': float(launch['duration'] - covered)})
        for row in children:
            # Equal intervals are not assigned an invented nesting order. Their
            # self time is unavailable because the trace does not resolve it.
            equal = any(other is not row and row['start'] == other['start']
                        and row['end'] == other['end'] for other in children)
            descendants = [(r['start'], r['end']) for r in children if r is not row
                           and row['start'] <= r['start'] and r['end'] <= row['end']
                           and (row['start'], row['end']) != (r['start'], r['end'])]
            self_time = None if equal else float(row['duration'] - union_length(descendants))
            matched.append({'name': row['name'], 'duration_us': float(row['duration']),
                            'visible_self_us': self_time})
            group = totals.setdefault(row['name'], {'inclusive': [], 'self': []})
            group['inclusive'].append(float(row['duration']))
            if self_time is not None:
                group['self'].append(self_time)
    stats = []
    for name, group in sorted(totals.items()):
        stats.append({'name': name, 'count': len(group['inclusive']),
                      'mean_inclusive_us': statistics.mean(group['inclusive']),
                      'p50_inclusive_us': statistics.median(group['inclusive']),
                      'mean_visible_self_us': statistics.mean(group['self']) if group['self'] else None,
                      'visible_self_count': len(group['self'])})
    return {'status': 'ok' if launches and matched else 'no_nested_runtime_events',
            'trace_file': str(trace), 'launch_count': len(launches),
            'all_runtime_event_count': len(runtime), 'nested_runtime_event_count': len(matched),
            'runtime_stats': stats, 'per_launch': per_launch,
            'observed_cann_names': sorted({row['name'] for row in cann}),
            'interpretation': 'Runtime API events are not guaranteed to expose private internal functions. '
                              'A large launch wrapper is not a completed internal breakdown. '
                              'Visible self time subtracts only recorded nested Runtime intervals; '
                              'it includes uninstrumented work and waiting, not pure CPU instruction time. '
                              'Do not add overlapping parent and child durations.'}


def load_bench():
    path = Path(__file__).with_name('bench.py')
    spec = importlib.util.spec_from_file_location('runtime_level2_bench', path)
    bench = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(bench)
    return bench


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--placement', choices=('vm144', 'bare192'), required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--device', type=int, default=0)
    parser.add_argument('--case', choices=('sub8', 'add1024'), default='sub8')
    parser.add_argument('--profile-ops', type=int, default=128)
    parser.add_argument('--trace-only', help='Analyze an already collected trace; no NPU import')
    args = parser.parse_args()
    if args.trace_only:
        result = analyze_runtime(args.trace_only)
        destination = Path(args.out)
        destination.mkdir(parents=True, exist_ok=False)
        (destination / 'runtime_detail.json').write_text(json.dumps(result, ensure_ascii=False, indent=2))
        print(json.dumps({key: result[key] for key in ('status', 'launch_count', 'all_runtime_event_count')}))
        return 0
    if args.profile_ops < 1:
        parser.error('profile-ops must be positive for Runtime diagnosis')
    os.environ['TASK_QUEUE_ENABLE'] = '0'
    os.environ.setdefault('OMP_NUM_THREADS', '10')
    os.environ.setdefault('OMP_PROC_BIND', 'false')
    bench = load_bench()

    def profile_level2(torch, torch_npu, operation, synchronize, count, root):
        profiler = torch_npu.profiler
        experimental = profiler._ExperimentalConfig(
            profiler_level=profiler.ProfilerLevel.Level2,
            aic_metrics=profiler.AiCMetrics.AiCoreNone, data_simplification=False)
        synchronize()
        with profiler.profile(activities=[profiler.ProfilerActivity.CPU, profiler.ProfilerActivity.NPU],
                              schedule=profiler.schedule(wait=0, warmup=0, active=1, repeat=1),
                              record_shapes=True, profile_memory=False, with_stack=False,
                              experimental_config=experimental,
                              on_trace_ready=profiler.tensorboard_trace_handler(str(root))) as prof:
            with torch.profiler.record_function('launch_runtime_level2'):
                for _ in range(count):
                    operation()
                synchronize()
            prof.step()
        result = bench.parse_traces(root)
        result.update({'torch_op_count': count, 'profiler_level': 'Level2', 'ai_core_metrics': 'AiCoreNone'})
        traces = list(Path(root).rglob('trace_view.json'))
        if len(traces) == 1:
            detail = analyze_runtime(traces[0])
            (Path(args.out) / 'runtime_detail.json').write_text(json.dumps(detail, ensure_ascii=False, indent=2))
            result['runtime_detail_status'] = detail['status']
            result['runtime_event_count'] = detail['all_runtime_event_count']
        return result

    bench.run_profile = profile_level2
    sys.argv = [str(Path(__file__).with_name('bench.py')), '--placement', args.placement,
                '--device', str(args.device), '--case', args.case, '--queue', '0',
                '--batch-sizes', '256', '--repeats', '20', '--warmup', '200',
                '--profile-ops', str(args.profile_ops), '--out', args.out]
    status = bench.main()
    summary_path = Path(args.out) / 'summary.json'
    if summary_path.exists():
        summary = json.loads(summary_path.read_text())
        profile = summary.get('profile', {})
        print('Level2 profile:', profile.get('status'),
              'Runtime events:', profile.get('runtime_event_count', 'unavailable'),
              'Nested analysis:', profile.get('runtime_detail_status', 'unavailable'))
        if profile.get('status') != 'ok' or profile.get('runtime_detail_status') != 'ok':
            print('No usable nested Runtime breakdown. Preserve the trace and observed API names; '
                  'do not repeat higher-level profiling indefinitely.', file=sys.stderr)
            return 2 if status == 0 else status
    return status


if __name__ == '__main__':
    sys.exit(main())
