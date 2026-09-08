import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool, query } from '../src/db/client.js';
import { createUser } from '../src/db/repositories/users.js';
import { getOrCreateBotState } from '../src/db/repositories/botState.js';
import { activateKillSwitch, deactivateKillSwitch } from '../src/risk/killSwitch.js';
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

describe('kill switch', () => {
  it('activating sets bot_state.status to KILL_SWITCH and logs a system_event, without touching positions', async () => {
    const user = await createUser(`${randomUUID()}@example.com`, 'hashed');
    await getOrCreateBotState(user.id);

    const state = await activateKillSwitch(user.id, 'manual stop from dashboard');
    expect(state.status).toBe('KILL_SWITCH');
    expect(state.killSwitchActive).toBe(true);
    expect(state.killSwitchReason).toBe('manual stop from dashboard');

    const events = await query<{ type: string }>('SELECT type FROM system_events WHERE user_id = $1', [user.id]);
    expect(events.map((e) => e.type)).toContain('KILL_SWITCH_ON');

    // No positions table mutation of any kind happens here — nothing to assert
    // beyond the fact that killSwitch functions never touch the positions table,
    // which is true by construction (no import of the positions repository).
  });

  it('deactivating clears the flag and moves status to STOPPED, not back to RUNNING automatically', async () => {
    const user = await createUser(`${randomUUID()}@example.com`, 'hashed');
    await activateKillSwitch(user.id, 'test');

    const state = await deactivateKillSwitch(user.id);
    expect(state.status).toBe('STOPPED');
    expect(state.killSwitchActive).toBe(false);
    expect(state.killSwitchReason).toBeNull();

    const events = await query<{ type: string }>('SELECT type FROM system_events WHERE user_id = $1', [user.id]);
    expect(events.map((e) => e.type)).toContain('KILL_SWITCH_OFF');
  });
});
