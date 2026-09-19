## Summary

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

## Likely cause

The software keyboard is dismissed and absent in both screenshots, so keyboard avoidance/inset handling is unlikely to be the primary cause. The stronger signal is a layout/paint mismatch around the Turnstile `WebView`: React Native exposes the following button with valid on-screen accessibility bounds while the pixels remain blank. Investigate the fixed Turnstile widget height and its interaction with the centered `ScrollView` content/z-order before changing keyboard handling.

No app layout fix was attempted in the E2E lane.
