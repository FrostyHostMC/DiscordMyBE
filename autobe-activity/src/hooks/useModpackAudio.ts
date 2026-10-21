import { useCallback, useRef } from 'react';
import { useAudioContext } from '@aippy/runtime/audio';
import * as Tone from 'tone';
import { describeError } from '@/utils/errorLog';

/**
 * Minecraft-style block SFX (synthesized with Tone.js — no audio files).
 * - playClick     -> soft wooden block PLACE
 * - playSuccess   -> wooden block PLACE
 * - playSyncChime -> wooden block PLACE
 * - playError     -> block BREAK (granular crumble)
 */
export function useModpackAudio() {
  const { getAudioContext, unlock } = useAudioContext();
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
  const initPromiseRef = useRef<Promise<boolean> | null>(null);

  const initTone = useCallback(async (): Promise<boolean> => {
    if (initPromiseRef.current) return initPromiseRef.current;
    initPromiseRef.current = (async () => {
      try {
        if (typeof window === 'undefined') return false;
        const ctx = getAudioContext();
        if (!ctx) return false;
        try { await unlock(); } catch { return false; }
        if (ctx.state === 'closed') return false;
        Tone.setContext(ctx);
        if (ctx.state !== 'running') {
          try { await Tone.start(); } catch { return false; }
        }
        if (Tone.getContext().state !== 'running') return false;
        if (!placeRef.current) {
          const knockFilter = new Tone.Filter(900, 'bandpass').toDestination();
          const knock = new Tone.NoiseSynth({
            noise: { type: 'pink' },
            envelope: { attack: 0.001, decay: 0.06, sustain: 0 },
            volume: -16,
          }).connect(knockFilter);
          const thud = new Tone.MembraneSynth({
            pitchDecay: 0.02, octaves: 4,
            envelope: { attack: 0.001, decay: 0.15, sustain: 0, release: 0.1 },
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
      } catch (e) {
        console.error('[Aippy] Audio init failed:', describeError(e));
        return false;
      }
    })();
    return initPromiseRef.current;
  }, [getAudioContext, unlock]);

  /** Soft wooden block place — used for button clicks. */
  const playClick = useCallback(async () => {
    if (!(await initTone()) || !placeRef.current) return;
    try {
      const { knock, thud } = placeRef.current;
      const now = Tone.now();
      knock.triggerAttackRelease('64n', now, 0.6);
      thud.triggerAttackRelease('E3', '64n', now + 0.005, 0.6);
    } catch { /* ignore */ }
  }, [initTone]);

  /** Wooden block place — success feedback. */
  const playSuccess = useCallback(async () => {
    if (!(await initTone()) || !placeRef.current) return;
    try {
      const { knock, thud } = placeRef.current;
      const now = Tone.now();
      knock.triggerAttackRelease('16n', now);
      thud.triggerAttackRelease('A2', '32n', now + 0.005);
    } catch { /* ignore */ }
  }, [initTone]);

  /** Wooden block place — sync/save feedback. */
  const playSyncChime = useCallback(async () => {
    if (!(await initTone()) || !placeRef.current) return;
    try {
      const { knock, thud } = placeRef.current;
      const now = Tone.now();
      knock.triggerAttackRelease('16n', now);
      thud.triggerAttackRelease('C3', '32n', now + 0.005);
    } catch { /* ignore */ }
  }, [initTone]);

  /** Block break — error/failure feedback. */
  const playError = useCallback(async () => {
    if (!(await initTone()) || !breakRef.current) return;
    try {
      const { impact, crumble } = breakRef.current;
      const now = Tone.now();
      impact.triggerAttackRelease('16n', now);
      crumble.triggerAttackRelease('64n', now + 0.02);
      crumble.triggerAttackRelease('64n', now + 0.08);
      crumble.triggerAttackRelease('32n', now + 0.13);
    } catch { /* ignore */ }
  }, [initTone]);

  return { playClick, playSuccess, playError, playSyncChime };
}