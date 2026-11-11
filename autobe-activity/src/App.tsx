import React, { useState, useEffect, useRef } from 'react';
import { aippyTweaks } from '@aippy/runtime/tweaks';
import { vibrate } from '@aippy/runtime/device';
import { Info, X } from 'lucide-react';
import { AutoBEFeatureArt, AutoBEWordmark } from '@/components/AutoBEBrandArt';
import tweaksConfig from '@/config/tweaksConfig.json';

import {
  AddonPack, MergedModpack, MergedOutput, ConflictItem, TabType, ScreenType,
  MergeSessionConfig, CommunityModpack
} from '@/types/modpack';
import { deliverFile, openExternalUrl } from '@/utils/deliverFile';
import { ensureCombinedBlob } from '@/utils/mergeEngine';
import { uploadToCloud } from '@/utils/cloudUpload';
import { getDiscordAuth, getDiscordUser } from '@/utils/discordAuth';
import { deleteLegacyWorkspaceDatabase } from '@/utils/legacyWorkspaceCleanup';
import { detectConflicts, parseAddonArchive } from '@/utils/addonParser';
import { executeMergePacks, buildMergePlan, MergePlan } from '@/utils/mergeEngine';
import { applySubpackToPack } from '@/utils/subpackProcessor';
import { scanScriptRuntimeConflicts, conflictsToReport } from '@/utils/scriptConflictScan';
import { describeError } from '@/utils/errorLog';
import { useModpackAudio } from '@/hooks/useModpackAudio';
import { mergeLogger } from '@/utils/mergeLogger';


import { MergeWorkspace } from '@/components/MergeWorkspace';
import { ScriptCheckScreen } from '@/components/ScriptCheckScreen';
import { ConflictScreen } from '@/components/ConflictScreen';
import { MergingScreen } from '@/components/MergingScreen';
import { MergeCompleteScreen } from '@/components/MergeCompleteScreen';
import { SubpackSelectModal } from '@/components/SubpackSelectModal';
import { CommunityModpacksScreen } from '@/components/CommunityModpacksScreen';
import { CommunityAddonsScreen } from '@/components/CommunityAddonsScreen';

const tweaks = aippyTweaks(tweaksConfig);

export const App: React.FC = () => {
  // Tweaks parameters at component top level
  const autoMergeTweak = tweaks.autoMergeConflicts.useState();
  const hapticTweak = tweaks.hapticEnabled.useState();
  const soundTweak = tweaks.soundEnabled.useState();

  // Audio synthesizer hook
  const { playClick, playSuccess, playError } = useModpackAudio();

  // Navigation states - starts directly in main studio workspace
  const [screen, setScreen] = useState<ScreenType>('main');
  const [currentTab, setCurrentTab] = useState<TabType>('workspace');

  // Data states
  const [installedPacks, setInstalledPacks] = useState<AddonPack[]>([]);
  const [selectedPackIds, setSelectedPackIds] = useState<string[]>([]);
  const discordUser = getDiscordUser();

  // Settings states
  const [autoMerge, setAutoMerge] = useState<boolean>(true);
  // Merging runtime states
  const [conflicts, setConflicts] = useState<ConflictItem[]>([]);

  const [mergePlan, setMergePlan] = useState<MergePlan | null>(null);
  const [mergeStep, setMergeStep] = useState<string>('Reading addons');
  const [mergeProgress, setMergeProgress] = useState<number>(0);
  const [justCompletedModpack, setJustCompletedModpack] = useState<MergedModpack | null>(null);

  // Subpack selection flow (port of AutoBE._show_subpack_selection)
  const [subpackPromptPacks, setSubpackPromptPacks] = useState<AddonPack[] | null>(null);
  const pendingMergeRef = useRef<{
    packs: AddonPack[];
    confList: ConflictItem[];
    nameOverride?: string;
    targetEngine?: string;
    outputOptions?: Pick<MergeSessionConfig, 'generateAddon' | 'generateSeparatePacks'>;
  } | null>(null);
  const scriptConflictsRef = useRef<Record<string, string[]>>({});
  const appliedSubpackSelectionsRef = useRef<Array<{ pack: string; variant: string }>>([]);
  const pendingTargetEngineRef = useRef<string>('1.20.0');
  const pendingHudPlacementRef = useRef<NonNullable<MergeSessionConfig['hudPlacement']>>('auto');
  const pendingOutputOptionsRef = useRef<Pick<MergeSessionConfig, 'generateAddon' | 'generateSeparatePacks'>>({ generateAddon: true, generateSeparatePacks: true });

  // File import ref

  // Notification Toast state
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const toastTimerRef = useRef<number | undefined>(undefined);
  const showToast = (msg: string, durationMs = 3500) => {
    setToastMessage(msg);
    // Only the newest toast's timer may clear it (older timers used to hide newer toasts early).
    if (toastTimerRef.current !== undefined) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToastMessage(null), durationMs);
  };

  const triggerHaptic = (duration = 50) => {
    if (hapticTweak) {
      vibrate(duration).catch(() => {});
    }
  };

  const handleSoundTap = () => {
    if (soundTweak) {
      playClick().catch(() => {});
    }
  };

  const navigateTab = (tab: TabType) => {
    triggerHaptic(30);
    handleSoundTap();
    setCurrentTab(tab === 'community' || tab === 'community_addons' ? tab : 'workspace');
    setScreen('main');
  };

  // Sync settings with tweaks
  useEffect(() => {
    const t = setTimeout(() => setAutoMerge(autoMergeTweak), 0);
    return () => clearTimeout(t);
  }, [autoMergeTweak]);

  // AutoBE no longer keeps a personal workspace or project library.
  // Remove the legacy IndexedDB database once on startup so old saved private
  // packs/projects do not linger on users' devices. Community data is server-side
  // in separate D1/R2 namespaces and is never touched here.
  useEffect(() => {
    void deleteLegacyWorkspaceDatabase().catch((err) => {
      console.warn('[LegacyWorkspace] Could not clear old local workspace database:', describeError(err));
    });
  }, []);

  // Toggle selection for pack merge
  const handleTogglePack = (id: string) => {
    triggerHaptic(40);
    handleSoundTap();
    setSelectedPackIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleSelectAll = () => {
    triggerHaptic(40);
    handleSoundTap();
    setSelectedPackIds(installedPacks.map((p) => p.id));
  };

  const handleClearSelection = () => {
    triggerHaptic(40);
    handleSoundTap();
    setSelectedPackIds([]);
  };

  // Imports exist only in memory for the current merge session. Nothing is
  // written to IndexedDB or uploaded to a private per-user cloud workspace.
  const handleImportPacks = async (newPacks: AddonPack[]): Promise<number> => {
    triggerHaptic(80);
    const seen = new Set(installedPacks.map((p) => `${p.uuid}_${p.type}`));
    const trulyNew: AddonPack[] = [];
    for (const pack of newPacks) {
      const key = `${pack.uuid}_${pack.type}`;
      if (seen.has(key)) continue;
      seen.add(key);
      trulyNew.push(pack);
    }
    if (trulyNew.length) {
      setInstalledPacks((previous) => [...previous, ...trulyNew]);
      showToast(`Imported ${trulyNew.length} add-on pack(s) into this merge session.`);
      if (soundTweak) playSuccess().catch(() => {});
    } else {
      showToast('Those add-ons are already in this merge session.');
    }
    return trulyNew.length;
  };

  // Every imported archive stays attached to its in-memory pack record.
  // If it is missing, ask for a fresh import instead of consulting personal storage.
  const hydratePacks = async (packs: AddonPack[]): Promise<AddonPack[]> => {
    const unique = new Map<string, AddonPack>();
    for (const pack of packs) {
      if (!unique.has(pack.id)) unique.set(pack.id, pack);
      if (!pack.fileBlob) throw new Error(`The selected pack "${pack.name}" is no longer in this session. Import it again before merging.`);
    }
    return [...unique.values()];
  };
  const mergeStartingRef = useRef(false);

  const getSelectedPacks = () => {
    const selectedIds = new Set(selectedPackIds);
    return installedPacks.filter((p) => selectedIds.has(p.id));
  };

  // Open Script API check screen
  const openScriptCheck = (packsToMerge: AddonPack[]) => {
    setMergePlan(buildMergePlan(packsToMerge));
    setScreen('script_check');
  };

  // Start merge flow
  const handleStartMergeFlow = async (customConfig?: MergeSessionConfig, orderedPackIds?: string[]) => {
    // Ignore extra taps while the first one is still loading packs.
    if (mergeStartingRef.current) return;
    mergeStartingRef.current = true;
    try {
      await handleStartMergeFlowInner(customConfig, orderedPackIds);
    } finally {
      mergeStartingRef.current = false;
    }
  };

  const handleStartMergeFlowInner = async (customConfig?: MergeSessionConfig, orderedPackIds?: string[]) => {
    pendingTargetEngineRef.current = customConfig?.targetEngine || '1.20.0';
    pendingHudPlacementRef.current = customConfig?.hudPlacement || 'auto';
    pendingOutputOptionsRef.current = { generateAddon: customConfig?.generateAddon ?? true, generateSeparatePacks: customConfig?.generateSeparatePacks ?? true };
    triggerHaptic(50);
    handleSoundTap();
    const selected = getSelectedPacks();
    const priority = new Map((orderedPackIds || []).map((id, index) => [id, index]));
    selected.sort((a, b) => {
      const ai = priority.get(a.id);
      const bi = priority.get(b.id);
      if (ai !== undefined && bi !== undefined) return ai - bi;
      if (ai !== undefined) return -1;
      if (bi !== undefined) return 1;
      return 0;
    });
    if (selected.length === 0) {
      showToast('Please select at least one pack to merge.');
      return;
    }
    let packsToMerge: AddonPack[];
    try {
      showToast('Loading selected packs…', 20000);
      packsToMerge = await hydratePacks(selected);
    } catch (err) {
      console.error('[Merge] Could not load pack files:', describeError(err));
      showToast(`Could not load the selected packs: ${describeError(err)}`, 8000);
      return;
    }

    // Vanilla overrides are detected by detectConflicts and always require an explicit choice.
    const detected = await detectConflicts(packsToMerge);
    setConflicts(detected);
    if (detected.some((conflict) => conflict.type === 'vanilla_asset') || (detected.length > 0 && !autoMerge)) setScreen('conflicts');
    else openScriptCheck(packsToMerge);
  };

  const doRunMergeProcess = async (
    packsToMerge: AddonPack[],
    confList: ConflictItem[] = [],
    modpackNameOverride?: string,
    targetEngine?: string,
    outputOptions: Pick<MergeSessionConfig, 'generateAddon' | 'generateSeparatePacks'> = { generateAddon: true, generateSeparatePacks: true }
  ) => {
    // Log the exact source set so reports can prove which library items entered this merge.
    mergeLogger.info('Starting merge execution', JSON.stringify({
      count: packsToMerge.length,
      selectedSources: packsToMerge.map((p) => ({ id: p.id, name: p.name, type: p.type, uuid: p.uuid })),
      name: modpackNameOverride || 'default'
    }));
    setScreen('merging');
    setMergeProgress(10);
    setMergeStep('Reading addons & manifests');

    try {
      const mergedName =
        modpackNameOverride ||
        `AutoBE_Modpack_${new Date().toLocaleDateString().replace(/\//g, '-')}`;

      mergeLogger.info('Executing merge', `Name: ${mergedName}, Packs: ${packsToMerge.map(p => p.name).join(', ')}`);

      const result = await executeMergePacks(packsToMerge, {
        modpackName: mergedName,
        targetEngine: targetEngine || '1.20.0',
        generateAddon: outputOptions.generateAddon,
        generateSeparatePacks: outputOptions.generateSeparatePacks,
        conflicts: confList,
        autoPrefix: autoMerge,
        scriptConflicts: scriptConflictsRef.current,
        hudPlacement: pendingHudPlacementRef.current,
        subpackSelections: appliedSubpackSelectionsRef.current,
        onProgress: (step, pct) => {
          setMergeStep(step);
          setMergeProgress(pct);
          mergeLogger.info(`Merge progress: ${step}`, `${pct}%`);
        }
      });

      if (!result || (!result.outputBlob && !(result.outputs && result.outputs.some((o) => o.blob)) && !(result.bundleParts && result.bundleParts.some((o) => o.blob)))) {
        throw new Error('Merge completed but no output files were generated');
      }

      mergeLogger.success('Merge completed successfully', result.outputFileName, packsToMerge.length, packsToMerge.map(p => p.name));

      // Keep generated output only in memory until the user downloads it or
      // explicitly publishes it to the public Community Modpacks section.

      setJustCompletedModpack(result);
      setScreen('merge_complete');
      triggerHaptic(120);
      if (soundTweak) playSuccess().catch(() => {});
    } catch (err) {
      const msg = describeError(err);
      console.error('[Aippy] Merge error:', msg);
      mergeLogger.error('Merge failed', msg);
      showToast(`Merge failed: ${msg}`);
      if (soundTweak) playError().catch(() => {});
      setScreen('main');
    }
  };

  const runMergeProcess = async (
    packsToMerge: AddonPack[],
    confList: ConflictItem[] = [],
    modpackNameOverride?: string,
    targetEngine?: string,
    outputOptions: Pick<MergeSessionConfig, 'generateAddon' | 'generateSeparatePacks'> = { generateAddon: true, generateSeparatePacks: true }
  ) => {
    // Make sure every pack's file is loaded (no-op if already loaded by the merge flow).
    try {
      packsToMerge = await hydratePacks(packsToMerge);
    } catch (err) {
      showToast(`Could not load pack files: ${describeError(err)}`, 8000);
      return;
    }
    // Pre-merge scan for runtime script property conflicts (warning only)
    try {
      const hits = await scanScriptRuntimeConflicts(packsToMerge);
      scriptConflictsRef.current = conflictsToReport(hits);
      if (hits.size > 0) {
        showToast(
          `Warning: ${hits.size} script runtime property conflict(s) detected — the last pack wins.`
        );
      }
    } catch (err) {
      console.error('[Aippy] Script conflict scan failed:', describeError(err));
      scriptConflictsRef.current = {};
    }

    appliedSubpackSelectionsRef.current = [];
    // Port of AutoBE subpack flow: prompt for variants before merging
    const withSubpacks = packsToMerge.filter(
      (p) => p.subpacks && p.subpacks.length > 0 && p.fileBlob
    );
    console.log('[MergeStart] Packs with subpacks:', withSubpacks.map(p => ({ name: p.name, uuid: p.uuid, type: p.type, subpacks: p.subpacks })));
    // Deduplicate by UUID + type (not internal ID) to handle BP/RP halves with same UUID
    const uniqueWithSubpacks = Array.from(
      new Map(withSubpacks.map(p => [`${p.uuid}_${p.type}`, p])).values()
    );
    console.log('[MergeStart] Unique packs with subpacks after dedup:', uniqueWithSubpacks.length);
    if (uniqueWithSubpacks.length > 0) {
      pendingMergeRef.current = { packs: packsToMerge, confList, nameOverride: modpackNameOverride, targetEngine, outputOptions };
      setSubpackPromptPacks(uniqueWithSubpacks);
      return;
    }

    await doRunMergeProcess(packsToMerge, confList, modpackNameOverride, targetEngine, outputOptions);
  };

  const handleSubpackConfirm = async (selections: Record<string, string>) => {
    const pending = pendingMergeRef.current;
    setSubpackPromptPacks(null);
    pendingMergeRef.current = null;
    if (!pending) return;

    console.log('[SubpackConfirm] Selections:', selections);
    const processed: AddonPack[] = [];
    try {
      for (const p of pending.packs) {
        // Look up selection by UUID+type (same key used for deduplication)
        const key = `${p.uuid}_${p.type}`;
        const variant = selections[key];
        console.log('[SubpackConfirm] Processing pack:', p.name, 'key:', key, 'variant:', variant, 'hasBlob:', !!p.fileBlob);
        if (p.subpacks?.length && !variant) {
          throw new Error(`No variant was selected for ${p.name}. Select a subpack variant before merging.`);
        }
        if (variant && p.fileBlob) {
          // Never silently merge the unprocessed source if the selected UI/assets
          // variant failed to extract. That would recreate the missing-interface
          // bug while falsely reporting a successful merge.
          processed.push(await applySubpackToPack(p, variant));
        } else {
          processed.push(p);
        }
      }
      appliedSubpackSelectionsRef.current = pending.packs
        .filter((pack) => pack.subpacks?.length)
        .map((pack) => ({ pack: pack.name, variant: selections[`${pack.uuid}_${pack.type}`] }))
        .filter((selection): selection is { pack: string; variant: string } => !!selection.variant);
      await doRunMergeProcess(processed, pending.confList, pending.nameOverride, pending.targetEngine, pending.outputOptions);
    } catch (err) {
      console.error('[AutoBE] Selected subpack extraction failed; merge cancelled:', describeError(err));
      showToast(`Could not apply the selected variant. Merge cancelled to prevent missing UI/assets: ${describeError(err)}`, 10000);
      setScreen('main');
    }
  };

  const handleSubpackCancel = () => {
    setSubpackPromptPacks(null);
    pendingMergeRef.current = null;
    setScreen('main');
  };

  // Download individual .mcpack
  const handleDownloadOutput = async (output: MergedOutput) => {
    if (!beginTransfer('download', 'Preparing download')) return;
    triggerHaptic(50);
    handleSoundTap();
    console.log('[Aippy] Download output:', output);

    // If blob is missing (common after loading from IndexedDB), regenerate it
    let blob = output.blob;
    if (!blob && justCompletedModpack?.outputs) {
      // Try to get it from the freshly completed modpack
      const freshOutput = justCompletedModpack.outputs.find(o => o.id === output.id);
      if (freshOutput?.blob) {
        blob = freshOutput.blob;
        console.log('[Aippy] Using blob from fresh merge:', output.fileName);
      }
    }

    if (!blob) {
      console.error('[Aippy] Output blob is missing for:', output.fileName);
      console.warn('[Download] Output file is unavailable; merge again to regenerate it.');
      endTransfer();
      return;
    }

    try {
      const result = await deliverFile(blob, output.fileName, (m) => {
        const match = m.match(/(\d+)%/);
        updateTransfer(m.replace(/….*$/, '').replace(/\s+\d+%.*$/, ''), match ? Number(match[1]) : transferProgress);
      });
      if (result.ok) {
        updateTransfer('Opening download', 100);
        return;
      }
      console.warn('[Download] Cloud hand-off failed:', result.error);
      console.warn('[Download] Could not prepare download:', result.error);
      // Show the manual panel (with the copyable link if the upload itself worked).
      const { showManualSavePanel } = await import('@/utils/download');
      showManualSavePanel(blob, output.fileName, result.url, result.error);
      if (soundTweak) playError().catch(() => {});
    } catch (e: unknown) {
      console.error('[Aippy] Download failed:', e);
      console.error('[Download] Download failed:', describeError(e));
      const { showManualSavePanel } = await import('@/utils/download');
      showManualSavePanel(blob, output.fileName, undefined, describeError(e));
      if (soundTweak) playError().catch(() => {});
    } finally {
      endTransfer();
    }
  };

  // Download combined .mcaddon
  const handleInstallToMinecraft = async (modpack: MergedModpack | null = justCompletedModpack) => {
    if (modpack?.generateAddon === false) { showToast('This project was configured without a combined .mcaddon. Download its separate .mcpack files instead.'); return; }
    if (!beginTransfer('install', 'Preparing .mcaddon')) return;
    triggerHaptic(60);
    handleSoundTap();
    if (!modpack) { endTransfer(); return; }

    console.log('[Download] Starting download for modpack:', modpack.name, 'id:', modpack.id);
    console.log('[Download] Modpack has outputBlob:', !!modpack.outputBlob);
    console.log('[Download] justCompletedModpack exists:', !!justCompletedModpack);
    console.log('[Download] justCompletedModpack has outputBlob:', !!justCompletedModpack?.outputBlob);

    // Prefer the in-memory data of the freshly completed merge (saved copies have no blobs).
    const source: MergedModpack =
      justCompletedModpack && modpack.id === justCompletedModpack.id ? justCompletedModpack : modpack;
    let blob: Blob | undefined = source.outputBlob;
    if (!blob && (source.bundleParts?.some((o) => o.blob) || source.outputs?.some((o) => o.blob))) {
      try {
        updateTransfer('Building .mcaddon', 0);
        blob = await ensureCombinedBlob(source, (pct) => updateTransfer('Building .mcaddon', pct));
      } catch (err) {
        console.error('[Download] Could not build combined file:', describeError(err));
        console.error('[Download] Could not build the combined file:', describeError(err));
        endTransfer();
        return;
      }
    }

    if (!blob) {
      console.error('[Aippy] Modpack blob is missing - cannot download from saved modpacks');
      console.warn('[Download] Modpack file unavailable; merge again to regenerate it.');
      endTransfer();
      return;
    }

    console.log('[Download] Blob size:', blob.size, 'type:', blob.type);
    const fileName = modpack.outputFileName || 'StoneByte_Modpack.mcaddon';

    try {
      updateTransfer('Uploading .mcaddon', 0);
      const result = await deliverFile(blob, fileName, (m) => {
        const match = m.match(/(\d+)%/);
        updateTransfer(m.includes('Uploading') ? 'Uploading .mcaddon' : 'Preparing download', match ? Number(match[1]) : transferProgress);
      });
      if (result.ok) {
        updateTransfer('Opening download', 100);
        return;
      }
      console.warn('[Download] Cloud hand-off failed:', result.error);
      console.warn('[Download] Could not prepare download:', result.error);
      const { showManualSavePanel } = await import('@/utils/download');
      showManualSavePanel(blob, fileName, result.url, result.error);
      if (soundTweak) playError().catch(() => {});
    } catch (e: unknown) {
      console.error('[Aippy] Download failed:', e);
      console.error('[Download] Download failed:', describeError(e));
      const { showManualSavePanel } = await import('@/utils/download');
      showManualSavePanel(blob, fileName, undefined, describeError(e));
      if (soundTweak) playError().catch(() => {});
    } finally {
      endTransfer();
    }
  };

  // Web Share API
  const handleShareModpack = async () => {
    triggerHaptic(40);
    handleSoundTap();
    if (!justCompletedModpack) return;
    if (navigator.share) {
      try {
        await navigator.share({
          title: justCompletedModpack.name,
          text: `Download my Bedrock addon modpack consolidated with AutoBE! Includes ${justCompletedModpack.totalPacks} addons.`,
          url: window.location.href
        });
      } catch {
        // user cancelled
      }
    } else {
      handleInstallToMinecraft();
    }
  };

  // Download community modpack
  const handleDownloadCommunityModpack = async (modpack: CommunityModpack) => {
    triggerHaptic(50);
    handleSoundTap();

    try {
      // Count a download attempt server-side, then open the actual R2 file.
      // Counting is best-effort so a stats/API hiccup never blocks the download.
      const auth = getDiscordAuth();
      if (auth) {
        fetch(`/api/community-modpacks?action=download&id=${encodeURIComponent(modpack.id)}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${auth.token}` },
        }).catch((err) => console.warn('[Community] Could not record download:', err));
      }
      // Open the hosted file in the system browser (blob/anchor downloads are
      // blocked inside Discord Activities).
      await openExternalUrl(modpack.blob_url);
      showToast(`${modpack.name} download started!`);
    } catch (e: unknown) {
      console.error('[Aippy] Community modpack download failed:', e);
      showToast(`Download failed: ${describeError(e)}`);
      if (soundTweak) playError().catch(() => {});
    }
  };

  // Publish modpack to community
  const [isPublishing, setIsPublishing] = useState(false);
  const [activeTransfer, setActiveTransfer] = useState<'publish' | 'install' | 'download' | null>(null);
  const [transferProgress, setTransferProgress] = useState(0);
  const [transferStatus, setTransferStatus] = useState('');
  const transferLockRef = useRef(false);

  const beginTransfer = (kind: 'publish' | 'install' | 'download', status: string) => {
    if (transferLockRef.current) return false;
    transferLockRef.current = true;
    setActiveTransfer(kind);
    setTransferProgress(0);
    setTransferStatus(status);
    return true;
  };
  const updateTransfer = (status: string, progress: number) => {
    setTransferStatus(status);
    setTransferProgress(Math.max(0, Math.min(100, progress)));
  };
  const endTransfer = () => {
    transferLockRef.current = false;
    setActiveTransfer(null);
    setTransferProgress(0);
    setTransferStatus('');
  };

  const handlePublishModpack = async (communityIconDataUrl?: string | null) => {
    if (justCompletedModpack?.generateAddon === false) { showToast('Community publishing requires a combined .mcaddon. Enable Combined Addon in the workspace and merge again.'); return; }
    if (!justCompletedModpack || !beginTransfer('publish', 'Building modpack')) return;

    console.log('[Publish] Starting publish for modpack:', justCompletedModpack.name);
    console.log('[Publish] Has outputBlob:', !!justCompletedModpack.outputBlob);

    triggerHaptic(50);
    setIsPublishing(true);

    try {
      // Get the blob
      let blob = justCompletedModpack.outputBlob;
      if (!blob && (justCompletedModpack.bundleParts?.some((o) => o.blob) || justCompletedModpack.outputs?.some((o) => o.blob))) {
        updateTransfer('Building modpack', 0);
        blob = await ensureCombinedBlob(justCompletedModpack, (pct) => updateTransfer('Building modpack', pct));
      }
      if (!blob) {
        console.error('[Publish] Blob is missing - cannot publish');
        throw new Error('Modpack blob is missing. Please merge again before publishing.');
      }

      console.log('[Publish] Blob size:', blob.size, 'type:', blob.type);

      const auth = getDiscordAuth();
      if (!auth) {
        throw new Error('Your Discord session was not found. Close and reopen the Activity, then try again.');
      }

      // Author name comes from the Discord SDK sign-in (calling discord.com directly
      // from inside an Activity is not guaranteed to be allowed by Discord's proxy/CSP).
      const discordUser = getDiscordUser();
      if (!discordUser) {
        throw new Error('Your Discord profile was not found. Close and reopen the Activity, then try again.');
      }
      const authorName = discordUser.global_name || discordUser.username || 'Anonymous';
      const authorId = discordUser.id;
      console.log('[Publish] Author:', authorName, 'ID:', authorId);

      // Upload to our own storage (no Discord size limit, link doesn't expire).
      let lastShown = -1;
      const uploaded = await uploadToCloud(blob, justCompletedModpack.outputFileName, 'pub', (pct) => {
        if (pct - lastShown >= 10 || pct === 100) {
          lastShown = pct;
          updateTransfer('Uploading modpack', pct);
        }
      });
      const blobUrl = uploaded.url;
      console.log('[Publish] Uploaded:', blobUrl);

      // Publish to community API
      console.log('[Publish] Publishing to community API...');
      console.log('[Publish] Request body:', {
        name: justCompletedModpack.name,
        description: justCompletedModpack.description,
        author: authorName,
        author_id: authorId,
        version: justCompletedModpack.version,
        total_packs: justCompletedModpack.totalPacks,
        size: justCompletedModpack.size,
        blob_url: blobUrl,
        file_name: justCompletedModpack.outputFileName,
      });

      const publishResponse = await fetch('/api/community-modpacks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${auth.token}`,
        },
        body: JSON.stringify({
          name: justCompletedModpack.name,
          description: justCompletedModpack.description || 'Custom Minecraft Bedrock modpack',
          author: authorName,
          author_id: authorId,
          version: justCompletedModpack.version,
          total_packs: justCompletedModpack.totalPacks,
          size: blob.size,
          // Store the actual merged archive size, not the sum of the source packs.
          // Keep base64 image data out of the community API if it is too large for D1.
          icon_data_url: typeof communityIconDataUrl === 'string' && communityIconDataUrl.length <= 100_000
            ? communityIconDataUrl
            : null,
          blob_url: blobUrl,
          file_name: justCompletedModpack.outputFileName,
          included_packs: justCompletedModpack.includedPacks,
        }),
      });

      console.log('[Publish] Community API response status:', publishResponse.status);
      const responseText = await publishResponse.text();
      console.log('[Publish] Community API response body:', responseText);

      if (!publishResponse.ok) {
        let error = 'Failed to publish modpack';
        try {
          const errorJson = JSON.parse(responseText);
          // Preserve server diagnostics so a generic 500 does not hide the actual cause.
          error = [errorJson.error, errorJson.details]
            .filter((part) => typeof part === 'string' && part.trim())
            .join(': ') || error;
        } catch {
          error = responseText || error;
        }
        console.error('[Publish] Community API error:', error);
        if (publishResponse.status === 429) {
          throw new Error(error || 'Publishing limit reached. Please try again later.');
        }
        if (publishResponse.status === 507 || /storage.*(limit|full)|quota.*exceed/i.test(error)) {
          throw new Error('Cloud storage is at its current limit. Your modpack was not published; please try again later.');
        }
        if (publishResponse.status === 503 || publishResponse.status === 502) {
          throw new Error('Cloudflare is temporarily unavailable or a free-tier limit was reached. Please wait a little and try again.');
        }
        throw new Error(error);
      }

      const responseData = JSON.parse(responseText);
      console.log('[Publish] Successfully published! Modpack ID:', responseData.id);
      updateTransfer('Published successfully', 100);
      if (soundTweak) playSuccess().catch(() => {});
    } catch (e: unknown) {
      console.error('[Aippy] Publish failed:', e);
      console.error('[Publish] Publish failed:', describeError(e));
      if (soundTweak) playError().catch(() => {});
      return describeError(e);
    } finally {
      setIsPublishing(false);
      endTransfer();
    }
  };


  return (
    <div className="relative flex h-[100dvh] min-h-0 w-full flex-col overflow-hidden bg-[#090713] pt-[calc(var(--autobe-host-top-inset)+env(safe-area-inset-top,0px))] pb-[env(safe-area-inset-bottom,0px)] font-sans text-[#F8F5FF]">
      {toastMessage && <div className="fixed left-3 right-3 top-[calc(env(safe-area-inset-top)+4.25rem)] z-[100] mx-auto flex max-w-xl items-center justify-between gap-3 rounded-xl border border-violet-400/40 bg-[#17102C]/95 p-3 text-xs font-semibold text-white shadow-2xl backdrop-blur-xl sm:left-auto sm:right-5"><div className="flex min-w-0 items-center gap-2"><Info className="h-4 w-4 shrink-0 text-violet-300"/><span className="break-words">{toastMessage}</span></div><button type="button" onClick={() => setToastMessage(null)} aria-label="Dismiss notification" className="rounded-lg p-1 text-violet-200/70 hover:bg-white/10 hover:text-white"><X className="h-4 w-4"/></button></div>}
      {subpackPromptPacks && <SubpackSelectModal packs={subpackPromptPacks} onConfirm={handleSubpackConfirm} onCancel={handleSubpackCancel}/>}
      {screen === 'script_check' && mergePlan && <ScriptCheckScreen plan={mergePlan} selectedPacks={getSelectedPacks()} onContinue={() => { triggerHaptic(50); handleSoundTap(); runMergeProcess(getSelectedPacks(), conflicts, undefined, pendingTargetEngineRef.current, pendingOutputOptionsRef.current); }} onBack={() => setScreen('main')}/>}
      {screen === 'conflicts' && <ConflictScreen conflicts={conflicts} autoMerge={autoMerge} packs={getSelectedPacks()} onUpdateResolution={(cid,res) => setConflicts(prev => prev.map(c => c.id === cid ? {...c,resolution:res} : c))} onAutoPrefixAll={() => { setConflicts(prev => prev.map(c => ({...c,resolution:c.type === 'vanilla_asset' || c.type === 'loot_table' || c.type === 'spawn_rule' || c.identifier === 'minecraft:player' ? 'keep_a' : 'prefix_all'}))); showToast('Applied safe defaults: namespace custom conflicts and keep the first vanilla override.'); }} onProceedMerge={() => openScriptCheck(getSelectedPacks())} onBack={() => setScreen('main')}/>}
      {screen === 'merging' && <MergingScreen currentStep={mergeStep} progress={mergeProgress} packCount={selectedPackIds.length} onCancel={() => setScreen('main')}/>}
      {screen === 'merge_complete' && justCompletedModpack && <MergeCompleteScreen modpack={justCompletedModpack} onInstallToMinecraft={() => handleInstallToMinecraft()} onSaveToFiles={() => handleInstallToMinecraft()} onShare={handleShareModpack} onDownloadOutput={handleDownloadOutput} onDone={() => {setJustCompletedModpack(null);navigateTab('workspace');}} onRename={newName => setJustCompletedModpack({...justCompletedModpack,name:newName,outputFileName:`${newName.replace(/\\s+/g,'_')}.mcaddon`})} onPublish={handlePublishModpack} isPublishing={isPublishing} activeTransfer={activeTransfer} transferProgress={transferProgress} transferStatus={transferStatus}/>}
      {screen === 'community' && <CommunityModpacksScreen onBack={() => setScreen('main')} onDownload={handleDownloadCommunityModpack} currentUserId={discordUser?.id}/>}
      {screen === 'main' && <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <aside className="hidden w-[248px] shrink-0 flex-col border-r border-violet-300/10 bg-[#0D0A18] px-4 py-5 lg:flex">
          <AutoBEWordmark/>
          <div className="mt-10 px-3 text-[10px] font-extrabold uppercase tracking-[.2em] text-violet-200/40">Workspace</div>
          <nav className="mt-3 space-y-1" aria-label="Main navigation">
            <button onClick={() => navigateTab('workspace')} className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition ${currentTab==='workspace'?'border border-violet-300/25 bg-violet-500/15 text-white shadow-[inset_3px_0_0_#A78BFA]':'text-[#AAA1C0] hover:bg-white/[.04] hover:text-white'}`}><AutoBEFeatureArt kind="merge" size={40}/><span><span className="block text-sm font-bold">Merger</span><span className="block text-[10px] text-[#837995]">Build your modpack</span></span></button>
            <button onClick={() => navigateTab('community')} className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition ${currentTab==='community'?'border border-violet-300/25 bg-violet-500/15 text-white':'text-[#AAA1C0] hover:bg-white/[.04] hover:text-white'}`}><AutoBEFeatureArt kind="community" size={40}/><span><span className="block text-sm font-bold">Community</span><span className="block text-[10px] text-[#837995]">Discover modpacks</span></span></button>
            <button onClick={() => navigateTab('community_addons')} className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition ${currentTab==='community_addons'?'border border-violet-300/25 bg-violet-500/15 text-white':'text-[#AAA1C0] hover:bg-white/[.04] hover:text-white'}`}><AutoBEFeatureArt kind="addons" size={40}/><span><span className="block text-sm font-bold">Addon Library</span><span className="block text-[10px] text-[#837995]">Browse individual packs</span></span></button>
          </nav>
          <div className="mt-auto overflow-hidden rounded-2xl border border-violet-300/15 bg-gradient-to-br from-[#211342] to-[#100D1C] p-4"><AutoBEFeatureArt kind="home" size={78}/><div className="mt-2 text-sm font-extrabold">Build. Merge. Explore.</div><p className="mt-1 text-xs leading-relaxed text-[#A99FBE]">Your Bedrock toolkit, with room for bigger ideas.</p><div className="mt-4 flex items-center gap-2 text-[10px] font-bold text-emerald-300"><span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_10px_#34D399]"/> Studio ready</div></div>
        </aside>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <header className="flex shrink-0 items-center justify-between gap-3 border-b border-violet-300/10 bg-[#0D0A18]/95 px-4 py-3 backdrop-blur-xl sm:px-6"><div className="lg:hidden"><AutoBEWordmark/></div><div className="hidden min-w-0 items-center gap-2 text-xs text-[#9B91AE] lg:flex"><span className="text-violet-200/50">Studio</span><span>/</span><span className="font-semibold text-white">{currentTab==='workspace'?'Merger workspace':currentTab==='community'?'Community modpacks':'Addon library'}</span></div><div className="ml-auto flex items-center gap-3"><div className="hidden text-right sm:block"><div className="text-xs font-bold text-white">{discordUser?.global_name || discordUser?.username || 'Discord member'}</div><div className="text-[10px] text-[#8E849F]">AutoBE Studio</div></div><div className="grid h-9 w-9 place-items-center rounded-xl border border-violet-300/20 bg-violet-500/10 text-xs font-black text-violet-200">{(discordUser?.global_name || discordUser?.username || 'A').slice(0,1).toUpperCase()}</div></div></header>
          <nav className="flex shrink-0 gap-2 overflow-x-auto border-b border-violet-300/10 bg-[#100B1D] px-3 py-2 lg:hidden" aria-label="Mobile navigation">
            <button onClick={() => navigateTab('workspace')} className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold ${currentTab==='workspace'?'bg-violet-500/20 text-white':'text-[#A99FBE]'}`}><AutoBEFeatureArt kind="merge" size={25}/> Merger</button>
            <button onClick={() => navigateTab('community')} className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold ${currentTab==='community'?'bg-violet-500/20 text-white':'text-[#A99FBE]'}`}><AutoBEFeatureArt kind="community" size={25}/> Community</button>
            <button onClick={() => navigateTab('community_addons')} className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold ${currentTab==='community_addons'?'bg-violet-500/20 text-white':'text-[#A99FBE]'}`}><AutoBEFeatureArt kind="addons" size={25}/> Addon Library</button>
          </nav>
          <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-[radial-gradient(ellipse_at_70%_0%,rgba(109,40,217,.12),transparent_42%),#090713]">
            {currentTab==='workspace' ? <>
              <section className="relative mx-4 mt-4 overflow-hidden rounded-2xl border border-violet-300/15 bg-gradient-to-r from-[#21113D] via-[#17102C] to-[#100D1B] p-5 sm:mx-6 sm:mt-6 sm:p-7"><div className="pointer-events-none absolute -right-8 -top-10 opacity-30"><AutoBEFeatureArt kind="home" size={230}/></div><div className="relative z-10 max-w-2xl"><div className="mb-2 text-[10px] font-extrabold uppercase tracking-[.2em] text-violet-200/70">Your Bedrock creation studio</div><h1 className="text-2xl font-black tracking-tight text-white sm:text-3xl">Make more room for <span className="text-violet-300">imagination.</span></h1><p className="mt-2 max-w-lg text-xs leading-relaxed text-[#B9ADC9] sm:text-sm">Bring your favorite addons together, resolve conflicts, and build a pack that feels like yours.</p><div className="mt-4 flex flex-wrap gap-2"><span className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-[10px] font-semibold text-[#D8CDED]">{installedPacks.length} imported packs</span><span className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-[10px] font-semibold text-[#D8CDED]">{selectedPackIds.length} selected for merge</span></div></div></section>
              <div className="mx-4 mb-6 mt-5 sm:mx-6"><div className="mb-3 flex items-center justify-between gap-3"><div><div className="text-[10px] font-extrabold uppercase tracking-[.2em] text-violet-200/55">Build workspace</div><h2 className="mt-1 text-lg font-extrabold text-white">Merger</h2></div><div className="text-[10px] text-[#847995]">Import · Organize · Analyze · Export</div></div><MergeWorkspace installedPacks={installedPacks} selectedPackIds={selectedPackIds} onTogglePack={handleTogglePack} onSelectAll={handleSelectAll} onClearSelection={handleClearSelection} onStartMergeFlow={handleStartMergeFlow} onImportPacks={handleImportPacks}/></div>
            </> : currentTab==='community' ? <CommunityModpacksScreen onBack={() => navigateTab('workspace')} onDownload={handleDownloadCommunityModpack} currentUserId={discordUser?.id}/> : <CommunityAddonsScreen onBack={() => navigateTab('workspace')} currentUserId={discordUser?.id}/>}
          </main>
        </div>
      </div>}
    </div>
  );
