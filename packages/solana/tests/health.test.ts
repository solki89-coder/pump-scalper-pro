import { describe, expect, it, vi } from 'vitest';
import { RpcHealthMonitor, type SlotSource } from '../src/health.js';

describe('RpcHealthMonitor', () => {
  it('emits healthy on a successful check', async () => {
    const source: SlotSource = { getSlot: vi.fn().mockResolvedValue(12345) };
    const monitor = new RpcHealthMonitor(source, 1000);
    const healthy = vi.fn();
    monitor.on('healthy', healthy);
    await monitor.checkOnce();
    expect(healthy).toHaveBeenCalledWith({ slot: 12345 });
    expect(monitor.isHealthy).toBe(true);
  });

  it('emits unhealthy with an increasing failure count on repeated errors', async () => {
    const source: SlotSource = { getSlot: vi.fn().mockRejectedValue(new Error('timeout')) };
    const monitor = new RpcHealthMonitor(source, 1000);
    const unhealthy = vi.fn();
    monitor.on('unhealthy', unhealthy);
    await monitor.checkOnce();
    await monitor.checkOnce();
    expect(unhealthy).toHaveBeenNthCalledWith(1, expect.objectContaining({ consecutiveFailures: 1 }));
    expect(unhealthy).toHaveBeenNthCalledWith(2, expect.objectContaining({ consecutiveFailures: 2 }));
    expect(monitor.isHealthy).toBe(false);
  });

  it('emits reconnected once it recovers after being unhealthy', async () => {
    let shouldFail = true;
    const source: SlotSource = {
      getSlot: vi.fn().mockImplementation(() => (shouldFail ? Promise.reject(new Error('down')) : Promise.resolve(999))),
    };
    const monitor = new RpcHealthMonitor(source, 1000);
    const reconnected = vi.fn();
    monitor.on('reconnected', reconnected);

    await monitor.checkOnce(); // fails
    shouldFail = false;
    await monitor.checkOnce(); // recovers

    expect(reconnected).toHaveBeenCalledTimes(1);
    expect(reconnected.mock.calls[0]?.[0]).toMatchObject({ slot: 999 });
    expect(monitor.isHealthy).toBe(true);
  });

  it('start/stop drives periodic checks without leaking timers', async () => {
    vi.useFakeTimers();
    const getSlot = vi.fn().mockResolvedValue(1);
    const monitor = new RpcHealthMonitor({ getSlot }, 1000);
    monitor.start();
    await vi.advanceTimersByTimeAsync(3500);
    monitor.stop();
    const callsAtStop = getSlot.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(getSlot.mock.calls.length).toBe(callsAtStop);
    vi.useRealTimers();
  });
});
