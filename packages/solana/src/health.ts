import { EventEmitter } from 'node:events';

export interface SlotSource {
  getSlot(): Promise<number>;
}

/**
 * Polls the RPC connection on an interval and emits 'healthy' / 'unhealthy' /
 * 'reconnected' so the rest of the system (Telegram RPC_ERROR alert in
 * Phase 11, system_events audit log) finds out about connectivity problems
 * instead of trades silently failing against a dead RPC.
 */
export class RpcHealthMonitor extends EventEmitter {
  private timer: ReturnType<typeof setInterval> | null = null;
  private consecutiveFailures = 0;
  private unhealthySince: number | null = null;

  constructor(
    private readonly source: SlotSource,
    private readonly intervalMs = 10_000,
  ) {
    super();
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.checkOnce(), this.intervalMs);
    void this.checkOnce();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  get isHealthy(): boolean {
    return this.consecutiveFailures === 0;
  }

  async checkOnce(): Promise<void> {
    try {
      const slot = await this.source.getSlot();
      if (this.consecutiveFailures > 0 && this.unhealthySince !== null) {
        this.emit('reconnected', { slot, downForMs: Date.now() - this.unhealthySince });
      }
      this.consecutiveFailures = 0;
      this.unhealthySince = null;
      this.emit('healthy', { slot });
    } catch (err) {
      this.consecutiveFailures += 1;
      if (this.unhealthySince === null) this.unhealthySince = Date.now();
      this.emit('unhealthy', { error: err as Error, consecutiveFailures: this.consecutiveFailures });
    }
  }
}
