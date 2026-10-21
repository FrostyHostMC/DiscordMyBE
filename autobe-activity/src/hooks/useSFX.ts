import { useCallback, useRef } from 'react';
import { useAudioContext } from '@aippy/runtime/audio';
import * as Tone from 'tone';

export function useSFX() {
  const { getAudioContext, unlock } = useAudioContext();
  const synthRef = useRef<Tone.Synth | null>(null);

  const initTone = useCallback(async () => {
    const ctx = getAudioContext();
    if (!ctx) return false;
    await unlock();
    Tone.setContext(ctx);
    await Tone.start();
    if (!synthRef.current) synthRef.current = new Tone.Synth().toDestination();
    return true;
  }, [getAudioContext, unlock]);

  const playDing = useCallback(async () => {
    if (!await initTone() || !synthRef.current) return;
    synthRef.current.triggerAttackRelease('G5', '16n');
  }, [initTone]);

  /** Soft, high-pitched click for enabling the compatibility fixer */
  const playToggleOn = useCallback(async () => {
    if (!await initTone() || !synthRef.current) return;
    synthRef.current.triggerAttackRelease('E6', '32n', undefined, 0.5);
  }, [initTone]);

  /** Soft, low-pitched click for disabling the compatibility fixer */
  const playToggleOff = useCallback(async () => {
    if (!await initTone() || !synthRef.current) return;
    synthRef.current.triggerAttackRelease('G3', '32n', undefined, 0.5);
  }, [initTone]);

  return { playDing, playToggleOn, playToggleOff };
}