#!/usr/bin/env python3
"""Run fixed-op cases sequentially, each in a fresh process; no torch import here."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys


def build_commands(args, root):
    commands = []
    for device in [int(x) for x in args.devices.split(',')]:
        for case in args.cases.split(','):
            if case not in ('sub8', 'add1024'):
                raise ValueError('Unknown case: ' + case)
            for queue in [int(x) for x in args.queues.split(',')]:
                if queue not in (0, 1):
                    raise ValueError('Only TASK_QUEUE_ENABLE=0/1 are supported')
                name = 'run_%s_device%d_queue%d' % (case, device, queue)
                argv = [sys.executable, str(Path(__file__).with_name('bench.py')),
                        '--case', case, '--device', str(device), '--queue', str(queue),
                        '--placement', args.placement, '--placements', str(Path(args.placements).resolve()),
                        '--out', str(root / name), '--batch-sizes', args.batch_sizes,
                        '--repeats', str(args.repeats), '--warmup', str(args.warmup),
                        '--torch-num-threads', str(args.torch_num_threads),
                        '--profile-ops', str(args.profile_ops)]
                commands.append((name, queue, argv))
    names = [name for name, _, _ in commands]
    if len(names) != len(set(names)):
        raise ValueError('Duplicate devices/cases/queues would reuse output paths')
    return commands


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--placement', choices=('vm144', 'bare192'), required=True)
    parser.add_argument('--placements', default=str(Path(__file__).with_name('placements.json')))
    parser.add_argument('--devices', default='0,6', help='Run device IDs sequentially, not distributed ranks')
    parser.add_argument('--cases', default='sub8,add1024')
    parser.add_argument('--queues', default='1,0')
    parser.add_argument('--batch-sizes', default='1,32,256')
    parser.add_argument('--repeats', type=int, default=20)
    parser.add_argument('--warmup', type=int, default=200)
    parser.add_argument('--torch-num-threads', type=int, default=10)
    parser.add_argument('--profile-ops', type=int, default=128)
    parser.add_argument('--out', required=True, help='New directory; must not already exist')
    parser.add_argument('--dry-run', action='store_true', help='Print commands without importing torch or writing output')
    args = parser.parse_args()
    root = Path(args.out).resolve()
    try:
        commands = build_commands(args, root)
        placements = json.loads(Path(args.placements).read_text())[args.placement]
        for _, _, argv in commands:
            if argv[argv.index('--device') + 1] not in placements:
                raise ValueError('No placement for selected device')
    except (ValueError, KeyError) as exc:
        parser.error(str(exc))
    if args.dry_run:
        for _, queue, argv in commands:
            print('TASK_QUEUE_ENABLE=%d OMP_NUM_THREADS=%d %s' % (
                queue, args.torch_num_threads, shlex.join(argv)))
        return 0
    if os.environ.get('ASCEND_LAUNCH_BLOCKING') == '1':
        parser.error('Unset ASCEND_LAUNCH_BLOCKING=1; it overrides TASK_QUEUE_ENABLE')
    root.mkdir(parents=True, exist_ok=False)
    results = []
    for name, queue, argv in commands:
        env = os.environ.copy()
        env['TASK_QUEUE_ENABLE'] = str(queue)
        env['OMP_NUM_THREADS'] = str(args.torch_num_threads)
        env.setdefault('OMP_PROC_BIND', 'false')
        print('Running ' + name, flush=True)
        with (root / (name + '.log')).open('w') as log:
            completed = subprocess.run(argv, env=env, stdout=log, stderr=subprocess.STDOUT)
        summary_path = root / name / 'summary.json'
        summary = json.loads(summary_path.read_text()) if summary_path.exists() else {}
        result = {'run': name, 'returncode': completed.returncode,
                  'status': summary.get('status', 'no_summary'),
                  'profile_status': summary.get('profile', {}).get('status', 'unavailable'),
                  'target_api_observed': summary.get('profile', {}).get('target_api_observed', False)}
        results.append(result)
        print(json.dumps(result), flush=True)
    timing_ok = all(row['returncode'] == 0 and row['status'] == 'ok' for row in results)
    report = {'schema_version': 1, 'utc': datetime.now(timezone.utc).isoformat(),
              'placement': args.placement, 'timing_ok': timing_ok,
              'all_target_api_observed': all(row['target_api_observed'] for row in results),
              'runs': results}
    (root / 'suite.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print('Results: ' + str(root), flush=True)
    if not report['all_target_api_observed']:
        print('NOTICE: Some short traces did not verify aclrtLaunchKernelWithHostArgs. '
              'Inspect profile status/API names; enqueue timing is not that API timing.', flush=True)
    return 0 if timing_ok else 1


if __name__ == '__main__':
    sys.exit(main())
