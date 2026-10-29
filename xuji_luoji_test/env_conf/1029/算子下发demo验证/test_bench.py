import contextlib
import importlib.util
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch


def module(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + '.py'))
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


bench, suite = module('bench'), module('run_suite')


class CoreTests(unittest.TestCase):
    def test_batch_is_async_until_single_final_drain(self):
        events = []
        row = bench.measure_batch(lambda: events.append('op'), lambda: events.append('sync'), 3)
        self.assertEqual(events, ['sync', 'op', 'op', 'op', 'sync'])
        self.assertGreaterEqual(row['total_wall_ns'], row['submit_wall_ns'] + row['drain_wall_ns'])
        self.assertEqual(row['total_us_per_op'], row['total_wall_ns'] / 3000)

    def test_thread_reuse_does_not_produce_false_delta(self):
        before = {'1': dict(tid=1, start_ticks=10, name='old')}
        after = {'1': dict(tid=1, start_ticks=20, name='new')}
        self.assertEqual(bench.thread_deltas(before, after)[0]['status'], 'new_or_reused')

    def test_suite_queue_modes_are_separate_child_invocations(self):
        args = SimpleNamespace(devices='0,6', cases='sub8', queues='1,0', placement='vm144',
                               placements=str(Path(__file__).with_name('placements.json')),
                               batch_sizes='1,32', repeats=2, warmup=3, torch_num_threads=10, profile_ops=8)
        commands = suite.build_commands(args, Path('/tmp/output'))
        self.assertEqual(len(commands), 4)
        self.assertEqual([row[1] for row in commands], [1, 0, 1, 0])
        self.assertEqual(len({row[0] for row in commands}), 4)
        args.devices = '0,0'
        with self.assertRaises(ValueError):
            suite.build_commands(args, Path('/tmp/output'))

    def test_worker_end_to_end_with_fake_backend_no_hardware_claim(self):
        # Exercise files, correctness, role-binding plumbing and timing flow only.
        class Tensor:
            def __init__(self, value):
                self.value = value
            def cpu(self):
                return self
            def __eq__(self, other):
                return self.value == other
        fake_torch = SimpleNamespace(__version__='fake', int32='int32', float32='float32',
            set_num_threads=lambda n: None, inference_mode=contextlib.nullcontext,
            full=lambda *a, **k: Tensor(7), full_like=lambda *a, **k: Tensor(2),
            empty_like=lambda *a, **k: Tensor(0),
            sub=lambda x, y, out: setattr(out, 'value', x.value - y.value),
            all=lambda value: SimpleNamespace(item=lambda: value))
        fake_npu = SimpleNamespace(__version__='fake', npu=SimpleNamespace(
            set_device=lambda n: None, is_available=lambda: True,
            get_device_name=lambda n: 'fake NPU', synchronize=lambda: None))
        affinity = {100: set(range(192))}
        def fake_threads():
            return {'100': dict(tid=100, name='main', start_ticks=1,
                affinity=sorted(affinity[100]), **{name: 0 for name in (
                    'utime_ticks', 'stime_ticks', 'runtime_ns', 'runqueue_wait_ns',
                    'timeslices', 'voluntary_switches', 'nonvoluntary_switches')})}
        def set_affinity(tid, target):
            affinity[100 if tid == 0 else tid] = set(target)
        with tempfile.TemporaryDirectory() as tmp:
            out = str(Path(tmp) / 'run_sub8_device6_queue0')
            argv = ['bench.py', '--case', 'sub8', '--device', '6', '--queue', '0',
                    '--placement', 'vm144', '--out', out, '--batch-sizes', '1,2',
                    '--warmup', '2', '--repeats', '2', '--profile-ops', '0']
            with contextlib.ExitStack() as stack:
                stack.enter_context(patch.dict('sys.modules', {'torch': fake_torch, 'torch_npu': fake_npu}))
                stack.enter_context(patch.dict('os.environ', {'TASK_QUEUE_ENABLE': '0', 'ASCEND_LAUNCH_BLOCKING': '0', 'ASCEND_RT_VISIBLE_DEVICES': ''}))
                stack.enter_context(patch('sys.argv', argv))
                stack.enter_context(patch.object(bench.os, 'sched_getaffinity', side_effect=lambda tid: affinity[100 if tid == 0 else tid], create=True))
                stack.enter_context(patch.object(bench.os, 'sched_setaffinity', side_effect=set_affinity, create=True))
                stack.enter_context(patch.object(bench, 'threads', side_effect=fake_threads))
                stack.enter_context(patch.object(bench, 'read', return_value='unavailable in fake backend'))
                stack.enter_context(patch.object(bench, 'command', return_value={'status': 'fake'}))
                stack.enter_context(patch.object(bench, 'library_manifest', return_value=[]))
                self.assertEqual(bench.main(), 0)
            result = json.loads(Path(out, 'summary.json').read_text())
            self.assertEqual(result['status'], 'ok')
            self.assertTrue(result['correctness'])
            self.assertEqual(len(result['measurements']), 4)
            self.assertEqual(result['profile']['status'], 'disabled')
            self.assertEqual(json.loads(Path(out, 'timing_unprofiled.json').read_text())['status'], 'ok')
            self.assertTrue(Path(out, 'threads.json').exists())


if __name__ == '__main__':
    unittest.main()
