import React, { useState, useEffect, useRef } from 'react';
import { aippyTweaks } from '@aippy/runtime/tweaks';
import { vibrate } from '@aippy/runtime/device';
import { Info, X } from 'lucide-react';
import { CosmicBackdrop } from '@/brand-art/CosmicBackdrop';
import '@/brand-art/cosmic-backdrop.css';
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
import { CreatorProfileScreen } from '@/components/CreatorProfileScreen';
import { CreatorPublicProfileScreen } from '@/components/CreatorPublicProfileScreen';

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
  const [showCreatorProfile, setShowCreatorProfile] = useState(false);
  const [publicCreatorId,setPublicCreatorId]=useState<string|null>(null);
  const [roleAccessStatus,setRoleAccessStatus]=useState<'checking'|'verified'|'unverified'|'error'|'unknown'>(()=>getDiscordAuth()?'checking':'unknown');
  const [roleAccessMessage,setRoleAccessMessage]=useState('');

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

  // AutoBE access is tied to the required Discord role. Previously verified
  // users are revoked immediately when a check confirms role loss; unverified
  // users see the same verification gate until they regain the role. Every
  // server-side Community and upload route independently enforces this check.
  useEffect(() => {
    const checkAccess = async () => {
      const auth = getDiscordAuth();
      if (!auth?.token) {
        setRoleAccessStatus(current => current === 'checking' ? 'unknown' : current);
        return;
      }
      try {
        const response = await fetch('/api/community-social?action=me', {
          headers: { Authorization: `Bearer ${auth.token}` },
          cache: 'no-store',
        });
        const data = await response.json().catch(() => ({})) as { error?: string; code?: string };
        if (response.ok) {
          setRoleAccessMessage('');
          setRoleAccessStatus('verified');
          return;
        }
        if (response.status === 403 && data.code === 'DISCORD_ROLE_REQUIRED') {
          setRoleAccessMessage(data.error || 'Your Discord account does not currently have the required AutoBE role.');
          setRoleAccessStatus('unverified');
          setCurrentTab('workspace');
          setScreen('main');
          setShowCreatorProfile(false);
          setPublicCreatorId(null);
          return;
        }
        if (response.status === 401) {
          setRoleAccessMessage('Your Discord session could not be verified. Reopen AutoBE through Discord and try again.');
          setRoleAccessStatus('error');
        } else if (response.status >= 500) {
          setRoleAccessMessage(data.error || 'Discord role verification is temporarily unavailable. Your role has not been treated as removed.');
          setRoleAccessStatus(current => current === 'verified' ? 'verified' : 'error');
        }
      } catch {
        setRoleAccessMessage('We could not reach Discord to verify your role. Please try again.');
        setRoleAccessStatus(current => current === 'verified' ? 'verified' : 'error');
      }
    };
    void checkAccess();
    const interval = window.setInterval(() => void checkAccess(), 30_000);
    return () => window.clearInterval(interval);
  }, []);

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
  if (roleAccessStatus === 'unverified' || roleAccessStatus === 'error') {
    return (
      <div className="relative flex min-h-[100dvh] w-full items-center justify-center overflow-hidden bg-[#090713] p-5 text-[#F8F5FF]">
        <img src="/assets/Locked%20Out%20Background.gif" alt="" aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-80"/>
        <div className="pointer-events-none absolute inset-0 bg-[#080510]/65"/>
        <div className="relative z-10 w-full max-w-md rounded-2xl border border-amber-300/20 bg-[#15111F]/90 p-6 text-center shadow-2xl backdrop-blur-md">
          <img src="/assets/Locked%20Out%20AutoBE%20Screen.gif" alt="AutoBE access screen" className="mx-auto mb-4 max-h-40 max-w-full object-contain"/>
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-amber-300/20 bg-amber-300/10 text-2xl">!</div>
          <p className="mt-5 text-[10px] font-extrabold uppercase tracking-[.2em] text-amber-200/70">{roleAccessStatus === 'unverified' ? 'Discord verification required' : 'Discord check unavailable'}</p>
          <h1 className="mt-2 text-2xl font-black">{roleAccessStatus === 'unverified' ? 'Required role not found' : 'Could not verify access'}</h1>
          <p className="mt-3 text-sm leading-relaxed text-[#C9BED8]">{roleAccessMessage || (roleAccessStatus === 'unverified' ? 'Your Discord account does not currently have the required AutoBE role.' : 'We could not confirm your Discord role right now.')}</p>
          <p className="mt-3 text-xs leading-relaxed text-[#9D93AD]">{roleAccessStatus === 'unverified' ? 'Rejoin the required Discord role, then reopen AutoBE to verify your access again.' : 'This is not treated as role removal. Try again when Discord verification is available.'}</p>
          <button type="button" onClick={() => window.location.reload()} className="mt-6 w-full rounded-xl bg-violet-500 px-4 py-3 text-sm font-bold text-white hover:bg-violet-400">Check access again</button>
        </div>
      </div>
    );
  }
  if (roleAccessStatus === 'checking') {
    return (
      <div className="autobe-loading-screen autobe-loading-screen--brand" role="status" aria-live="polite">
        <img src="/assets/New%20AutoBE%20Main%20Icon.gif" alt="AutoBE" className="autobe-loading-logo"/>
        <p className="autobe-loading-message">Loading into a wonderful place...</p>
      </div>
    );
  }
  return (
    <div className={"isolate relative flex h-[100dvh] min-h-0 w-full flex-col overflow-hidden " + (showCreatorProfile || publicCreatorId ? "bg-[#090713]" : "bg-transparent") + " pt-[calc(var(--autobe-host-top-inset)+env(safe-area-inset-top,0px))] pb-[env(safe-area-inset-bottom,0px)] font-sans text-[#F8F5FF]"}>
{!showCreatorProfile && !publicCreatorId && <CosmicBackdrop className="autobe-cosmic-backdrop--app" />}
      {toastMessage && <div className="fixed left-3 right-3 top-[calc(env(safe-area-inset-top)+4.25rem)] z-[100] mx-auto flex max-w-xl items-center justify-between gap-3 rounded-xl border border-violet-400/40 bg-[#17102C]/95 p-3 text-xs font-semibold text-white shadow-2xl backdrop-blur-xl sm:left-auto sm:right-5"><div className="flex min-w-0 items-center gap-2"><Info className="h-4 w-4 shrink-0 text-violet-300"/><span className="break-words">{toastMessage}</span></div><button type="button" onClick={() => setToastMessage(null)} aria-label="Dismiss notification" className="rounded-lg p-1 text-violet-200/70 hover:bg-white/10 hover:text-white"><X className="h-4 w-4"/></button></div>}
      {subpackPromptPacks && <SubpackSelectModal packs={subpackPromptPacks} onConfirm={handleSubpackConfirm} onCancel={handleSubpackCancel}/>}
      {screen === 'script_check' && mergePlan && <ScriptCheckScreen plan={mergePlan} selectedPacks={getSelectedPacks()} onContinue={() => { triggerHaptic(50); handleSoundTap(); runMergeProcess(getSelectedPacks(), conflicts, undefined, pendingTargetEngineRef.current, pendingOutputOptionsRef.current); }} onBack={() => setScreen('main')}/>}
      {screen === 'conflicts' && <ConflictScreen conflicts={conflicts} autoMerge={autoMerge} packs={getSelectedPacks()} onUpdateResolution={(cid,res) => setConflicts(prev => prev.map(c => c.id === cid ? {...c,resolution:res} : c))} onAutoPrefixAll={() => { setConflicts(prev => prev.map(c => ({...c,resolution:c.type === 'vanilla_asset' || c.type === 'loot_table' || c.type === 'spawn_rule' || c.identifier === 'minecraft:player' ? 'keep_a' : 'prefix_all'}))); showToast('Applied safe defaults: namespace custom conflicts and keep the first vanilla override.'); }} onProceedMerge={() => openScriptCheck(getSelectedPacks())} onBack={() => setScreen('main')}/>}
      {screen === 'merging' && <MergingScreen currentStep={mergeStep} progress={mergeProgress} packCount={selectedPackIds.length} onCancel={() => setScreen('main')}/>}
      {screen === 'merge_complete' && justCompletedModpack && <MergeCompleteScreen modpack={justCompletedModpack} onInstallToMinecraft={() => handleInstallToMinecraft()} onSaveToFiles={() => handleInstallToMinecraft()} onShare={handleShareModpack} onDownloadOutput={handleDownloadOutput} onDone={() => {setJustCompletedModpack(null);navigateTab('workspace');}} onRename={newName => setJustCompletedModpack({...justCompletedModpack,name:newName,outputFileName:`${newName.replace(/\\s+/g,'_')}.mcaddon`})} onPublish={handlePublishModpack} isPublishing={isPublishing} activeTransfer={activeTransfer} transferProgress={transferProgress} transferStatus={transferStatus}/>}
      {screen === 'community' && !publicCreatorId && <CommunityModpacksScreen onBack={() => setScreen('main')} onDownload={handleDownloadCommunityModpack} currentUserId={discordUser?.id} onOpenCreator={setPublicCreatorId}/>} 
      {showCreatorProfile && <CreatorProfileScreen onBack={() => setShowCreatorProfile(false)} user={discordUser}/>}
      {publicCreatorId && <CreatorPublicProfileScreen creatorId={publicCreatorId} currentUserId={discordUser?.id} onBack={()=>setPublicCreatorId(null)} onOpenUpload={handleDownloadCommunityModpack}/>} 
      {screen === 'main' && !showCreatorProfile && !publicCreatorId && <div className="relative z-10 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex shrink-0 flex-col gap-3 border-b border-white/10 bg-[#090713]/55 px-4 py-3 backdrop-blur-xl sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <img src="/assets/New%20AutoBE%20Main%20Icon.gif" alt="AutoBE" className="h-11 w-11 shrink-0 object-contain mix-blend-screen"/>
            <div><div className="text-lg font-black tracking-tight text-white">AutoBE</div><div className="text-[9px] font-semibold uppercase tracking-[.2em] text-violet-100/65">Bedrock creation studio</div></div>
          </div>
          <div className="flex min-w-0 items-center justify-between gap-3 lg:justify-end">
            <nav className="flex min-w-0 flex-1 items-center justify-center gap-2 sm:gap-4 lg:flex-none" aria-label="Main navigation">
              <button type="button" onClick={() => navigateTab('workspace')} aria-label="Merger" aria-current={currentTab==='workspace'?'page':undefined} className={`flex min-w-0 flex-1 items-center justify-center rounded-xl border p-2 transition sm:flex-none sm:px-4 ${currentTab==='workspace'?'border-violet-300/50 bg-violet-400/15 shadow-[0_0_24px_rgba(139,92,246,.16)]':'border-transparent hover:border-white/15 hover:bg-white/[.06]'}`}><img src="/assets/Merger.gif" alt="Merger" className="h-12 w-auto max-w-full object-contain sm:h-14"/></button>
              <button type="button" onClick={() => navigateTab('community')} aria-label="Community modpacks" aria-current={currentTab==='community'?'page':undefined} className={`flex min-w-0 flex-1 items-center justify-center rounded-xl border p-2 transition sm:flex-none sm:px-4 ${currentTab==='community'?'border-violet-300/50 bg-violet-400/15 shadow-[0_0_24px_rgba(139,92,246,.16)]':'border-transparent hover:border-white/15 hover:bg-white/[.06]'}`}><img src="/assets/Modpacks.gif" alt="Community" className="h-12 w-auto max-w-full object-contain sm:h-14"/></button>
              <button type="button" onClick={() => navigateTab('community_addons')} aria-label="Addon library" aria-current={currentTab==='community_addons'?'page':undefined} className={`flex min-w-0 flex-1 items-center justify-center rounded-xl border p-2 transition sm:flex-none sm:px-4 ${currentTab==='community_addons'?'border-violet-300/50 bg-violet-400/15 shadow-[0_0_24px_rgba(139,92,246,.16)]':'border-transparent hover:border-white/15 hover:bg-white/[.06]'}`}><img src="/assets/Addons.gif" alt="Addons" className="h-12 w-auto max-w-full object-contain sm:h-14"/></button>
            </nav>
            <button type="button" onClick={() => setShowCreatorProfile(true)} aria-label="Open your creator profile" title="Your profile" className="h-10 w-10 shrink-0 overflow-hidden rounded-full border border-violet-300/40 bg-violet-500/10 transition hover:border-violet-200 hover:ring-2 hover:ring-violet-400/30 focus:outline-none focus:ring-2 focus:ring-violet-300">{discordUser?.id && discordUser.avatar ? <img src={`https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.${discordUser.avatar.startsWith('a_') ? 'gif' : 'png'}?size=96`} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer"/> : <div className="grid h-full w-full place-items-center text-xs font-black text-violet-200">{(discordUser?.global_name || discordUser?.username || 'A').slice(0,1).toUpperCase()}</div>}</button>
          </div>
        </header>
        <main className="relative z-10 min-h-0 flex-1 overflow-y-auto overscroll-contain bg-transparent">
          {currentTab==='workspace' ? <>
            <section className="mx-4 mt-4 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-white/10 bg-[#0B0816]/55 px-5 py-4 backdrop-blur-md sm:mx-6 sm:mt-6 sm:px-6">
              <div className="min-w-0"><img src="/assets/Merger.gif" alt="Merger" className="h-12 w-auto max-w-[min(72vw,320px)] object-contain sm:h-14"/><p className="mt-2 max-w-xl text-xs leading-relaxed text-[#C4B9D4] sm:text-sm">Import Bedrock packs, organize your selection, resolve conflicts, and export one merged addon.</p></div>
              <div className="flex flex-wrap gap-2 text-[10px] font-semibold text-[#E3D9F2]"><span className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">{installedPacks.length} imported</span><span className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">{selectedPackIds.length} selected</span></div>
            </section>
            <div className="mx-4 mb-6 mt-5 sm:mx-6"><MergeWorkspace installedPacks={installedPacks} selectedPackIds={selectedPackIds} onTogglePack={handleTogglePack} onSelectAll={handleSelectAll} onClearSelection={handleClearSelection} onStartMergeFlow={handleStartMergeFlow} onImportPacks={handleImportPacks}/></div>
          </> : currentTab==='community' ? <CommunityModpacksScreen onBack={() => navigateTab('workspace')} onDownload={handleDownloadCommunityModpack} currentUserId={discordUser?.id} onOpenCreator={setPublicCreatorId}/> : <CommunityAddonsScreen onBack={() => navigateTab('workspace')} currentUserId={discordUser?.id} onOpenCreator={setPublicCreatorId}/>}
        </main>
      </div>}
    </div>
  );
};

export default App;
