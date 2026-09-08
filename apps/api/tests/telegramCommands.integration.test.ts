import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool } from '../src/db/client.js';
import { createUser } from '../src/db/repositories/users.js';
import { getOrCreateBotState } from '../src/db/repositories/botState.js';
import { upsertRiskConfig } from '../src/db/repositories/riskConfig.js';
import { commands } from '../src/telegram/commands.js';
import { ensureTestSchema, truncateAll } from './dbTestUtils.js';

beforeAll(async () => {
  await ensureTestSchema();
});

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await closePool();
});

function replyCollector() {
  const messages: string[] = [];
  const reply = async (text: string) => {
    messages.push(text);
  };
  return { messages, reply };
}

describe('telegram commands', () => {
  it('every command replies with a clear message instead of throwing when no operator exists', async () => {
    const { messages, reply } = replyCollector();
    await commands.status(null, reply);
    await commands.pnl(null, reply);
    await commands.positions(null, reply);
    await commands.start(null, reply);
    await commands.stop(null, reply);
    await commands.paper(null, reply);
    await commands.risk(null, reply);
    await commands.strategy(null, reply);
    await commands.kill(null, reply);
    expect(messages).toHaveLength(9);
    for (const m of messages) expect(m).toContain('No operator account');
  });

  it('/tokens and /live work even with no operator account, since they need none', async () => {
    const { messages, reply } = replyCollector();
    await commands.tokens(null, reply);
    await commands.live(null, reply);
    expect(messages[0]).toContain('No tokens discovered');
    expect(messages[1]).toContain('not offered');
  });

  it('/status reports PAPER by default for a fresh operator', async () => {
    const user = await createUser(`${randomUUID()}@example.com`, 'hash');
    await getOrCreateBotState(user.id);
    const { messages, reply } = replyCollector();
    await commands.status(user.id, reply);
    expect(messages[0]).toContain('PAPER');
  });

  it('/start flips status to RUNNING and /stop flips it back', async () => {
    const user = await createUser(`${randomUUID()}@example.com`, 'hash');
    const { messages, reply } = replyCollector();
    await commands.start(user.id, reply);
    expect(messages[0]).toContain('RUNNING');
    await commands.stop(user.id, reply);
    expect(messages[1]).toContain('STOPPED');
  });

  it('/risk reports "not set yet" until a risk config exists, then reports it', async () => {
    const user = await createUser(`${randomUUID()}@example.com`, 'hash');
    const { messages, reply } = replyCollector();
    await commands.risk(user.id, reply);
    expect(messages[0]).toContain('set yet');

    await upsertRiskConfig({
      userId: user.id,
      maxPositionSizeSol: 0.5,
      maxDailyLossSol: 1,
      maxTotalExposureSol: 2,
      maxOpenPositions: 3,
      maxTradesPerDay: 20,
      maxSlippageBps: 500,
      minSolBalance: 0.1,
      autonomousEnabled: false,
      autonomousMaxPositionSol: null,
      autonomousMaxDailyLossSol: null,
      autonomousMaxTrades: null,
      tradingAllocationSol: 2,
    });
    await commands.risk(user.id, reply);
    expect(messages[1]).toContain('0.5 SOL');
  });

  it('/kill activates the kill switch and confirms in the reply', async () => {
    const user = await createUser(`${randomUUID()}@example.com`, 'hash');
    const { messages, reply } = replyCollector();
    await commands.kill(user.id, reply);
    expect(messages[0]).toContain('Kill switch activated');

    const state = await getOrCreateBotState(user.id);
    expect(state.killSwitchActive).toBe(true);
  });
});
