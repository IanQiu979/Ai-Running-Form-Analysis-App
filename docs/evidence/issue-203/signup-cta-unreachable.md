## Summary

> **Superseded 2026-09-20.** The observation below was real but its reading was wrong: this was a
> test-harness artefact (iOS 26's "Use Strong Password?" panel over the CTA), not an app defect.
> See "Confirmed cause" further down; the original record is kept as written.

On the iOS EAS development build, email sign-up cannot proceed after Cloudflare Turnstile reports **Success!**. The `Create account` button is enabled in the native accessibility hierarchy but is not painted or reachable in the viewport. Maestro therefore taps the reported element without invoking account creation, and the screen remains on the sign-up form.

This was reproduced repeatedly while repairing issue #203's E2E flows. It blocks the sign-up leg independently of the later analysis flow.

## Environment

- EAS development build: `dbd22da6-b42b-4d4b-a270-0e6fd138e42b` (`dbd22da6`)
- Bundle ID: `com.ian.paceanalysisai`
- Simulator: `PACE-e2e-203`, iPhone 17 (`iPhone18,3`)
- Simulator runtime: iOS 26.5
- Maestro: 1.39.0
- Launch: headless `xcrun simctl`, Metro on port 8093

## Reproduction

1. Fresh-install the development `.app` on the booted simulator.
2. Launch it with the Metro URL.
3. Continue through Welcome and Details to the sign-up screen.
4. Enter a unique synthetic email and valid password.
5. Check the 16+/Terms consent checkbox.
6. Complete Turnstile and wait for **Success!**.
7. Attempt to scroll to and activate `Create account`.

Observed: `auth-email-submit` is present with `enabled=true` and bounds `[24,472][378,528]` in the iOS accessibility hierarchy. It is nevertheless absent from the screenshot. `scrollUntilVisible`, a background-only upward swipe, a fresh visible/enabled assertion, and tapping the stable ID all leave the form unchanged.

Expected: the enabled `Create account` button is visibly reachable and activates account creation.

## Evidence

### Immediately before the stable-ID tap

![Turnstile succeeds but Create account is not painted](https://raw.githubusercontent.com/IanQiu979/v2.3_RunningFormAna/fm/v23-e2e-dev-build-203/docs/evidence/issue-203/signup-cta-before-tap.png)

### Final failed Home assertion

![The sign-up form remains after tapping the enabled submit ID](https://raw.githubusercontent.com/IanQiu979/v2.3_RunningFormAna/fm/v23-e2e-dev-build-203/docs/evidence/issue-203/signup-cta-final-failure.png)

The task branch contains the original PNG evidence at the linked paths; the links render once that branch is published by the no-mistakes pipeline.

## Confirmed cause (2026-09-20, issue #230 — a test-harness artefact, not an app defect)

Reproduced with the same EAS development build (`dbd22da6`) on a fresh iPhone 17 / iOS 26.5
simulator, Metro serving `main`'s `app/(auth)/sign-in.tsx` unchanged. The "Likely cause" below
was wrong on both counts, and so was the later overflow-centring theory (that `flexGrow: 1` +
`justifyContent: 'center'` pins the content container to the viewport and clips both ends):

1. **The layout is sound.** With the keyboard down, the whole sign-up form — header, both fields,
   consent row, the 70 pt Turnstile box, both buttons and the footer — fits the 402 × 874 viewport
   and is vertically centred with spare room top and bottom
   (`../issue-230/form-fits-centred-iphone17.png`). When the viewport is shrunk by a keyboard the
   content container grows to the content's height and the `ScrollView` scrolls: an in-viewport
   swipe brings `auth-email-submit` from y 472 to y 229 and it is painted and tappable
   (`../issue-230/scrolls-under-panel.png`). Both halves of the "centre when it fits, scroll when it
   does not" contract already hold.
2. **The blank region IS the keyboard window.** A `xcrun simctl io <udid> screenshot` of the very
   state the two PNGs above capture shows iOS 26's **"Use Strong Password?" panel** occupying
   y 459–874 (`../issue-230/strong-password-panel-under-cta.png`). It is presented the moment the
   empty `textContentType="newPassword"` field is focused, it is **415 pt tall** against the plain
   keyboard's 308 pt, and `KeyboardAvoidingView` (`behavior="padding"`) pads for it exactly as it
   should — the `ScrollView` frame ends at y 459 and "Create account" (y 472–528) sits under the
   panel. Nothing in the flow ever resigns the password field: the consent tap is handled by its
   own `Pressable` (`keyboardShouldPersistTaps="handled"` keeps the keyboard), and Cloudflare
   auto-resolves, so the widget is never tapped. The KAV padding "remained applied" because the
   keyboard remained presented; there is no stuck-padding bug.
3. **Why the evidence looked like a paint failure.** Maestro's screenshots come from XCTest,
   which does not render the keyboard window — so the panel is invisible in
   `signup-cta-before-tap.png` and `signup-cta-final-failure.png` while every app pixel above it
   is real. Maestro judges `visible` by window bounds, so `scrollUntilVisible` saw `[24,472]
   [378,528]` inside the screen and never scrolled; the "background-only upward swipe" from 88 %
   and the final tap both landed on the panel. The panel's own elements carry no labels in the
   accessibility tree (`maestro hierarchy` shows only unlabelled frames at `[0,459][402,874]`),
   which is why nothing in the hierarchy explained the gap.
4. **A second, hidden blocker behind the first.** The same panel swallows every character
   `inputText` types after the first: the field's hierarchy value is a single `•` (the
   screenshot's "empty" password field is one bullet). Even once the CTA is reached, submit fails
   locally with "Password must be at least 8 characters" (verified). Tapping the panel's close X
   first — which does accept an XCTest tap — lets all 20 characters land, and the plain keyboard
   that follows (308 pt) leaves "Create account" visible above it
   (`../issue-230/after-panel-dismissed-keyboard-cta-visible.png`).

**What a person sees on a device is different**: the panel is visible to them and they either
take the suggested password or close it, exactly as the captain did on 2026-09-20 when a new
email sign-up on his iPhone completed normally. No app or layout change was made.

**Fix (in `.maestro/flows/subflows/sign-up.yaml`, 2026-09-20):** after focusing the password
field, dismiss the panel when the keyboard's return key is absent from the tree (the proxy for
"the panel is up"), type, then drop the keyboard with a tap on the title so the form re-centres,
and never swipe the background blindly. Verified live: the subflow reached Home on the
development build and `maestro.e2e+1789873122029@example.com` was created in the live project
at 02:59:09 UTC (`../issue-230/signup-reaches-home.png`).

## Likely cause (as written 2026-09-19 — superseded above)

The software keyboard is dismissed and absent in both screenshots, so keyboard avoidance/inset handling is unlikely to be the primary cause. The stronger signal is a layout/paint mismatch around the Turnstile `WebView`: React Native exposes the following button with valid on-screen accessibility bounds while the pixels remain blank. Investigate the fixed Turnstile widget height and its interaction with the centered `ScrollView` content/z-order before changing keyboard handling.

No app layout fix was attempted in the E2E lane.
