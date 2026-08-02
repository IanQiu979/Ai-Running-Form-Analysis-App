/**
 * Cloudflare Turnstile server-side verification (issue #12/Known Issue #12) — the check
 * `signup-with-captcha/index.ts` runs before ever calling `supabase.auth.signUp()`.
 *
 * FAILS CLOSED, deliberately, unlike `lib/hibp.ts` (client-side, fails open). This IS the
 * anti-farming gate itself — Known Issue #12's whole point was that disposable signup was
 * previously unthrottled. A network failure or malformed response from Cloudflare here must
 * refuse the signup, not silently let it through; the failure mode is "signup briefly
 * unavailable," never "CAPTCHA silently skipped."
 */
export interface CaptchaVerifier {
  verify(token: string, remoteIp: string | null): Promise<boolean>;
}

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export class TurnstileVerifier implements CaptchaVerifier {
  constructor(private readonly secretKey: string) {}

  async verify(token: string, remoteIp: string | null): Promise<boolean> {
    const body = new URLSearchParams({ secret: this.secretKey, response: token });
    if (remoteIp) {
      body.set('remoteip', remoteIp);
    }

    let response: Response;
    try {
      response = await fetch(SITEVERIFY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
    } catch {
      // Network failure reaching Cloudflare — fail closed, see this file's header.
      return false;
    }

    if (!response.ok) {
      return false;
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      return false;
    }

    return (
      typeof data === 'object' &&
      data !== null &&
      (data as { success?: unknown }).success === true
    );
  }
}
