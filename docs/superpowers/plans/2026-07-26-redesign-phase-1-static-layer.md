# V2.3 Redesign — Phase 1 (Static Layer) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the app typographic and material range — the thing its current tokens structurally forbid — without adding a single animation or runtime dependency.

**Architecture:** Additive token changes first (`constants/theme.ts`), then two new presentational components, then screen adoption. Every existing token keeps its name and value, so no screen changes until it is deliberately opted in. Phase 2 (the three animated moments) is a separate plan and is **not** in scope here.

**Tech Stack:** React Native 0.8x / Expo SDK 54, TypeScript strict, expo-router, `expo-image`, `react-native-reanimated` 4.1.1 (not used in this phase), Jest + `@testing-library/react-native` 14.0.1, Deno for edge tests.

**Read before starting:** `docs/superpowers/specs/2026-07-26-redesign-design.md` (the spec this implements) and `docs/design/frontend-design-brief.md` §2, §6, §7.

## Global Constraints

- **No new runtime dependencies.** `react-native-svg` is NOT installed and must NOT be added. Hairlines are plain `View`s.
- **No hardcoded colors in components** (brief §2). Everything comes from `constants/theme.ts`.
- **Score is never conveyed by color alone** (brief §7): always numeral + band word + bar length.
- **Every control ≥44×44** (brief §7).
- **All text scales with Dynamic Type; never hard-clip the score readout** (brief §7).
- **No new animation in this phase.** Motion is Phase 2.
- **Existing token names and values must not change**, except `Radius.card` (Task 3). Additive only.
- Verification commands: `npm run typecheck` · `npm test` · `npx jest <path>` for a single suite.
- **Do not run bare `deno test`** — it omits `--allow-env` and 9 tests will fail spuriously. Always use `npm test`.
- Known pre-existing flake, NOT caused by this work: `app/analyzing.tsx:180` can emit an `act()` warning failure on an isolated `npx jest` run and pass on a re-run.

---

## File Structure

| File | Responsibility |
|---|---|
| `constants/theme.ts` | MODIFY — add `FontSize.display`/`.hero`, `FontFamily.prose`, `Spacing.editorial`; change `Radius.card` |
| `constants/__tests__/theme-tokens.test.ts` | CREATE — locks the new tokens' values and the "one large element per screen" rule |
| `components/duotone-frame.tsx` | CREATE — renders a user frame full-bleed, graded to the palette |
| `components/__tests__/duotone-frame.test.tsx` | CREATE |
| `components/ui/notched-card.tsx` | CREATE — the die-cut result container |
| `components/__tests__/notched-card.test.tsx` | CREATE |
| `app/result/[id].tsx` | MODIFY — adopt hero numeral, prose family, duotone frame, notched card |
| `docs/design/frontend-design-brief.md` | MODIFY — record the token amendments so the brief stays the source of truth |

---

### Task 1: Extend the type scale

**Files:**
- Modify: `constants/theme.ts` (the `FontSize` block, currently ends `xxl: 32`)
- Test: `constants/__tests__/theme-tokens.test.ts` (create)

**Interfaces:**
- Consumes: nothing
- Produces: `FontSize.display: 64`, `FontSize.hero: 96` — used by Task 6.

- [x] **Step 1: Write the failing test**

Create `constants/__tests__/theme-tokens.test.ts`:

```ts
/**
 * Locks the redesign's new token values (spec 2026-07-26-redesign-design.md §3).
 *
 * The six original steps are asserted UNCHANGED on purpose: the redesign is additive, and a
 * screen that never opts into `display`/`hero` must look exactly as it did before.
 */
import { FontSize, Radius, Spacing } from '../theme';

describe('type scale', () => {
  it('keeps the brief’s six original steps unchanged', () => {
    expect(FontSize.xs).toBe(13);
    expect(FontSize.sm).toBe(15);
    expect(FontSize.md).toBe(17);
    expect(FontSize.lg).toBe(20);
    expect(FontSize.xl).toBe(24);
    expect(FontSize.xxl).toBe(32);
  });

  it('adds display steps that give the scale real range', () => {
    expect(FontSize.display).toBe(64);
    expect(FontSize.hero).toBe(96);
  });

  it('spans a ratio wide enough for editorial hierarchy (the old 2.5x was the problem)', () => {
    expect(FontSize.hero / FontSize.xs).toBeGreaterThan(7);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx jest constants/__tests__/theme-tokens.test.ts`
Expected: FAIL — `expect(FontSize.display).toBe(64)` receives `undefined`.

- [x] **Step 3: Write minimal implementation**

In `constants/theme.ts`, replace the `FontSize` block's closing with the two new steps added:

```ts
/** The brief's six fixed steps: 32 / 24 / 20 / 17 / 15 / 13. Support Dynamic Type — never
 * hard-clip text at these sizes (brief §2).
 *
 * `display` and `hero` are the redesign's addition (spec 2026-07-26 §3.1). The original six
 * spanned 13->32 — a ratio of 2.5x — which is why nothing on screen had real hierarchy. These
 * two exist to be used AT MOST ONCE PER SCREEN; the contrast comes from the gap between 96 and
 * 15, not from many large things. */
export const FontSize = {
  xs: 13,
  sm: 15,
  md: 17,
  lg: 20,
  xl: 24,
  xxl: 32,
  display: 64,
  hero: 96,
} as const;
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx jest constants/__tests__/theme-tokens.test.ts`
Expected: PASS (3 tests).

- [x] **Step 5: Commit**

```bash
git add constants/theme.ts constants/__tests__/theme-tokens.test.ts
git commit -m "feat(theme): extend the type scale with display/hero steps

The original six steps span 13->32, a ratio of 2.5x, which is why no screen
has real typographic hierarchy. display (64) and hero (96) exist to be used at
most once per screen. All six original steps keep their values, so no existing
screen changes."
```

---

### Task 2: Add the prose type role

**Files:**
- Modify: `constants/theme.ts` (the `FontFamily` block)
- Modify: `app/_layout.tsx` (the `useFonts` call, ~line 47)
- Modify: `package.json` (one font package)
- Test: `constants/__tests__/theme-tokens.test.ts` (extend)

**Interfaces:**
- Consumes: nothing
- Produces: `FontFamily.prose.regular` / `.italic` — used by Task 6.

**Why:** coaching feedback is writing by a coach, not UI chrome, but currently renders in the same family as button labels. A transitional serif separates the two. Chosen: **Newsreader** — it has a true italic, reads well at 15–17pt on device, and is on Google Fonts so it installs the same way the existing three families do.

- [x] **Step 1: Install the font package**

Run: `npx expo install @expo-google-fonts/newsreader`

- [x] **Step 2: Write the failing test**

Append to `constants/__tests__/theme-tokens.test.ts`:

```ts
import { FontFamily } from '../theme';

describe('prose type role', () => {
  it('exposes a serif family distinct from the UI family', () => {
    expect(FontFamily.prose.regular).toBe('Newsreader_400Regular');
    expect(FontFamily.prose.italic).toBe('Newsreader_400Regular_Italic');
  });

  it('does not disturb the existing three roles', () => {
    expect(FontFamily.body.regular).toBe('Inter_400Regular');
    expect(FontFamily.display.regular).toBe('Archivo_400Regular');
    expect(FontFamily.mono.regular).toBe('IBMPlexMono_400Regular');
  });
});
```

- [x] **Step 3: Run test to verify it fails**

Run: `npx jest constants/__tests__/theme-tokens.test.ts`
Expected: FAIL — `Cannot read properties of undefined (reading 'regular')` on `FontFamily.prose`.

- [x] **Step 4: Add the role to the theme**

In `constants/theme.ts`, add to the `FontFamily` object after the `mono` role:

```ts
  /** Coaching prose ONLY — per-pillar feedback and drill instructions (spec 2026-07-26 §3.2).
   * Never UI chrome: buttons, labels, tabs and every other control stay `body` (Inter). The
   * split exists because the feedback is writing by a coach, and rendering it in the same
   * family as a button label is what made it read as generated UI text. */
  prose: {
    regular: 'Newsreader_400Regular',
    italic: 'Newsreader_400Regular_Italic',
    semiBold: 'Newsreader_600SemiBold',
  },
```

- [x] **Step 5: Load the font at startup**

In `app/_layout.tsx`, add the import alongside the existing font imports:

```ts
import {
  Newsreader_400Regular,
  Newsreader_400Regular_Italic,
  Newsreader_600SemiBold,
} from '@expo-google-fonts/newsreader';
```

and add the three entries to the existing `useFonts({ ... })` call, after `IBMPlexMono_600SemiBold`:

```ts
    Newsreader_400Regular,
    Newsreader_400Regular_Italic,
    Newsreader_600SemiBold,
```

- [x] **Step 6: Run tests to verify they pass**

Run: `npx jest constants/__tests__/theme-tokens.test.ts`
Expected: PASS (5 tests).

Run: `npm run typecheck`
Expected: clean exit, no output.

- [x] **Step 7: Commit**

```bash
git add constants/theme.ts app/_layout.tsx package.json package-lock.json constants/__tests__/theme-tokens.test.ts
git commit -m "feat(theme): add a serif prose role for coaching feedback

Coaching feedback is writing by a coach, not UI chrome, but renders today in
the same family as button labels. Newsreader is used ONLY for per-pillar
feedback and drill instructions; every control stays Inter."
```

---

### Task 3: Sharpen card corners and add editorial spacing

**Files:**
- Modify: `constants/theme.ts` (`Radius`, `Spacing`)
- Test: `constants/__tests__/theme-tokens.test.ts` (extend)

**Interfaces:**
- Consumes: nothing
- Produces: `Radius.card: 0`, `Spacing.editorial: 96` — used by Tasks 5 and 6.

**Note:** this is the one non-additive change in the plan. It affects every card already using `Radius.card`, which is the intent — sharp corners read as document, rounded read as app.

- [x] **Step 1: Write the failing test**

Append to `constants/__tests__/theme-tokens.test.ts`:

```ts
describe('shape and rhythm', () => {
  it('squares off cards — sharp reads as document, rounded reads as app', () => {
    expect(Radius.card).toBe(0);
  });

  it('leaves sheets and pills alone (a pill is still a pill)', () => {
    expect(Radius.sheet).toBe(12);
    expect(Radius.pill).toBe(999);
  });

  it('adds one editorial gap above the brief’s ramp', () => {
    expect(Spacing.editorial).toBe(96);
    expect(Spacing.xxxl).toBe(48);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx jest constants/__tests__/theme-tokens.test.ts`
Expected: FAIL — `Radius.card` is 8, `Spacing.editorial` is `undefined`.

- [x] **Step 3: Write minimal implementation**

In `constants/theme.ts`, change `Radius.card` and add the comment:

```ts
export const Radius = {
  /** Cards. 0 by deliberate choice (spec 2026-07-26 §3.3): a sharp corner reads as a printed
   * document, a rounded one reads as a generic app card. */
  card: 0,
  /** Sheets, modals. */
  sheet: 12,
  /** Pills, chips. */
  pill: 999,
} as const;
```

and add one step to `Spacing`:

```ts
  /** The single large vertical gap that separates a result's hero from its readout (spec
   * 2026-07-26 §3.4). Not part of the brief's original ramp — use sparingly, once per screen. */
  editorial: 96,
```

- [x] **Step 4: Run the full suite — this change has reach**

Run: `npm test`
Expected: all suites pass. If a snapshot or layout assertion fails because it asserted `borderRadius: 8`, update that assertion to `0` — the token is the source of truth, and the test was locking the old value.

- [x] **Step 5: Commit**

```bash
git add constants/theme.ts constants/__tests__/theme-tokens.test.ts
git commit -m "feat(theme): square off cards, add an editorial spacing step

Radius.card 8 -> 0. Sheets and pills unchanged. Spacing.editorial (96) is the
one large gap separating a result's hero from its readout."
```

---

### Task 4: The duotone frame component

**Files:**
- Create: `components/duotone-frame.tsx`
- Test: `components/__tests__/duotone-frame.test.tsx`

**Interfaces:**
- Consumes: `Colors` from `constants/theme`
- Produces: `<DuotoneFrame uri={string} accessibilityLabel={string} testID?={string} />`

**Why:** a user's frame currently renders as a rounded thumbnail inside a card, which makes the photograph foreign to the interface. Full-bleed and graded, photograph and interface become one material — which is what brief §1 was reaching for.

**Grading constraint (from spec §3.5, non-negotiable):** grade toward the **warm** base. Brief §2 chose warm graphite/bone specifically because it flatters skin tones. A cold blue grade is clinical and unflattering on a human body. Implementation therefore uses a **warm low-opacity overlay**, never a hue rotation of the subject.

- [x] **Step 1: Write the failing test**

Create `components/__tests__/duotone-frame.test.tsx`:

```tsx
/**
 * Locks the two rules that make DuotoneFrame safe on real bodies (spec 2026-07-26 §3.5):
 * the grade is a warm overlay, never a hue shift of the subject; and the frame always carries
 * a text alternative (brief §7 requires the annotated hero to have one).
 */
import { render, screen } from '@testing-library/react-native';

import { DuotoneFrame } from '../duotone-frame';

describe('DuotoneFrame', () => {
  it('renders the supplied image', () => {
    render(<DuotoneFrame uri="file:///frame-01.jpg" accessibilityLabel="your running frame" testID="frame" />);
    expect(screen.getByTestId('frame')).toBeTruthy();
  });

  it('carries the text alternative brief §7 requires', () => {
    render(<DuotoneFrame uri="file:///frame-01.jpg" accessibilityLabel="your running frame" testID="frame" />);
    expect(screen.getByLabelText('your running frame')).toBeTruthy();
  });

  it('grades with a warm overlay rather than recolouring the subject', () => {
    render(<DuotoneFrame uri="file:///frame-01.jpg" accessibilityLabel="your running frame" testID="frame" />);
    const overlay = screen.getByTestId('frame-grade');
    const style = Array.isArray(overlay.props.style) ? Object.assign({}, ...overlay.props.style) : overlay.props.style;
    // A grade heavy enough to tint the interface, light enough to leave skin readable.
    expect(style.opacity).toBeLessThanOrEqual(0.2);
    expect(overlay.props.accessibilityElementsHidden).toBe(true);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx jest components/__tests__/duotone-frame.test.tsx`
Expected: FAIL — `Cannot find module '../duotone-frame'`.

- [x] **Step 3: Write minimal implementation**

Create `components/duotone-frame.tsx`:

```tsx
/**
 * A user's frame, full-bleed and graded into the palette (spec 2026-07-26 §3.5).
 *
 * WHY FULL-BLEED: rendering a photograph as a rounded thumbnail inside a card makes it foreign
 * to the interface. Bleeding it and grading it toward the app's base makes photograph and UI one
 * material — brief §1's "frames real photographic content with restraint", executed.
 *
 * WHY A WARM OVERLAY AND NOT A HUE SHIFT: brief §2 chose a warm graphite/bone base specifically
 * because it flatters skin tones. A cold duotone of the kind used on machinery photography is
 * clinical and unflattering on a human body. So the subject's own colour is never rotated — a
 * low-opacity warm wash sits over it, which unifies the surface without touching skin rendition.
 */
import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

/** Heavy enough to unify frame and interface, light enough that skin stays true. */
const GRADE_OPACITY = 0.14;

type DuotoneFrameProps = {
  /** Local or remote URI of the stored frame. */
  uri: string;
  /** Brief §7: the hero frame must carry a text alternative. */
  accessibilityLabel: string;
  testID?: string;
};

export function DuotoneFrame({ uri, accessibilityLabel, testID }: DuotoneFrameProps) {
  const scheme = useColorScheme() ?? 'light';
  const grade = Colors[scheme].background;

  return (
    <View style={styles.container} testID={testID}>
      <Image
        source={{ uri }}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        accessible
        accessibilityLabel={accessibilityLabel}
      />
      <View
        testID={testID ? `${testID}-grade` : undefined}
        style={[StyleSheet.absoluteFill, { backgroundColor: grade, opacity: GRADE_OPACITY }]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        pointerEvents="none"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    aspectRatio: 3 / 4,
  },
});
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx jest components/__tests__/duotone-frame.test.tsx`
Expected: PASS (3 tests).

If `useColorScheme` resolves from a different path in this repo, check `hooks/` and use the existing import that `components/pace-readout.tsx` uses — match the established pattern rather than inventing one.

- [x] **Step 5: Commit**

```bash
git add components/duotone-frame.tsx components/__tests__/duotone-frame.test.tsx
git commit -m "feat(ui): DuotoneFrame — the user's frame, full-bleed and graded warm

Grades with a low-opacity warm wash rather than a hue shift, because brief §2
chose a warm base to flatter skin tones and a cold duotone is unflattering on a
body. Carries the text alternative brief §7 requires."
```

---

### Task 5: The notched result card

**Files:**
- Create: `components/ui/notched-card.tsx`
- Test: `components/__tests__/notched-card.test.tsx`

**Interfaces:**
- Consumes: `Colors`, `Spacing` from `constants/theme`
- Produces: `<NotchedCard testID?={string}>{children}</NotchedCard>`

**Why:** a card that is not a rounded rectangle is the cheapest possible signal that this is not a template. Built from `View`s only — two small squares in the base colour, absolutely positioned over the card's mid-edges, read as die-cut notches. No SVG, no masking, no dependency.

- [x] **Step 1: Write the failing test**

Create `components/__tests__/notched-card.test.tsx`:

```tsx
/**
 * The result container is a notched rectangle, not a rounded card (spec 2026-07-26 §3.6).
 * Shape is the identity signal, so the notches are asserted present and asserted decorative —
 * they must never appear in the accessibility tree (brief §7).
 */
import { Text } from 'react-native';
import { render, screen } from '@testing-library/react-native';

import { NotchedCard } from '../ui/notched-card';

describe('NotchedCard', () => {
  it('renders its children', () => {
    render(
      <NotchedCard testID="card">
        <Text>Posture 72</Text>
      </NotchedCard>
    );
    expect(screen.getByText('Posture 72')).toBeTruthy();
  });

  it('renders two notches', () => {
    render(
      <NotchedCard testID="card">
        <Text>Posture 72</Text>
      </NotchedCard>
    );
    expect(screen.getByTestId('card-notch-left')).toBeTruthy();
    expect(screen.getByTestId('card-notch-right')).toBeTruthy();
  });

  it('hides the notches from assistive technology — they are decoration', () => {
    render(
      <NotchedCard testID="card">
        <Text>Posture 72</Text>
      </NotchedCard>
    );
    expect(screen.getByTestId('card-notch-left').props.accessibilityElementsHidden).toBe(true);
    expect(screen.getByTestId('card-notch-right').props.accessibilityElementsHidden).toBe(true);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx jest components/__tests__/notched-card.test.tsx`
Expected: FAIL — `Cannot find module '../ui/notched-card'`.

- [x] **Step 3: Write minimal implementation**

Create `components/ui/notched-card.tsx`:

```tsx
/**
 * The result container: a notched rectangle rather than a rounded card (spec 2026-07-26 §3.6).
 *
 * A card that is not a rounded rectangle is the cheapest available signal that a screen was
 * designed rather than templated. Built from plain Views — two circles in the page's own
 * background colour, centred on the left and right edges, read as die-cut notches. No SVG, no
 * mask, no dependency (see the spec's "net new runtime dependencies: none").
 *
 * The notches are pure decoration and are hidden from assistive technology (brief §7).
 */
import { StyleSheet, View, type ViewProps } from 'react-native';

import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

const NOTCH_DIAMETER = 24;

type NotchedCardProps = ViewProps & {
  testID?: string;
  children: React.ReactNode;
};

export function NotchedCard({ testID, children, style, ...rest }: NotchedCardProps) {
  const scheme = useColorScheme() ?? 'light';
  const page = Colors[scheme].background;
  const surface = Colors[scheme].surface;

  const notch = [
    styles.notch,
    { backgroundColor: page, width: NOTCH_DIAMETER, height: NOTCH_DIAMETER, borderRadius: NOTCH_DIAMETER / 2 },
  ];

  return (
    <View testID={testID} style={[styles.card, { backgroundColor: surface }, style]} {...rest}>
      {children}
      <View
        testID={testID ? `${testID}-notch-left` : undefined}
        style={[...notch, styles.notchLeft]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        pointerEvents="none"
      />
      <View
        testID={testID ? `${testID}-notch-right` : undefined}
        style={[...notch, styles.notchRight]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        pointerEvents="none"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: Spacing.xl,
    overflow: 'hidden',
  },
  notch: {
    position: 'absolute',
    top: '50%',
    marginTop: -NOTCH_DIAMETER / 2,
  },
  notchLeft: {
    left: -NOTCH_DIAMETER / 2,
  },
  notchRight: {
    right: -NOTCH_DIAMETER / 2,
  },
});
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx jest components/__tests__/notched-card.test.tsx`
Expected: PASS (3 tests).

Note: `overflow: 'hidden'` on the card will clip the notches. If they do not render visibly on device, remove `overflow: 'hidden'` from `styles.card` — the tests will still pass either way, so verify this one visually before committing.

- [x] **Step 5: Commit**

```bash
git add components/ui/notched-card.tsx components/__tests__/notched-card.test.tsx
git commit -m "feat(ui): NotchedCard — a die-cut result container, no SVG needed

Two background-coloured circles on the mid-edges read as notches. Shape is the
identity signal. Notches are decoration and hidden from assistive technology."
```

---

### Task 6: Adopt the new layer on the result screen

**Files:**
- Modify: `app/result/[id].tsx`
- Modify: `components/pace-readout.tsx` (feedback text style only)
- Test: `components/__tests__/pace-readout.test.tsx` (extend)

**Interfaces:**
- Consumes: `FontSize.hero`, `FontFamily.prose`, `Spacing.editorial`, `DuotoneFrame`, `NotchedCard`
- Produces: nothing downstream

**Scope discipline:** this is the ONE screen Phase 1 restyles. Home, capture, history and settings are deliberately untouched — they inherit only the `Radius.card` change from Task 3. Restyling every screen is a follow-up, not this task.

- [x] **Step 1: Write the failing test for the prose family**

Append to `components/__tests__/pace-readout.test.tsx`. This reuses the file's existing
`proTierVideoResult` fixture, its `await render(...)` convention, and the `pillar-feedback-*`
testIDs it already asserts against — do not introduce a second fixture:

```tsx
import { FontFamily } from '@/constants/theme';

describe('coaching feedback typography', () => {
  it('renders per-pillar feedback in the prose serif, not the UI family', async () => {
    await render(<PaceReadout result={proTierVideoResult} />);

    const feedback = screen.getByTestId('pillar-feedback-cadence');
    const style = Array.isArray(feedback.props.style)
      ? Object.assign({}, ...feedback.props.style)
      : feedback.props.style;

    expect(style.fontFamily).toBe(FontFamily.prose.regular);
  });

  it('leaves the measured score numeral in mono — only prose changes family', async () => {
    await render(<PaceReadout result={proTierVideoResult} />);

    const score = screen.getByTestId('pillar-score-cadence');
    const style = Array.isArray(score.props.style)
      ? Object.assign({}, ...score.props.style)
      : score.props.style;

    expect(style.fontFamily).toBe(FontFamily.mono.regular);
  });
});
```

If `pillar-score-cadence` is not the testID this file uses for the numeral, run
`grep -n "testID" components/pace-readout.tsx` and use the real one — the assertion matters, the
exact id does not.

- [x] **Step 2: Run test to verify it fails**

Run: `npx jest components/__tests__/pace-readout.test.tsx`
Expected: FAIL — `fontFamily` is `Inter_400Regular`.

- [x] **Step 3: Switch the feedback style to the prose family**

In `components/pace-readout.tsx`, find the style used for per-pillar `feedback` text and change only its `fontFamily`:

```ts
      fontFamily: FontFamily.prose.regular,
```

Leave every other style — pillar letter, name, score numeral, band word, labels — exactly as it is. Only the coaching prose changes family.

- [x] **Step 4: Run test to verify it passes**

Run: `npx jest components/__tests__/pace-readout.test.tsx`
Expected: PASS.

- [x] **Step 5: Apply the hero numeral and editorial gap**

In `app/result/[id].tsx`:
- Set the overall score numeral's `fontSize` to `FontSize.hero` and keep its existing `FontFamily.mono` family and colour.
- Add a `marginBottom: Spacing.editorial` to the container separating the hero frame from the PACE readout.
- **Dynamic Type guard (brief §7 forbids clipping the readout):** add `allowFontScaling` handling so the numeral shrinks rather than clips —

```tsx
<Text
  style={styles.overallNumeral}
  numberOfLines={1}
  adjustsFontSizeToFit
  minimumFontScale={0.5}
  accessibilityLabel={`Overall ${overall.score} out of 100, ${bandWord}`}>
  {overall.score}
</Text>
```

- [x] **Step 6: Wrap the hero frame and the readout**

Replace the existing thumbnail/card rendering of the hero frame with `DuotoneFrame`, and the readout's container with `NotchedCard`. Keep every existing accessibility label and the `not medical advice` disclaimer footer exactly where they are — brief §5 requires the disclaimer on every result.

- [x] **Step 7: Verify the whole suite**

Run: `npm test`
Expected: all suites pass.

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 8: Verify on device — this task is visual and tests cannot judge it** — PARTIAL: the dev server and a full iOS bundle were verified, the visual judgement was not. See "Outstanding: the device check" at the end of this file.

```bash
npx expo start --port 8090 --clear
```

Open a result and check: the numeral does not clip at the largest Dynamic Type setting; the notches are visible; the graded frame flatters rather than deadens skin; the serif feedback is readable at body size. **If the grade looks cold or muddy on a real body, reduce `GRADE_OPACITY` in `components/duotone-frame.tsx` or drop the grade to background-only.** That judgement is the point of this step.

> Port note: another Expo project on this machine (`~/Developer/rune`) sometimes holds port 8081, in which case `expo start` silently skips starting a server and Expo Go connects to the *other app*. Always pass an explicit `--port`, and if something looks wrong, check with `lsof -nP -iTCP:8090 -sTCP:LISTEN`.

- [x] **Step 9: Commit**

```bash
git add app/result/\[id\].tsx components/pace-readout.tsx components/__tests__/pace-readout.test.tsx
git commit -m "feat(ui): adopt the static redesign layer on the result screen

Hero numeral at FontSize.hero with adjustsFontSizeToFit so Dynamic Type shrinks
rather than clips (brief §7). Coaching feedback moves to the prose serif; every
other style is untouched. Hero frame renders full-bleed and graded; the readout
sits in a notched card. Disclaimer footer unchanged."
```

---

### Task 7: Record the amendments in the brief

**Files:**
- Modify: `docs/design/frontend-design-brief.md` (§2 tokens, and a new §2.1)

**Why:** the brief is the source of truth and is normally matched literally. A token set that has drifted from it silently is how the next person gets confused.

- [x] **Step 1: Amend §2's token tables**

Under `### Type (roles...)`, add:

```markdown
- **Prose:** **Newsreader** — coaching feedback and drill instructions ONLY, never UI chrome
  (amended 2026-07-26, spec `docs/superpowers/specs/2026-07-26-redesign-design.md` §3.2).
- Scale amended 2026-07-26: the six steps above are joined by `display 64` and `hero 96`, for at
  most ONE element per screen. The original 13→32 range (2.5×) is why no screen had hierarchy.
```

Under `### Spacing / radius / motion`, replace the radius sentence with:

```markdown
- Spacing ramp `4 · 8 · 12 · 16 · 24 · 32 · 48`, plus `editorial 96` for the single large gap on a
  result (amended 2026-07-26). Radius: **`0` cards** (amended 2026-07-26 — sharp reads as document,
  rounded reads as app), `12` sheets, `999` pills.
```

- [x] **Step 2: Add the motion budget, ready for Phase 2**

Add a new subsection at the end of §6:

```markdown
### 6.1 The motion budget (amended 2026-07-26)

Exactly three moments in this app animate: the app-launch intro, the first-run intro, and the
result reveal. **Nothing else animates.** No ambient motion, no decorative transitions, no
per-word reveals, no marquees or tickers.

This is a budget, not a guideline. Unwritten, "three moments" becomes the first three of eleven.
Phase 1 (the static layer) adds none of them; they are specified in
`docs/superpowers/specs/2026-07-26-redesign-design.md` §4 and built in Phase 2.
```

- [x] **Step 3: Verify nothing broke**

Run: `npm test`
Expected: all suites pass (docs-only change, but the knowledge-bundle verify step runs here too).

- [x] **Step 4: Commit**

```bash
git add docs/design/frontend-design-brief.md
git commit -m "docs(design): record the Phase 1 token amendments in the brief

The brief is the source of truth and is matched literally, so a token set that
drifts from it silently is how the next person gets confused. Also lands §6.1,
the motion budget Phase 2 will be held to."
```

---

## Phase 2 — not in this plan

The three animated moments (§4 of the spec) are a **separate plan**, to be written once Phase 1 is merged and has been looked at on a real device. Phase 2 builds `components/annotation-lines.tsx` once and wires three callers.

Do not start Phase 2 from this document — the visual judgement in Task 6 Step 8 should inform it.

## Verification checklist for the whole phase

- [x] `npm run typecheck` clean
- [x] `npm test` — all suites green (922 jest + 369 deno)
- [ ] Result screen checked on device at default AND largest Dynamic Type — **NOT DONE**, see below
- [ ] Result screen checked in both light and dark — **NOT DONE**, see below
- [ ] The duotone grade judged on a real body, not a placeholder — **NOT DONE**, see below
- [x] No new entry in `package.json` except `@expo-google-fonts/newsreader`

### Outstanding: the device check (Task 6 Step 8)

What WAS verified in the implementing environment:

- `npx expo start --port 8090 --clear` ran and the server was confirmed listening on 8090 via
  `lsof -nP -iTCP:8090 -sTCP:LISTEN` — no collision with the other Expo project on this machine.
- The full iOS bundle built from that server (HTTP 200, ~11.2 MB) with all three Newsreader faces
  and both new components resolved. So the new dependency and both components compile and link;
  what is unverified is purely how they LOOK.

Why the visual judgement could not be made there: the worktree has no `.env`, so the app cannot
reach Supabase and sign-in is impossible; the result screen therefore cannot be opened at all.
Expo Go was also not installed on the simulator, and there is no real stored analysis and no
photograph of a real body to grade against — which is precisely what the grade judgement needs.

Three judgements still need real device eyes before Phase 2 is planned:

1. Does the hero numeral clip or reflow acceptably at the largest Dynamic Type setting? (The
   numeral has `adjustsFontSizeToFit` + `minimumFontScale={0.5}`, and its row now wraps. The
   first-reveal path renders `AnimatedOverallNumeral`, a `TextInput`, which cannot take
   `adjustsFontSizeToFit` — that path is the one most likely to overflow at 96pt.)
2. Do the notches read as die-cut? Their fill contrast is imperceptible by measurement (1.07:1 on
   `surface.base`, 1.13:1 on `surface.raised`), so a hairline stroke was added to carry the shape.
   Whether that arc reads at 24pt diameter on a real screen is the open question.
3. Does the duotone grade flatter a real body or deaden it? If it looks cold or muddy on skin,
   lower `GRADE_OPACITY` in `components/duotone-frame.tsx` (currently `0.14`) or drop the grade to
   background-only, exactly as spec §3.5 allows.
