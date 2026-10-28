#!/usr/bin/env python3
"""Apply a version-checked, opt-in CPU-pool patch. Does not import vLLM.
Usage: python apply_cpu_binding_patch.py [path/to/cpu_binding.py] [--check]
Enable after checking VM-to-host CPU/memory/PCI mappings with:
LOCAL_ASCEND_CPU_POOLS='{"0":"48-55","1":"56-63","2":"32-39","3":"40-47","4":"0-7","5":"8-15","6":"16-23","7":"24-31"}'
This sample assumes guest NUMA 0..3 maps to host NUMA 0..3.
Unset the variable and restart vLLM to restore automatic allocation.
Existing IRQ binding behavior is preserved. migratepages moves existing pages;
it is not a persistent memory allocation policy. Upstream may catch binding
errors and continue unbound: inspect every worker's startup logs.
"""
import argparse
import hashlib
import os
from pathlib import Path
import shutil
import tempfile

EXPECTED = '66ac806269a9e8ff4b9d4043673d364001806141c658245654809065c1b81149'
PATCHED = '1ce3ddcfe35146cce01d93940892e2e1b426e8f8dd0d157acb43365503fe3d3e'
EDITS = [('        affinity: dict[int, list[int]] = {}\n        affinity_message, _ =', '        affinity: dict[int, list[int]] = {}\n        if os.getenv("LOCAL_ASCEND_CPU_POOLS"):\n            return affinity\n        affinity_message, _ ='), ('    def build_cpu_pools(self) -> bool:\n', '    def build_explicit_cpu_pools(self, raw: str) -> bool:\n        # Local opt-in patch: keys are GLOBAL logical NPU IDs, values guest CPU lists.\n        import json\n\n        if self._uses_cluster_cpu_topology():\n            raise RuntimeError("Explicit CPU pools are not supported for cluster CPU topology.")\n        def unique_object(pairs):\n            result = {}\n            for key, value in pairs:\n                if key in result:\n                    raise ValueError(f"Duplicate NPU key: {key}")\n                result[key] = value\n            return result\n\n        config = json.loads(raw, object_pairs_hook=unique_object)\n        if not isinstance(config, dict) or not config:\n            raise ValueError("LOCAL_ASCEND_CPU_POOLS must be a non-empty JSON object.")\n        pools = {}\n        used = set()\n        known = set(self.device_info.all_logic_npus)\n        for key, value in config.items():\n            if not key.isdigit() or str(int(key)) != key or int(key) not in known:\n                raise ValueError(f"Unknown/non-canonical global logical NPU ID: {key}")\n            if not isinstance(value, str) or not DeviceInfo.is_cpu_list(value):\n                raise ValueError(f"Invalid CPU list for NPU {key}: {value!r}")\n            cpus = DeviceInfo.expand_cpu_list(value)\n            if len(cpus) != len(set(cpus)) or len(cpus) < self._min_cpus_per_npu():\n                raise ValueError(f"Duplicate or insufficient CPUs for NPU {key}: {cpus}")\n            # Reject descending ranges even when other ranges supply enough CPUs.\n            for segment in value.split(\',\'):\n                if \'-\' in segment:\n                    lo, hi = map(int, segment.split(\'-\'))\n                    if lo > hi:\n                        raise ValueError(f"Descending CPU range: {segment}")\n            if any(cpu not in self.cpu_node for cpu in cpus):\n                raise ValueError(f"Unknown guest CPU in pool for NPU {key}")\n            nodes = {self.cpu_node[cpu] for cpu in cpus}\n            if len(nodes) != 1:\n                raise ValueError(f"NPU {key} CPU pool spans NUMA nodes: {nodes}")\n            if used.intersection(cpus):\n                raise ValueError(f"Overlapping CPU pools at NPU {key}")\n            used.update(cpus)\n            pools[int(key)] = sorted(cpus)\n\n        required = set(self.device_info.running_npu_list) | {self.current_npu}\n        missing = required - pools.keys()\n        if missing:\n            raise ValueError(f"Missing explicit CPU pools for NPUs: {sorted(missing)}")\n        allowed = set(self.device_info.allowed_cpus)\n        for npu in required:\n            denied = set(pools[npu]) - allowed\n            if denied:\n                raise ValueError(f"NPU {npu} CPUs outside Cpus_allowed_list: {sorted(denied)}")\n        self.npu_cpu_pool = {npu: pools[npu] for npu in sorted(required)}\n        logger.info(\n            "[cpu_bind_mode] mode=explicit_local rank=%s npu=%s pool=%s numa=%s",\n            self.rank_id, self.current_npu, pools[self.current_npu],\n            self.cpu_node[pools[self.current_npu][0]],\n        )\n        return True\n\n    def build_cpu_pools(self) -> bool:\n'), ('        self.build_cpu_node_map()\n\n        mode = self._binding_mode()', '        self.build_cpu_node_map()\n\n        explicit_pools = os.getenv("LOCAL_ASCEND_CPU_POOLS")\n        if explicit_pools:\n            return self.build_explicit_cpu_pools(explicit_pools)\n\n        mode = self._binding_mode()'), ('        execute_command(\n            [\n                "migratepages",', '        _, migration_rc = execute_command(\n            [\n                "migratepages",'), ('                str(target_numa),\n            ]\n        )\n', '                str(target_numa),\n            ]\n        )\n        if migration_rc != 0:\n            logger.warning("[migrate] failed: pid=%s npu=%s numa=%s rc=%s", pid, npu, target_numa, migration_rc)\n')]

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('path', nargs='?', default='/vllm-workspace/vllm-ascend/vllm_ascend/cpu_binding.py')
    parser.add_argument('--check', action='store_true', help='Validate only; do not write')
    args = parser.parse_args()
    target = Path(args.path).resolve(strict=True)
    original = target.read_text()
    digest = hashlib.sha256(original.encode()).hexdigest()
    if digest == PATCHED:
        print('Already patched. No changes.')
        return
    if digest != EXPECTED:
        raise SystemExit('Source differs from supplied version; no files changed. Send the current source.')
    updated = original
    for old, new in EDITS:
        if updated.count(old) != 1:
            raise SystemExit('Patch anchor mismatch; no files changed.')
        updated = updated.replace(old, new, 1)
    compile(updated, str(target), 'exec')
    if args.check:
        print('Source matches; patched syntax valid. No changes.')
        return
    backup = target.with_name(target.name + '.before_explicit_local.bak')
    with backup.open('xb') as stream:
        stream.write(target.read_bytes())
    shutil.copystat(target, backup)
    fd, tmp = tempfile.mkstemp(prefix=target.name + '.', dir=target.parent)
    try:
        with os.fdopen(fd, 'w') as stream:
            stream.write(updated)
        shutil.copystat(target, tmp)
        stat = target.stat()
        if os.geteuid() == 0:
            os.chown(tmp, stat.st_uid, stat.st_gid)
        os.replace(tmp, target)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)
    print('Patched:', target)
    print('Backup:', backup)
    print('Default behavior unchanged until LOCAL_ASCEND_CPU_POOLS is set. Restart vLLM after configuration.')

if __name__ == '__main__':
    main()
