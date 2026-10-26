export OMP_PROC_BIND=false
export OMP_NUM_THREADS=10
export PYTORCH_NPU_ALLOC_CONF=expandable_segments:True
export LD_PRELOAD=/usr/lib/aarch64-linux-gnu/libjemalloc.so.2:$LD_PRELOAD
export HCCL_BUFFSIZE=1024
export TASK_QUEUE_ENABLE=1
export HCCL_OP_EXPANSION_MODE="AIV"
export VLLM_ENGINE_READY_TIMEOUT_S=3600
export VLLM_ASCEND_APPLY_DSV4_PATCH=1
export GLOO_SOCKET_IFNAME=lo

export VLLM_USE_V2_MODEL_RUNNER=1
export LOCAL_ASCEND_CPU_POOLS='{"0":"108-125","1":"126-143","2":"72-89","3":"90-107","4":"0-17","5":"18-35","6":"36-53","7":"54-71"}'

vllm serve /opt/z00927893/model/DeepSeek-V4-Flash-0731-w8a8 \
    --max-model-len 66048 \
    --max-num-batched-tokens 8192 \
    --served-model-name dsv4 \
    --gpu-memory-utilization 0.9 \
    --max-num-seqs 8 \
    --data-parallel-size 1 \
    --tensor-parallel-size 8 \
    --enable-expert-parallel \
    --tokenizer-mode deepseek_v4 \
    --tool-call-parser deepseek_v4 \
    --enable-auto-tool-choice \
    --reasoning-parser deepseek_v4 \
    --enable-prefix-caching \
    --no-disable-hybrid-kv-cache-manager \
    --model-loader-extra-config='{"enable_multithread_load": true, "num_threads": 128}' \
    --quantization ascend \
    --port 55732 \
    --block-size 32 \
    --compilation-config '{"cudagraph_mode":"FULL_DECODE_ONLY"}' \
    --speculative-config '{"method": "dspark", "num_speculative_tokens": 7}' \
    --additional-config '{"ascend_compilation_config": {"enable_npugraph_ex": true, "enable_static_kernel": false}, "enable_cpu_binding": true, "enable_dsa_cp": false, "multistream_overlap_shared_expert": true}' \