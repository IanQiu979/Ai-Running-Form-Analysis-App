/**
 * LIVE-NETWORK canary for `lib/hibp.ts` (issue #74).
 *
 * `hibp.test.ts` mocks `fetch` and proves the parser is correct against fixtures. It cannot
 * tell you that HIBP still *speaks* that shape. This file can: it runs the real, shipped
 * `checkPasswordBreached` against the live Pwned Passwords range API.
 *
 * Why this exists: `checkPasswordBreached` fails open — an unreachable or misbehaving endpoint
 * returns `unavailable` and sign-up proceeds — and `lib/hibp.ts` deliberately never logs.
 * Together those two correct decisions make the control silently unobservable. If HIBP changes
 * its content-type, Cloudflare starts challenging us, or our egress gets rate-limited, every
 * sign-up passes the check forever and nothing fires. This canary is what fires. It runs on a
 * daily cron (`.github/workflows/hibp-canary.yml`), NOT in `npm test` — the commit gate must
 * stay hermetic, so `jest.config.js` explicitly ignores this file and `jest.canary.config.js`
 * is the only config that runs it.
 *
 * Both assertions below must reject `unavailable`, not merely accept `breached`/`safe`. A
 * canary that cannot go red is the bug it was built to catch, wearing a different hat.
 *
 * Exactly ONE thing is faked: `expo-crypto`'s `digestStringAsync`, a native module with no Node
 * build. Its stand-in is a real `node:crypto` SHA-1 returning LOWERCASE hex — exactly what the
 * native module returns on device — so the lowercase/uppercase normalization in `lib/hibp.ts`
 * (the classic silent no-op this whole check is vulnerable to) is still proven end-to-end
 * against a live response. Everything else is real: the network call, the content-type guard,
 * the single retry, the 4s shared deadline, the CRLF split, and the `Add-Padding` count-0 row
 * filter.
 *
 * The only two strings this file ever hashes are the public test vector "password" and a fresh
 * random UUID. No user data is involved and none is transmitted — `lib/hibp.ts`'s leak-safety
 * rules (never log a hash, prefix, or password) bind this file too.
 */
import { randomUUID } from 'node:crypto';

import { checkPasswordBreached } from '../hibp';

jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA1: 'SHA-1' },
  // `require` inside the factory rather than a top-level import: Jest hoists `jest.mock` above
  // the import statements, so referencing an imported binding here throws an out-of-scope error.
  digestStringAsync: (_algorithm: unknown, data: string) =>
    Promise.resolve(require('node:crypto').createHash('sha1').update(data, 'utf8').digest('hex')),
}));

// The function's own budget is a 4s internal deadline. This outer timeout is deliberately far
// looser: a CI runner's first TLS handshake to a cold host is slower than a warm laptop's, and
// a canary that fails on its own impatience is a canary that gets muted.
const LIVE_TIMEOUT_MS = 30_000;

describe('HIBP live-endpoint canary', () => {
  it('still reports a known-breached password as breached', async () => {
    const result = await checkPasswordBreached('password');

    // The load-bearing assertion. A Cloudflare challenge page, a content-type change, a
    // rate-limit on our egress, or any parse breakage all collapse to `unavailable` or `safe`
    // right here — which is precisely the rot that is invisible in production today.
    expect(result.status).toBe('breached');
    // A count of 0 would mean we matched an `Add-Padding` decoy row rather than the real one.
    expect(result.status === 'breached' && result.count > 0).toBe(true);
  }, LIVE_TIMEOUT_MS);

  it('still reports a random, never-breached password as safe — not unavailable', async () => {
    const result = await checkPasswordBreached(`canary-${randomUUID()}`);

    // `safe` is a positive assertion in `lib/hibp.ts`: it is returned only after at least one
    // well-formed range row has parsed. So if this is not `safe`, the parser has stopped
    // recognising HIBP's response shape — even in a world where the `breached` case above
    // somehow still passed.
    expect(result.status).toBe('safe');
  }, LIVE_TIMEOUT_MS);
});
