import { useCallback, useRef } from 'react';

type ToneHandle = { oscillator: OscillatorNode; gain: GainNode };

/** Small browser-native sound effects. No external app-host audio bridge is required. */
export function useRemakerAudio() {
  const contextRef = useRef<AudioContext | null>(null);

  const playNotes = useCallback((notes: number[], duration = 0.16) => {
    try {
      const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return;
      const context = contextRef.current ?? new AudioContextClass();
      contextRef.current = context;
      if (context.state === 'suspended') void context.resume();

      const now = context.currentTime;
      notes.forEach((frequency, index) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = 'triangle';
        oscillator.frequency.setValueAtTime(frequency, now + index * 0.08);
        gain.gain.setValueAtTime(0.0001, now + index * 0.08);
        gain.gain.exponentialRampToValueAtTime(0.12, now + index * 0.08 + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + index * 0.08 + duration);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(now + index * 0.08);
        oscillator.stop(now + index * 0.08 + duration + 0.02);
      });
    } catch {
      // Sound is optional; never interrupt a conversion because audio is unavailable.
    }
  }, []);

  const playSuccess = useCallback(() => playNotes([659.25, 987.77]), [playNotes]);
  const playProcess = useCallback(() => playNotes([261.63], 0.06), [playNotes]);
  const playWarning = useCallback(() => playNotes([87.31], 0.22), [playNotes]);

  return { playSuccess, playProcess, playWarning, playError: playWarning };
}
