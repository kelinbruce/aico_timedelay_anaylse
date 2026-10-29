"""Trace-schema tests; no torch, NPU, or remote environment required."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('bench', Path(__file__).with_name('bench.py'))
bench = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bench)


def metadata(pid, name):
    return {'ph': 'M', 'name': 'process_name', 'pid': pid, 'args': {'name': name}}


def event(name, pid, duration=1.0, task_type=None, category=None):
    result = {'ph': 'X', 'name': name, 'pid': pid, 'tid': 40, 'dur': duration}
    if task_type is not None:
        result['args'] = {'Task Type': task_type}
    if category is not None:
        result['cat'] = category
    return result


class TraceParserTests(unittest.TestCase):
    def parse(self, events, wrapped=False):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'ASCEND_PROFILER_OUTPUT'
            path.mkdir()
            payload = {'traceEvents': events} if wrapped else events
            path.joinpath('trace_view.json').write_text(json.dumps(payload))
            return bench.parse_traces(directory)

    def test_metadata_identifies_uncategorized_real_schema(self):
        # This is the actual structure of the project's 10/27 trace export.
        result = self.parse([
            metadata(10, 'CANN'), metadata(20, 'Ascend Hardware'),
            event('AscendCL@aclrtLaunchKernelWithHostArgs', 10, 6.5),
            event('aclnnSub_SubAiCore_Sub', 20, 1.3, 'AI_VECTOR_CORE'),
        ])
        self.assertTrue(result['target_api_observed'])
        self.assertEqual(result['api_stats'][0]['p50_us'], 6.5)
        self.assertEqual(result['kernel_stats'][0]['task_type'], 'AI_VECTOR_CORE')
        self.assertEqual(result['kernel_stats'][0]['count'], 1)

    def test_excludes_parent_scopes_prefix_lookalikes_and_wrong_processes(self):
        result = self.parse([
            metadata(10, 'CANN'), metadata(20, 'Ascend Hardware'), metadata(30, 'Python'),
            event('AscendCL@aclrtLaunchKernelWithHostArgs', 10, 7),
            event('AscendCL@aclnnSub', 10, 20),
            event('AscendCL@aclnnSubGetWorkspaceSize', 10, 3),
            event('aclnnSub', 30, 100, category='cpu_op'),
            event('Enqueue@aclnnSub', 30, 100, category='enqueue'),
            event('Dequeue@aclnnSub', 30, 100, category='dequeue'),
            event('AscendCL@aclrtLaunchKernelWithHostArgs', 30, 1000, category='python_function'),
            event('Enqueue@AscendCL@aclrtLaunchKernelWithHostArgs', 10, 2000),
            event('AscendCL@aclnnSub_NotAnAPI', 10, 2000),
            event('aclnnSub_SubAiCore_Sub', 20, 1, 'AI_VECTOR_CORE'),
        ], wrapped=True)
        names = {row['name']: row for row in result['api_stats']}
        self.assertEqual(set(names), {'AscendCL@aclrtLaunchKernelWithHostArgs',
                                     'AscendCL@aclnnSub', 'AscendCL@aclnnSubGetWorkspaceSize'})
        self.assertEqual(names['AscendCL@aclrtLaunchKernelWithHostArgs']['count'], 1)
        self.assertEqual(names['AscendCL@aclrtLaunchKernelWithHostArgs']['mean_us'], 7)

    def test_separates_task_types_and_excludes_noncompute(self):
        result = self.parse([
            metadata(20, 'Ascend Hardware'),
            event('same_kernel', 20, 1, 'AI_CORE'),
            event('same_kernel', 20, 2, 'MIX_AIV'),
            event('same_kernel', 20, 100, 'EVENT_WAIT'),
            event('same_kernel', 20, 100, 'PCIE_DMA_SQE'),
            event('same_kernel', 20, 100, 'COMMUNICATION'),
            event('same_kernel', 20, 100, 'UNKNOWN_CORE_TYPE'),
            event('same_kernel', 20, 100),
        ])
        self.assertEqual(len(result['kernel_stats']), 2)
        self.assertEqual({row['task_type'] for row in result['kernel_stats']}, {'AI_CORE', 'MIX_AIV'})
        self.assertEqual(result['hardware_task_type_counts']['UNKNOWN_CORE_TYPE'], 1)
        self.assertEqual(result['hardware_task_type_counts']['<missing>'], 1)

    def test_missing_metadata_does_not_claim_target_or_kernel(self):
        result = self.parse([
            event('AscendCL@aclrtLaunchKernelWithHostArgs', 10),
            event('sub', 20, 1, 'AI_CORE', 'kernel'),
        ])
        self.assertFalse(result['target_api_observed'])
        self.assertEqual(result['api_stats'], [])
        self.assertEqual(result['kernel_stats'], [])

    def test_multiple_exports_are_not_combined(self):
        with tempfile.TemporaryDirectory() as directory:
            for name in ('first', 'second'):
                path = Path(directory) / name
                path.mkdir()
                path.joinpath('trace_view.json').write_text('[]')
            self.assertEqual(bench.parse_traces(directory)['status'], 'error')

    def test_invalid_durations_are_ignored(self):
        result = self.parse([
            metadata(10, 'CANN'),
            *[event('AscendCL@aclrtLaunchKernelWithHostArgs', 10, duration)
              for duration in (float('nan'), float('inf'), -1, True, '1')],
            event('AscendCL@aclrtLaunchKernelWithHostArgs', 10, 2),
        ])
        self.assertEqual(result['api_stats'][0]['count'], 1)


if __name__ == '__main__':
    unittest.main()
