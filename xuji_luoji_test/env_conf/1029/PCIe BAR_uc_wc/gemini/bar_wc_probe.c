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

#define DEFAULT_ITERATIONS 50000

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
    val = 1000000000ULL; // 非 aarch64 回退到纳秒
#endif
    return val;
}

// 模拟连续 16 次 8 字节写（共 128 字节，等价于连续写入 hostArgs 参数结构与 SQE 描述符）
static inline void write_128b_sequential(volatile uint64_t *dst) {
    dst[0]  = 0x1111111122222222ULL;
    dst[1]  = 0x3333333344444444ULL;
    dst[2]  = 0x5555555566666666ULL;
    dst[3]  = 0x7777777788888888ULL;
    dst[4]  = 0x99999999AAAAAAAAULL;
    dst[5]  = 0xBBBBBBBBCCCCCCCCULL;
    dst[6]  = 0xDDDDDDDDEEEEEEEEULL;
    dst[7]  = 0xFFFFFFFF00000000ULL;
    dst[8]  = 0x0101010102020202ULL;
    dst[9]  = 0x0303030304040404ULL;
    dst[10] = 0x0505050506060606ULL;
    dst[11] = 0x0707070708080808ULL;
    dst[12] = 0x090909090A0A0A0AULL;
    dst[13] = 0x0B0B0B0B0C0C0C0CULL;
    dst[14] = 0x0D0D0D0D0E0E0E0EULL;
    dst[15] = 0x0F0F0F0F00000000ULL;
}

// 运行单一目标的基准测试
void benchmark_memory_target(const char *label, volatile void *addr, size_t size, int iterations, uint64_t freq) {
    volatile uint64_t *dst = (volatile uint64_t *)addr;
    char buffer[256];
    memset(buffer, 0x5A, sizeof(buffer));

    // 预热
    for (int i = 0; i < 1000; i++) {
        write_128b_sequential(dst);
    }

    // 1. 连续 128B (16 次 8 字节 Store)
    uint64_t start = read_cntvct();
    for (int i = 0; i < iterations; i++) {
        write_128b_sequential(dst);
    }
    uint64_t end = read_cntvct();

    double total_sec = (double)(end - start) / freq;
    double avg_ns_128 = (total_sec / iterations) * 1e9;
    double store_8b_ns = avg_ns_128 / 16.0;
    double bw_128 = (128.0 * iterations / (1024.0 * 1024.0)) / total_sec;

    // 2. 连续 256B memcpy
    start = read_cntvct();
    for (int i = 0; i < iterations; i++) {
        memcpy((void *)addr, buffer, 256);
    }
    end = read_cntvct();

    total_sec = (double)(end - start) / freq;
    double avg_ns_256 = (total_sec / iterations) * 1e9;
    double bw_256 = (256.0 * iterations / (1024.0 * 1024.0)) / total_sec;

    printf("====================================================================\n");
    printf("测试目标: %s\n", label);
    printf("--------------------------------------------------------------------\n");
    printf("1. 【128 字节连续写入 (16 个 8B Store 指令)】:\n");
    printf("   - 每次 128B 写入耗时: %.2f ns (%.3f μs)\n", avg_ns_128, avg_ns_128 / 1000.0);
    printf("   - 单个 8B Store 耗时: %.2f ns\n", store_8b_ns);
    printf("   - 写入吞吐量:         %.2f MB/s\n", bw_128);
    printf("2. 【256 字节 memcpy 写入】:\n");
    printf("   - 每次 256B 写入耗时: %.2f ns (%.3f μs)\n", avg_ns_256, avg_ns_256 / 1000.0);
    printf("   - 写入吞吐量:         %.2f MB/s\n", bw_256);

    printf("--> 属性判定结论: ");
    if (store_8b_ns < 15.0) {
        printf("\033[1;32m[PASS] Write-Combining (WC) 正常生效\033[0m\n");
        printf("    说明: CPU Store Buffer 正确聚合小包，纳秒级提交，无严重总线挂起。\n");
    } else if (store_8b_ns >= 100.0) {
        printf("\033[1;31m[CRITICAL] 内存属性已退化为 UC (Device-nGnRE)！WC 彻底失效！\033[0m\n");
        printf("    说明: 每次 8B 写入耗时高达 ~%.1f ns，触发无缓冲总线 Stall！单次下发 128-256B 必定带来 15-20 μs 刚性延迟！\033[0m\n", store_8b_ns);
    } else {
        printf("\033[1;33m[WARNING] 性能介于正常与异常之间 (%.1f ns)，需结合总线与锁状态排查\033[0m\n", store_8b_ns);
    }
    printf("====================================================================\n\n");
}

int main(int argc, char *argv[]) {
    int iterations = DEFAULT_ITERATIONS;
    uint64_t freq = read_cntfrq();

    printf("\n####################################################################\n");
    printf("# PCIe BAR 内存属性 (WC vs UC) 硬件流水线实测探针 (ARM64 / x86_64)   #\n");
    printf("####################################################################\n");
    printf("CPU 计时器频率: %.2f MHz | 单项循环次数: %d\n\n", freq / 1e6, iterations);

    // 首先跑一个 DRAM（常规可缓存内存）作为理想基准参考
    void *dram_buf = mmap(NULL, 4096, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
    if (dram_buf != MAP_FAILED) {
        benchmark_memory_target("系统 DRAM 内存 (Normal Cacheable 基线对照)", dram_buf, 4096, iterations, freq);
        munmap(dram_buf, 4096);
    }

    if (argc < 2) {
        printf("提示: 未指定 PCIe BAR 路径，仅输出了 DRAM 基线。\n");
        printf("请传入 NPU BAR 路径执行实际物理测试，例如:\n");
        printf("  sudo %s /sys/bus/pci/devices/0000:01:00.0/resource2\n", argv[0]);
        printf("  sudo %s /sys/bus/pci/devices/0000:01:00.0/resource2_wc (若存在)\n\n");
        return 0;
    }

    const char *bar_path = argv[1];
    int fd = open(bar_path, O_RDWR | O_SYNC);
    if (fd < 0) {
        fprintf(stderr, "错误: 打开 BAR resource 失败: %s (errno: %d, %s)\n", bar_path, errno, strerror(errno));
        fprintf(stderr, "请检查是否具有 root 权限 (sudo) 以及路径是否正确。\n");
        return 1;
    }

    size_t map_size = 4096;
    void *bar_map = mmap(NULL, map_size, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
    if (bar_map == MAP_FAILED) {
        fprintf(stderr, "错误: mmap 映射 BAR 失败 (errno: %d, %s)\n", errno, strerror(errno));
        close(fd);
        return 1;
    }

    benchmark_memory_target(bar_path, bar_map, map_size, iterations, freq);

    munmap(bar_map, map_size);
    close(fd);
    return 0;
}
