import unittest
from run import gated_measure, summarize, metadata_environment


class Gate:
    enabled = False
    def probe_begin(self, batch):
        self.enabled = True
    def probe_end(self):
        self.enabled = False


class WindowTests(unittest.TestCase):
    def test_metadata_keeps_jemalloc_removes_only_probe(self):
        env = {'LD_PRELOAD': '/tmp/probe.so:/usr/lib64/libjemalloc.so.2:', 'OTHER': 'unchanged'}
        clean = metadata_environment(env, '/tmp/probe.so')
        self.assertEqual(clean['LD_PRELOAD'], '/usr/lib64/libjemalloc.so.2')
        self.assertEqual(clean['OTHER'], 'unchanged')
        self.assertEqual(env['LD_PRELOAD'], '/tmp/probe.so:/usr/lib64/libjemalloc.so.2:')

    def test_metadata_no_preload_when_only_probe(self):
        self.assertNotIn('LD_PRELOAD', metadata_environment({'LD_PRELOAD': '/tmp/probe.so'}, '/tmp/probe.so'))

    def test_only_submit_is_enabled(self):
        gate = Gate()
        states = []
        def operation():
            states.append(('op', gate.enabled))
        def sync():
            states.append(('sync', gate.enabled))
        def original(op, synchronize, size):
            synchronize()
            for _ in range(size):
                op()
            synchronize()
            return 42
        self.assertEqual(gated_measure(original, gate, 0, operation, sync, 2), 42)
        self.assertEqual(states, [('sync', False), ('op', True), ('op', True), ('sync', False)])
        self.assertFalse(gate.enabled)

    def test_exception_disables_capture(self):
        gate = Gate()
        def original(op, synchronize, size):
            synchronize()
            raise ValueError('test')
        with self.assertRaises(ValueError):
            gated_measure(original, gate, 0, lambda: None, lambda: None, 1)
        self.assertFalse(gate.enabled)

    def test_changed_helper_is_rejected(self):
        with self.assertRaises(RuntimeError):
            gated_measure(lambda *args: None, Gate(), 0, lambda: None, lambda: None, 1)

    def test_summary_counts_and_time_are_per_op(self):
        records = [{'request_hex': '0x123', 'fd_path_after_capture': '/dev/example',
                    'caller_library': '/lib/driver.so', 'caller_offset_hex': '0x20',
                    'result': result, 'duration_ns': duration}
                   for result, duration in ((0, 2000), (-1, 4000))]
        result = summarize(records, 4)[0]
        self.assertEqual(result['count'], 2)
        self.assertEqual(result['calls_per_op'], .5)
        self.assertEqual(result['error_count'], 1)
        self.assertEqual(result['total_us_per_op'], 1.5)

    def test_empty_capture_not_invented(self):
        self.assertEqual(summarize([], 5120), [])


if __name__ == '__main__':
    unittest.main()
