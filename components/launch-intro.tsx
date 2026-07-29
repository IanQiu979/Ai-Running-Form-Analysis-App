/**
 * Moment 1 (spec 2026-07-26 §4): the ground rule alone, drawn left→right, <=400ms, on every cold
 * start. This is the riskiest of the three moments — seen constantly by someone who only wants to
 * check their quota — so it is the shortest and the only interruptible one.
 *
 * WARM-START SAFETY BY CONSTRUCTION, NOT A FLAG: `app/_layout.tsx` mounts this once per process
 * lifetime — `RootLayoutNav` does not remount across backgrounding/foregrounding, only a killed-
 * and-relaunched process re-creates it. So there is nothing to persist here: "warm starts are not
 * cold starts" falls out of the same "no remount, no replay" guarantee
 * `components/pace-reveal.tsx` and `components/pace-readout.tsx` already rely on for their own
 * one-time reveals.
 *
 * Interruptible: the whole overlay is a `Pressable`, and a tap calls `onDone` immediately,
 * regardless of how far the line has drawn — never trap a user behind branding.
 */
import { useEffect, useRef } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { AnnotationLines, type AnnotationLine } from '@/components/annotation-lines';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useReducedMotion } from '@/hooks/use-reduced-motion';

/** The ground rule alone — the same fixed position `DuotoneFrame`/`FirstRunIntro` use for their
 * own ground rule, so the mark reads as the same line throughout the app. */
const GROUND_RULE: AnnotationLine = { id: 'ground', top: '82%', left: '10%', width: '80%' };

type LaunchIntroProps = {
  onDone: () => void;
};

export function LaunchIntro({ onDone }: LaunchIntroProps) {
  const scheme = useColorScheme() ?? 'light';
  const reduceMotion = useReducedMotion();
  const doneRef = useRef(false);

  const finish = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    onDone();
  };

  useEffect(() => {
    // Reduced motion: `AnnotationLines` itself snaps the line to fully drawn and fires its own
    // `onComplete` synchronously-ish from an effect — this one exists only as a belt-and-braces
    // fallback in case that path is ever skipped, so `onDone` is never missed.
    if (reduceMotion) finish();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- finish is stable via doneRef
  }, [reduceMotion]);

  return (
    <Pressable
      testID="launch-intro-overlay"
      accessibilityRole="button"
      accessibilityLabel="Skip intro"
      style={[styles.overlay, { backgroundColor: Colors[scheme].background }]}
      onPress={finish}>
      <AnnotationLines lines={[GROUND_RULE]} play onComplete={finish} testID="launch-intro" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10,
  },
});
