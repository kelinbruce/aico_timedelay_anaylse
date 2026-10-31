import copy
import json
import os
import struct
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import collect as c
from elf64 import EvidenceError, elf_header, note_build_id

PROFILE = json.loads((Path(__file__).parent / 'profile_25_5.json').read_text())
BASE = 0xffff000010000000


def header(kind=4, phnum=1):
    ident = b'\x7fELF\x02\x01\x01' + bytes(9)
    return struct.pack('<16sHHIQQQIHHHHHH', ident, kind, 183, 1, 0, 64, 0, 0,
                       64, 56, phnum, 64, 0, 0)


def core_file(path, va=BASE, data=b'abcdefgh', duplicate_offset=None):
    n = 1 if duplicate_offset is None else 2
    ph = struct.pack('<IIQQQQQQ', 1, 7, 4096, va, 0, len(data), len(data), 4096)
    if duplicate_offset is not None:
        ph += struct.pack('<IIQQQQQQ', 1, 7, duplicate_offset, va, 0, len(data), len(data), 4096)
    path.write_bytes(header(phnum=n) + ph + bytes(4096 - 64 - len(ph)) + data)


def proc_state(mem=0, huge=0):
    return {name: {'status': 'ok', 'value': value, 'text': str(value), 'path': name}
            for name, value in [('bar_mem', mem), ('bar_mem_huge', huge)]}


def state(mode=0, wc=0, mem=0, huge=0, disabled=(0, 0)):
    proc = proc_state(int(bool(mem) and not disabled[0]), int(bool(huge) and not disabled[1]))
    return {'device': 0, 'monotonic_ns': 1, 'proc_before': proc, 'proc_after': copy.deepcopy(proc),
            'run_mode': {'initialized': mode is not None, 'inferred_mode': mode},
            'wc': {'status': 'ok', 'bar_wc_flag': wc, 'bar4_wc_bit': bool(wc & 16)},
            'capability': {'cached_bar_mem': mem, 'cached_bar_huge_mem': huge,
                           'raw_device_feature_bar_mem': None},
            'disabled': dict(zip(('bar_mem', 'bar_huge_mem'), disabled)),
            'pages': {'host_page_size': 4096, 'device_page_size': 4096, 'page_size_inited': 1}}


class KcoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / 'core'

    def tearDown(self):
        self.temp.cleanup()

    def test_virtual_translation_and_readonly_open(self):
        core_file(self.path)
        actual_open = os.open
        with patch.object(c.os, 'open', wraps=actual_open) as op:
            reader = c.KcoreReader(self.path)
        try:
            self.assertEqual(op.call_args.args[1] & os.O_ACCMODE, os.O_RDONLY)
            self.assertEqual(reader.read(BASE + 2, 3, 'target'), b'cde')
            self.assertEqual(reader.total_bytes, 3)
            self.assertEqual(reader.audit[0]['bytes'], 3)
        finally:
            reader.close()

    def test_short_read_not_zero(self):
        core_file(self.path)
        reader = c.KcoreReader(self.path)
        try:
            with self.path.open('r+b') as f:
                f.truncate(4097)
            with self.assertRaisesRegex(EvidenceError, 'Short'):
                reader.read(BASE, 8, 'flag')
        finally:
            reader.close()

    def test_unmapped_or_cross_boundary_rejected(self):
        core_file(self.path)
        reader = c.KcoreReader(self.path)
        try:
            for address, size in ((BASE - 1, 1), (BASE + 7, 2), (0, 4)):
                with self.assertRaises(EvidenceError):
                    reader.read(address, size, 'flag')
        finally:
            reader.close()

    def test_overlapping_conflicting_translation_rejected(self):
        core_file(self.path, duplicate_offset=8192)
        reader = c.KcoreReader(self.path)
        try:
            with self.assertRaisesRegex(EvidenceError, 'ambiguous'):
                reader.read(BASE, 4, 'flag')
        finally:
            reader.close()

    def test_budget_blocks_further_read(self):
        core_file(self.path)
        reader = c.KcoreReader(self.path)
        try:
            reader.total_bytes = c.READ_BUDGET
            with self.assertRaisesRegex(EvidenceError, 'budget'):
                reader.read(BASE, 4, 'flag')
        finally:
            reader.close()

    def test_wrong_elf_architecture_rejected(self):
        data = bytearray(header())
        struct.pack_into('<H', data, 18, 62)
        with self.assertRaises(EvidenceError):
            elf_header(data, 4)

    def test_build_id_note_and_truncation(self):
        note = struct.pack('<III', 4, 4, 3) + b'GNU\0' + b'abcd'
        self.assertEqual(note_build_id(note), '61626364')
        with self.assertRaises(EvidenceError):
            note_build_id(note[:-1])


class InterpretTests(unittest.TestCase):
    def test_vm_wc_gate_closed_is_current_not_historical(self):
        r = c.interpret(state())
        self.assertIn('CURRENT_WC_CONDITION_FALSE', r['codes'])
        self.assertTrue(any('不证明能力初始化时' in s for s in r['next_steps']))

    def test_physical_mode_bypasses_zero_wc(self):
        r = c.interpret(state(mode=1))
        self.assertIn('WC_CHECK_BYPASSED_IN_CURRENT_MODE', r['codes'])
        self.assertNotIn('CURRENT_WC_CONDITION_FALSE', r['codes'])

    def test_uninitialized_mode_does_not_become_vm_mode(self):
        r = c.interpret(state(mode=None))
        self.assertIn('RUN_MODE_UNINITIALIZED', r['codes'])
        self.assertNotIn('CURRENT_WC_CONDITION_FALSE', r['codes'])

    def test_missing_controller_is_unknown_not_flag_zero(self):
        s = state()
        s['wc'] = {'status': 'object_unavailable'}
        r = c.interpret(s)
        self.assertIn('WC_CONTROL_OBJECT_UNAVAILABLE', r['codes'])
        self.assertNotIn('CURRENT_WC_CONDITION_FALSE', r['codes'])

    def test_explicit_disable_can_explain_nonzero_cache(self):
        r = c.interpret(state(wc=16, mem=1, huge=1, disabled=(1, 0)))
        self.assertIn('EXPLICIT_DISABLE_BAR_MEM', r['codes'])
        self.assertNotIn('BOTH_CURRENT_CAPABILITIES_AVAILABLE', r['codes'])

    def test_clearing_disable_is_insufficient_for_zero_cache(self):
        r = c.interpret(state(disabled=(1, 0)))
        self.assertIn('CACHE_ZERO_AND_DISABLED_BAR_MEM', r['codes'])
        self.assertTrue(any('仅撤销禁用不能恢复' in s for s in r['next_steps']))

    def test_wc_ready_zero_cache_needs_initialization_evidence(self):
        r = c.interpret(state(wc=16))
        self.assertIn('CURRENT_WC_CONDITION_TRUE', r['codes'])
        self.assertTrue(any('原始设备能力' in s for s in r['next_steps']))

    def test_page_mismatch_cannot_explain_both(self):
        s = state(wc=16)
        s['pages']['device_page_size'] = 65536
        r = c.interpret(s)
        self.assertIn('BASE_PAGE_SIZE_MISMATCH', r['codes'])
        self.assertTrue(any('不能单独解释' in s for s in r['facts']))

    def test_proc_disagrees_with_cached_fields(self):
        s = state(mem=1)
        s['proc_after'] = proc_state()
        self.assertEqual(c.interpret(s)['codes'], ['SNAPSHOT_INCONSISTENT'])

    def test_available_is_not_repaired(self):
        r = c.interpret(state(wc=16, mem=1, huge=1))
        self.assertIn('BOTH_CURRENT_CAPABILITIES_AVAILABLE', r['codes'])
        self.assertTrue(any('不证明修复成功' in s for s in r['limits']))


class MemoryFixture:
    """Independent byte fixture using offsets verified from the module instructions."""
    def __init__(self, duplicate=False, dvpp=1 << 34, mode_init=1):
        self.cells = {}
        self.syms = {'drv_devmm_host': {'devmm_svm': BASE, 'get_flag.2': BASE + 8,
                     'get_host_flag.1': BASE + 12, 'g_dev_feature_capabilty_disable': BASE + 0x100},
                     'drv_pcie_host': {'g_ctrls': BASE + 0x100000}}
        self.svm = BASE + 0x200000
        self.pci = BASE + 0x300000
        self.put(BASE, self.svm, 8)
        self.put(BASE + 8, mode_init, 1)
        self.put(BASE + 12, 0, 4)
        self.put(BASE + 0x101, 0, 1)
        self.put(BASE + 0x102, 0, 1)
        self.put(self.svm + 0x94, 4096, 4)
        self.put(self.svm + 0x9c, 4096, 4)
        self.put(self.svm + 0xc0, 1, 4)
        self.put(self.svm + 0xc069f0, dvpp, 8)
        self.put(self.svm + 0xc06a00, 0, 4)
        self.put(self.svm + 0xc06a14, 0, 4)
        table = bytearray(1124 * 0x50)
        for i in ([7, 8] if duplicate else [7]):
            struct.pack_into('<I', table, i * 0x50, 0)
            struct.pack_into('<I', table, i * 0x50 + 0x14, 3)
            struct.pack_into('<Q', table, i * 0x50 + 0x20, self.pci)
        self.add(BASE + 0x100000, table)
        for offset, value in [(0x12e8, 0), (0x12ec, 123), (0x12f0, 4), (0x12f4, 2),
                              (0x1300, 0), (0x5820, 0)]:
            self.put(self.pci + offset, value, 4)

    def put(self, addr, val, size):
        self.add(addr, val.to_bytes(size, 'little'))

    def add(self, addr, data):
        self.cells.update({addr + i: val for i, val in enumerate(data)})

    def read(self, addr, size, label):
        return bytes(self.cells[addr + i] for i in range(size))

    def uint(self, addr, size, label):
        return int.from_bytes(self.read(addr, size, label), 'little')


class SnapshotTests(unittest.TestCase):
    def test_exact_field_decode_and_nonzero_controller_index(self):
        memory = MemoryFixture()
        with patch.object(c, 'read_proc', return_value=proc_state()):
            result = c.snapshot(memory, PROFILE, memory.syms, 0)
        self.assertEqual(result['wc']['matching_control_indices'], [7])
        self.assertEqual(result['wc']['remote_dev_id'], 123)
        self.assertEqual(result['wc']['slot_id'], 4)
        self.assertEqual(result['wc']['actual_getter_return_code'], None)
        self.assertEqual(result['run_mode']['inferred_mode'], 0)
        self.assertIsNone(result['capability']['raw_device_feature_bar_mem'])

    def test_duplicate_device_lookup_is_not_accepted(self):
        memory = MemoryFixture(duplicate=True)
        with patch.object(c, 'read_proc', return_value=proc_state()):
            result = c.snapshot(memory, PROFILE, memory.syms, 0)
        self.assertEqual(result['wc']['status'], 'object_unavailable')
        self.assertNotIn('bar_wc_flag', result['wc'])

    def test_zero_filled_capability_page_is_rejected(self):
        memory = MemoryFixture(dvpp=0)
        with patch.object(c, 'read_proc', return_value=proc_state()):
            with self.assertRaisesRegex(EvidenceError, 'sentinel'):
                c.snapshot(memory, PROFILE, memory.syms, 0)

    def test_uninitialized_mode_preserves_unknown(self):
        memory = MemoryFixture(mode_init=0)
        with patch.object(c, 'read_proc', return_value=proc_state()):
            result = c.snapshot(memory, PROFILE, memory.syms, 0)
        self.assertIsNone(result['run_mode']['inferred_mode'])

    def test_mismatched_private_device_rejected(self):
        memory = MemoryFixture()
        memory.put(memory.pci + 0x12e8, 5, 4)
        with patch.object(c, 'read_proc', return_value=proc_state()):
            with self.assertRaisesRegex(EvidenceError, 'device ID'):
                c.snapshot(memory, PROFILE, memory.syms, 0)

    def test_svm_pointer_mutation_rejected(self):
        memory = MemoryFixture()
        original = memory.uint
        def changing(addr, size, label):
            if label == 'devmm_svm pointer reread':
                return memory.svm + 8
            return original(addr, size, label)
        with patch.object(c, 'read_proc', return_value=proc_state()), patch.object(memory, 'uint', changing):
            with self.assertRaisesRegex(EvidenceError, 'SVM object changed'):
                c.snapshot(memory, PROFILE, memory.syms, 0)

    def test_module_identity_failure_prevents_kcore_open(self):
        env = {'cgroup': {'status': 'ok', 'text': '0::/'}, 'device': 0}
        with patch.object(c, 'environment', return_value=env), \
             patch.object(c, 'check_bundle', return_value={}), \
             patch.object(c.platform, 'system', return_value='Linux'), \
             patch.object(c.platform, 'machine', return_value='aarch64'), \
             patch.object(c.os, 'geteuid', return_value=0), \
             patch.object(c.Path, 'exists', return_value=False), \
             patch.object(c, 'load_module', side_effect=EvidenceError('loaded build ID mismatch')), \
             patch.object(c, 'KcoreReader') as reader:
            result = c.collect(0)
        reader.assert_not_called()
        self.assertEqual(result['status'], 'unavailable')
        self.assertEqual(result['interpretation']['codes'], ['READ_UNAVAILABLE'])


if __name__ == '__main__':
    unittest.main()
