#!/usr/bin/env python3
"""Read actual HAL hash and query BAR-copy feature flags; no perf or compiler."""
import argparse
import ctypes
import hashlib
import json
import os
from pathlib import Path
import platform
import sys
import traceback


class SupportFeaturePara(ctypes.Structure):
    _fields_ = [('support_feature', ctypes.c_uint64), ('devid', ctypes.c_uint32)]


def decode(return_code, output_bits):
    if return_code != 0:
        return {'bar_mem': None, 'bar_huge_mem': None, 'runtime_query_any_supported': None}
    return {'bar_mem': bool(output_bits & 0x2), 'bar_huge_mem': bool(output_bits & 0x8),
            'runtime_query_any_supported': bool(output_bits & 0xa)}


def query(function, device, mask):
    incoming = SupportFeaturePara(mask, device)
    outgoing = SupportFeaturePara()
    size = ctypes.c_size_t(0)  # Matches Runtime's CheckSupportPcieBarCopy.
    rc = int(function(2, ctypes.byref(incoming), ctypes.sizeof(incoming),
                      ctypes.byref(outgoing), ctypes.byref(size)))
    return {'input_mask_hex': hex(mask), 'return_code': rc, 'output_mask_hex': hex(outgoing.support_feature),
            'output_size': size.value, **decode(rc, outgoing.support_feature)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--device', type=int, default=0)
    parser.add_argument('--out', required=True, help='New JSON file, not an existing result directory')
    args = parser.parse_args()
    output = Path(args.out).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    # Reserve the file exclusively before using the device.
    with output.open('x') as stream:
        stream.write('{}\n')
    result = {'status': 'error', 'device': args.device, 'platform': platform.system(),
              'kernel': platform.release(), 'machine': platform.machine(), 'python': sys.version,
              'base_page_size': os.sysconf('SC_PAGE_SIZE'),
              'script_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              'abi': {'sizeof_supportFeaturePara': ctypes.sizeof(SupportFeaturePara),
                      'support_feature_offset': SupportFeaturePara.support_feature.offset,
                      'devid_offset': SupportFeaturePara.devid.offset},
              'meaning': 'Read CTRL_TYPE_SUPPORT_FEATURE=2 with masks 0x2/0x8/0xa. No capability is forced or modified. A positive capability alone does not prove Runtime selected BAR copy.'}
    try:
        if platform.system() != 'Linux' or ctypes.sizeof(ctypes.c_void_p) != 8:
            raise RuntimeError('This diagnostic targets the current 64-bit Linux Ascend environment')
        if ctypes.sizeof(SupportFeaturePara) != 16 or SupportFeaturePara.devid.offset != 8:
            raise RuntimeError('Unexpected native ABI layout')
        if args.device < 0:
            raise ValueError('device must be nonnegative')
        if os.environ.get('ASCEND_RT_VISIBLE_DEVICES'):
            raise RuntimeError('ASCEND_RT_VISIBLE_DEVICES is set; original device-ID mapping is required')
        if 'libioctl_probe' in os.environ.get('LD_PRELOAD', ''):
            raise RuntimeError('Run this independent query without the benchmark ioctl probe preloaded')
        os.environ['TASK_QUEUE_ENABLE'] = '0'
        result['task_queue_enable'] = '0'
        import torch
        import torch_npu
        torch_npu.npu.set_device(args.device)
        # Ensure SVM device setup has happened before querying cached capabilities.
        allocation = torch.empty(1, dtype=torch.int32, device=f'npu:{args.device}')
        torch_npu.npu.synchronize()
        result.update({'torch_version': torch.__version__, 'torch_npu_version': torch_npu.__version__,
                       'device_name': torch_npu.npu.get_device_name(args.device)})
        mapping_lines = [line for line in Path('/proc/self/maps').read_text().splitlines()
                         if line.split()[-1].endswith('/libascend_hal.so')]
        paths = sorted({line.split()[-1] for line in mapping_lines})
        result['hal_mapping_lines'] = mapping_lines
        if len(paths) != 1:
            raise RuntimeError(f'Expected one already loaded libascend_hal.so, found {paths}')
        library_path = Path(paths[0])
        result['hal_library'] = {'path': str(library_path), 'size': library_path.stat().st_size,
                                 'sha256': hashlib.sha256(library_path.read_bytes()).hexdigest()}
        version = Path('/usr/local/Ascend/driver/version.info')
        result['driver_version_info'] = version.read_text(errors='replace')[:32768] if version.is_file() else None
        # Reuse the loaded object. Do not introduce any new or replacement HAL symbols.
        library = ctypes.CDLL(str(library_path), mode=os.RTLD_NOW | os.RTLD_NOLOAD)
        function = getattr(library, 'halMemCtl')
        function.argtypes = [ctypes.c_int, ctypes.c_void_p, ctypes.c_size_t, ctypes.c_void_p,
                             ctypes.POINTER(ctypes.c_size_t)]
        function.restype = ctypes.c_int
        result['queries'] = [query(function, args.device, mask) for mask in (0x2, 0x8, 0xa)]
        result['status'] = 'ok' if all(row['return_code'] == 0 for row in result['queries']) else 'query_error'
        del allocation
    except Exception:
        result['error'] = traceback.format_exc()
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'status': result['status'], 'out': str(output)}, ensure_ascii=False))
    return 0 if result['status'] == 'ok' else 2


if __name__ == '__main__':
    sys.exit(main())
