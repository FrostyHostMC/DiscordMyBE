import React, { useEffect, useRef, useState } from 'react';
import assetsData from '@/config/assets';
import { VerificationState } from '@/types/modpack';
import { validateLicenseKey } from '@/utils/verification';
import { SHOW_DEV_KEY_HINT, OFFLINE_LICENSE_KEYS } from '@/config/verification';

interface ActivationScreenProps {
  state: VerificationState;
  onActivated: () => void | Promise<void>;
  onRetry: () => void | Promise<void>;
}

/**
 * Activation gate — the web equivalent of the Python activation overlay.
 *
 * Renders four distinct states so the user always knows *why* they are stuck:
 *   update_required -> app too old, cannot be fixed in-app
 *   denied          -> blocked / untrusted environment
 *   offline_ok      -> needs a network round trip
 *   unverified      -> needs an activation key
 */
export const ActivationScreen: React.FC<ActivationScreenProps> = ({
  state,
  onActivated,
  onRetry
}) => {
  const [key, setKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [tosChecked, setTosChecked] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Mirrors the Python RGB loading animation while the key is validated.
  useEffect(() => {
    if (!busy) return;
    const id = setInterval(() => setProgress((p) => Math.min(100, p + 4)), 50);
    return () => clearInterval(id);
  }, [busy]);

  useEffect(() => {
    if (state.status === 'unverified') inputRef.current?.focus();
  }, [state.status]);

  const submit = async () => {
    if (busy) return;
    if (!key.trim()) {
      setError('Enter your activation key.');
      return;
    }
    if (!tosChecked) {
      setError('Accept the Terms of Use first.');
      return;
    }

    setError(null);
    setNotice(null);
    setProgress(0);
    setBusy(true);

    try {
      const res = await validateLicenseKey(key, state.deviceId);
      if (!res.ok) {
        setError(res.message);
        setBusy(false);
        return;
      }
      await onActivated();
    } catch (err: any) {
      setError(err?.message || 'Activation failed. Please try again.');
      setBusy(false);
    }
  };

  const blocked = state.status === 'denied';
  const needsUpdate = state.status === 'update_required';
  const offline = state.status === 'offline_ok';

  // Key entry is pointless only for hard failures. `offline_ok` still gets the
  // field, because a key can always be checked against the hashes built into
  // the bundle — refusing to show it would strand the user with no way forward.
  const canEnterKey = !blocked && !needsUpdate;

  const accent = blocked
    ? 'text-red-400 border-red-500/40'
    : needsUpdate
    ? 'text-amber-300 border-amber-500/40'
    : 'text-purple-300 border-purple-500/40';

  const title = blocked
    ? 'Access denied'
    : needsUpdate
    ? 'Update required'
    : offline
    ? 'Connection needed'
    : 'Activation required';

  const body = blocked
    ? state.reason || 'This device is not permitted to run AutoBE.'
    : needsUpdate
    ? state.reason || 'A newer version of AutoBE is required.'
    : offline
    ? state.reason || 'You are offline. A key can still be checked against the keys built into this version.'
    : 'Enter your activation key to continue. It is remembered on this device.';

  return (
    <div className="relative w-full h-full flex flex-col items-center justify-center px-7 bg-[#07050F] text-white select-none overflow-y-auto">
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-72 h-72 bg-purple-600/20 rounded-full blur-[90px] pointer-events-none" />

      <div className="relative z-10 w-full max-w-sm flex flex-col items-center py-8">
        <div className="w-20 h-20 rounded-3xl overflow-hidden shadow-[0_0_30px_rgba(168,85,247,0.45)] border border-purple-500/30 p-1.5 bg-[#0C081A]/80 mb-4">
          <img
            src={assetsData.IMAGE_DNFM}
            alt="AutoBE"
            className="w-full h-full object-contain"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).src = assetsData.IMAGE_DNFM_FALLBACK;
            }}
          />
        </div>

        <h1 className="text-xl font-black font-mono tracking-tight">
          Auto<span className="text-purple-400">BE</span>
        </h1>

        <div className={`mt-5 w-full p-4 rounded-2xl bg-[#0D091A] border ${accent} text-center`}>
          <div className="text-3xl mb-2">
            {blocked ? '🚫' : needsUpdate ? '⬆️' : offline ? '📡' : '🔒'}
          </div>
          <p className="text-sm font-bold">{title}</p>
          <p className="text-[11px] text-zinc-400 mt-1.5 leading-relaxed">{body}</p>
          {state.latestVersion && !needsUpdate && (
            <p className="text-[10px] text-zinc-500 font-mono mt-2">latest: v{state.latestVersion}</p>
          )}
        </div>

        {canEnterKey && (
          <>
            <input
              ref={inputRef}
              type="text"
              value={key}
              onChange={(e) => setKey(e.target.value.toUpperCase())}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit();
              }}
              placeholder="AUTOBE-XXXX-XXXX-XXXX-XXXX"
              autoCapitalize="characters"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
              className="mt-4 w-full px-4 py-3 rounded-xl bg-[#0A0A0A] border border-purple-500/30 text-xs font-mono text-white placeholder:text-zinc-600 outline-none focus:border-purple-400 tracking-wider"
            />

            {SHOW_DEV_KEY_HINT && OFFLINE_LICENSE_KEYS.length > 0 && (
              <button
                type="button"
                onClick={() => setKey(OFFLINE_LICENSE_KEYS[0])}
                disabled={busy}
                className="mt-1.5 text-[10px] text-purple-400/70 hover:text-purple-300 font-mono disabled:opacity-40"
              >
                dev build — use {OFFLINE_LICENSE_KEYS[0]}
              </button>
            )}

            <label className="mt-3 w-full flex items-start gap-2 text-[11px] text-zinc-400 leading-tight">
              <input
                type="checkbox"
                checked={tosChecked}
                onChange={(e) => setTosChecked(e.target.checked)}
                disabled={busy}
                className="mt-0.5 accent-purple-500"
              />
              <span>
                I accept the Terms of Use and confirm this is my own device.
              </span>
            </label>

            {error && (
              <p className="mt-2 w-full text-[11px] text-red-300 text-center leading-relaxed">{error}</p>
            )}
            {notice && (
              <p className="mt-2 w-full text-[11px] text-emerald-300 text-center leading-relaxed">
                {notice}
              </p>
            )}

            {busy ? (
              <div className="mt-4 w-full space-y-3">
                <div className="w-full h-1.5 rounded-full bg-purple-950/60 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-purple-500 to-fuchsia-300 transition-all"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <p className="text-[11px] text-purple-300 font-mono text-center">
                  Binding key to device {state.deviceId.slice(0, 8)}…
                </p>
              </div>
            ) : (
              <button
                type="button"
                onClick={submit}
                className="mt-4 w-full py-3 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 font-bold text-sm text-white shadow-[0_0_20px_rgba(147,51,234,0.5)] border border-purple-400/40 active:scale-[0.98] transition-transform"
              >
                Activate AutoBE
              </button>
            )}

            <button
              type="button"
              onClick={async () => {
                setError(null);
                setNotice('Re-checking…');
                await onRetry();
                setNotice(null);
              }}
              disabled={busy}
              className="mt-3 text-[11px] text-zinc-500 hover:text-purple-300 disabled:opacity-40"
            >
              Retry verification
            </button>
          </>
        )}

        {blocked && (
          <p className="mt-5 text-[11px] text-zinc-500 text-center leading-relaxed">
            If you believe this is a mistake, contact support with the device ID below.
          </p>
        )}
        {(blocked || needsUpdate || offline) && (
          <button
            type="button"
            onClick={() => onRetry()}
            className="mt-4 w-full py-2.5 rounded-xl text-[11px] font-semibold text-purple-300 bg-[#110B24] border border-purple-500/30 active:scale-[0.98]"
          >
            {offline ? 'Retry now' : 'Check again'}
          </button>
        )}

        <div className="mt-6 text-center space-y-1">
          <p className="text-[10px] text-zinc-600 font-mono">
            Device ID {state.deviceId.slice(0, 8)}…{state.deviceId.slice(-6)}
          </p>
          <p className="text-[10px] text-zinc-700">
            Verification is processed entirely on this device
          </p>
        </div>
      </div>
    </div>
  );
};