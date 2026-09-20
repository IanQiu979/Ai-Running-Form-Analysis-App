/**
 * The one-time age screen for an account an OAuth provider created (2026-09-20). Email sign-up
 * records the age band inside `signup-with-captcha`; a "Continue with Google" account is minted
 * by GoTrue inside the browser exchange, where no request body of ours travels, so its band is
 * asked for HERE, on first use, and persisted through `record-age-band` — the same copy, the same
 * `AgeBandChoiceGroup`, the same server write and the same policy stamp as the sign-up form.
 *
 * WHERE IT SITS. `app/(tabs)/_layout.tsx` wraps the tab navigator in it: the navigator is the
 * child, the gate an overlay above it covering Home and History — the two surfaces every other
 * protected route is reached from. It is not a route of its own: a route needs a navigation
 * decision in the root layout keyed on an async profile read, and an overlay needs none (the
 * navigator underneath keeps its state and simply becomes usable when the gate lifts). While the
 * gate is up the child is hidden from assistive technology too (`accessibilityViewIsModal` on the
 * overlay for VoiceOver, `importantForAccessibility="no-hide-descendants"` on the child for
 * TalkBack) — an absolutely positioned sibling alone does not take Home out of the a11y tree.
 *
 * WHO SEES IT — `lib/age-band.ts`'s `isOAuthCreatedAccount` AND no band on file. An email account
 * never sees it (it answered at sign-up, or pre-dates the question and is deliberately left
 * alone). For a Google account the profile is read ONCE PER ACCOUNT PER DEVICE: a successful read
 * or write leaves a local note (`markAgeBandRecordedLocally`, safe because the band is write-once)
 * and later launches skip the network entirely, so an account that answered is never walled by an
 * offline launch. While a read is in flight the overlay is a blank canvas with Sign out rather
 * than nothing, so Home is never usable for a beat before the question lands. A read failure
 * FAILS CLOSED with a Retry — `readAgeBand` throws rather than guessing, and "could not check" is
 * not "checked and fine" — plus Sign out, so the screen is never a dead end.
 *
 * Write-once on the server: a `age_band_already_recorded` answer means a band is on file (a retry
 * after a dropped response, or a second device racing this one); the gate re-reads the profile,
 * which records the local note and lifts it.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AgeBandChoiceGroup, selectionOf } from '@/components/age-band-choice';
import { SquareButton } from '@/components/ui/square-button';
import { Copy } from '@/constants/copy';
import { ContentWidth } from '@/constants/theme';
import { Ink, Layout, Space, Type } from '@/constants/v23-theme';
import {
  describeRecordAgeBandError,
  hasAgeBandBeenRecordedLocally,
  isOAuthCreatedAccount,
  markAgeBandRecordedLocally,
  readAgeBand,
  recordAgeBand,
  type AgeBand,
} from '@/lib/age-band';
import { useSession } from '@/lib/session-provider';
import { signOut } from '@/lib/sign-out';
import { useAnnounce } from '@/lib/use-announce';

type Phase = 'hidden' | 'checking' | 'ask' | 'loadError';

type Props = {
  /** The signed-in surface the gate covers (the tab navigator). */
  children: ReactNode;
};

export function AgeBandGate({ children }: Props) {
  const { session } = useSession();
  const insets = useSafeAreaInsets();
  const candidate = isOAuthCreatedAccount(session);
  const userId = session?.user.id ?? null;

  const [phase, setPhase] = useState<Phase>(candidate ? 'checking' : 'hidden');
  const [ageBand, setAgeBand] = useState<AgeBand | null>(null);
  const [guardianConsent, setGuardianConsent] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selection = selectionOf(ageBand, guardianConsent);

  // Unmount guard, same shape as consent-gate.tsx: a late resolve must not touch state.
  const unmountedRef = useRef(false);
  useEffect(() => () => { unmountedRef.current = true; }, []);

  const check = useCallback(async () => {
    if (userId === null) return;
    setPhase('checking');
    setError(null);
    if (await hasAgeBandBeenRecordedLocally(userId)) {
      if (!unmountedRef.current) setPhase('hidden');
      return;
    }
    try {
      const band = await readAgeBand();
      if (unmountedRef.current) return;
      if (band !== null) await markAgeBandRecordedLocally(userId);
      if (unmountedRef.current) return;
      setPhase(band === null ? 'ask' : 'hidden');
    } catch {
      if (unmountedRef.current) return;
      setPhase('loadError');
    }
  }, [userId]);

  // Re-checked whenever the signed-in user changes (a sign-out followed by a different Google
  // account signing in on the same mounted navigator must ask again for the new account).
  useEffect(() => {
    if (!candidate) {
      setPhase('hidden');
      return;
    }
    void check();
  }, [candidate, userId, check]);

  useAnnounce(error ?? (phase === 'ask' ? Copy.auth.ageGate.title : null));

  async function handleSubmit() {
    if (selection === null || pending || userId === null) return;
    setPending(true);
    setError(null);
    const result = await recordAgeBand(selection);
    if (unmountedRef.current) return;
    if (result.ok) {
      await markAgeBandRecordedLocally(userId);
      if (unmountedRef.current) return;
      setPending(false);
      setPhase('hidden');
      return;
    }
    setPending(false);
    if (result.code === 'age_band_already_recorded') {
      // A band is on file (a dropped response retried, or another device got there first). The
      // profile is the authority on which one — re-read it rather than trust this call's input.
      void check();
      return;
    }
    setError(describeRecordAgeBandError(result.code));
  }

  async function handleSignOut() {
    if (pending) return;
    setPending(true);
    setError(null);
    // Never rejects (lib/sign-out.ts). `ok` and `globalRevokeFailed` both clear the local session,
    // so the route guard unmounts this whole tree; `stillSignedIn` is the one state where nothing
    // happened, and saying nothing about it would leave the user tapping a dead link.
    const result = await signOut();
    if (unmountedRef.current) return;
    setPending(false);
    if (!result.ok && result.reason === 'stillSignedIn') {
      setError(Copy.settings.signOutError.stillSignedIn.body);
    }
  }

  const gateUp = phase !== 'hidden';

  const signOutLink = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={Copy.auth.ageGate.signOut}
      accessibilityState={{ disabled: pending }}
      disabled={pending}
      onPress={handleSignOut}
      style={styles.textLink}
      testID="age-gate-sign-out">
      <Text style={styles.textLinkLabel}>{Copy.auth.ageGate.signOut}</Text>
    </Pressable>
  );

  return (
    <View style={styles.host}>
      <View
        style={styles.host}
        testID="age-band-gate-content"
        importantForAccessibility={gateUp ? 'no-hide-descendants' : 'auto'}>
        {children}
      </View>
      {gateUp && (
        <View style={styles.overlay} testID="age-band-gate" accessibilityViewIsModal>
          {phase === 'checking' ? (
            <View style={styles.checking} accessibilityLabel={Copy.auth.ageGate.loading}>
              <ActivityIndicator color={Ink.ink2} />
              {error !== null && (
                <Text style={styles.error} accessibilityLiveRegion="polite">
                  {error}
                </Text>
              )}
              {signOutLink}
            </View>
          ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[
            styles.frame,
            {
              paddingTop: Math.max(insets.top, Layout.canvas.safeTop),
              paddingBottom: Math.max(insets.bottom, Layout.canvas.safeBottom),
            },
          ]}
          keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <Text style={styles.eyebrow}>{Copy.auth.ageGate.eyebrow}</Text>
            <Text style={styles.title} accessibilityRole="header">
              {Copy.auth.ageGate.title}
            </Text>
            <Text style={styles.body}>
              {phase === 'loadError' ? Copy.auth.ageGate.error.load : Copy.auth.ageGate.body}
            </Text>
          </View>

          {phase === 'ask' && (
            <AgeBandChoiceGroup
              value={ageBand}
              onChange={(band) => {
                setAgeBand(band);
                if (band !== '13_17') setGuardianConsent(false);
                setError(null);
              }}
              guardianConsent={guardianConsent}
              onToggleGuardianConsent={() => setGuardianConsent((checked) => !checked)}
              disabled={pending}
              testIDPrefix="age-gate"
            />
          )}

          {error !== null && (
            <Text style={styles.error} accessibilityLiveRegion="polite">
              {error}
            </Text>
          )}

          <View style={styles.actions}>
            {phase === 'loadError' ? (
              <SquareButton
                label={Copy.auth.ageGate.error.retry}
                onPress={() => void check()}
                testID="age-gate-retry"
              />
            ) : (
              <SquareButton
                label={Copy.auth.ageGate.submit}
                onPress={handleSubmit}
                disabled={pending || selection === null}
                busy={pending}
                testID="age-gate-submit"
              />
            )}
            {signOutLink}
          </View>
        </ScrollView>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    start: 0,
    end: 0,
    backgroundColor: Ink.bg,
  },
  checking: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space.lg,
    paddingHorizontal: Layout.gutter,
  },
  scroll: {
    flex: 1,
  },
  frame: {
    flexGrow: 1,
    width: '100%',
    maxWidth: ContentWidth.readable,
    alignSelf: 'center',
    paddingHorizontal: Layout.gutter,
    justifyContent: 'center',
    gap: Space.xl,
  },
  header: {
    gap: Space.sm,
  },
  eyebrow: {
    ...Type.label,
    color: Ink.ink2,
  },
  title: {
    ...Type.displaySm,
    color: Ink.ink,
  },
  body: {
    ...Type.body,
    color: Ink.ink2,
  },
  error: {
    ...Type.small,
    color: Ink.danger,
  },
  actions: {
    gap: Space.lg,
  },
  textLink: {
    alignSelf: 'center',
    minHeight: Layout.hitTarget,
    justifyContent: 'center',
    paddingHorizontal: Space.lg,
  },
  textLinkLabel: {
    ...Type.small,
    color: Ink.ink2,
    textDecorationLine: 'underline',
  },
});
