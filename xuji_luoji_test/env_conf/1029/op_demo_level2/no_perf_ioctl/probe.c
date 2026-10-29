#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <stdint.h>
#include <stdarg.h>
#include <stddef.h>
#include <string.h>
#include <sys/ioctl.h>
#include <time.h>

/* Only libc ioctl is interposed. No optional Ascend HAL symbols are invented. */
typedef int (*ioctl_fn)(int, unsigned long, ...);
static ioctl_fn original_ioctl;
#define CAPACITY 131072u
typedef struct {
    uint64_t request, start_ns, duration_ns, caller_pc;
    int32_t fd, result;
    uint32_t batch, reserved;
} ProbeEvent;
static ProbeEvent events[CAPACITY];
static size_t used, lost;
static __thread int enabled;
static __thread uint32_t current_batch;

static uint64_t now_ns(void)
{
    struct timespec value;
    if (clock_gettime(CLOCK_MONOTONIC, &value) != 0) return 0;
    return (uint64_t)value.tv_sec * 1000000000ull + (uint64_t)value.tv_nsec;
}

__attribute__((constructor)) static void resolve_original(void)
{
    original_ioctl = (ioctl_fn)dlsym(RTLD_NEXT, "ioctl");
}

int probe_ready(void) { return original_ioctl != NULL; }
size_t probe_event_size(void) { return sizeof(ProbeEvent); }
size_t probe_capacity(void) { return CAPACITY; }
size_t probe_count(void) { return used; }
size_t probe_lost(void) { return lost; }
const ProbeEvent *probe_events(void) { return events; }
int probe_resolve_pc(uint64_t address, const char **path, uint64_t *offset)
{
    Dl_info info;
    if (!dladdr((void *)(uintptr_t)address, &info)) return 0;
    *path = info.dli_fname;
    *offset = address - (uintptr_t)info.dli_fbase;
    return 1;
}
void probe_begin(uint32_t batch) { current_batch = batch; enabled = 1; }
void probe_end(void) { enabled = 0; }

/* Run only on the single calling thread before capture starts. */
void probe_reset(void)
{
    enabled = 0;
    used = 0;
    lost = 0;
    /* Fault in storage before measured calls, rather than on first record. */
    memset(events, 0, sizeof(events));
}
void probe_clock_pairs(uint64_t *out, size_t count)
{
    for (size_t i = 0; i < count; ++i) {
        uint64_t start = now_ns(), end = now_ns();
        out[i] = (start && end >= start) ? end - start : UINT64_MAX;
    }
}

int ioctl(int fd, unsigned long request, ...)
{
    va_list args;
    va_start(args, request);
    void *argument = va_arg(args, void *);
    va_end(args);
    if (!original_ioctl) { errno = ENOSYS; return -1; }
    if (!enabled) return original_ioctl(fd, request, argument);
    int incoming_errno = errno;
    uint64_t start = now_ns();
    errno = incoming_errno;
    int result = original_ioctl(fd, request, argument);
    int call_errno = errno;
    uint64_t end = now_ns();
    if (start && end >= start && used < CAPACITY) {
        ProbeEvent *record = &events[used++];
        record->request = request;
        record->start_ns = start;
        record->duration_ns = end - start;
        record->caller_pc = (uintptr_t)__builtin_return_address(0);
        record->fd = fd;
        record->result = result;
        record->batch = current_batch;
        record->reserved = 0;
    } else {
        ++lost;
    }
    errno = call_errno;
    return result;
}
