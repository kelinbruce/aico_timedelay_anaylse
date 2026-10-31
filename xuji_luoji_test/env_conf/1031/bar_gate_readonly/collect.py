#!/usr/bin/env python3
"""Read selected BAR capability fields from the existing Guest driver.

No ioctl, kernel function call, device BAR access, probe attachment, module load,
sysctl change, reset, or driver modification. Only the result directory is written.
Exact module hashes, live GNU build IDs and module-local symbol locations are
required before reading /proc/kcore. No arbitrary address option is exposed.
"""
import argparse
import datetime
import hashlib
import json
import os
import platform
import re
import shutil
import struct
import subprocess
import sys
import tarfile
import tempfile
import time
from pathlib import Path

from elf64 import EvidenceError, ModuleELF, elf_header, note_build_id

HERE = Path(__file__).resolve().parent
MODULES = ('drv_devmm_host', 'drv_pcie_host')
MAX_FILE = 128 * 1024 * 1024
MAX_READ = 128 * 1024
READ_BUDGET = 1024 * 1024
KERNEL_MIN = 0xfff0000000000000  # upper canonical range, at most 52 VA bits


def read_small(path, limit=65536):
    with open(path, 'rb') as f:
        data = f.read(limit + 1)
    if len(data) > limit:
        raise EvidenceError('File exceeds size limit: ' + str(path))
    return data


def text_file(path):
    try:
        return {'status': 'ok', 'text': read_small(path).decode(errors='replace').strip()}
    except (OSError, EvidenceError) as e:
        return {'status': 'unavailable', 'error': str(e)}


def require_text(path):
    r = text_file(path)
    if r['status'] != 'ok':
        raise EvidenceError('%s: %s' % (path, r['error']))
    return r['text']


def command(args):
    try:
        p = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                           timeout=10, check=False)
    except (OSError, subprocess.TimeoutExpired) as e:
        raise EvidenceError('%s: %s' % (args[0], e))
    if p.returncode:
        raise EvidenceError('%s exited %d: %s' %
                            (args[0], p.returncode, p.stderr[:2000].decode(errors='replace')))
    if len(p.stdout) > 65536:
        raise EvidenceError('Unexpected command output size')
    return p.stdout.decode(errors='strict').strip()


def pointer(value, label):
    if not isinstance(value, int) or not (KERNEL_MIN <= value < (1 << 64)) or value % 8:
        raise EvidenceError('Invalid/unavailable kernel pointer for ' + label)
    return value


class KcoreReader:
    """Address translation is from ELF PT_LOAD, never a guessed kernel slide."""
    def __init__(self, path='/proc/kcore'):
        self.fd = os.open(path, os.O_RDONLY | getattr(os, 'O_CLOEXEC', 0))
        self.audit = []
        self.total_bytes = 0
        try:
            h = elf_header(self._pread(0, 64), 4)
            if h[9] != 56 or not 1 <= h[10] <= 4096 or h[5] != 64:
                raise EvidenceError('Unsupported kcore program headers')
            raw = self._pread(h[5], h[9] * h[10])
            self.header_bytes = 64 + len(raw)
            self.segments = []
            for i in range(h[10]):
                kind, flags, off, va, pa, fs, ms, align = struct.unpack_from('<IIQQQQQQ', raw, i * 56)
                if kind == 1:
                    if not flags & 4 or fs > ms or va + ms > (1 << 64):
                        raise EvidenceError('Invalid kcore PT_LOAD')
                    self.segments.append({'offset': off, 'vaddr': va, 'filesz': fs})
            if not self.segments:
                raise EvidenceError('kcore has no PT_LOAD segments')
            self.header = h
        except Exception:
            self.close()
            raise

    def _pread(self, offset, size):
        if not 0 <= offset <= (1 << 63) - 1 or not 0 < size <= 256 * 1024:
            raise EvidenceError('Invalid bounded file read')
        data = os.pread(self.fd, size, offset)
        if len(data) != size:
            raise EvidenceError('Short kernel-memory read; not interpreted as zero')
        return data

    def read(self, address, size, label):
        if not 0 < size <= MAX_READ or self.total_bytes + size > READ_BUDGET:
            raise EvidenceError('Kernel-memory read budget exceeded')
        if address < KERNEL_MIN or address + size > (1 << 64):
            raise EvidenceError('Invalid kernel-memory range')
        # PT_LOAD ranges may overlap; accept only if translation agrees.
        offsets = {s['offset'] + address - s['vaddr'] for s in self.segments
                   if s['vaddr'] <= address and address + size <= s['vaddr'] + s['filesz']}
        if len(offsets) != 1:
            raise EvidenceError('Memory range absent/ambiguous in kcore PT_LOAD: ' + label)
        data = self._pread(offsets.pop(), size)
        self.total_bytes += size
        self.audit.append({'field': label, 'address': hex(address), 'bytes': size})
        return data

    def uint(self, address, size, label):
        if size not in (1, 4, 8):
            raise EvidenceError('Unexpected integer width')
        return int.from_bytes(self.read(address, size, label), 'little')

    def close(self):
        if self.fd is not None:
            os.close(self.fd)
            self.fd = None


def load_module(name, expected):
    modinfo = shutil.which('modinfo')
    if modinfo:
        path = Path(command([modinfo, '-n', name]))
    else:
        path = Path('/lib/modules') / platform.release() / 'updates' / (name + '.ko')
    if not path.is_file() or not 0 < path.stat().st_size <= MAX_FILE:
        raise EvidenceError('Expected an uncompressed regular module: ' + str(path))
    raw = read_small(path, MAX_FILE)
    sha = hashlib.sha256(raw).hexdigest()
    if sha != expected['sha256']:
        raise EvidenceError('%s SHA256 mismatch; refuse this build-specific layout. actual=%s' % (name, sha))
    elf = ModuleELF(raw)
    src = require_text('/sys/module/' + name + '/srcversion')
    if src != expected['srcversion'] or elf.modinfo().get('srcversion') != [src]:
        raise EvidenceError(name + ' loaded srcversion does not match')
    initstate = require_text('/sys/module/' + name + '/initstate')
    if initstate != 'live':
        raise EvidenceError(name + ' is not in live state')
    live_note = read_small('/sys/module/' + name + '/notes/.note.gnu.build-id', 4096)
    live_id = note_build_id(live_note)
    if live_id != expected['build_id'] or elf.build_id() != live_id:
        raise EvidenceError(name + ' loaded build ID does not match')
    symbols = elf.object_symbols()
    resolved = {}
    for key, wanted in expected['symbols'].items():
        matches = [s for s in symbols if s['name'] == key]
        if matches != [wanted]:
            raise EvidenceError(name + ' symbol layout mismatch: ' + key)
        section_base = int(require_text('/sys/module/%s/sections/%s' % (name, wanted['section'])), 16)
        pointer(section_base, 'module section ' + name)
        resolved[key] = section_base + wanted['offset']
    return {'module': name, 'path': str(path), 'sha256': sha, 'size': len(raw),
            'srcversion': src, 'loaded_build_id': live_id, 'state': initstate,
            'vermagic': elf.modinfo().get('vermagic'),
            'symbols': {k: hex(v) for k, v in resolved.items()}}, resolved


def crosscheck_symbols(resolved):
    wanted = {(mod, sym) for mod, symbols in resolved.items() for sym in symbols}
    records = {key: [] for key in wanted}
    try:
        f = open('/proc/kallsyms')
    except OSError as e:
        # Exact live build IDs and section bases remain mandatory in load_module.
        return [{'status': 'unavailable', 'error': str(e),
                 'note': 'Using independently verified module section bases and live build IDs.'}]
    with f:
        for line in f:
            parts = line.split()
            if len(parts) == 4 and parts[3].startswith('['):
                key = (parts[3][1:-1], parts[2])
                if key in wanted:
                    records[key].append((int(parts[0], 16), parts[1]))
    result = []
    for key, found in records.items():
        mod, sym = key
        addresses = {addr for addr, _ in found if addr}
        if addresses and addresses != {resolved[mod][sym]}:
            raise EvidenceError('kallsyms disagrees with module section: %s/%s' % key)
        if len(found) > 1:
            raise EvidenceError('Ambiguous module-local kallsyms symbol: %s/%s' % key)
        result.append({'module': mod, 'symbol': sym,
                       'status': 'matched' if addresses else 'hidden_or_missing',
                       'section_resolved_address': hex(resolved[mod][sym])})
    return result


def read_proc(device):
    out = {}
    for name in ('bar_mem', 'bar_mem_huge'):
        p = '/proc/svm/dev%d/feature/%s' % (device, name)
        r = text_file(p)
        if r['status'] == 'ok':
            try:
                r['value'] = int(r['text'])
                if r['value'] not in (0, 1):
                    raise ValueError('not boolean')
            except ValueError:
                r = {'status': 'invalid', 'text': r['text']}
        r['path'] = p
        out[name] = r
    return out


def snapshot(reader, p, symbols, device):
    svm_syms, pci_syms = (symbols[m] for m in MODULES)
    out = {'device': device, 'monotonic_ns': time.monotonic_ns(), 'proc_before': read_proc(device)}
    sl, cl, pl, caps = (p['layouts'][k] for k in ('svm', 'ctrl', 'pci', 'capability'))
    # Locals are addressed inside drv_devmm_host only, not a global name search.
    valid = reader.uint(svm_syms['get_flag.2'], 1, 'run_mode.get_flag')
    phy = reader.uint(svm_syms['get_host_flag.1'], 4, 'run_mode.get_host_flag')
    if valid not in (0, 1):
        raise EvidenceError('Run-mode initialization flag is not bool')
    out['run_mode'] = {'initialized': bool(valid), 'cached_physical_flag': phy,
                       'inferred_mode': int(phy != 0) if valid else None,
                       'function_invoked': False,
                       'note': 'Initialized cache predicts 1 for nonzero physical flag, else 0. Uninitialized is unknown, not mode 0/2.'}
    addr = pointer(reader.uint(svm_syms['devmm_svm'], 8, 'devmm_svm pointer'), 'devmm_svm')
    pages = {field: reader.uint(addr + sl[field], 4, 'svm.' + field)
             for field in ('host_page_size', 'device_page_size', 'page_size_inited')}
    if pages['page_size_inited'] not in (0, 1):
        raise EvidenceError('Unexpected page_size_inited value')
    if pages['page_size_inited']:
        for k in ('host_page_size', 'device_page_size'):
            v = pages[k]
            if not 4096 <= v <= 65536 or v & (v - 1):
                raise EvidenceError('Implausible initialized page size: ' + k)
    out['pages'] = pages
    cap_addr = addr + sl['dev_capability'] + device * caps['size']
    out['capability'] = {
        'dvpp_memsize': reader.uint(cap_addr + caps['dvpp_memsize'], 8, 'cap.dvpp_memsize'),
        'cached_bar_mem': reader.uint(cap_addr + caps['feature_bar_mem'], 4, 'cap.feature_bar_mem'),
        'cached_bar_huge_mem': reader.uint(cap_addr + caps['feature_bar_huge_mem'], 4, 'cap.feature_bar_huge_mem'),
        'raw_device_feature_bar_mem': None,
        'raw_input_note': 'Original initialization info is not preserved by these cached fields.'}
    if out['capability']['dvpp_memsize'] not in (1 << 32, 1 << 34):
        raise EvidenceError('Capability record is uninitialized/unreadable (DVPP sentinel); refuse zero interpretation')
    dis = svm_syms['g_dev_feature_capabilty_disable'] + device * p['disable_stride']
    out['disabled'] = {k: reader.uint(dis + ix, 1, 'disable.' + k)
                       for k, ix in p['disable_indices'].items()}
    if any(v not in (0, 1) for v in out['disabled'].values()):
        raise EvidenceError('Disable state is not bool')
    table = reader.read(pci_syms['g_ctrls'], cl['size'] * p['device_count'], 'g_ctrls scan')
    matches = []
    for i in range(p['device_count']):
        start = i * cl['size']
        did = struct.unpack_from('<I', table, start + cl['dev_id'])[0]
        state = struct.unpack_from('<I', table, start + cl['startup_flg'])[0]
        if did == device and state == p['active_startup_flag']:
            matches.append(i)
    out['wc'] = {'function_invoked': False, 'actual_getter_return_code': None,
                 'matching_control_indices': matches}
    if len(matches) != 1:
        out['wc'].update(status='object_unavailable',
                         reason='Expected exactly one started control object. Do not interpret as WC flag zero.')
    else:
        idx = matches[0]
        begin = idx * cl['size']
        entry = table[begin:begin + cl['size']]
        private = pointer(struct.unpack_from('<Q', entry, cl['priv'])[0], 'PCI ctrl private')
        fields = {k: reader.uint(private + pl[k], 4, 'pci.' + k)
                  for k in ('dev_id', 'remote_dev_id', 'slot_id', 'func_id', 'virtfn_flag', 'bar_wc_flag')}
        if fields['dev_id'] != device:
            raise EvidenceError('Private PCI object device ID mismatch')
        again = reader.read(pci_syms['g_ctrls'] + begin, 40, 'g_ctrls identity reread')
        # Ignore timestamp/counters; verify identity, active state and private pointer.
        for offset, size in ((cl['dev_id'], 4), (cl['startup_flg'], 4), (cl['priv'], 8)):
            if again[offset:offset + size] != entry[offset:offset + size]:
                raise EvidenceError('Control object changed during capture')
        out['wc'].update(status='ok', **fields,
                         bar4_wc_bit=bool(fields['bar_wc_flag'] & p['wc_mask']))
    if reader.uint(svm_syms['devmm_svm'], 8, 'devmm_svm pointer reread') != addr:
        raise EvidenceError('SVM object changed during capture')
    out['proc_after'] = read_proc(device)
    return out


def values_only(s):
    return {k: v for k, v in s.items() if k != 'monotonic_ns'}


def interpret(s):
    """Conclusions about a stable current snapshot; never invent initialization history."""
    facts, next_steps, codes = [], [], []
    mode = s['run_mode']['inferred_mode']
    wc = s['wc']
    cap, disabled = s['capability'], s['disabled']
    if mode is not None:
        facts.append('有效缓存推导的运行模式=%s。' % mode)
    if wc['status'] == 'ok':
        facts.append('读取的 bar_wc_flag=%s，BAR4 位=%s。' %
                     (hex(wc['bar_wc_flag']), int(wc['bar4_wc_bit'])))
    for kind, proc_name in (('bar_mem', 'bar_mem'), ('bar_huge_mem', 'bar_mem_huge')):
        cached = cap['cached_' + kind]
        expected = int(cached != 0 and not disabled[kind])
        for phase in ('proc_before', 'proc_after'):
            rec = s[phase][proc_name]
            if rec['status'] == 'ok' and rec['value'] != expected:
                return {'codes': ['SNAPSHOT_INCONSISTENT'],
                        'facts': ['内核节点与缓存/禁用位计算结果不一致，不能据此判根因。'],
                        'next_steps': ['核对设备编号、采集期间的驱动状态变化及本构建实现。']}
        facts.append('%s：缓存=%s，禁用位=%s，按当前代码计算的对外能力=%s。' %
                     (kind, cached, disabled[kind], expected))
        if cached and disabled[kind]:
            codes.append('EXPLICIT_DISABLE_' + kind.upper())
            next_steps.append('在 Guest 定位 %s 显式禁用的设置者和用途；通过当前版本受支持方式撤销错误禁用。' % kind)
        elif not cached and disabled[kind]:
            codes.append('CACHE_ZERO_AND_DISABLED_' + kind.upper())
            next_steps.append('%s 缓存和禁用位均构成阻断；仅撤销禁用不能恢复零缓存。' % kind)
    cache_zero = not cap['cached_bar_mem'] or not cap['cached_bar_huge_mem']
    if mode is None:
        codes.append('RUN_MODE_UNINITIALIZED')
        facts.append('运行模式缓存尚未有效初始化，不能把默认值解释为虚机模式。')
        next_steps.append('读取当前驱动运行模式查询的实际返回码及初始化记录；本工具没有执行内核函数。')
    elif mode == 1:
        codes.append('WC_CHECK_BYPASSED_IN_CURRENT_MODE')
        facts.append('有效运行模式缓存推导为 1；按本构建代码，WC 检查会被绕过。')
        if cache_zero:
            next_steps.append('优先取得 devmm_set_dev_capability 初始化时的原始 feature_bar_mem、返回码及生成后的缓存，核对初始化时序。')
    elif wc['status'] != 'ok':
        codes.append('WC_CONTROL_OBJECT_UNAVAILABLE')
        facts.append('未取得唯一有效 PCI 控制对象，WC getter 是否成功未知，不能把未知写成 flag=0。')
        next_steps.append('在 Guest 检查设备编号、控制对象注册/启动状态及 devdrv_get_bar_wc_flag 实际返回码。')
    elif not wc['bar4_wc_bit']:
        codes.append('CURRENT_WC_CONDITION_FALSE')
        facts.append('有效运行模式缓存推导为 0，且当前 BAR4 WC 位为 0；当前 WC 条件不满足。')
        if cache_zero:
            next_steps.append('核对 WC 能力发布者及初始化顺序，并取得原始设备 feature_bar_mem；本快照不证明能力初始化时 flag 也为零。')
        else:
            next_steps.append('当前 WC 条件与非零缓存并存，检查初始化后 WC 状态变化；不要直接刷新/改写能力。')
    else:
        codes.append('CURRENT_WC_CONDITION_TRUE')
        facts.append('有效运行模式缓存推导为 0，当前 BAR4 WC 位为 1。')
        if cache_zero:
            next_steps.append('当前 WC 位不能解释零缓存；取得初始化时的原始设备能力和 WC 值，检查发布过晚或缓存未刷新。')
    pg = s['pages']
    if pg['page_size_inited'] and pg['host_page_size'] != pg['device_page_size']:
        codes.append('BASE_PAGE_SIZE_MISMATCH')
        facts.append('Guest 驱动两侧基础页大小不等，可阻断普通 BAR；不能单独解释巨大页 BAR 也为零。')
    elif not pg['page_size_inited']:
        codes.append('PAGE_SIZE_UNINITIALIZED')
        facts.append('页大小未初始化，不能按默认值判定页条件。')
    if all(cap['cached_' + k] and not disabled[k] for k in ('bar_mem', 'bar_huge_mem')):
        codes.append('BOTH_CURRENT_CAPABILITIES_AVAILABLE')
        next_steps.append('两项 Guest 当前能力均可用；在原容器重新确认 HAL/Runtime 路径及无探针性能。')
    return {'codes': codes, 'facts': facts, 'next_steps': list(dict.fromkeys(next_steps)),
            'limits': ['这是当前状态的读取，未执行 getter/setter，未捕获设备初始化调用。',
                       '未取得原始设备能力输入；WC 声明不等于实际 Stage-2 映射属性。',
                       '两次相同读取降低状态变化的疑虑，但不构成锁保护的原子快照。',
                       '本工具不证明修复成功，也不测量业务性能收益。']}


def environment(device):
    links = {}
    for ns in ('mnt', 'pid', 'user'):
        try:
            links[ns] = os.readlink('/proc/self/ns/' + ns)
        except OSError as e:
            links[ns] = str(e)
    return {'declared_role': 'guest-os-outside-container', 'device': device,
            'hostname': platform.node(), 'kernel': platform.release(), 'machine': platform.machine(),
            'python': sys.version, 'utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'euid': os.geteuid() if hasattr(os, 'geteuid') else None,
            'boot_id': text_file('/proc/sys/kernel/random/boot_id'), 'namespaces': links,
            'cgroup': text_file('/proc/self/cgroup'),
            'lockdown': text_file('/sys/kernel/security/lockdown'),
            'kptr_restrict': text_file('/proc/sys/kernel/kptr_restrict'),
            'driver_install_info': text_file('/etc/ascend_install.info'),
            'driver_version': text_file('/usr/local/spu/driver/version.info'),
            'device_node': {'path': '/dev/davinci%d' % device,
                            'exists': Path('/dev/davinci%d' % device).exists()},
            'effective_capability': read_proc(device)}


def check_bundle():
    manifest = HERE / 'SHA256SUMS'
    if not manifest.is_file():
        raise EvidenceError('Missing SHA256SUMS; use the complete published bundle')
    checked = {}
    for line in manifest.read_text().splitlines():
        sha, filename = line.split('  ', 1)
        if Path(filename).name != filename or not re.fullmatch('[0-9a-f]{64}', sha):
            raise EvidenceError('Invalid bundle manifest')
        actual = hashlib.sha256(read_small(HERE / filename, MAX_FILE)).hexdigest()
        if actual != sha:
            raise EvidenceError('Bundle checksum mismatch: ' + filename)
        checked[filename] = sha
    if not {'collect.py', 'elf64.py', 'profile_25_5.json'} <= checked.keys():
        raise EvidenceError('Incomplete bundle manifest')
    return checked


def collect(device):
    result = {'schema': 1, 'status': 'unavailable', 'environment': environment(device),
              'modules': {}, 'snapshots': [], 'interpretation': None, 'read_audit': []}
    reader = None
    try:
        result['bundle_sha256'] = check_bundle()
        if platform.system() != 'Linux' or platform.machine() != 'aarch64' or sys.maxsize <= 2**32:
            raise EvidenceError('Run on the aarch64 Linux Guest, outside the container')
        if os.geteuid() != 0:
            raise EvidenceError('Guest root is required to read existing kernel diagnostics')
        cg = result['environment']['cgroup'].get('text', '')
        if Path('/.dockerenv').exists() or re.search(r'docker|kubepods|containerd|lxc', cg):
            raise EvidenceError('Container detected; run on the Guest OS outside vm_test')
        p = json.loads((HERE / 'profile_25_5.json').read_text())
        if p['schema'] != 1 or not 0 <= device < p['device_count']:
            raise EvidenceError('Invalid profile/device')
        symbols = {}
        for m in MODULES:
            info, addr = load_module(m, p['modules'][m])
            result['modules'][m] = info
            symbols[m] = addr
        result['selected_symbols'] = crosscheck_symbols(symbols)
        reader = KcoreReader()
        for i in range(2):
            result['snapshots'].append(snapshot(reader, p, symbols, device))
            if i == 0:
                time.sleep(0.1)
        # Recheck loaded identity and relocated symbol locations after capture.
        for m in MODULES:
            sysbase = '/sys/module/' + m
            if require_text(sysbase + '/initstate') != 'live':
                raise EvidenceError('Module state changed during capture')
            if require_text(sysbase + '/srcversion') != p['modules'][m]['srcversion']:
                raise EvidenceError('Module identity changed during capture')
            if note_build_id(read_small(sysbase + '/notes/.note.gnu.build-id', 4096)) != p['modules'][m]['build_id']:
                raise EvidenceError('Loaded build ID changed during capture')
            for sym, record in p['modules'][m]['symbols'].items():
                base = int(require_text(sysbase + '/sections/' + record['section']), 16)
                if base + record['offset'] != symbols[m][sym]:
                    raise EvidenceError('Module section changed during capture')
        if text_file('/proc/sys/kernel/random/boot_id') != result['environment']['boot_id']:
            raise EvidenceError('Boot identity changed during capture')
        if values_only(result['snapshots'][0]) != values_only(result['snapshots'][1]):
            raise EvidenceError('Selected state changed between snapshots; no stable interpretation')
        result['interpretation'] = interpret(result['snapshots'][0])
        result['status'] = ('inconsistent' if 'SNAPSHOT_INCONSISTENT' in result['interpretation']['codes']
                            else 'captured')
    except (OSError, EvidenceError, ValueError, KeyError, struct.error) as e:
        result['error'] = '%s: %s' % (type(e).__name__, e)
        result['interpretation'] = {'codes': ['READ_UNAVAILABLE'],
            'facts': ['未完成有效状态采集，未知字段不能解释为零/不支持。'],
            'next_steps': ['按 error 指定的缺项处理。若内核禁止 kcore/模块地址读取，交由平台方用既有受支持诊断接口返回同一组字段；不要为此关闭内核保护。']}
    finally:
        if reader is not None:
            result['read_audit'] = reader.audit
            result['kernel_data_bytes_read'] = reader.total_bytes
            result['kcore_header_bytes_read'] = reader.header_bytes
            reader.close()
    return result


def report(result):
    lines = ['当前 25.5.0 Guest 驱动 BAR 能力只读快照', '', '采集状态：' + result['status'],
             '设备编号：Guest 驱动编号 %s（不自动等同于重排后的容器逻辑编号）' % result['environment']['device']]
    if result.get('error'):
        lines += ['', '读取失败原因：' + result['error']]
    interp = result['interpretation']
    lines += ['', '判定代码：' + ', '.join(interp['codes']), '', *interp['facts'],
              '', '下一步：', *interp['next_steps'], '', *interp.get('limits', [])]
    if result['status'] != 'captured':
        lines.append('请保留整个结果包；重复运行相同命令不会自动补齐被禁止或缺失的读取入口。')
    return '\n'.join(lines) + '\n'


def save_result(result, out):
    (out / 'result.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    (out / '结论.txt').write_text(report(result))
    for name in ('collect.py', 'elf64.py', 'profile_25_5.json'):
        shutil.copyfile(HERE / name, out / name)
    manifest = {f.name: hashlib.sha256(f.read_bytes()).hexdigest() for f in out.iterdir() if f.is_file()}
    (out / 'SHA256_MANIFEST.json').write_text(json.dumps(manifest, indent=2) + '\n')
    archive = out.with_name(out.name + '.tar.gz')
    with tarfile.open(archive, 'x:gz') as tar:
        tar.add(out, arcname=out.name)
    return archive


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--guest', action='store_true', required=True,
                        help='Confirm execution in Guest OS, outside container and KVM host')
    parser.add_argument('--device', type=int, default=0, choices=range(1124), metavar='ID',
                        help='Guest driver device ID, default 0')
    parser.add_argument('--out', type=Path, help='New output directory; default /tmp/bar-gate-...')
    args = parser.parse_args()
    if args.out:
        out = args.out.resolve()
        if out.exists() or out.with_name(out.name + '.tar.gz').exists():
            parser.error('Output path/archive already exists; choose a new directory')
        out.mkdir(parents=True, exist_ok=False)
    else:
        out = Path(tempfile.mkdtemp(prefix='bar-gate-vm-'))
    result = collect(args.device)
    archive = save_result(result, out)
    print(report(result))
    print('结果包：' + str(archive))
    print('SHA256：' + hashlib.sha256(archive.read_bytes()).hexdigest())
    return 0 if result['status'] == 'captured' else 2


if __name__ == '__main__':
    sys.exit(main())
