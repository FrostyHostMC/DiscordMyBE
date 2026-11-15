import { useCallback, useRef } from 'react';
import { useAudioContext } from '@aippy/runtime/audio';
import * as Tone from 'tone';

/**
 * Minecraft-style block SFX (synthesized with Tone.js — no audio files).
 * - playDing       -> wooden block PLACE (success feedback)
 * - playToggleOn   -> soft block PLACE
 * - playToggleOff  -> block BREAK (granular crumble)
 */
export function useSFX() {
  const { getAudioContext, unlock } = useAudioContext();
  // Reusable nodes, created once after the audio context is unlocked.
  const placeRef = useRef<{
    knock: Tone.NoiseSynth;
    knockFilter: Tone.Filter;
    thud: Tone.MembraneSynth;
  } | null>(null);
  const breakRef = useRef<{
    impact: Tone.NoiseSynth;
    impactFilter: Tone.Filter;
    crumble: Tone.NoiseSynth;
    crumbleFilter: Tone.Filter;
  } | null>(null);

  const initTone = useCallback(async () => {
    const ctx = getAudioContext();
    if (!ctx) return false;
    await unlock();
    Tone.setContext(ctx);
    await Tone.start();

    if (!placeRef.current) {
      const knockFilter = new Tone.Filter(900, 'bandpass').toDestination();
      const knock = new Tone.NoiseSynth({
        noise: { type: 'pink' },
        envelope: { attack: 0.001, decay: 0.06, sustain: 0 },
        volume: -16,
      }).connect(knockFilter);
      const thud = new Tone.MembraneSynth({
        pitchDecay: 0.02,
        octaves: 4,
        envelope: { attack: 0.001, decay: 0.15, sustain: 0, release: 0.1 },
        volume: -14,
      }).toDestination();
      placeRef.current = { knock, knockFilter, thud };
    }

    if (!breakRef.current) {
      const impactFilter = new Tone.Filter(1800, 'bandpass').toDestination();
      const impact = new Tone.NoiseSynth({
        noise: { type: 'white' },
        envelope: { attack: 0.001, decay: 0.08, sustain: 0 },
        volume: -12,
      }).connect(impactFilter);
      const crumbleFilter = new Tone.Filter(600, 'lowpass').toDestination();
      const crumble = new Tone.NoiseSynth({
        noise: { type: 'brown' },
        envelope: { attack: 0.002, decay: 0.2, sustain: 0 },
        volume: -14,
      }).connect(crumbleFilter);
      breakRef.current = { impact, impactFilter, crumble, crumbleFilter };
    }
    return true;
  }, [getAudioContext, unlock]);

  /** Minecraft wooden block place — used for success feedback. */
  const playDing = useCallback(async () => {
    if (!(await initTone()) || !placeRef.current) return;
    const { knock, thud } = placeRef.current;
    const now = Tone.now();
    knock.triggerAttackRelease('16n', now);
    thud.triggerAttackRelease('A2', '32n', now + 0.005);
  }, [initTone]);

  /** Soft block place for enabling the compatibility fixer */
  const playToggleOn = useCallback(async () => {
    if (!(await initTone()) || !placeRef.current) return;
    const { knock, thud } = placeRef.current;
    const now = Tone.now();
    knock.triggerAttackRelease('64n', now, 0.5);
    thud.triggerAttackRelease('E3', '64n', now + 0.005, 0.5);
  }, [initTone]);

  /** Block break for disabling the compatibility fixer */
  const playToggleOff = useCallback(async () => {
    if (!(await initTone()) || !breakRef.current) return;
    const { impact, crumble } = breakRef.current;
    const now = Tone.now();
    impact.triggerAttackRelease('64n', now, 0.5);
    crumble.triggerAttackRelease('64n', now + 0.03, 0.5);
    crumble.triggerAttackRelease('64n', now + 0.09, 0.5);
  }, [initTone]);

  return { playDing, playToggleOn, playToggleOff };
}