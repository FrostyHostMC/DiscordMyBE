import { useCallback, useRef } from 'react';
import { useAudioContext } from '@aippy/runtime/audio';
import * as Tone from 'tone';
import { describeError } from '@/utils/errorLog';

export function useModpackAudio() {
  const { getAudioContext, unlock } = useAudioContext();
  const synthRef = useRef<Tone.Synth | null>(null);
  const chimeRef = useRef<Tone.PolySynth | null>(null);
  const thudRef = useRef<Tone.MembraneSynth | null>(null);
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
        if (!synthRef.current) {
          synthRef.current = new Tone.Synth({
            oscillator: { type: 'sine' },
            envelope: { attack: 0.005, decay: 0.05, sustain: 0, release: 0.04 }
          }).toDestination();
          synthRef.current.volume.value = -8;
        }
        if (!chimeRef.current) {
          chimeRef.current = new Tone.PolySynth(Tone.Synth, {
            oscillator: { type: 'triangle' },
            envelope: { attack: 0.02, decay: 0.25, sustain: 0.1, release: 0.4 }
          }).toDestination();
          chimeRef.current.volume.value = -6;
        }
        if (!thudRef.current) {
          thudRef.current = new Tone.MembraneSynth({
            pitchDecay: 0.08, octaves: 2,
            envelope: { attack: 0.001, decay: 0.2, sustain: 0.01, release: 0.15 }
          }).toDestination();
          thudRef.current.volume.value = -5;
        }
        return true;
      } catch (e) {
        console.error('[Aippy] Audio init failed:', describeError(e));
        return false;
      }
    })();
    return initPromiseRef.current;
  }, [getAudioContext, unlock]);

  const playClick = useCallback(async () => {
    if (!(await initTone()) || !synthRef.current) return;
    try { synthRef.current.triggerAttackRelease('C6', '32n'); } catch { /* ignore */ }
  }, [initTone]);

  const playSuccess = useCallback(async () => {
    if (!(await initTone()) || !chimeRef.current) return;
    try {
      const now = Tone.now();
      chimeRef.current.triggerAttackRelease(['E5', 'G#5'], '8n', now);
      chimeRef.current.triggerAttackRelease(['B5', 'E6'], '4n', now + 0.1);
    } catch { /* ignore */ }
  }, [initTone]);

  const playSyncChime = useCallback(async () => {
    if (!(await initTone()) || !chimeRef.current) return;
    try { chimeRef.current.triggerAttackRelease(['F#5', 'A#5', 'C#6'], '8n', Tone.now()); } catch { /* ignore */ }
  }, [initTone]);

  const playError = useCallback(async () => {
    if (!(await initTone()) || !thudRef.current) return;
    try { thudRef.current.triggerAttackRelease('A1', '16n'); } catch { /* ignore */ }
  }, [initTone]);

  return { playClick, playSuccess, playError, playSyncChime };
}