import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('runtime_l2', Path(__file__).with_name('runtime_level2.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class RuntimeTests(unittest.TestCase):
    def analyze(self, events):
        metadata = [{'ph': 'M', 'name': 'process_name', 'pid': 2, 'args': {'name': 'CANN'}}]
        with tempfile.TemporaryDirectory() as tmp:
            trace = Path(tmp) / 'trace.json'
            trace.write_text(json.dumps(metadata + events))
            return module.analyze_runtime(trace)

    def event(self, name, start, duration, tid=3, pid=2):
        return dict(ph='X', name=name, ts=str(start), dur=duration, pid=pid, tid=tid)

    def test_nested_intervals_not_double_counted(self):
        result = self.analyze([
            self.event('AscendCL@aclrtLaunchKernelWithHostArgs', 100, 20),
            self.event('Runtime@launch', 101, 18),
            self.event('Runtime@copy', 102, 5),
            self.event('Runtime@send', 110, 3)])
        self.assertEqual(result['status'], 'ok')
        self.assertEqual(result['per_launch'][0]['visible_runtime_union_us'], 18)
        self.assertEqual(result['per_launch'][0]['outside_visible_runtime_us'], 2)
        stats = {row['name']: row for row in result['runtime_stats']}
        self.assertEqual(stats['Runtime@launch']['mean_visible_self_us'], 10)

    def test_level1_is_explicitly_not_a_runtime_breakdown(self):
        result = self.analyze([self.event('AscendCL@aclrtLaunchKernelWithHostArgs', 100, 20)])
        self.assertEqual(result['status'], 'no_nested_runtime_events')
        self.assertEqual(result['launch_count'], 1)
        self.assertEqual(result['runtime_stats'], [])

    def test_other_threads_and_python_lookalikes_excluded(self):
        result = self.analyze([
            self.event('AscendCL@aclrtLaunchKernelWithHostArgs', 100, 20),
            self.event('Runtime@copy', 102, 5, tid=4),
            self.event('Runtime@copy', 102, 5, pid=99)])
        self.assertEqual(result['nested_runtime_event_count'], 0)
        self.assertEqual(result['all_runtime_event_count'], 1)

    def test_equal_intervals_do_not_invent_self_time(self):
        result = self.analyze([
            self.event('AscendCL@aclrtLaunchKernelWithHostArgs', 100, 20),
            self.event('Runtime@a', 101, 18), self.event('Runtime@b', 101, 18)])
        self.assertTrue(all(row['mean_visible_self_us'] is None for row in result['runtime_stats']))


if __name__ == '__main__':
    unittest.main()
