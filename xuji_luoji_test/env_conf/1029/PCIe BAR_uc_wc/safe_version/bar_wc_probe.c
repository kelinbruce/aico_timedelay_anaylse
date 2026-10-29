#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <string.h>
#include <fcntl.h>
#include <unistd.h>
#include <sys/mman.h>
#include <time.h>
#include <errno.h>

// 读取 ARM64 虚拟物理时钟计数器 (cntvct_el0)
static inline uint64_t read_cntvct(void) {
    uint64_t val;
#if defined(__aarch64__)
    asm volatile("isb; mrs %0, cntvct_el0" : "=r"(val));
#else
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC_RAW, &ts);
    val = (uint64_t)ts.tv_sec * 1000000000ULL + ts.tv_nsec;
#endif
    return val;
}

// 读取 ARM64 系统时钟频率 (cntfrq_el0)
static inline uint64_t read_cntfrq(void) {
    uint64_t val;
#if defined(__aarch64__)
    asm volatile("mrs %0, cntfrq_el0" : "=r"(val));
#else
    val = 1000000000ULL;
#endif
    return val;
}

int main(int argc, char *argv[]) {
    printf("########################################################################\n");
    printf("# 安全保护提示：严禁对未经厂商白名单确认的未知 PCIe BAR 执行裸内存盲写！ #\n");
    printf("########################################################################\n");
    printf("原因: PCIe BAR0/2 通常包含芯片核心控制寄存器(CSR)、硬件门铃或复位接口。\n");
    printf("向任意 BAR 偏移 0 盲写垃圾数据可能导致硬件 PCIe AER 致命故障、掉卡或芯片 Hang。\n\n");

    printf("【安全推荐核验方案】:\n");
    printf("1. 宿主机侧：运行 check_host_bar_wc.py（全只读），直接检查 KVM Stage-2 S2PT 页表属性是 Normal-NC 还是 Device-nGnRE。\n");
    printf("2. 虚机内部：运行 xuji_luoji_test/launch_microbench，通过受驱动保护的官方通道测试小算子下发耗时。\n\n");

    // 运行安全内存基准（仅对系统普通 DRAM 内存进行压测基准测试，100% 安全）
    uint64_t freq = read_cntfrq();
    printf("当前系统时钟频率: %.2f MHz\n", freq / 1e6);
    printf("正在运行 DRAM 安全性能基准 (仅操作普通用户态内存，无任何硬件风险)...\n");

    int iterations = 100000;
    void *dram_buf = mmap(NULL, 4096, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
    if (dram_buf != MAP_FAILED) {
        volatile uint64_t *dst = (volatile uint64_t *)dram_buf;
        uint64_t start = read_cntvct();
        for (int i = 0; i < iterations; i++) {
            dst[0] = 0x11111111;
            dst[1] = 0x22222222;
        }
        uint64_t end = read_cntvct();
        double total_sec = (double)(end - start) / freq;
        double avg_ns = (total_sec / (iterations * 2)) * 1e9;
        printf("DRAM 正常可缓存写单次耗时基线: %.2f ns\n", avg_ns);
        munmap(dram_buf, 4096);
    }

    return 0;
}
