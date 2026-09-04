/**
 * The entry screen's scroll reveal — `app/(auth)/sign-in.tsx`'s pace/pillars content, added by the
 * V2.3 redesign (2026-09-04).
 *
 * WHY A SCREEN-LEVEL TEST AND NOT A `lib/` UNIT: there is no mapping function to hoist out. Both
 * defects this guards against live in the WIRING itself, which is exactly the case CLAUDE.md's
 * testing section says to reach for RNTL for:
 *
 *   1. THE SECTION IS BUILT FROM THE SHARED `PACE_PILLARS` LIST, in canonical P-A-C-E order. A
 *      hand-typed list on this screen would be the fifth place in the app that knows the four
 *      pillars, and the one nobody would remember to update — this app has exactly four pillars
 *      and a front door that advertised three would be a genuinely bad bug.
 *   2. THE REVEAL SITS BELOW THE SIGN-IN CONTROLS. That ordering is a deliberate product decision
 *      (a returning user must never scroll past a brochure to reach a sign-in button), it is
 *      invisible in a diff once the file is 600 lines long, and it is a single moved JSX block away
 *      from being lost. Asserted against the real rendered tree order, not against line numbers.
 *
 * Copy is read from `Copy.auth.about` rather than restated, so this cannot pass while the screen
 * renders something different from what the copy module ships.
 */
import { render, screen } from '@testing-library/react-native';

import { Copy } from '@/constants/copy';
import { PACE_PILLARS } from '@shared/pace';

jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('react-native-safe-area-context/jest/mock').default
);

jest.mock('@/lib/auth', () => ({ signInWithGoogle: jest.fn() }));
jest.mock('@/lib/hibp', () => ({ checkPasswordBreached: jest.fn() }));
jest.mock('@/lib/signup-with-captcha', () => ({
  signUpWithCaptcha: jest.fn(),
  applySignupSession: jest.fn(),
}));
jest.mock('@/lib/supabase', () => ({
  supabase: { auth: { signInWithPassword: jest.fn() } },
}));
jest.mock('@/lib/session-provider', () => ({
  useSession: () => ({
    deepLinkAuthError: null,
    clearDeepLinkAuthError: jest.fn(),
    corruptedSessionError: null,
    clearCorruptedSessionError: jest.fn(),
  }),
}));

// The real widget hosts a WebView, whose native module does not exist under Jest. This screen
// only mounts it in signUp mode, which no test here enters — but the `import` runs regardless, so
// the module still has to be stubbed. Same boundary-mock approach as `sign-in.test.tsx`.
jest.mock('@/components/turnstile-widget', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { forwardRef } = require('react');
  return {
    TurnstileWidget: forwardRef(function MockTurnstileWidget() {
      return null;
    }),
  };
});

// Same module-evaluation-order dance as `sign-in.test.tsx`: `TURNSTILE_CONFIG` is resolved when
// the screen module is first required, and a plain ES import would hoist above these assignments.
process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY = 'test-site-key';
process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://project-ref.supabase.co';
delete process.env.EXPO_PUBLIC_TURNSTILE_HOSTNAME;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const SignInScreen = require('../sign-in').default;

const HIDDEN = { includeHiddenElements: true } as const;

/** Depth-first order of the rendered tree — paint/read order, which is what "below" means here. */
function flatten(node: unknown, out: unknown[] = []): unknown[] {
  const element = node as { children?: unknown[] };
  out.push(node);
  for (const child of element.children ?? []) {
    if (typeof child !== 'string') flatten(child, out);
  }
  return out;
}

describe('the entry screen’s scroll reveal', () => {
  it('renders every pillar, in canonical P-A-C-E order, from the shared list', async () => {
    await render(<SignInScreen />);

    const order = flatten(screen.root);

    // Presence first, with the copy read from the module rather than restated here.
    for (const id of PACE_PILLARS) {
      expect(screen.getByTestId(`sign-in-pillar-${id}`, HIDDEN)).toBeTruthy();
      expect(screen.getByText(Copy.auth.about.pillar[id].label)).toBeTruthy();
      expect(screen.getByText(Copy.auth.about.pillar[id].body)).toBeTruthy();
    }

    // Then order. `PACE_PILLARS` is the canonical sequence (supabase/functions/_shared/pace.ts);
    // this proves the screen iterates it rather than happening to list the same four.
    const rendered = PACE_PILLARS.map((id) =>
      order.indexOf(screen.getByTestId(`sign-in-pillar-${id}`, HIDDEN))
    );
    expect(rendered).toEqual([...rendered].sort((a, b) => a - b));
  });

  it('states the photo/video limit and the product’s scope before a stranger signs up', async () => {
    await render(<SignInScreen />);

    expect(screen.getByText(Copy.auth.about.limit.body)).toBeTruthy();
    expect(screen.getByText(Copy.auth.about.scope.body)).toBeTruthy();
  });

  it('keeps the reveal BELOW the sign-in controls', async () => {
    await render(<SignInScreen />);

    const order = flatten(screen.root);
    const cta = screen.getByRole('button', { name: Copy.auth.cta.google });
    const firstPillar = screen.getByTestId('sign-in-pillar-posture', HIDDEN);

    const ctaIndex = order.indexOf(cta);
    const revealIndex = order.indexOf(firstPillar);
    expect(ctaIndex).toBeGreaterThanOrEqual(0);
    expect(revealIndex).toBeGreaterThanOrEqual(0);
    expect(revealIndex).toBeGreaterThan(ctaIndex);
  });
});
