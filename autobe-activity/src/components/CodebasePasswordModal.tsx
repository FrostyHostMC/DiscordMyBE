import React, { useEffect, useRef, useState } from 'react';
import { Lock, X, KeyRound, ShieldCheck, AlertCircle } from 'lucide-react';

interface CodebasePasswordModalProps {
  open: boolean;
  onClose: () => void;
  onUnlock: (password: string) => void;
}

export const CodebasePasswordModal: React.FC<CodebasePasswordModalProps> = ({
  open,
  onClose,
  onUnlock
}) => {
  const [value, setValue] = useState('');
  const [error, setError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);  useEffect(() => {
    if (!open) return;
    // Focus after the overlay has mounted.
    const timer = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, [open]);

  if (!open) return null;

  const handleClose = () => {
    setValue('');
    setError(false);
    onClose();
  };

  const submit = () => {
    if (value.length === 0) {
      setError(true);
      return;
    }
    onUnlock(value);
    handleClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/80 transition-opacity"
        onClick={handleClose}
        aria-hidden="true"
      />
      <div
        className={`relative w-full max-w-sm rounded-2xl bg-[#100D18] border ${
          error ? 'border-red-500/60' : 'border-[#762BFF]/60'
        } shadow-[0_0_30px_rgba(118,43,255,0.25)] p-5 space-y-4`}
        role="dialog"
        aria-modal="true"
        aria-label="Codebase export password"
      >
        <button
          type="button"
          onClick={handleClose}
          className="absolute top-3 right-3 p-1.5 rounded-lg text-[#AAA3BB] hover:text-white hover:bg-[#15111F] transition-colors"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-3">
          <span className="p-2.5 rounded-xl bg-[#762BFF]/20 text-[#A855F7] border border-[#762BFF]/30 shrink-0">
            <Lock className="w-5 h-5" />
          </span>
          <div>
            <div className="text-sm font-bold text-white">Encrypt Codebase Export</div>
            <div className="text-[11px] text-[#AAA3BB] mt-0.5">
              Enter a password to encrypt the codebase archive with AES-256. You'll need this password to extract the files.
            </div>
          </div>
        </div>

        <div
          className={`flex items-center gap-2 rounded-xl bg-[#08070D] border px-3 py-2.5 transition-colors ${
            error ? 'border-red-500/70' : 'border-[#30263F] focus-within:border-[#762BFF]'
          }`}
        >
          <KeyRound className={`w-4 h-4 shrink-0 ${error ? 'text-red-400' : 'text-[#A855F7]'}`} />
          <input
            ref={inputRef}
            type="password"
            inputMode="numeric"
            autoComplete="off"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
            }}
            placeholder="Enter password"
            className="w-full bg-transparent text-sm text-white placeholder-[#716885] outline-none tracking-widest font-mono"
          />
        </div>

        {error && (
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-red-400">
            <AlertCircle className="w-3.5 h-3.5" />
            <span>Password cannot be empty.</span>
          </div>
        )}

        <button
          type="button"
          onClick={submit}
          disabled={value.length === 0}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-[#762BFF] text-white text-xs font-bold border border-[#A855F7] hover:brightness-110 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_0_12px_rgba(118,43,255,0.35)]"
        >
          <ShieldCheck className="w-4 h-4" />
          Encrypt & Download Codebase
        </button>

        <p className="text-[10px] text-[#716885] text-center leading-relaxed">
          The archive will be AES-256 encrypted. You must remember this password to extract the files.
        </p>
      </div>
    </div>
  );
};