"""Offline builder for the two exact user-supplied 25.5.0 modules.

Input DWARF text was generated with llvm-dwarfdump from these exact modules.
This builder is not run on the Guest. The deployed collector uses only stdlib.
"""
import argparse
import hashlib
import json
import re
from pathlib import Path
from elf64 import EvidenceError, ModuleELF

EXPECTED = {
    'drv_devmm_host': '26b14ada0adc038435b82224b028db8a9ea46874a792fa82a503c6017b52ab1c',
    'drv_pcie_host': 'f922377a83cd371711ab4839879011d62e61696a4abfd2ac9a3db19183f7523f',
}


def one(values, label):
    values = set(values)
    if len(values) != 1:
        raise EvidenceError('%s is missing/ambiguous: %r' % (label, values))
    return values.pop()


def layout(path, fields):
    s = path.read_text()
    out = {'size': one((int(x, 16) for x in re.findall(
        r'DW_AT_byte_size\s+\((0x[0-9a-f]+)\)', s)), str(path))}
    for name in fields:
        blocks = re.findall(r'DW_AT_name\s+\("' + re.escape(name) +
                            r'"\)(.*?)(?=\n\n|\Z)', s, re.S)
        offsets = []
        for block in blocks:
            m = re.search(r'DW_AT_data_member_location\s+\((0x[0-9a-f]+)\)', block)
            if m:
                offsets.append(int(m[1], 16))
        out[name] = one(offsets, name)
    return out


def build(modules, evidence):
    profile = {'schema': 1, 'architecture': 'aarch64', 'byteorder': 'little',
               'description': 'Exact 2026-10-30 uploaded HDK 25.5.0 modules; not a generic 25.5 layout',
               'modules': {}, 'layouts': {}, 'provenance': []}
    for name, sha in EXPECTED.items():
        raw = (modules / (name + '.ko')).read_bytes()
        if hashlib.sha256(raw).hexdigest() != sha:
            raise EvidenceError('Unreviewed module: ' + name)
        elf = ModuleELF(raw)
        wanted = (['devmm_svm', 'g_dev_feature_capabilty_disable', 'get_flag.2', 'get_host_flag.1']
                  if name == 'drv_devmm_host' else ['g_ctrls'])
        syms = elf.object_symbols()
        selected = {}
        for symname in wanted:
            matches = [s for s in syms if s['name'] == symname]
            if len(matches) != 1:
                raise EvidenceError('Symbol missing/ambiguous: ' + symname)
            selected[symname] = matches[0]
        profile['modules'][name] = {'sha256': sha, 'size': len(raw),
            'srcversion': one(elf.modinfo()['srcversion'], name),
            'build_id': elf.build_id(), 'symbols': selected}

    descriptions = {
        'svm': ('drv_devmm_host.devmm_svm_dev',
                ['host_page_size', 'device_page_size', 'page_size_inited', 'dev_capability']),
        'capability': ('drv_devmm_host.devmm_device_capability',
                       ['dvpp_memsize', 'feature_bar_mem', 'feature_bar_huge_mem']),
        'ctrl': ('drv_pcie_host.devdrv_ctrl',
                 ['dev_id', 'slot_id', 'func_id', 'virtfn_flag', 'startup_flg', 'priv']),
        'pci': ('drv_pcie_host.devdrv_pci_ctrl',
                ['dev_id', 'remote_dev_id', 'slot_id', 'func_id', 'virtfn_flag', 'bar_wc_flag']),
    }
    for key, (file, fields) in descriptions.items():
        path = evidence / (file + '.dwarf.txt')
        profile['layouts'][key] = layout(path, fields)
        profile['provenance'].append({'file': path.name,
                                     'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
    # The array dimensions are checked against both DWARF and ELF symbol sizes.
    ctrl_dwarf = (evidence / 'drv_pcie_host.g_ctrls.dwarf.txt').read_text()
    disable_dwarf = (evidence / 'drv_devmm_host.g_dev_feature_capabilty_disable.dwarf.txt').read_text()
    n = one(map(int, re.findall(r'devdrv_ctrl\[(\d+)\]', ctrl_dwarf)), 'device count')
    dims = one(re.findall(r'bool\[(\d+)\]\[(\d+)\]', disable_dwarf), 'disable dimensions')
    if n != int(dims[0]):
        raise EvidenceError('Array dimensions disagree')
    profile['device_count'] = n
    profile['disable_stride'] = int(dims[1])
    profile['disable_indices'] = {'bar_mem': 1, 'bar_huge_mem': 2}
    profile['active_startup_flag'] = 3
    profile['wc_mask'] = 0x10
    svm = profile['modules']['drv_devmm_host']['symbols']
    pci = profile['modules']['drv_pcie_host']['symbols']
    assert svm['devmm_svm']['size'] == 8
    assert svm['get_flag.2']['size'] == 1
    assert svm['get_host_flag.1']['size'] == 4
    assert svm['g_dev_feature_capabilty_disable']['size'] == n * int(dims[1])
    assert pci['g_ctrls']['size'] == n * profile['layouts']['ctrl']['size']
    assert svm['get_host_flag.1']['offset'] == svm['get_flag.2']['offset'] + 4
    assert svm['get_host_flag.1']['section'] == svm['get_flag.2']['section']
    # Cross-check the critical offsets against the reviewed AArch64 instructions.
    assert profile['layouts']['ctrl']['size'] == 0x50
    assert profile['layouts']['pci']['bar_wc_flag'] == 0x5820
    assert profile['layouts']['capability']['size'] == 0x48
    assert profile['layouts']['svm']['dev_capability'] == 0xc069f0
    assert profile['layouts']['capability']['feature_bar_mem'] == 0x10
    assert profile['layouts']['capability']['feature_bar_huge_mem'] == 0x24
    return profile


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--modules', type=Path, required=True)
    p.add_argument('--evidence', type=Path, required=True)
    p.add_argument('--out', type=Path, required=True)
    a = p.parse_args()
    result = build(a.modules, a.evidence)
    with a.out.open('x') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
        f.write('\n')
    print(a.out)
