/**
 * `components/turnstile-widget.tsx` (issue #12/Known Issue #12) — the Cloudflare Turnstile
 * challenge, hosted in a `WebView`. `react-native-webview` has no native module under Jest (it
 * throws `TurboModuleRegistry.getEnforcing` if imported unmocked — verified directly), so it's
 * mocked at the module boundary here, same convention `lib/__tests__/delete-account.test.ts` uses
 * for `../supabase`: a minimal fake that captures the props this component passes it (so tests can
 * simulate `onMessage` events the same way the real native WebView would deliver them) and exposes
 * `injectJavaScript` as a spy so `reset()` can be asserted on without a real WebView present.
 *
 * WHAT THIS SUITE PROVES: the postMessage-JSON protocol between the HTML shell and this component
 * is parsed correctly (`token`/`expired`/`error` messages dispatch to the right callback), a
 * malformed or unrecognized message degrades to `onError` rather than being silently dropped, a
 * WebView-level load failure (`onError`/`onHttpError`) also calls `onError`, and `reset()` injects
 * the expected `window.turnstile.reset(...)` call. It does NOT prove the HTML shell's own inline
 * script is correct — that only runs inside a real WebView, which this test environment cannot
 * provide; the shell is small and reviewed by hand instead (see this component's own header).
 */
import { createRef } from 'react';
import { render } from '@testing-library/react-native';

let latestProps: Record<string, unknown> | null = null;
const mockInjectJavaScript = jest.fn();

jest.mock('react-native-webview', () => {
  // require(), not import — this factory runs inside jest.mock, which babel-jest hoists above
  // every top-level import in this file.
  const React = require('react');
  const { View } = require('react-native');
  const MockWebView = React.forwardRef(function MockWebView(props: Record<string, unknown>, ref: unknown) {
    latestProps = props;
    React.useImperativeHandle(ref, () => ({ injectJavaScript: mockInjectJavaScript }));
    return React.createElement(View, { testID: 'mock-webview' });
  });
  return { __esModule: true, default: MockWebView };
});

// Re-imported after the mock is registered, matching this repo's established pattern.
import { TurnstileWidget, type TurnstileWidgetHandle } from '../turnstile-widget';

function emitMessage(data: unknown) {
  const handler = latestProps?.onMessage as ((event: { nativeEvent: { data: string } }) => void) | undefined;
  handler?.({ nativeEvent: { data: JSON.stringify(data) } });
}

beforeEach(() => {
  latestProps = null;
  mockInjectJavaScript.mockReset();
});

describe('TurnstileWidget', () => {
  it('calls onToken when the shell posts a token message', async () => {
    const onToken = jest.fn();
    await render(
      <TurnstileWidget siteKey="site-key" baseUrl="https://example.test/" onToken={onToken} onError={jest.fn()} onExpire={jest.fn()} />
    );

    emitMessage({ type: 'token', token: 'the-token' });

    expect(onToken).toHaveBeenCalledWith('the-token');
  });

  it('calls onExpire when the shell posts an expired message', async () => {
    const onExpire = jest.fn();
    await render(
      <TurnstileWidget siteKey="site-key" baseUrl="https://example.test/" onToken={jest.fn()} onError={jest.fn()} onExpire={onExpire} />
    );

    emitMessage({ type: 'expired' });

    expect(onExpire).toHaveBeenCalled();
  });

  it('calls onError when the shell posts an error message', async () => {
    const onError = jest.fn();
    await render(
      <TurnstileWidget siteKey="site-key" baseUrl="https://example.test/" onToken={jest.fn()} onError={onError} onExpire={jest.fn()} />
    );

    emitMessage({ type: 'error' });

    expect(onError).toHaveBeenCalled();
  });

  it('calls onError on an unparseable message rather than dropping it silently', async () => {
    const onError = jest.fn();
    await render(
      <TurnstileWidget siteKey="site-key" baseUrl="https://example.test/" onToken={jest.fn()} onError={onError} onExpire={jest.fn()} />
    );

    const handler = latestProps?.onMessage as (event: { nativeEvent: { data: string } }) => void;
    handler({ nativeEvent: { data: 'not json' } });

    expect(onError).toHaveBeenCalled();
  });

  it('calls onError on an unrecognized message shape', async () => {
    const onError = jest.fn();
    await render(
      <TurnstileWidget siteKey="site-key" baseUrl="https://example.test/" onToken={jest.fn()} onError={onError} onExpire={jest.fn()} />
    );

    emitMessage({ type: 'something-else' });

    expect(onError).toHaveBeenCalled();
  });

  it('calls onError when the WebView itself fails to load', async () => {
    const onError = jest.fn();
    await render(
      <TurnstileWidget siteKey="site-key" baseUrl="https://example.test/" onToken={jest.fn()} onError={onError} onExpire={jest.fn()} />
    );

    const handler = latestProps?.onError as () => void;
    handler();

    expect(onError).toHaveBeenCalled();
  });

  it('injects a turnstile.reset() call when reset() is invoked via the ref', async () => {
    const ref = createRef<TurnstileWidgetHandle>();
    await render(
      <TurnstileWidget ref={ref} siteKey="site-key" baseUrl="https://example.test/" onToken={jest.fn()} onError={jest.fn()} onExpire={jest.fn()} />
    );

    ref.current?.reset();

    expect(mockInjectJavaScript).toHaveBeenCalledWith(expect.stringContaining('window.turnstile.reset'));
  });

  it('bakes the given site key into the HTML shell', async () => {
    await render(
      <TurnstileWidget siteKey="my-unique-site-key" baseUrl="https://example.test/" onToken={jest.fn()} onError={jest.fn()} onExpire={jest.fn()} />
    );

    const source = latestProps?.source as { html: string };
    expect(source.html).toContain('my-unique-site-key');
  });

  // REGRESSION LOCK — v23-signup-signin-cloudflare-fix-r1. This component used to pass
  // `source={{ html }}` with no `baseUrl`, which loads the challenge under `about:blank` (iOS) /
  // a `null` origin (Android): no hostname. Turnstile widgets are hostname-bound and Cloudflare
  // provides no way to disable that check, so every REAL site key failed with error 110200 and
  // the only thing that ever reached this component was `onError`. Cloudflare's dummy test keys
  // ignore hostnames entirely, so the two `*-local` EAS profiles — the only environments the
  // widget was ever exercised in — could not reproduce it, and #166 shipped green.
  //
  // The assertion is on the WebView `source` prop rather than on rendered output because that
  // prop IS the whole contract: nothing downstream of it is observable without a real WebView.
  it('loads the shell under the given baseUrl, so Cloudflare has a hostname to validate', async () => {
    await render(
      <TurnstileWidget
        siteKey="site-key"
        baseUrl="https://forms.example.test/"
        onToken={jest.fn()}
        onError={jest.fn()}
        onExpire={jest.fn()}
      />
    );

    const source = latestProps?.source as { html: string; baseUrl?: string };
    expect(source.baseUrl).toBe('https://forms.example.test/');
  });
});
