"""Bounded, read-only helpers for the BAR-copy diagnostic bundle (Python 3.9+)."""
import hashlib
import json
import os
from pathlib import Path
import platform
import resource
import selectors
import signal
import subprocess
import time

SCHEMA = 1
ENV_KEYS = (
    'ASCEND_RT_VISIBLE_DEVICES', 'ASCEND_VISIBLE_DEVICES', 'ASCEND_DEVICE_ID',
    'LD_PRELOAD', 'LD_LIBRARY_PATH', 'PYTHONPATH', 'TASK_QUEUE_ENABLE',
    'ASCEND_GLOBAL_LOG_LEVEL', 'ASCEND_MODULE_LOG_LEVEL',
    'ASCEND_SLOG_PRINT_TO_STDOUT', 'ASCEND_PROCESS_LOG_PATH', 'OMP_NUM_THREADS',
)


def dump(path, value):
    Path(path).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')


def read(path, limit=262144):
    try:
        with Path(path).open('rb') as stream:
            data = stream.read(limit + 1)
        return {'status': 'truncated' if len(data) > limit else 'ok',
                'text': data[:limit].decode('utf-8', 'replace'), 'path': str(path)}
    except OSError as error:
        return {'status': 'unavailable', 'error': str(error), 'path': str(path)}


def sha256(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for data in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(data)
    return h.hexdigest()


def identity():
    return {'kernel': platform.release(), 'machine': platform.machine(),
            'boot_id': read('/proc/sys/kernel/random/boot_id', 128),
            'machine_id': read('/etc/machine-id', 128),
            'pid': os.getpid(), 'wall_time_ns': time.time_ns(),
            'monotonic_ns': time.monotonic_ns(),
            'namespaces': {n: ns_link(n) for n in ('pid', 'mnt', 'user')}}


def ns_link(name):
    try:
        return os.readlink('/proc/self/ns/' + name)
    except OSError:
        return None


def limits():
    return {name: list(resource.getrlimit(getattr(resource, name)))
            for name in ('RLIMIT_AS', 'RLIMIT_DATA', 'RLIMIT_STACK')}


def features(device):
    # Reference driver exposes /proc/svm/dev<logical-id>/feature/*.
    # Absence is UNKNOWN. Never write these nodes (they can alter feature state).
    base = Path('/proc/svm') / ('dev%d' % device)
    result = {'source': 'reference_proc_interface', 'device': device,
              'values': {}, 'files': {}}
    for key in ('bar_mem', 'bar_mem_huge'):
        item = read(base / 'feature' / key, 128)
        result['files'][key] = item
        text = item.get('text', '').strip()
        result['values'][key] = int(text) if item['status'] == 'ok' and text in ('0', '1') else None
    result['summary'] = read(base / 'summary')
    return result


def run_bounded(argv, log, timeout=120, max_bytes=32 * 1024 * 1024,
                env=None, extra_files=()):
    """No shell; stop our process group on timeout/log overflow/interruption."""
    started = time.monotonic()
    record = {'argv': list(argv), 'status': 'error', 'timeout_seconds': timeout,
              'max_log_bytes': max_bytes}
    proc = None
    selector = selectors.DefaultSelector()
    reason = None
    total = 0
    try:
        with Path(log).open('xb') as output:
            proc = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                    env=env, start_new_session=True)
            os.set_blocking(proc.stdout.fileno(), False)
            selector.register(proc.stdout, selectors.EVENT_READ)
            while selector.get_map() or proc.poll() is None:
                if time.monotonic() - started > timeout:
                    reason = 'timeout'
                    break
                extra_size = sum(Path(p).stat().st_size for p in extra_files if Path(p).is_file())
                if total + extra_size >= max_bytes:
                    reason = 'output_limit'
                    break
                for key, _ in selector.select(timeout=0.1):
                    data = os.read(key.fileobj.fileno(), 65536)
                    if not data:
                        selector.unregister(key.fileobj)
                        continue
                    remaining = max_bytes - total - extra_size
                    output.write(data[:max(0, remaining)])
                    total += len(data)
                    if len(data) > remaining:
                        reason = 'output_limit'
                        break
                if reason:
                    break
            if reason:
                record['cleanup_complete'] = kill_group(proc)
            record['returncode'] = proc.wait(timeout=5)
            record['status'] = reason or ('ok' if proc.returncode == 0 else 'failed')
    except KeyboardInterrupt:
        reason = 'interrupted'
        record['status'] = reason
        raise
    except (OSError, subprocess.SubprocessError) as error:
        record['error'] = str(error)
        if reason:
            record['status'] = reason
    finally:
        if proc is not None:
            if proc.poll() is None or reason:
                record['cleanup_complete'] = kill_group(proc)
            if proc.stdout:
                proc.stdout.close()
        selector.close()
        record['duration_seconds'] = time.monotonic() - started
        record['output_bytes'] = total
    return record


def kill_group(proc):
    try:
        os.killpg(proc.pid, signal.SIGTERM)
    except ProcessLookupError:
        return proc.poll() is not None
    try:
        proc.wait(timeout=2)
    except subprocess.TimeoutExpired:
        pass
    # A descendant may still hold the stdout pipe after the leader exits.
    try:
        os.killpg(proc.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    try:
        proc.wait(timeout=5)
        return True
    except subprocess.TimeoutExpired:
        return False


def manifest(root):
    root = Path(root)
    return {str(p.relative_to(root)): {'sha256': sha256(p), 'bytes': p.stat().st_size}
            for p in sorted(root.rglob('*')) if p.is_file() and not p.is_symlink()
            and p.name != 'SHA256_MANIFEST.json'}
