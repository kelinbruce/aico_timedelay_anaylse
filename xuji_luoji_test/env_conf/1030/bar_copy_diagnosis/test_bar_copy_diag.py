"""Diagnostic decision tests; no Ascend hardware, SDK, perf or root required."""
import copy
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import bar_copy_diag as diag
from common import dump, manifest, run_bounded


def probe(mask=0, mode='inherit', soft=1024, hard=-1):
    return {'status': 'ok', 'device': 0, 'device_name': 'test-NPU',
            'torch_version': 'test', 'torch_npu_version': 'test', 'base_page_size': 4096,
            'hal_library': {'sha256': 'test-hal'},
            'loaded_libraries': {'/test/libascend_hal.so': 'test-hal', '/test/libruntime.so': 'test-runtime'},
            'driver_version_info': {'status': 'ok', 'text': 'test-driver'},
            'identity': {'kernel': 'test-kernel', 'machine': 'aarch64',
                         'boot_id': {'status': 'ok', 'text': 'test-boot'},
                         'machine_id': {'status': 'ok', 'text': 'test-machine'},
                         'namespaces': {'pid': 'pid:[1]', 'mnt': 'mnt:[1]', 'user': 'user:[1]'}},
            'affinity': [0, 1], 'environment': {'TASK_QUEUE_ENABLE': '0'},
            'as_soft_mode': mode,
            'limits_effective': {'RLIMIT_AS': [soft, hard], 'RLIMIT_DATA': [-1, -1], 'RLIMIT_STACK': [8192, -1]},
            'queries': [{'input_mask_hex': hex(m), 'output_mask_hex': hex(mask & m), 'return_code': 0}
                        for m in (2, 8, 10)]}


def run(p=None, log='', status='ok'):
    p = p or probe()
    return {'probe': p, 'mask': diag.capability(p) if status == 'ok' else None,
            'execution': {'status': status}, 'init_log': diag.parse_init_logs(log, p['device'])}


def info(bar=1, huge=1, malloc=1, device=0):
    return ('Device info. (devid=%d; dvpp_size=0; support_bar_mem=%d; support_dev_read_only=0; '
            'support_dev_mem_map_host=0; support_bar_huge_mem=%d; allocated_by_malloc=%d; host_rw_dev_ro=0)'
            % (device, bar, huge, malloc))


class CapabilityTests(unittest.TestCase):
    def test_error_is_unknown(self):
        p = probe()
        p['queries'][0]['return_code'] = 7
        self.assertIsNone(diag.capability(p))

    def test_inconsistent_union_is_unknown(self):
        p = probe(10)
        p['queries'][2]['output_mask_hex'] = '0x0'
        self.assertIsNone(diag.capability(p))

    def test_unrequested_bits_unknown(self):
        p = probe()
        p['queries'][0]['output_mask_hex'] = '0xa'
        self.assertIsNone(diag.capability(p))

    def test_duplicate_query_is_invalid(self):
        p = probe()
        p['queries'][1] = p['queries'][0]
        self.assertIsNone(diag.capability(p))

    def test_partial_support_is_supported(self):
        for mask in (2, 8, 10):
            self.assertEqual(diag.capability(probe(mask)), mask)


class LogTests(unittest.TestCase):
    def test_other_device_cannot_explain_target(self):
        self.assertEqual(diag.parse_init_logs(info(device=1), 0)['status'], 'missing')

    def test_missing_field_does_not_guess_malloc(self):
        text = 'Device info. (devid=0; support_bar_mem=0; support_bar_huge_mem=0)'
        self.assertEqual(diag.parse_init_logs(text, 0)['status'], 'missing')

    def test_conflicting_reinitializations_are_not_last_wins(self):
        text = info(malloc=0) + '\n' + info(malloc=1)
        self.assertEqual(diag.parse_init_logs(text, 0)['status'], 'conflict')

    def test_hex_fields_and_repeated_identical_log(self):
        text = info().replace('support_bar_mem=1', 'support_bar_mem=0x1')
        result = diag.parse_init_logs(text + '\n' + text, 0)
        self.assertEqual(result['status'], 'ok')
        self.assertEqual(result['matched_records'], 2)

    def test_mmap_errno_is_only_a_clue(self):
        text = '1 mmap(NULL, 8192, PROT_READ, MAP_PRIVATE, -1, 0) = -1 ENOMEM (Cannot allocate memory)\n'
        self.assertEqual(len(diag.mmap_failures(text)), 1)
        self.assertEqual(diag.decide({'A0': run(log=text)})['code'], 'INSUFFICIENT_EVIDENCE')


class VerdictTests(unittest.TestCase):
    def test_available_capability_is_not_performance_fix(self):
        r = diag.decide({'A0': run(probe(8))})
        self.assertEqual(r['code'], 'CAPABILITY_AVAILABLE')
        self.assertIn('不是业务性能', r['scope'])

    def test_zero_without_internal_fields_is_not_vendor_verdict(self):
        r = diag.decide({'A0': run()})
        self.assertEqual(r['code'], 'INSUFFICIENT_EVIDENCE')
        self.assertIn('不能据此判定', r['repairability'])

    def test_malloc_fallback_only_when_kernel_input_positive(self):
        r = diag.decide({'A0': run(log=info())})
        self.assertEqual(r['code'], 'HAL_FALLBACK_IDENTIFIED')
        self.assertIn('尚未验证', r['repairability'])

    def test_zero_input_and_malloc_both_reported(self):
        r = diag.decide({'A0': run(log=info(bar=0, huge=0, malloc=1))})
        self.assertEqual(r['code'], 'GUEST_DRIVER_GATE_IDENTIFIED')
        self.assertTrue(any('同时存在 malloc' in s for s in r['actions']))

    def test_kernel_zero_does_not_assert_wc_or_stage2(self):
        r = diag.decide({'A0': run(log=info(bar=0, huge=0, malloc=0))})
        self.assertEqual(r['code'], 'GUEST_DRIVER_GATE_IDENTIFIED')
        self.assertIn('尚不能断言需要补丁', r['repairability'])

    def test_input_positive_without_malloc_is_mismatch(self):
        r = diag.decide({'A0': run(log=info(malloc=0))})
        self.assertEqual(r['code'], 'HAL_CAPABILITY_MISMATCH')

    def test_timeout_even_with_json_success_is_invalid(self):
        self.assertEqual(diag.decide({'A0': run(probe(10), status='timeout')})['code'], 'INVALID_COLLECTION')

    def test_no_runs_is_invalid(self):
        self.assertEqual(diag.decide({})['code'], 'INVALID_COLLECTION')


class ABATests(unittest.TestCase):
    def setUp(self):
        self.runs = {'A0': run(probe()), 'B1': run(probe(8, mode='hard', soft=-1)), 'A1': run(probe())}

    def test_strict_aba_recognized(self):
        self.assertTrue(diag.aba_verified(self.runs))
        self.assertEqual(diag.decide(self.runs)['code'], 'AS_LIMIT_FIX_VERIFIED')

    def test_without_reversal_cannot_claim_cause(self):
        self.runs['A1'] = run(probe(8))
        self.assertFalse(diag.aba_verified(self.runs))

    def test_changed_hal_cannot_claim_configuration_fix(self):
        self.runs['B1']['probe']['hal_library']['sha256'] = 'different'
        self.assertFalse(diag.aba_verified(self.runs))

    def test_changed_runtime_cannot_claim_configuration_fix(self):
        self.runs['B1']['probe']['loaded_libraries']['/test/libruntime.so'] = 'different'
        self.assertFalse(diag.aba_verified(self.runs))

    def test_changed_environment_or_affinity_invalidates_aba(self):
        r = copy.deepcopy(self.runs)
        r['B1']['probe']['environment']['LD_PRELOAD'] = 'other.so'
        self.assertFalse(diag.aba_verified(r))
        self.runs['B1']['probe']['affinity'] = [2]
        self.assertFalse(diag.aba_verified(self.runs))

    def test_other_limit_change_invalidates_aba(self):
        self.runs['B1']['probe']['limits_effective']['RLIMIT_DATA'] = [200, 200]
        self.assertFalse(diag.aba_verified(self.runs))

    def test_boot_id_unavailable_is_not_match(self):
        for r in self.runs.values():
            r['probe']['identity']['boot_id'] = {'status': 'unavailable'}
        self.assertFalse(diag.aba_verified(self.runs))


def write_collection(root, p, log=''):
    (root / 'A0' / 'data').mkdir(parents=True)
    dump(root / 'A0' / 'data' / 'probe.json', p)
    (root / 'A0' / 'process.log').write_text(log)
    dump(root / 'collection.json', {'schema': 1, 'kind': 'guest', 'status': 'complete',
                                  'role_declared_by_operator': 'vm-container',
                                  'runs': {'A0': {'status': 'ok', 'returncode': 0}}})
    dump(root / 'SHA256_MANIFEST.json', manifest(root))


class IntegrationTests(unittest.TestCase):
    def test_offline_cli_report_and_new_directory_guard(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            write_collection(root / 'input', probe(), info())
            cmd = [sys.executable, str(diag.HERE / 'bar_copy_diag.py'), 'analyze',
                   '--input', str(root / 'input'), '--out', str(root / 'report')]
            result = subprocess.run(cmd, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(diag.load(root / 'report' / '结论.json')['code'], 'HAL_FALLBACK_IDENTIFIED')
            old = (root / 'report' / '结论.md').read_bytes()
            self.assertEqual(subprocess.run(cmd, capture_output=True).returncode, 3)
            self.assertEqual((root / 'report' / '结论.md').read_bytes(), old)

    def test_before_after_verification(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            write_collection(root / 'before', probe())
            write_collection(root / 'after', probe(10))
            cmd = [sys.executable, str(diag.HERE / 'bar_copy_diag.py'), 'verify',
                   '--before', str(root / 'before'), '--after', str(root / 'after'),
                   '--change-note', 'synthetic test only', '--out', str(root / 'report')]
            result = subprocess.run(cmd, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(diag.load(root / 'report' / '结论.json')['code'], 'CAPABILITY_RESTORED_SAME_STACK')

    def test_reboot_does_not_prove_same_environment(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            write_collection(root / 'before', probe())
            p = probe(10)
            p['identity']['boot_id']['text'] = 'new-boot'
            write_collection(root / 'after', p)
            args = type('Args', (), {'before': str(root / 'before'), 'after': str(root / 'after'),
                                    'out': str(root / 'report'), 'change_note': 'synthetic'})()
            diag.verify(args)
            self.assertEqual(diag.load(root / 'report' / '结论.json')['code'], 'CAPABILITY_RESTORED_COMPARABILITY_LIMITED')

    def test_timeout_and_log_size_limits(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            r = run_bounded([sys.executable, '-c', 'import time; time.sleep(5)'], root / 'slow.log', timeout=0.2)
            self.assertEqual(r['status'], 'timeout')
            r = run_bounded([sys.executable, '-c', 'print("x" * 100000)'], root / 'big.log', max_bytes=1024)
            self.assertEqual(r['status'], 'output_limit')
            self.assertLessEqual((root / 'big.log').stat().st_size, 1024)

    def test_kernel_snapshot_from_other_boot_not_used_for_cause(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            write_collection(root / 'input', probe())
            (root / 'kernel').mkdir()
            dump(root / 'kernel' / 'kernel.json', {'schema': 1, 'kind': 'guest_kernel', 'device': 0, 'identity': {}})
            (root / 'report').mkdir()
            r = diag.analyze(root / 'input', root / 'report', root / 'kernel')
            self.assertEqual(r['code'], 'INSUFFICIENT_EVIDENCE')
            self.assertTrue(any('不匹配' in s for s in r['missing']))

    def test_tampered_results_refused(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp).resolve()
            write_collection(root, probe())
            (root / 'A0' / 'data' / 'probe.json').write_text('{}')
            with self.assertRaisesRegex(ValueError, 'changed'):
                diag.check_integrity(root)

    def test_interrupted_json_is_invalid_instead_of_crashing(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            write_collection(root, probe())
            (root / 'A0' / 'data' / 'probe.json').write_text('{')
            r = diag.read_run(root, 'A0', {'status': 'timeout'})
            self.assertIsNone(r['mask'])
            self.assertEqual(diag.decide({'A0': r})['code'], 'INVALID_COLLECTION')

    def test_manifest_cannot_escape_result_directory(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp).resolve()
            dump(root / 'SHA256_MANIFEST.json', {'../foreign': {'sha256': 'x', 'bytes': 0}})
            with self.assertRaisesRegex(ValueError, 'Invalid manifest path'):
                diag.check_integrity(root)


if __name__ == '__main__':
    unittest.main()
