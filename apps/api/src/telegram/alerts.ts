import type { Position, RiskCheckResult, TokenSnapshot, Trade } from '@pump-scalper/shared';
import {
  formatBuyExecuted,
  formatDailyLossLimit,
  formatKillSwitch,
  formatNewToken,
  formatRiskReject,
  formatRpcError,
  formatSellExecuted,
} from './formatting.js';

export interface TelegramAlertsPort {
  newToken(token: TokenSnapshot): Promise<void>;
  buySignal(mint: string, signal: 'BUY' | 'STRONG_BUY', opportunityScore: number, riskScore: number): Promise<void>;
  buyExecuted(position: Position): Promise<void>;
  sellExecuted(position: Position, trade: Trade): Promise<void>;
  riskReject(mint: string | null, sizeSol: number, result: RiskCheckResult): Promise<void>;
  dailyLossLimit(dailyLossSol: number, capSol: number): Promise<void>;
  killSwitch(active: boolean, reason: string | null): Promise<void>;
  rpcError(message: string, consecutiveFailures: number): Promise<void>;
}

/** Used whenever TELEGRAM_BOT_TOKEN isn't configured — every call is a no-op, matching README's "leave empty to disable". */
export class NoopTelegramAlerts implements TelegramAlertsPort {
  async newToken(): Promise<void> {}
  async buySignal(): Promise<void> {}
  async buyExecuted(): Promise<void> {}
  async sellExecuted(): Promise<void> {}
  async riskReject(): Promise<void> {}
  async dailyLossLimit(): Promise<void> {}
  async killSwitch(): Promise<void> {}
  async rpcError(): Promise<void> {}
}

export interface TelegramSender {
  sendMessage(chatId: string, text: string, opts?: { parse_mode?: 'Markdown' }): Promise<unknown>;
}

export class TelegramAlerts implements TelegramAlertsPort {
  constructor(
    private readonly sender: TelegramSender,
    private readonly chatId: string,
    private readonly logger: { error(msg: string, err?: unknown): void } = console,
  ) {}

  private async send(text: string): Promise<void> {
    try {
      await this.sender.sendMessage(this.chatId, text, { parse_mode: 'Markdown' });
    } catch (err) {
      // An alert failing to send must never break the trading logic that triggered it.
      this.logger.error('Telegram alert failed to send', err);
    }
  }

  newToken(token: TokenSnapshot): Promise<void> {
    return this.send(formatNewToken(token));
  }

  buySignal(mint: string, signal: 'BUY' | 'STRONG_BUY', opportunityScore: number, riskScore: number): Promise<void> {
    return this.send(`📈 *BUY_SIGNAL* (${signal})\n${mint}\nOpportunity: ${opportunityScore.toFixed(0)} · Risk: ${riskScore.toFixed(0)}`);
  }

  buyExecuted(position: Position): Promise<void> {
    return this.send(formatBuyExecuted(position));
  }

  sellExecuted(position: Position, trade: Trade): Promise<void> {
    return this.send(formatSellExecuted(position, trade));
  }

  riskReject(mint: string | null, sizeSol: number, result: RiskCheckResult): Promise<void> {
    return this.send(formatRiskReject(mint, sizeSol, result));
  }

  dailyLossLimit(dailyLossSol: number, capSol: number): Promise<void> {
    return this.send(formatDailyLossLimit(dailyLossSol, capSol));
  }

  killSwitch(active: boolean, reason: string | null): Promise<void> {
    return this.send(formatKillSwitch(active, reason));
  }

  rpcError(message: string, consecutiveFailures: number): Promise<void> {
    return this.send(formatRpcError(message, consecutiveFailures));
  }
}
