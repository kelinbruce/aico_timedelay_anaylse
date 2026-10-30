#!/usr/bin/env python3
"""One fresh NPU initialization and capability query; launched by bar_copy_diag.py."""
import argparse
import ctypes
import os
from pathlib import Path
import platform
import resource
import sys
import traceback

from common import SCHEMA, ENV_KEYS, dump, features, identity, limits, read, sha256
from query_copy_capability import SupportFeaturePara, query


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--device', type=int, required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--as-soft', choices=('inherit', 'hard'), default='inherit')
    args = parser.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=False)
    result = {'schema': SCHEMA, 'status': 'error', 'device': args.device,
              'identity': identity(), 'limits_inherited': limits(), 'as_soft_mode': args.as_soft,
              'environment': {k: os.environ[k] for k in ENV_KEYS if k in os.environ}}
    try:
        if platform.system() != 'Linux' or ctypes.sizeof(ctypes.c_void_p) != 8:
            raise RuntimeError('Requires a 64-bit Linux NPU test container')
        if args.device < 0:
            raise ValueError('device must be nonnegative')
        if os.environ.get('ASCEND_RT_VISIBLE_DEVICES'):
            raise RuntimeError('ASCEND_RT_VISIBLE_DEVICES remaps device IDs; do not guess or remove isolation')
        if 'libioctl_probe' in os.environ.get('LD_PRELOAD', ''):
            raise RuntimeError('Run capability diagnosis without the benchmark ioctl probe')
        if ctypes.sizeof(SupportFeaturePara) != 16 or SupportFeaturePara.devid.offset != 8:
            raise RuntimeError('Unsupported supportFeaturePara ABI')
        if args.as_soft == 'hard':
            _, hard = resource.getrlimit(resource.RLIMIT_AS)
            resource.setrlimit(resource.RLIMIT_AS, (hard, hard))
        result['limits_effective'] = limits()
        result['features_before'] = features(args.device)
        result['base_page_size'] = os.sysconf('SC_PAGE_SIZE')
        result['driver_version_info'] = read('/usr/local/Ascend/driver/version.info')
        result['cgroup'] = read('/proc/self/cgroup')
        result['affinity'] = sorted(os.sched_getaffinity(0))
        dump(out / 'preflight.json', result)
        (out / 'maps_before.txt').write_text(read('/proc/self/maps')['text'])
        (out / 'limits.txt').write_text(read('/proc/self/limits')['text'])
        os.environ['TASK_QUEUE_ENABLE'] = '0'
        import torch
        import torch_npu
        result['torch_version'] = torch.__version__
        result['torch_npu_version'] = torch_npu.__version__
        torch_npu.npu.set_device(args.device)
        allocation = torch.empty(1, dtype=torch.int32, device='npu:%d' % args.device)
        torch_npu.npu.synchronize()
        result['device_name'] = torch_npu.npu.get_device_name(args.device)
        maps = read('/proc/self/maps')
        (out / 'maps_after.txt').write_text(maps.get('text', ''))
        if maps['status'] != 'ok':
            raise RuntimeError('Cannot identify loaded HAL from complete /proc/self/maps')
        paths = sorted({line.split()[-1] for line in maps['text'].splitlines()
                        if line.split()[-1].endswith('/libascend_hal.so')})
        if len(paths) != 1:
            raise RuntimeError('Expected one loaded libascend_hal.so; got %r' % paths)
        library_path = Path(paths[0])
        result['hal_library'] = {'path': str(library_path), 'sha256': sha256(library_path),
                                 'bytes': library_path.stat().st_size}
        selected_names = {'libascend_hal.so', 'libruntime.so', 'libascendcl.so', 'libtorch_npu.so'}
        selected = sorted({line.split()[-1] for line in maps['text'].splitlines()
                           if Path(line.split()[-1]).name in selected_names})
        result['loaded_libraries'] = {p: sha256(p) for p in selected}
        library = ctypes.CDLL(str(library_path), mode=os.RTLD_NOW | os.RTLD_NOLOAD)
        function = library.halMemCtl
        function.argtypes = [ctypes.c_int, ctypes.c_void_p, ctypes.c_size_t,
                             ctypes.c_void_p, ctypes.POINTER(ctypes.c_size_t)]
        function.restype = ctypes.c_int
        result['queries'] = [query(function, args.device, mask) for mask in (2, 8, 10)]
        result['features_after'] = features(args.device)
        result['status'] = 'ok' if all(q['return_code'] == 0 for q in result['queries']) else 'query_error'
        del allocation
    except Exception:
        result['error'] = traceback.format_exc()
    result['identity_end'] = identity()
    dump(out / 'probe.json', result)
    print('BAR_DIAG_RESULT ' + result['status'], flush=True)
    return 0 if result['status'] == 'ok' else 2


if __name__ == '__main__':
    sys.exit(main())
