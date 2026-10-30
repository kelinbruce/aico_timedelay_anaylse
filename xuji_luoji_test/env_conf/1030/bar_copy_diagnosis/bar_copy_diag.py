#!/usr/bin/env python3
"""Collect evidence, diagnose the failing layer, and verify a specific BAR-copy repair.

Does not modify running services, driver feature bits, PCI mappings, or kernels.
"""
import argparse
import json
import os
from pathlib import Path
import platform
import re
import resource
import shutil
import sys
import time

from common import (SCHEMA, ENV_KEYS, dump, features, identity, limits, manifest,
                    read, run_bounded, sha256)

HERE = Path(__file__).resolve().parent
EXPECTED_MASKS = (2, 8, 10)


def load(path):
    with Path(path).open() as stream:
        return json.load(stream)


def check_integrity(root):
    entries = load(root / 'SHA256_MANIFEST.json')
    if not entries:
        raise ValueError('Empty result manifest')
    for name, entry in entries.items():
        path = (root / name).resolve()
        if path == root or root not in path.parents or not path.is_file():
            raise ValueError('Invalid manifest path: ' + name)
        if sha256(path) != entry['sha256'] or path.stat().st_size != entry['bytes']:
            raise ValueError('Result file changed or transfer damaged: ' + name)


def worker_snapshot(pid):
    base = Path('/proc') / str(pid)
    before = read(base / 'stat', 8192)
    result = {'pid': pid, 'stat_before': before, 'limits': read(base / 'limits'),
              'status': read(base / 'status'), 'cgroup': read(base / 'cgroup')}
    env = read(base / 'environ', 2 * 1024 * 1024)
    result['environment_status'] = env['status']
    result['environment_selected'] = {}
    if env['status'] == 'ok':
        for item in env['text'].split('\0'):
            key, sep, value = item.partition('=')
            if sep and key in ENV_KEYS:
                result['environment_selected'][key] = value
    maps = read(base / 'maps')
    result['maps_status'] = maps['status']
    result['hal_runtime_mapping_lines'] = [line for line in maps.get('text', '').splitlines()
                                          if re.search(r'/(libascend_hal|libruntime|libascendcl|libtorch_npu)\.so(?:\s|$)', line)]
    after = read(base / 'stat', 8192)
    result['stat_after'] = after
    def start_time(item):
        if item['status'] != 'ok':
            return None
        try:
            return item['text'].rsplit(')', 1)[1].split()[19]
        except (IndexError, ValueError):
            return None
    result['process_identity_stable'] = start_time(before) is not None and start_time(before) == start_time(after)
    return result


def capability(probe):
    """Invalid/failed/inconsistent queries are UNKNOWN, never unsupported."""
    if probe.get('status') != 'ok':
        return None
    try:
        queries = probe['queries']
        if len(queries) != 3:
            return None
        by_mask = {int(q['input_mask_hex'], 16): q for q in queries}
        if set(by_mask) != set(EXPECTED_MASKS):
            return None
        values = {}
        for mask in EXPECTED_MASKS:
            q = by_mask[mask]
            value = int(q['output_mask_hex'], 16)
            if q['return_code'] != 0 or value < 0 or value & ~mask:
                return None
            values[mask] = value
        if values[10] != (values[2] | values[8]):
            return None
        return values[10]
    except (KeyError, TypeError, ValueError):
        return None


def parse_init_logs(text, device):
    """Only direct child logs; exact device + all fields on the same record."""
    records = []
    for line in text.splitlines():
        if 'Device info.' not in line:
            continue
        fields = dict(re.findall(r'\b(devid|support_bar_mem|support_bar_huge_mem|allocated_by_malloc)=(0x[0-9a-fA-F]+|[0-9]+)\b', line))
        if set(fields) != {'devid', 'support_bar_mem', 'support_bar_huge_mem', 'allocated_by_malloc'}:
            continue
        fields = {k: int(v, 16) if v.startswith('0x') else int(v) for k, v in fields.items()}
        if fields['devid'] != device or any(fields[k] not in (0, 1) for k in fields if k != 'devid'):
            continue
        records.append({'fields': fields, 'line': line[:4096]})
    unique = {tuple(sorted(r['fields'].items())) for r in records}
    return {'status': 'ok' if len(unique) == 1 else ('conflict' if unique else 'missing'),
            'record': records[-1] if len(unique) == 1 else None, 'matched_records': len(records)}


def mmap_failures(text):
    # Syscall failure is a clue, not by itself proof that HAL selected malloc mode.
    result = []
    for line in text.splitlines():
        if re.search(r'\b(?:mmap|mremap)\(', line) and re.search(r'= -1 [A-Z]+', line):
            result.append(line[:4096])
    return result[:50]


def read_run(root, name, run_record):
    folder = root / name
    probe_file = folder / 'data' / 'probe.json'
    try:
        probe = load(probe_file) if probe_file.is_file() else {}
        if not isinstance(probe, dict):
            raise ValueError('probe.json must contain an object')
    except (OSError, ValueError) as error:
        probe = {'status': 'error', 'error': 'Incomplete or invalid probe.json: ' + str(error)}
    log = read(folder / 'process.log', 32 * 1024 * 1024)
    valid = run_record.get('status') == 'ok' and log['status'] == 'ok'
    init = parse_init_logs(log.get('text', ''), probe.get('device', -1))
    return {'name': name, 'execution': run_record, 'probe': probe,
            'mask': capability(probe) if valid else None,
            'init_log': init, 'raw_log': str(folder / 'process.log')}


def same_stack(a, b):
    keys = ('device', 'device_name', 'torch_version', 'torch_npu_version', 'base_page_size')
    if any(a.get(k) is None or a.get(k) != b.get(k) for k in keys):
        return False
    if not a.get('hal_library', {}).get('sha256') or a['hal_library']['sha256'] != b.get('hal_library', {}).get('sha256'):
        return False
    if not a.get('loaded_libraries') or a['loaded_libraries'] != b.get('loaded_libraries'):
        return False
    for key in ('kernel', 'machine'):
        if not a.get('identity', {}).get(key) or a['identity'][key] != b.get('identity', {}).get(key):
            return False
    av, bv = a.get('driver_version_info', {}), b.get('driver_version_info', {})
    return av.get('status') == bv.get('status') == 'ok' and av.get('text') == bv.get('text')


def aba_verified(runs):
    if not all(n in runs for n in ('A0', 'B1', 'A1')):
        return False
    a, b, c = (runs[n] for n in ('A0', 'B1', 'A1'))
    if a['mask'] != 0 or b['mask'] not in (2, 8, 10) or c['mask'] != 0:
        return False
    ap, bp, cp = (r['probe'] for r in (a, b, c))
    if not same_stack(ap, bp) or not same_stack(ap, cp):
        return False
    if ap.get('environment') != bp.get('environment') or ap.get('environment') != cp.get('environment'):
        return False
    for key in ('boot_id', 'namespaces'):
        if ap['identity'].get(key) != bp['identity'].get(key) or ap['identity'].get(key) != cp['identity'].get(key):
            return False
    if ap['identity'].get('boot_id', {}).get('status') != 'ok':
        return False
    if not all(ap['identity'].get('namespaces', {}).get(k) for k in ('pid', 'mnt', 'user')):
        return False
    if not ap.get('affinity') or ap['affinity'] != bp.get('affinity') or ap['affinity'] != cp.get('affinity'):
        return False
    if ap.get('as_soft_mode') != 'inherit' or cp.get('as_soft_mode') != 'inherit' or bp.get('as_soft_mode') != 'hard':
        return False
    al, bl, cl = (p.get('limits_effective', {}) for p in (ap, bp, cp))
    if al != cl or not all(k in al and k in bl for k in ('RLIMIT_AS', 'RLIMIT_DATA', 'RLIMIT_STACK')):
        return False
    if al['RLIMIT_AS'][0] == -1 or al['RLIMIT_AS'][0] == bl['RLIMIT_AS'][0]:
        return False
    return (al['RLIMIT_AS'][1] == bl['RLIMIT_AS'][1] == bl['RLIMIT_AS'][0]
            and al['RLIMIT_DATA'] == bl['RLIMIT_DATA'] and al['RLIMIT_STACK'] == bl['RLIMIT_STACK'])


def decide(runs):
    result = {'code': 'INSUFFICIENT_EVIDENCE', 'repairability': '未证实；不能据此判定不可修复或必须厂商补丁',
              'conclusion': '', 'actions': [], 'missing': [], 'evidence': [],
              'scope': 'BAR-copy 能力及初始化关闭层；不是业务性能或实际 BAR-copy 路径证明'}
    a = runs.get('A0', {})
    mask = a.get('mask')
    if mask is None:
        result.update(code='INVALID_COLLECTION', conclusion='本轮能力查询无效，不能判断是否支持 BAR-copy。',
                      actions=['先处理 A0/process.log、A0/data/probe.json 中的查询/初始化错误；不要将失败当成能力为零。'])
        return result
    result['evidence'].append('A0 三种请求一致，最终支持位为 ' + hex(mask))
    fv = a.get('probe', {}).get('features_after', {}).get('values', {})
    result['evidence'].append('同进程可见 /proc/svm 能力节点：bar_mem=%s，bar_mem_huge=%s（None 表示未知；仅为辅助证据）'
                              % (fv.get('bar_mem'), fv.get('bar_mem_huge')))
    if mask:
        result.update(code='CAPABILITY_AVAILABLE', repairability='当前测试进程已报告支持，无需修复“能力为零”',
                      conclusion='本轮未复现 BAR-copy 能力缺失。',
                      actions=['保持当前配置；若业务仍走 DMA，检查业务 worker 的实际 HAL、copy policy、argsSize 和分配回退。',
                               '使用包内 performance 工具及原业务压测验证路径和性能，不能只凭支持位宣告 gap 消失。'])
        return result
    if aba_verified(runs):
        result.update(code='AS_LIMIT_FIX_VERIFIED', repairability='已在当前栈的测试子进程验证可以恢复能力',
                      conclusion='仅放宽测试进程 RLIMIT_AS 后能力恢复，恢复原限制后再次为零；A/B/A 通过。',
                      actions=['核对业务 worker 的 /proc/<PID>/limits 是否有同样的 Max address space 限制。',
                               '在实际施加限制的服务启动器/容器启动配置中调整该项软限制，使其满足所需虚拟地址映射；不要把虚拟地址空间大小当作物理内存需求。',
                               '维护窗口重启对应业务进程后重新采集并执行 verify；无需因本证据升级 HAL/驱动。',
                               '随后验证实际参数复制路径、无探针微基准和原业务 E2E，能力恢复不等于性能 gap 已消除。'])
        result['evidence'].append('A0=0，B1=' + hex(runs['B1']['mask']) + '，A1=0；栈、环境和其余资源限制一致')
        return result
    init = a.get('init_log', {})
    if init.get('status') == 'conflict':
        result['conclusion'] = '同一测试进程的目标设备初始化日志互相冲突，无法确定关闭层。'
        result['missing'] = ['核对设备重初始化、日志格式与设备编号；保留完整日志，不能挑选某一条作为结论。']
        return result
    if init.get('status') == 'ok':
        f = init['record']['fields']
        result['evidence'].append(init['record']['line'])
        input_mask = f['support_bar_mem'] * 2 + f['support_bar_huge_mem'] * 8
        if input_mask and f['allocated_by_malloc'] == 1:
            result.update(code='HAL_FALLBACK_IDENTIFIED',
                          conclusion='初始化日志显示 Guest 内核输入能力非零，HAL 使用 malloc 分配模式，最终能力为零。',
                          repairability='关闭层已定位到 HAL 初始化；恢复能力尚未验证',
                          actions=['优先检查同进程 mmap.strace、maps_before.txt 和 limits.txt 中的 SVM 映射失败。',
                                   '若 Max address space 有限且硬限制允许，执行 --test-as-limit 的受控 A/B/A。',
                                   '按实际失败原因处理地址空间冲突、资源限制或初始化适配；不因这条证据先修改 KVM/WC。',
                                   '修复后新建测试进程，并用 verify 验证能力恢复；失败 errno 本身不足以指定修复。'],
                          missing=['SVM 必需映射失败的具体地址/长度/errno；已实施修复后的能力结果'])
        elif input_mask == 0:
            result.update(code='GUEST_DRIVER_GATE_IDENTIFIED',
                          conclusion='HAL 初始化时收到的 Guest 内核能力已经为零，能力缺失至少已发生在 HAL 之前。',
                          repairability='Guest 驱动/设备能力层待进一步判定；尚不能断言需要补丁',
                          actions=['在虚机系统（容器外）运行 kernel 子命令，收集当前内核能力节点、模块身份和初始化日志。',
                                   '核对原始设备 feature_bar_mem、host_run_mode、devdrv_get_bar_wc_flag 返回码及输出值、BAR4 0x10 位、禁用状态。',
                                   '若仅未发布能力且映射已受支持，处理能力发布/初始化；若真实映射条件不满足，再由宿主维护方评估 KVM/VFIO 修复。'],
                          missing=['原始设备能力、WC getter 返回码与完整 flag、禁用状态、页大小，以及与当前二进制匹配的实现'])
            if f['allocated_by_malloc'] == 1:
                result['actions'].append('同时存在 malloc 回退；即使修复 Guest 内核能力，HAL 回退也需独立消除。')
        else:
            result.update(code='HAL_CAPABILITY_MISMATCH',
                          conclusion='初始化输入能力非零且未记录 malloc 回退，但最终查询为零；与参考链路不一致。',
                          actions=['核对当前 HAL 的实际实现、能力缓存、设备编号和初始化顺序；不要强套参考源码判断。'],
                          missing=['匹配当前 HAL 的缓存值与查询实现'])
    else:
        result['conclusion'] = '能力为零已复现，但当前日志未提供足够字段区分 HAL 与 Guest 内核关闭层。'
        result['actions'] = ['查看 A0/process.log 是否包含驱动初始化信息；日志选项不保证此构建输出所有字段。',
                             '在虚机系统运行 kernel 子命令；将交接清单与完整结果交给当前驱动维护方补取指定字段。',
                             '先停止重复相同微基准；缺少诊断接口不等于当前平台不支持 WC。']
        result['missing'] = ['同进程初始化的 support_bar_mem、support_bar_huge_mem、allocated_by_malloc，或等价的当前构建诊断字段']
    if 'B1' in runs:
        result['evidence'].append('RLIMIT_AS 对照未满足严格 A/B/A 验收；不能据此声称该修复有效，也不能排除其他修复。')
    return result


def write_report(out, result, details):
    dump(out / '结论.json', dict(result, details=details))
    lines = ['# BAR-copy 定位结论', '', '**判定：' + result['code'] + '**', '',
             result['conclusion'], '', '**能否修复：** ' + result['repairability'], '',
             '**结论范围：** ' + result['scope'], '', '## 证据', '']
    lines += ['- ' + s for s in result.get('evidence', [])] or ['- 尚无有效证据。']
    lines += ['', '## 修复或下一步动作', '']
    lines += [str(i + 1) + '. ' + s for i, s in enumerate(result.get('actions', []))]
    if result.get('missing'):
        lines += ['', '## 尚缺证据', ''] + ['- ' + s for s in result['missing']]
    if details.get('collection'):
        c = details['collection']
        lines += ['', '## 采集完整性', '', '- 主流程状态：' + c.get('status', 'unknown'),
                  '- RLIMIT_AS 实验：' + c.get('as_trial', 'unknown'),
                  '- mmap 追踪：' + c.get('trace', 'unknown')]
        for name, run in c.get('runs', {}).items():
            lines.append('- %s：%s；退出码=%s' % (name, run.get('status'), run.get('returncode')))
        if c.get('worker_snapshot'):
            lines += ['- 已附指定业务 worker 的限制、库映射和选定环境变量。请与 A0/data/limits.txt 对照；测试进程不会自动继承该 worker 的配置。']
        else:
            lines += ['- 未指定 --worker-pid：当前结论仅针对新测试进程，不能直接代表已运行的业务 worker。']
    lines += ['', '诊断日志和 strace 有扰动，本包不把这些窗口当作性能验收。',
              '公开参考源码的分支只用于设计检查点；未知版本、缺失接口、历史日志或零捕获不会自动升级为根因。', '']
    (out / '结论.md').write_text('\n'.join(lines))
    handoff = ['# 当前版本驱动诊断交接清单', '', '现场结果目录：' + str(out), '',
               '当前自动判定：' + result['code'], '',
               '请在同一设备、当前 HAL/Guest 驱动构建上提供以下字段，并附原始输出、采集时间和二进制对应关系：', '',
               '1. HAL：内核输入的 support_bar_mem/support_bar_huge_mem、allocated_by_malloc、最终缓存和设备编号。',
               '2. Guest 驱动：原始 feature_bar_mem，host_run_mode，host_page_size/device_page_size，两项最终能力及 disable 状态。',
               '3. WC：devdrv_get_bar_wc_flag 的返回码、输出值及 BAR4 0x10 位；若为零，说明赋值者和初始化/更新时序。',
               '4. 若需要宿主修复：证明对应 BAR4 范围的有效映射条件，区分“映射不支持”和“支持但能力未发布”。',
               '5. 给出当前版本可实施的配置调整/修复补丁及回退方式；若不能修复，提供具体不支持条件，不仅提供版本号。', '',
               '禁止用强制 capability=1、写 BAR、只看 Prefetchable/resource_wc 或缺少调试接口替代上述证据。', '']
    (out / '驱动诊断交接清单.md').write_text('\n'.join(handoff))


def analyze(root, out, kernel=None):
    collection = load(root / 'collection.json')
    if collection.get('schema') != SCHEMA or collection.get('kind') != 'guest':
        raise ValueError('Expected a guest collection produced by this bundle')
    runs = {n: read_run(root, n, r) for n, r in collection['runs'].items()}
    result = decide(runs)
    details = {'collection': collection, 'runs': runs}
    if kernel is not None:
        k = load(Path(kernel) / 'kernel.json')
        if k.get('schema') != SCHEMA or k.get('kind') != 'guest_kernel':
            raise ValueError('Expected a Guest-OS kernel snapshot from this tool')
        details['guest_kernel_snapshot'] = k
        a = runs.get('A0', {}).get('probe', {})
        same_boot = (a.get('identity', {}).get('boot_id', {}).get('status') == 'ok'
                     and a['identity']['boot_id'] == k.get('identity', {}).get('boot_id'))
        matching = (same_boot and a.get('identity', {}).get('kernel') == k.get('identity', {}).get('kernel')
                    and a.get('device') == k.get('device'))
        details['kernel_snapshot_same_boot_kernel_and_device_number'] = matching
        if matching:
            result['evidence'].append('已附同一启动周期、同内核和同编号的 Guest 内核快照；容器设备映射仍需核对，历史日志不自动定因。')
        else:
            result['missing'].append('附加 Guest 内核快照与测试进程的启动周期/内核/设备编号不匹配，不能用于本轮归因。')
    trace = root / 'TRACE' / 'mmap.strace'
    if trace.is_file():
        data = read(trace, 32 * 1024 * 1024)
        details['mmap_failures_clues_only'] = mmap_failures(data.get('text', ''))
        details['trace_read_status'] = data['status']
    write_report(out, result, details)
    return result


def new_output(path):
    out = Path(path).expanduser().resolve()
    out.mkdir(parents=True, exist_ok=False)
    return out


def collect_guest(args):
    out = new_output(args.out)
    collection = {'schema': SCHEMA, 'kind': 'guest', 'status': 'collecting',
                  'role_declared_by_operator': args.role, 'device': args.device,
                  'identity': identity(), 'limits': limits(), 'runs': {},
                  'logging_changes': {'ASCEND_GLOBAL_LOG_LEVEL': '0', 'ASCEND_SLOG_PRINT_TO_STDOUT': '1',
                                      'ASCEND_MODULE_LOG_LEVEL': 'removed in test children only'},
                  'environment_original': {k: os.environ[k] for k in ENV_KEYS if k in os.environ},
                  'tool_sha256': {name: sha256(HERE / name) for name in
                                 ('bar_copy_diag.py', 'common.py', 'guest_probe.py', 'query_copy_capability.py')},
                  'as_trial': 'not_requested', 'trace': 'not_requested'}
    if args.worker_pid is not None:
        collection['worker_snapshot'] = worker_snapshot(args.worker_pid)
    dump(out / 'collection.json', collection)
    if platform.system() != 'Linux':
        collection.update(status='preflight_failed', error='Collect on Linux inside the original NPU test container; this Mac is only for analysis.')
        dump(out / 'collection.json', collection)
        analyze(out, out)
        dump(out / 'SHA256_MANIFEST.json', manifest(out))
        return 3
    env = dict(os.environ)
    env.update(ASCEND_GLOBAL_LOG_LEVEL='0', ASCEND_SLOG_PRINT_TO_STDOUT='1', TASK_QUEUE_ENABLE='0')
    env.pop('ASCEND_MODULE_LOG_LEVEL', None)

    def one(name, mode='inherit', trace=False):
        folder = out / name
        folder.mkdir()
        cmd = [sys.executable, str(HERE / 'guest_probe.py'), '--device', str(args.device),
               '--out', str(folder / 'data'), '--as-soft', mode]
        trace_path = folder / 'mmap.strace'
        if trace:
            cmd = ['strace', '-f', '-qq', '-ttt', '-e', 'trace=mmap,mremap,munmap,brk',
                   '-o', str(trace_path)] + cmd
        record = run_bounded(cmd, folder / 'process.log', timeout=args.timeout,
                             max_bytes=args.max_mib * 1024 * 1024, env=env,
                             extra_files=[trace_path] if trace else [])
        collection['runs'][name] = record
        dump(out / 'collection.json', collection)
        return read_run(out, name, record)

    try:
        a = one('A0')
        if args.test_as_limit:
            soft, hard = collection['limits']['RLIMIT_AS']
            if a['mask'] != 0:
                collection['as_trial'] = 'skipped: baseline invalid or already supported'
            elif soft == resource.RLIM_INFINITY or soft == hard:
                collection['as_trial'] = 'skipped: no higher existing hard limit; no system limit is changed'
            else:
                collection['as_trial'] = 'attempted: raise child soft limit to its existing hard limit'
                one('B1', 'hard')
                one('A1')
        if args.mmap_trace == 'auto' and a['mask'] == 0:
            if shutil.which('strace'):
                collection['trace'] = 'attempted in separate TRACE process'
                one('TRACE', trace=True)
            else:
                collection['trace'] = 'unavailable: strace not installed; no packages installed by tool'
        collection['status'] = 'complete'
    except KeyboardInterrupt:
        collection['status'] = 'interrupted'
    except Exception as error:
        collection.update(status='error', error=repr(error))
    finally:
        dump(out / 'collection.json', collection)
        result = analyze(out, out)
        dump(out / 'SHA256_MANIFEST.json', manifest(out))
    print(result['code'] + ': ' + str(out / '结论.md'))
    return 3 if result['code'] == 'INVALID_COLLECTION' else 0


def collect_kernel(args):
    out = new_output(args.out)
    meta = {'schema': SCHEMA, 'kind': 'guest_kernel', 'identity': identity(),
            'device': args.device, 'features': features(args.device), 'commands': {},
            'evidence_scope': 'Current read-only snapshot; historical dmesg is not correlated to a fresh HAL process.'}
    if platform.system() != 'Linux':
        dump(out / 'kernel.json', dict(meta, status='invalid_platform'))
        return 3
    commands = {'virtualization': ['systemd-detect-virt', '--vm'],
                'dmesg': ['dmesg'], 'lsmod': ['lsmod'], 'npu_smi': ['npu-smi', 'info']}
    for name, cmd in commands.items():
        meta['commands'][name] = run_bounded(cmd, out / (name + '.log'), timeout=20, max_bytes=8*1024*1024)
    for name, path in [('cmdline', '/proc/cmdline'), ('version', '/proc/version'),
                       ('driver_version', '/usr/local/Ascend/driver/version.info')]:
        meta[name] = read(path)
    symbols = []
    try:
        with open('/proc/kallsyms') as stream:
            for line in stream:
                if re.search(r'\b(devdrv_get_bar_wc_flag(?:_inner)?|devdrv_set_bar_wc_flag(?:_inner)?|devmm_set_dev_capability|devmm_is_support_wc_scene)\b', line):
                    fields = line.split()
                    symbols.append(' '.join(fields[1:]))
        meta['symbols'] = {'status': 'ok', 'entries': symbols}
    except OSError as error:
        meta['symbols'] = {'status': 'unavailable', 'error': str(error)}
    modules = []
    for line in read('/proc/modules').get('text', '').splitlines():
        name = line.split()[0]
        if re.search(r'devmm|devdrv|ascend|drv_pcie|svm', name, re.I):
            modules.append(name)
            meta['commands']['modinfo_' + name] = run_bounded(['modinfo', name], out / ('modinfo_' + name + '.log'), timeout=10)
    meta['module_names'] = modules
    meta['status'] = 'complete_with_availability_recorded'
    dump(out / 'kernel.json', meta)
    (out / '说明.md').write_text('# Guest 内核快照\n\n此目录在虚机系统、容器外采集。\n\n'
        'feature 节点缺失不是不支持；节点读取值已包含驱动判断，不能单独读出 WC 原始 flag 或 disable 原因。\n'
        '符号存在只说明后续有诊断入口；符号不存在不能证明对应功能不存在。\n'
        'dmesg 是本次启动历史日志，不自动关联 A0 进程，也不能单凭旧日志给本轮定因。\n'
        '请与 guest 结果一起提供；未读取或修改任何 KVM Stage-2/PCI BAR。\n')
    dump(out / 'SHA256_MANIFEST.json', manifest(out))
    print(str(out / 'kernel.json'))
    return 0


def verify(args):
    out = new_output(args.out)
    before, after = Path(args.before).resolve(), Path(args.after).resolve()
    check_integrity(before)
    check_integrity(after)
    bc, ac = load(before / 'collection.json'), load(after / 'collection.json')
    if any(c.get('schema') != SCHEMA or c.get('kind') != 'guest' for c in (bc, ac)):
        raise ValueError('verify requires two guest collections from this bundle')
    b, a = (read_run(root, 'A0', col.get('runs', {}).get('A0', {}))
            for root, col in ((before, bc), (after, ac)))
    result = {'code': 'REPAIR_NOT_VERIFIED', 'conclusion': '本组修复前后结果尚未证明恢复 BAR-copy 能力。',
              'repairability': '未验证成功', 'scope': '仅验证能力恢复；实际路径和性能须另验收',
              'evidence': ['实施动作（操作者记录）：' + args.change_note], 'actions': [], 'missing': []}
    details = {'before': str(before), 'after': str(after), 'before_mask': b['mask'], 'after_mask': a['mask'],
               'same_stack': same_stack(b['probe'], a['probe'])}
    same_machine = (b['probe'].get('identity', {}).get('machine_id', {}).get('status') == 'ok'
                    and b['probe']['identity']['machine_id'] == a['probe'].get('identity', {}).get('machine_id'))
    # In containers machine-id can be image-local: same boot is additionally required.
    same_boot = (b['probe'].get('identity', {}).get('boot_id', {}).get('status') == 'ok'
                 and b['probe']['identity']['boot_id'] == a['probe'].get('identity', {}).get('boot_id'))
    if b['mask'] is None or a['mask'] is None:
        result['missing'].append('有效且一致的 before/after 能力查询')
    elif b['mask'] == 0 and a['mask'] in (2, 8, 10):
        if same_machine and same_boot and details['same_stack'] and bc.get('role_declared_by_operator') == ac.get('role_declared_by_operator'):
            result.update(code='CAPABILITY_RESTORED_SAME_STACK', conclusion='同一启动周期、同一记录的软件栈中，修复后测试进程的 BAR-copy 能力已恢复。',
                          repairability='本组前后结果验证能力可恢复；单组结果不证明唯一因果')
        else:
            result.update(code='CAPABILITY_RESTORED_COMPARABILITY_LIMITED', conclusion='after 能力非零，但机器/启动周期或软件栈不可直接对应。',
                          repairability='能力恢复已观测；不能据此宣称当前版本的指定改动是原因')
        result['actions'] = ['记录并复测实际实施的改动，必要时回退再现 before。',
                             '检查业务 worker 是否同样恢复；执行 performance 工具及原业务测试，验收实际路径与性能。']
    else:
        result['actions'] = ['按照 after/结论.md 继续定位；能力未从零变为非零，不宣告修复完成。']
    write_report(out, result, details)
    dump(out / 'SHA256_MANIFEST.json', manifest(out))
    print(result['code'] + ': ' + str(out / '结论.md'))
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    guest = sub.add_parser('guest', help='Run INSIDE the VM torch_npu test container')
    guest.add_argument('--out', required=True)
    guest.add_argument('--device', type=int, default=0)
    guest.add_argument('--role', choices=('vm-container', 'bare-container'), default='vm-container')
    guest.add_argument('--worker-pid', type=int, help='Optional business worker PID visible in this container; snapshot only')
    guest.add_argument('--test-as-limit', action='store_true', help='Only in test children: A/B/A with soft RLIMIT_AS raised to existing hard limit')
    guest.add_argument('--mmap-trace', choices=('auto', 'off'), default='auto')
    guest.add_argument('--timeout', type=int, default=120)
    guest.add_argument('--max-mib', type=int, default=32)
    kernel = sub.add_parser('kernel', help='Read-only snapshot on Guest OS OUTSIDE containers, not on KVM host')
    kernel.add_argument('--device', type=int, default=0)
    kernel.add_argument('--out', required=True)
    analysis = sub.add_parser('analyze', help='Rebuild report from a collected guest directory, no NPU access')
    analysis.add_argument('--input', required=True)
    analysis.add_argument('--out', required=True)
    analysis.add_argument('--kernel', help='Optional Guest-OS kernel snapshot directory, not a KVM host result')
    verification = sub.add_parser('verify', help='Compare before/after A0 results following an actual repair')
    verification.add_argument('--before', required=True)
    verification.add_argument('--after', required=True)
    verification.add_argument('--change-note', required=True)
    verification.add_argument('--out', required=True)
    args = parser.parse_args()
    if getattr(args, 'device', 0) < 0:
        parser.error('--device must be nonnegative')
    if getattr(args, 'worker_pid', None) is not None and args.worker_pid < 1:
        parser.error('--worker-pid must be positive')
    if hasattr(args, 'timeout') and not 10 <= args.timeout <= 300:
        parser.error('--timeout must be 10..300 seconds per subprocess')
    if hasattr(args, 'max_mib') and not 1 <= args.max_mib <= 64:
        parser.error('--max-mib must be 1..64')
    try:
        if args.command == 'guest':
            return collect_guest(args)
        if args.command == 'kernel':
            return collect_kernel(args)
        if args.command == 'verify':
            return verify(args)
        check_integrity(Path(args.input).resolve())
        if args.kernel:
            check_integrity(Path(args.kernel).resolve())
        out = new_output(args.out)
        result = analyze(Path(args.input).resolve(), out, args.kernel)
        dump(out / 'SHA256_MANIFEST.json', manifest(out))
        print(result['code'] + ': ' + str(out / '结论.md'))
        return 0
    except (OSError, ValueError, KeyError, json.JSONDecodeError) as error:
        print('ERROR: ' + str(error), file=sys.stderr)
        return 3


if __name__ == '__main__':
    sys.exit(main())
