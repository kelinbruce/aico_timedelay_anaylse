HCCL 实现变化采集：环境1的48 vCPU虚机
日期：2026-11-09

当前执行入口：仅虚机、暂不启动服务
用户最新说明：当前看起来没有容器，部署环境与之前不同；机器上可能已有其他服务运行。
按虚机内直接部署采集，暂不执行后文Docker、启动服务、peer查询或通信域探针步骤。
此前“同一容器镜像”的假设不再适用。物理宿主机和8张卡沿用用户此前说明，但软件栈必须重新核对。

将脚本放到虚机的/tmp/hccl_diag，使用当前推理软件环境的Python执行（无需启动推理）：

python3 /tmp/hccl_diag/hccl_collect_static.py \
  --layer guest --label env1_48_direct \
  --out /tmp/hccl48_direct_guest
tar -C /tmp -czf /tmp/hccl48_direct_guest.tgz hccl48_direct_guest

不要传--container，不需要docker exec，也不需要再跑一次--layer container。
--layer guest同样采集当前Python环境的软件包版本和选定源码；它不是只采集硬件。
如果推理软件装在venv/conda环境中，用该环境Python的完整路径替换python3。
若暂不清楚使用哪个Python，可以先采集，保留输出中的python字段；缺失包不代表其他环境也没有安装。
源码在自定义目录时，可追加--source-root /实际vllm目录 --source-root /实际vllm-ascend目录。
先提供hccl48_direct_guest.tgz。静态版本信息不能替代实际进程加载的HCCL库，也不能证明原144核容器的通信域配置。
现有其他服务的运行时材料必须单独标记，不能作为目标模型复现结果。

以下保留完整分层参考流程：仅在对应环境/空闲条件满足时使用，并非当前需要全部执行的步骤。

已知前提
用户此前确认48核和144 vCPU版本使用同一宿主机、同一组8张NPU；最新说明当前没有容器，软件栈待重新核实。
48核可以先做本轮定位，无须等待144版本恢复。比较目标是“实际选了哪个通信实现、为什么”，不是48核的绝对时延。
仍要记录Guest PCI地址、透传映射、驱动、安装路径和进程库；存在容器时另外记录容器挂载。
现有144核证据：全部8个rank由旧AIV kernel变成Reduce_Inline/Memcpy/Notify；不能称作已证实的物理链路变慢。

文件说明
hccl_collect_static.py：Host/Guest/容器静态采集。只读查询；不import torch、不运行NPU计算。
hccl_runtime_snapshot.py：在服务运行时读取全部worker的环境子集、线程亲和性、实际映射库路径及SHA256。
hccl_peer_query.py：可选，空闲时查询可见NPU的peer-access能力。会导入torch并可能初始化运行时，不做带宽测试。
run_hccl_logged.sh：在容器内用HCCL DEBUG日志启动原服务脚本。不会设置HCCL模式、算法、绑核或LD_LIBRARY_PATH。
pg_probe/：可选Python通信域探针，记录init_process_group/new_group传入选项，不修改参数或返回值。
test_hccl_diag.py：本地功能检查；不是NPU实测。

准备
将zip解压到Guest的/tmp，使脚本位于/tmp/hccl_diag/。宿主机能进入时也放一份。
以下vm_test替换为实际容器名，/实际路径/start_48.sh替换为48核可以正常运行的脚本。
使用启动vLLM时同一Python环境执行容器采集器。
保持原模型、TP8/EP、AIV设置、CANN、graph配置不变；先不要同时修jemalloc、换库、清缓存、改算法。
48核必须移除不适用的144核显式CPU池/taskset/numactl CPU列表；这是48核的必要适配，要保存实际脚本。
若仅按6核/卡分配，2个IRQ核+ACL/release各1核后main仅剩2核，时延明显受CPU配置影响是可能的。

1. 宿主机采集（有权限时做；没有也可以先做第2步）

virsh list --all
sudo python3 /tmp/hccl_diag/hccl_collect_static.py \
  --layer host --label env1_48 --domain 实际48核虚机域名 \
  --out /tmp/hccl48_host
sudo tar -C /tmp -czf /tmp/hccl48_host.tgz hccl48_host

包含：宿主机CPU/NUMA、libvirt运行及持久XML、NPU/PCIe拓扑、板卡标识、HCCS状态、驱动版本。
默认物理卡ID 0..7、chip ID=0；若npu-smi info -m显示不同编号，用--device-ids ... / --chip-id ...指定。
透传后宿主机npu-smi可能无法查询已交给VFIO的设备。保留错误即可，不解绑设备、不重新加载驱动。
Guest不重复执行已知不支持的npu-smi topo；宿主机查询失败也不等于HCCL拓扑错误。

2. Guest采集和脚本放入容器

sudo python3 /tmp/hccl_diag/hccl_collect_static.py \
  --layer guest --label env1_48 --container vm_test --out /tmp/hccl48_guest
docker exec vm_test mkdir -p /tmp/hccl_diag
docker cp /tmp/hccl_diag/. vm_test:/tmp/hccl_diag/
docker exec -it vm_test bash

从此处到第5步均在容器内执行。输出目录固定用/tmp/hccl48；重做时换新的目录，避免覆盖。

3. 容器静态信息和可选peer能力查询（服务未占用NPU时）

python3 /tmp/hccl_diag/hccl_collect_static.py \
  --layer container --label env1_48 --out /tmp/hccl48/static

若源码不在/vllm-workspace/vllm和/vllm-workspace/vllm-ascend：
追加--source-root /实际vllm仓库 --source-root /实际vllm-ascend仓库。

可选peer查询：在服务空闲、使用相同Python/CANN/可见卡设置的shell执行：

python3 /tmp/hccl_diag/hccl_peer_query.py \
  > /tmp/hccl48/peer.json 2> /tmp/hccl48/peer.stderr

这只是运行时报告的能力矩阵，不是HCCL选路或带宽测量。error与False分开记录。
如果可见卡数不是8，或者可见设备设置与worker不同，暂不比较该矩阵。

4. 终端A：用原48核脚本启动，采集HCCL日志

bash /tmp/hccl_diag/run_hccl_logged.sh \
  /tmp/hccl48/runA /实际路径/start_48.sh

包装器设置的日志变量如下，必须在vLLM进程启动前生效：
ASCEND_PROCESS_LOG_PATH=/tmp/hccl48/runA/plog
ASCEND_GLOBAL_LOG_LEVEL=3
ASCEND_MODULE_LOG_LEVEL=HCCL=0
ASCEND_SLOG_PRINT_TO_STDOUT=0

启动脚本必须以前台方式运行vllm，不要自行nohup/后台化或把控制台日志重定向到别处。
如果原脚本内部覆盖这些日志变量，先在该脚本vllm serve前设置同样的值。
DEBUG日志可能影响时延，只短时运行诊断请求；不要把本次性能作为48/144/裸机对比基线。
服务启动、预热后，先在另一终端保存初始化日志副本：
cp -a /tmp/hccl48/runA/plog /tmp/hccl48/runA/plog_after_init
然后用原压测里的同样输入、8并发跑一小轮；通常只需几次decode，不要长时间压测。
保留压测命令/输入长度/输出长度/并发设置。如果只能做普通请求，先说明本次没有严格匹配512 KiB通信规格。

没有现成压测命令时，可在容器内另一终端使用以下小样例（默认端口55732、模型dsv4；按实际改）：

python3 - <<'PY'
from concurrent.futures import ThreadPoolExecutor
import json
from urllib.request import Request, urlopen
def request(i):
    body = {"model":"dsv4", "messages":[{"role":"user","content":f"请详细介绍NUMA、CPU亲和性与内存访问的关系。这是诊断请求{i}。"}], "max_tokens":128,"temperature":0,"stream":False}
    req = Request("http://127.0.0.1:55732/v1/chat/completions", data=json.dumps(body).encode(), headers={"Content-Type":"application/json"})
    with urlopen(req, timeout=300) as r:
        result=json.load(r)
    return {"request":i,"usage":result.get("usage")}
with ThreadPoolExecutor(max_workers=8) as pool:
    for result in pool.map(request, range(8)):
        print(json.dumps(result, ensure_ascii=False))
PY

样例不是原压测的等价替代；最终以profile/plog中的collective大小和执行模式为准。

5. 终端B：服务仍运行且请求完成后，采集实际worker

python3 /tmp/hccl_diag/hccl_runtime_snapshot.py > /tmp/hccl48/runA/runtime.json
python3 - <<'PY'
import json
p=json.load(open('/tmp/hccl48/runA/runtime.json'))
print('worker_count =',p['worker_count'])
for w in p['workers']:
    print(w['pid'],w.get('status'),w.get('error'))
    for lib in w.get('loaded_libraries',[]):
        print(' ',lib['path'],lib.get('sha256'),lib.get('error'))
PY

应有8个worker。若自动发现失败，在同一容器中用ps -eo pid,comm查找worker，并显式传--pids PID0 PID1 ... PID7。
environ是进程exec时的环境证据；之后代码setenv及通信域覆盖要看第6步探针和HCCL日志。
实际库哈希来自/proc/PID/maps指向的文件，并检查设备/inode；error、deleted、PID变化都不能当作“库相同”。
哈希读取会产生少量CPU/IO，因此放在请求结束后进行。

检查plog目录确实有新日志，保留完整文件，不只保留grep结果：

find /tmp/hccl48/runA/plog -type f -print
grep -RniE 'opExpansion|aiv|unfold|hccl.?config|determin|topo|peer|ranktable|mesh|ring|algorithm|unsupported|fallback' \
  /tmp/hccl48/runA/plog > /tmp/hccl48/runA/hccl_hits.txt

若文件为空或只含ERROR，先核对实际worker中的日志变量，以及运行用户对指定目录的写权限。
不能把“没有AIV日志”直接解释成没有设置AIV。库可能使用不同日志措辞，grep没有命中时仍上传原始plog。
检查日志时间从worker初始化覆盖到请求执行；若日志滚动已丢失初始化部分，缩短本次请求量后重新采集。

6. 可选：通信域选项探针

如果HCCL日志没有显示通信域配置，再做第二次短启动。先按平时方式停止runA，避免占用同一组NPU。
重复第4/5步，把输出目录换成runB，启动命令为：

HCCL_DIAG_PG_PROBE=1 bash /tmp/hccl_diag/run_hccl_logged.sh \
  /tmp/hccl48/runB /实际路径/start_48.sh

请求完成后：

python3 /tmp/hccl_diag/hccl_runtime_snapshot.py > /tmp/hccl48/runB/runtime.json
grep -R 'hook_installed' /tmp/hccl48/runB/pg
grep -R 'pg_options' /tmp/hccl48/runB/pg > /tmp/hccl48/runB/pg_options_hits.txt

pg/PID.jsonl会记录创建通信组时的backend/ranks/group_desc、pg_options.hccl_config、当时HCCL环境、Torch确定性开关和调用文件位置。
请核对8个worker PID都有hook_installed和相关new_group/init_process_group事件；其他Python进程只有bootstrap是正常的。
探针不改库源码，不修改调用参数/返回值；停止这个启动进程后，使用原脚本正常启动就不再注入。
若环境已有sitecustomize，包装器会拒绝覆盖。若启动脚本重写PYTHONPATH或以python -S/-I启动，可能未注入；缺失事件不能当作没有配置覆盖。
这是Python层请求的选项，不是原生HCCL最终生效配置。直接C++创建的通信域也不会被此探针截获。
pg_options缺省/空字典，不证明最终一定是AIV；仍须与plog和实际通信kernel交叉验证。
该探针只在本地模拟模块验证了参数/异常/导入行为，尚未在现场torch-npu上验证。若出现探针相关启动异常，使用runA保留基础证据即可。

7. 打包（先采集runtime，再按平时方式停止诊断服务，随后打包）

容器内：
tar -C /tmp -czf /tmp/hccl48_container.tgz hccl48

退出到Guest：
docker cp vm_test:/tmp/hccl48_container.tgz /tmp/hccl48_container.tgz
sudo tar -C /tmp -czf /tmp/hccl48_guest.tgz hccl48_guest

需要的结果：hccl48_container.tgz、hccl48_guest.tgz，以及能采集时的hccl48_host.tgz。
若旧优化环境仍能进入，在旧环境同样采一套，label和目录改成old_nohlt；不要使用旧144核绑核列表启动48核。

如何判读
拓扑：先将NPU逻辑ID→Guest BDF→Host BDF逐卡对应，再比较物理链路状态、Guest peer能力及HCCL实际拓扑/选路。
同一物理8卡且Host正常、Guest peer或HCCL互联识别异常，重点查透传/驱动呈现。PCI编号重排本身不是故障。
CPU NUMA本地性、npu-smi topo是否支持、HCCL是否能使用peer是三件不同的事。
库：按worker实际加载的libhccl/libhcomm/torch_npu/ascendcl/ascend_hal等逐项对比路径和SHA256，并对照驱动/CANN版本及容器挂载。
路径不同但SHA相同通常是同一文件内容；版本字符串相同而SHA不同不能当作同一构建。
库不同只是候选原因。需要在相同48核、同卡、同配置下用已验证兼容的完整软件栈做后续单变量对照，不能随意替换单个libhccl.so。
通信域：从probe的调用点和pg_options找是否显式配置了展开模式、确定性等，再用plog核实最终选择。
若显式模式覆盖AIV，后续只改该项并重启验证；不是重新export一次AIV就能覆盖所有通信域选项。
48核仍为同规格SDMA/Notify：说明现象不依赖144 vCPU配置；继续以上三条，不凭CPU数量解释AIV消失。
48核同规格图内恢复AIV：重点比较48/144的XML/透传呈现、worker实际配置/库、图模式；不能直接认定144核导致问题。
全部比较都需确认相同collective、dtype、大小和graph/eager场景。不同大小可能合法选择不同实现。
没有旧运行库哈希和旧plog时，只能确认新环境事实，不能只凭一套新数据证实“库回归”。

参考
HCCL日志模块设置（CANN 9.1）：
https://www.hiascend.com/doc_center/source/zh/CANNCommunityEdition/910/maintenref/envvar/envref_07_0123.html
日志落盘而非打屏（CANN 9.1）：
https://www.hiascend.com/doc_center/source/zh/CANNCommunityEdition/910/maintenref/envvar/envref_07_0121.html
AIV选择约束和通信域优先级（9.0文档仅作机制参考，现场9.1构建以日志为准）：
https://www.hiascend.com/doc_center/source/en/CANNCommunityEdition/900/maintenref/envvar/envref_07_0096.html
peer能力API支持参考（torch-npu旧版本文档，具体可用性由采集器记录）：
https://gitcode.com/Ascend/pytorch/blob/v2.9.0/docs/api/torch_npu_apis.md
