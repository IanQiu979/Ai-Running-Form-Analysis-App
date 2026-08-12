/**
 * Renders a Cloudflare Turnstile challenge inside a `WebView` (issue #12/Known Issue #12).
 * Turnstile is a web widget with no first-party React Native SDK, so this hosts a minimal HTML
 * shell that loads Cloudflare's own `turnstile/v0/api.js` and bridges its callbacks back to RN via
 * `window.ReactNativeWebView.postMessage`. Used only on the sign-up path
 * (`app/(auth)/sign-in.tsx`) — sign-in never renders this.
 *
 * Turnstile tokens are SINGLE-USE: once `signup-with-captcha` verifies one against Cloudflare's
 * siteverify API, it cannot be reused, even if the signup attempt then fails for an unrelated
 * reason (a weak password, an already-registered email). The caller MUST call `reset()` via ref
 * after every submit attempt — success or failure — to get a fresh token queued up for the next
 * one; this component does not reset itself, since it has no way to know a submission happened.
 *
 * `size="invisible"` would remove the visible checkbox entirely, but Cloudflare's own guidance is
 * that a managed/non-interactive widget (`appearance: 'always'`, the default) gives users a clear
 * signal that a check ran — kept visible deliberately, matching the "no dark patterns" spirit of
 * this app's other consent-adjacent UI (see `docs/design/copy-deck.md`).
 *
 * `baseUrl` IS LOAD-BEARING, NOT COSMETIC. Turnstile widgets are hostname-bound and Cloudflare
 * offers no way to disable that check, so the HTML below must be loaded under a hostname on the
 * widget's allow list or `challenges.cloudflare.com` refuses it with error 110200 and the only
 * thing that reaches this component is `onError`. `source={{ html }}` alone loads under
 * `about:blank`/a `null` origin — no hostname — which a real production site key can never pass.
 * `lib/turnstile-config.ts` owns picking the value and explains why this went unnoticed until
 * production; this component just refuses to render without one.
 */
import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import WebView, { type WebViewMessageEvent } from 'react-native-webview';

import { Colors, Radius, type ColorScheme } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export interface TurnstileWidgetHandle {
  /** Forces Cloudflare's own widget to discard its current token and issue a fresh one. Call
   * this after every submit attempt (success or failure) — see this file's header. */
  reset: () => void;
}

interface TurnstileWidgetProps {
  siteKey: string;
  /** The URL the challenge HTML is loaded under — its hostname must be on the widget's allow
   * list in Cloudflare. Required; see this file's header for why there is no sane default. */
  baseUrl: string;
  onToken: (token: string) => void;
  /** Fired on a Cloudflare-reported verification error OR on the WebView itself failing to load
   * the challenge shell (no network, DNS failure, etc.) — the caller can't tell these apart and
   * shouldn't need to; both mean "no usable token right now." */
  onError: () => void;
  /** The current token expired before it was used (Cloudflare's own `expired-callback`) — the
   * caller should clear any token it was holding and wait for a fresh `onToken`. */
  onExpire: () => void;
}

function buildHtml(siteKey: string): string {
  // `secure_challenge` / `turnstile-container` — kept intentionally tiny; this shell exists only
  // to host the widget, never any other content, so it carries no theme tokens or app styling.
  return `<!DOCTYPE html>
<html>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
    <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
    <style>
      html, body { margin: 0; padding: 0; display: flex; align-items: center; justify-content: center; background: transparent; }
    </style>
  </head>
  <body>
    <div id="turnstile-container"></div>
    <script>
      function post(message) {
        if (window.ReactNativeWebView) {
          window.ReactNativeWebView.postMessage(JSON.stringify(message));
        }
      }
      window.onloadTurnstileCallback = function () {
        window.turnstileWidgetId = window.turnstile.render('#turnstile-container', {
          sitekey: '${siteKey}',
          callback: function (token) { post({ type: 'token', token: token }); },
          'error-callback': function () { post({ type: 'error' }); },
          'expired-callback': function () { post({ type: 'expired' }); },
        });
      };
      // Cloudflare's script calls this once it's loaded and ready to render.
      window.onload = function () {
        if (window.turnstile) {
          window.onloadTurnstileCallback();
        }
      };
    </script>
  </body>
</html>`;
}

export const TurnstileWidget = forwardRef<TurnstileWidgetHandle, TurnstileWidgetProps>(
  function TurnstileWidget({ siteKey, baseUrl, onToken, onError, onExpire }, ref) {
    const scheme: ColorScheme = useColorScheme() ?? 'light';
    const colors = Colors[scheme];
    const webViewRef = useRef<WebView>(null);
    const [html] = useState(() => buildHtml(siteKey));

    useImperativeHandle(ref, () => ({
      reset: () => {
        webViewRef.current?.injectJavaScript(
          'if (window.turnstile && window.turnstileWidgetId !== undefined) { window.turnstile.reset(window.turnstileWidgetId); } true;'
        );
      },
    }));

    function handleMessage(event: WebViewMessageEvent) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(event.nativeEvent.data);
      } catch {
        onError();
        return;
      }
      if (typeof parsed !== 'object' || parsed === null) {
        onError();
        return;
      }
      const message = parsed as { type?: unknown; token?: unknown };
      if (message.type === 'token' && typeof message.token === 'string') {
        onToken(message.token);
      } else if (message.type === 'expired') {
        onExpire();
      } else if (message.type === 'error') {
        onError();
      } else {
        // An unrecognized shape (or a 'token' message with a non-string token) is treated the
        // same as a genuine error — better to tell the user nothing came through than to
        // silently drop it and leave the submit button disabled with no explanation.
        onError();
      }
    }

    return (
      <View
        style={[
          styles.container,
          { backgroundColor: colors.surface.base, borderColor: colors.control.border },
        ]}>
        <WebView
          ref={webViewRef}
          testID="turnstile-webview"
          // `baseUrl` is what gives this page a hostname for Cloudflare to check — see the
          // header. Dropping it back to a bare `{ html }` reintroduces the exact 110200 that
          // made sign-up impossible for every real site key.
          source={{ html, baseUrl }}
          onMessage={handleMessage}
          onError={onError}
          onHttpError={onError}
          style={styles.webview}
          // Nothing in this shell needs JS-injected storage/cookies beyond what Cloudflare's own
          // script requires to function — no app data ever crosses into this WebView.
          javaScriptEnabled
          originWhitelist={['*']}
          scrollEnabled={false}
        />
      </View>
    );
  }
);

const WIDGET_HEIGHT = 70;

const styles = StyleSheet.create({
  container: {
    height: WIDGET_HEIGHT,
    borderRadius: Radius.card,
    borderWidth: 1,
    overflow: 'hidden',
  },
  webview: {
    flex: 1,
    backgroundColor: 'transparent',
  },
});
