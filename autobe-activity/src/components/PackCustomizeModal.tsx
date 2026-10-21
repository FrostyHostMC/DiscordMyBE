import React, { useState, useRef, useEffect } from 'react';
import { X, Type, FileText, User, Image as ImageIcon, Loader2, Check } from 'lucide-react';
import { MergedModpack } from '@/types/modpack';
import { PackCustomization } from '@/utils/packCustomization';

interface PackCustomizeModalProps {
  modpack: MergedModpack;
  onApply: (custom: PackCustomization) => Promise<void>;
  onClose: () => void;
}

export const PackCustomizeModal: React.FC<PackCustomizeModalProps> = ({
  modpack,
  onApply,
  onClose
}) => {
  const [name, setName] = useState(modpack.name);
  const [description, setDescription] = useState(modpack.description || '');
  const [author, setAuthor] = useState('');
  const [iconFile, setIconFile] = useState<File | null>(null);
  const [iconPreview, setIconPreview] = useState<string | null>(modpack.iconDataUrl || null);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (iconPreview && iconPreview.startsWith('blob:')) {
        URL.revokeObjectURL(iconPreview);
      }
    };
  }, [iconPreview]);

  const pickIcon = () => {
    fileInputRef.current?.click();
  };

  const handleIconChosen = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Please choose a PNG or JPG image for the pack icon.');
      return;
    }
    setError(null);
    setIconFile(file);
    setIconPreview(URL.createObjectURL(file));
  };

  const handleApply = async () => {
    if (!name.trim()) {
      setError('Pack name is required.');
      return;
    }
    setApplying(true);
    setError(null);
    try {
      await onApply({
        name: name.trim(),
        description: description.trim() || 'Merged with AutoBE',
        author: author.trim(),
        iconFile
      });
    } catch {
      setApplying(false);
      setError('Could not rewrite pack metadata. Please try again.');
    }
  };

  const inputCls =
    'w-full px-3 py-2.5 rounded-lg bg-[#08070D] border border-[#30263F] text-sm text-white placeholder-[#716885] focus:outline-none focus:border-[#762BFF] transition-colors';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70">
      <div className="w-full max-w-md rounded-2xl bg-[#100D18] border border-[#762BFF]/50 shadow-[0_0_30px_rgba(118,43,255,0.25)] overflow-hidden animate-in zoom-in-95 duration-150">
        {/* Accent stripe */}
        <div className="h-1 bg-[#762BFF]" />

        <div className="p-5 space-y-4">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-white">Name your merged pack</h2>
              <p className="text-[11px] text-[#AAA3BB] mt-0.5 truncate">
                Applies to this modpack only: {modpack.name}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-[#AAA3BB] hover:text-white active:scale-95 transition-all"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Name */}
          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-[11px] font-bold text-[#E5E7EB] uppercase tracking-wider">
              <Type className="w-3 h-3 text-[#A855F7]" /> Name
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputCls}
              placeholder="My Merged Pack"
              maxLength={80}
            />
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-[11px] font-bold text-[#E5E7EB] uppercase tracking-wider">
              <FileText className="w-3 h-3 text-[#A855F7]" /> Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className={`${inputCls} resize-none`}
              placeholder="Merged with AutoBE"
              maxLength={300}
            />
          </div>

          {/* Author */}
          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-[11px] font-bold text-[#E5E7EB] uppercase tracking-wider">
              <User className="w-3 h-3 text-[#A855F7]" /> Author
            </label>
            <input
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              className={inputCls}
              placeholder="Optional"
              maxLength={60}
            />
          </div>

          {/* Icon */}
          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-[11px] font-bold text-[#E5E7EB] uppercase tracking-wider">
              <ImageIcon className="w-3 h-3 text-[#A855F7]" /> Pack Icon
            </label>
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-lg bg-[#15111F] border border-[#30263F] overflow-hidden flex items-center justify-center shrink-0">
                {iconPreview ? (
                  <img src={iconPreview} alt="" className="w-full h-full object-cover" />
                ) : (
                  <ImageIcon className="w-5 h-5 text-[#716885]" />
                )}
              </div>
              <button
                type="button"
                onClick={pickIcon}
                className="px-3 py-2 rounded-lg bg-[#15111F] border border-[#30263F] text-xs font-semibold text-white hover:text-[#A855F7] active:scale-95 transition-all"
              >
                {iconFile ? 'Replace image' : 'Choose image...'}
              </button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg"
              onChange={handleIconChosen}
              className="hidden"
            />
          </div>

          {error && (
            <p className="text-[11px] text-red-400 font-semibold">{error}</p>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={applying}
              className="flex-1 px-4 py-2.5 rounded-xl bg-[#15111F] border border-[#30263F] text-xs font-semibold text-[#AAA3BB] hover:text-white active:scale-95 transition-all disabled:opacity-50"
            >
              Skip
            </button>
            <button
              type="button"
              onClick={handleApply}
              disabled={applying}
              className="flex-1 px-4 py-2.5 rounded-xl bg-[#762BFF] hover:bg-[#853CFF] text-xs font-bold text-white shadow-[0_0_15px_rgba(118,43,255,0.4)] active:scale-95 transition-all disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {applying ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Applying...
                </>
              ) : (
                <>
                  <Check className="w-3.5 h-3.5" />
                  Apply
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};