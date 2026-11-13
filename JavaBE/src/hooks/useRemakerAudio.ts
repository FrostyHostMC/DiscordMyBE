import { useCallback, useRef } from 'react';
import { useAudioContext } from '@aippy/runtime/audio';
import * as Tone from 'tone';

/** Synth SFX for the Mod Remaker: success chime, process pulse, and warning buzz. */
export function useRemakerAudio() {
  const { getAudioContext, unlock } = useAudioContext();
  const chimeRef = useRef<Tone.PolySynth | null>(null);
  const clickRef = useRef<Tone.MembraneSynth | null>(null);
  const buzzRef = useRef<Tone.Synth | null>(null);

  const initTone = useCallback(async () => {
    const ctx = getAudioContext();
    if (!ctx) return false;
    await unlock();
    Tone.setContext(ctx);
    await Tone.start();
    if (!chimeRef.current) {
      chimeRef.current = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'triangle' },
        envelope: { attack: 0.005, decay: 0.2, sustain: 0, release: 0.1 },
      }).toDestination();
      chimeRef.current.volume.value = -8;
    }
    if (!clickRef.current) {
      clickRef.current = new Tone.MembraneSynth({
        pitchDecay: 0.01,
        octaves: 2,
        oscillator: { type: 'sine' },
        envelope: { attack: 0.001, decay: 0.05, sustain: 0 },
      }).toDestination();
      clickRef.current.volume.value = -12;
    }
    if (!buzzRef.current) {
      buzzRef.current = new Tone.Synth({
        oscillator: { type: 'sawtooth' },
        envelope: { attack: 0.01, decay: 0.28, sustain: 0.05, release: 0.08 },
      }).toDestination();
      buzzRef.current.volume.value = -14;
    }
    return true;
  }, [getAudioContext, unlock]);

  /** Bright, ascending digital chime (~200ms decay) as specified. */
  const playSuccess = useCallback(async () => {
    if (!await initTone() || !chimeRef.current) return;
    const now = Tone.now();
    chimeRef.current.triggerAttackRelease(['E5'], '16n', now);
    chimeRef.current.triggerAttackRelease(['B5'], '16n', now + 0.08);
  }, [initTone]);

  /** Short, crisp metallic click (~50ms) for log updates as specified. */
  const playProcess = useCallback(async () => {
    if (!await initTone() || !clickRef.current) return;
    clickRef.current.triggerAttackRelease('C4', '64n');
  }, [initTone]);

  /** Low-frequency, subtle digital buzz (~300ms) for parity mismatches & auto-repair trigger as specified. */
  const playWarning = useCallback(async () => {
    if (!await initTone() || !buzzRef.current) return;
    buzzRef.current.triggerAttackRelease('F2', '16n');
  }, [initTone]);

  return { playSuccess, playProcess, playWarning, playError: playWarning };
}