import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('compare', Path(__file__).with_name('compare.py'))
compare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(compare)


def fixture(scale=1):
    return dict(schema_version=1, status='ok', case='sub8', device=0, queue=1,
                config=dict(repeats=3, batch_sizes=[32], warmup=200, torch_num_threads=10),
                metadata=dict(torch_version='2.10.0', torch_npu_version='2.10.0.post6',
                              loaded_libraries=[dict(path='/opt/cann/lib64/libruntime.so', sha256='abc')]),
                measurements=[dict(batch_size=32, submit_us_per_op=x * scale,
                                   drain_us_per_op=scale, total_us_per_op=(x + 1) * scale,
                                   main_cpu_us_per_op=scale, process_cpu_us_per_op=2 * scale)
                              for x in (1, 2, 9)],
                profile=dict(status='ok', target_api_observed=True, kernel_stats=[dict(
                    name='sub_kernel', task_type='AI_CORE', count=64, p50_us=2 * scale,
                    p95_us=3 * scale, mean_us=2.2 * scale)], api_stats=[dict(
                    name='aclrtLaunchKernelWithHostArgs', count=64, p50_us=5 * scale,
                    p95_us=10 * scale, mean_us=6 * scale)]))


def save(root, name, data):
    folder = Path(root) / name
    folder.mkdir(parents=True)
    (folder / 'summary.json').write_text(json.dumps(data))


class CompareTests(unittest.TestCase):
    def test_correct_medians_ratios_and_report(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            save(root / 'bare', 'run_a', fixture())
            save(root / 'vm', 'run_a', fixture(2))
            result = compare.compare(root / 'bare', root / 'vm')
            submit = next(r for r in result['timing_rows'] if r['metric'] == 'submit_us_per_op')
            self.assertEqual((submit['bare_us'], submit['vm_us'], submit['vm_over_bare']), (2, 4, 2))
            self.assertEqual(result['api_rows'][0]['p50_us_ratio'], 2)
            self.assertEqual(result['kernel_rows'][0]['p50_us_ratio'], 2)
            self.assertEqual(result['warnings'], [])
            compare.write_report(result, root / 'out')
            self.assertIn('Host 提交循环', (root / 'out/comparison.md').read_text())
            self.assertTrue((root / 'out/comparison.csv').exists())
            self.assertTrue((root / 'out/kernel_comparison.csv').exists())

    def test_missing_profile_is_unavailable_not_zero(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            save(root / 'bare', 'run_a', fixture())
            vm = fixture(2)
            vm['profile'] = {'status': 'disabled'}
            save(root / 'vm', 'run_a', vm)
            result = compare.compare(root / 'bare', root / 'vm')
            self.assertIsNone(result['api_rows'][0]['vm_p50_us'])
            self.assertIsNone(result['api_rows'][0]['p50_us_ratio'])
            self.assertTrue(any('disabled' in warning for warning in result['warnings']))
            compare.write_report(result, root / 'out')
            self.assertIn('n.a.', (root / 'out/comparison.md').read_text())

    def test_duplicate_pair_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            save(root, 'run_a', fixture())
            save(root, 'run_b', copy.deepcopy(fixture()))
            with self.assertRaisesRegex(ValueError, 'Duplicate'):
                compare.load_runs(root)

    def test_library_paths_can_differ_but_hashes_must_match(self):
        bare, vm = fixture(), fixture()
        vm['metadata']['loaded_libraries'][0]['path'] = '/another/container/libruntime.so'
        self.assertEqual(compare.compatibility_warnings(('sub8', 0, 1), bare, vm), [])
        vm['metadata']['loaded_libraries'][0]['sha256'] = 'different-build'
        warnings = compare.compatibility_warnings(('sub8', 0, 1), bare, vm)
        self.assertTrue(any('SHA256 differs' in item and 'pure virtualization' in item for item in warnings))
        vm['metadata']['loaded_libraries'] = []
        warnings = compare.compatibility_warnings(('sub8', 0, 1), bare, vm)
        self.assertTrue(any('missing from VM manifest' in item for item in warnings))

    def test_environment_workload_and_profile_size_mismatch(self):
        bare, vm = fixture(), fixture()
        bare['config']['profile_ops'] = 64
        vm['config']['profile_ops'] = 128
        bare['metadata']['env'] = {'OMP_NUM_THREADS': '10', 'LD_PRELOAD': '/lib/jemalloc.so'}
        vm['metadata']['env'] = {'OMP_NUM_THREADS': '1'}
        bare['metadata']['case_spec'] = {'op': 'sub', 'shape': [8], 'dtype': 'int32'}
        vm['metadata']['case_spec'] = {'op': 'sub', 'shape': [16], 'dtype': 'int32'}
        warnings = compare.compatibility_warnings(('sub8', 0, 1), bare, vm)
        for field in ('config.profile_ops', 'env.OMP_NUM_THREADS', 'env.LD_PRELOAD', 'case_spec'):
            self.assertTrue(any(field in item for item in warnings), field)

    def test_same_kernel_name_different_task_type_is_not_paired(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            save(root / 'bare', 'run_a', fixture())
            vm = fixture(2)
            vm['profile']['kernel_stats'][0]['task_type'] = 'AI_CPU'
            save(root / 'vm', 'run_a', vm)
            result = compare.compare(root / 'bare', root / 'vm')
            self.assertEqual(result['kernel_rows'], [])
            self.assertEqual(sum('no matching name/TaskType' in warning for warning in result['warnings']), 2)
            compare.write_report(result, root / 'out')
            self.assertIn('n.a.', (root / 'out/comparison.md').read_text())
            self.assertEqual(len((root / 'out/kernel_comparison.csv').read_text().splitlines()), 1)


if __name__ == '__main__':
    unittest.main()
