import React, { useState, useEffect, useRef } from 'react';
import { aippyTweaks } from '@aippy/runtime/tweaks';
import { vibrate } from '@aippy/runtime/device';
import { Info, X } from 'lucide-react';
import tweaksConfig from '@/config/tweaksConfig.json';

import {
  AddonPack,
  MergedModpack,
  MergedOutput,
  ConflictItem,
  TabType,
  ScreenType,
  MergeSessionConfig,
  CommunityModpack
} from '@/types/modpack';
import { INITIAL_DEMO_PACKS, INITIAL_DEMO_MODPACKS } from '@/utils/demoData';
import { deliverFile, openExternalUrl } from '@/utils/deliverFile';
import { ensureCombinedBlob } from '@/utils/mergeEngine';
import { uploadToCloud } from '@/utils/cloudUpload';
import { getDiscordAuth, getDiscordUser } from '@/utils/discordAuth';
import {
  getAllPacksFromDB,
  savePackToDB,
  loadPackFile,
  getLastStorageError,
  deletePackFromDB,
  getAllModpacksFromDB,
  saveModpackToDB,
  deleteModpackFromDB,
  clearAllDB
} from '@/utils/storage';
import { detectConflicts, parseAddonArchive } from '@/utils/addonParser';
import { executeMergePacks, buildMergePlan, MergePlan } from '@/utils/mergeEngine';
import { applySubpackToPack } from '@/utils/subpackProcessor';
import { scanScriptRuntimeConflicts, conflictsToReport } from '@/utils/scriptConflictScan';
import { describeError } from '@/utils/errorLog';
import { downloadBlob } from '@/utils/download';
import { useModpackAudio } from '@/hooks/useModpackAudio';
import { mergeLogger } from '@/utils/mergeLogger';

import { AppSidebar, TopBar, UtilityPanel } from '@/components/DashboardShell';
import { BottomNav } from '@/components/BottomNav';
import { HomeScreen } from '@/components/HomeScreen';
import { MergeWorkspace } from '@/components/MergeWorkspace';
import { DependenciesScreen } from '@/components/DependenciesScreen';
import { LogsScreen } from '@/components/LogsScreen';
import { AddPacksScreen } from '@/components/AddPacksScreen';
import { ScriptCheckScreen } from '@/components/ScriptCheckScreen';
import { ConflictScreen } from '@/components/ConflictScreen';
import { MergingScreen } from '@/components/MergingScreen';
import { MergeCompleteScreen } from '@/components/MergeCompleteScreen';
import { ModpackDetailsScreen } from '@/components/ModpackDetailsScreen';
import { SettingsScreen } from '@/components/SettingsScreen';
import { AboutScreen } from '@/components/AboutScreen';
import { LibraryScreen } from '@/components/LibraryScreen';
import { MyPacksScreen } from '@/components/MyPacksScreen';
import { PackExtractTool } from '@/components/PackExtractTool';
import { ListMaker } from '@/components/ListMaker';
import { LegalScreen } from '@/components/LegalScreen';
import { SplashScreen } from '@/components/SplashScreen';
import { SubpackSelectModal } from '@/components/SubpackSelectModal';
import { CommunityModpacksScreen } from '@/components/CommunityModpacksScreen';

const tweaks = aippyTweaks(tweaksConfig);

export const App: React.FC = () => {
  // Tweaks parameters at component top level
  const autoMergeTweak = tweaks.autoMergeConflicts.useState();
  const keepOriginalsTweak = tweaks.keepOriginals.useState();
  const hapticTweak = tweaks.hapticEnabled.useState();
  const soundTweak = tweaks.soundEnabled.useState();

  // Audio synthesizer hook
  const { playClick, playSuccess, playError } = useModpackAudio();

  // Navigation states - starts directly in main studio workspace
  const [screen, setScreen] = useState<ScreenType>('main');
  const [currentTab, setCurrentTab] = useState<TabType>('overview');
  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState(false);

  // Data states
  const [installedPacks, setInstalledPacks] = useState<AddonPack[]>([]);
  const [myModpacks, setMyModpacks] = useState<MergedModpack[]>([]);
  const [selectedPackIds, setSelectedPackIds] = useState<string[]>([]);
  const [activeModpack, setActiveModpack] = useState<MergedModpack | null>(null);

  // Settings states
  const [autoMerge, setAutoMerge] = useState<boolean>(true);
  const [keepOriginals, setKeepOriginals] = useState<boolean>(true);

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
  } | null>(null);
  const scriptConflictsRef = useRef<Record<string, string[]>>({});

  // File import ref
  const globalFileInputRef = useRef<HTMLInputElement>(null);

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
    setCurrentTab(tab);
    setScreen('main');
  };

  const startCreate = () => {
    triggerHaptic(50);
    handleSoundTap();
    setCurrentTab('workspace');
    setScreen('main');
  };

  const openAbout = () => {
    triggerHaptic(40);
    handleSoundTap();
    setCurrentTab('about');
    setScreen('main');
  };

  // Sync settings with tweaks
  useEffect(() => {
    const t = setTimeout(() => setAutoMerge(autoMergeTweak), 0);
    return () => clearTimeout(t);
  }, [autoMergeTweak]);

  useEffect(() => {
    const t = setTimeout(() => setKeepOriginals(keepOriginalsTweak), 0);
    return () => clearTimeout(t);
  }, [keepOriginalsTweak]);

  // Initial data loading from IndexedDB
  useEffect(() => {
    const loadData = async () => {
      try {
        const storedPacks = await getAllPacksFromDB();
        if (storedPacks.length > 0) {
          setInstalledPacks(storedPacks);
        } else {
          for (const p of INITIAL_DEMO_PACKS) {
            await savePackToDB(p);
          }
          setInstalledPacks(INITIAL_DEMO_PACKS);
        }

        const storedModpacks = await getAllModpacksFromDB();
        if (storedModpacks.length > 0) {
          setMyModpacks(storedModpacks);
        } else {
          for (const m of INITIAL_DEMO_MODPACKS) {
            await saveModpackToDB(m);
          }
          setMyModpacks(INITIAL_DEMO_MODPACKS);
        }
      } catch (err) {
        console.error('[Aippy] Initialization error:', describeError(err));
        showToast(`Could not load your saved packs: ${describeError(err)}`);
      }
    };

    loadData();
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

  // Import packs
  const handleImportPacks = async (newPacks: AddonPack[]): Promise<number> => {
    triggerHaptic(80);

    // Compare against what is REALLY stored (not a possibly-stale React state)
    // so deleting then re-importing the same addon always works.
    let existingPacks: AddonPack[];
    try {
      existingPacks = await getAllPacksFromDB();
    } catch (err) {
      console.error('[Import] Could not read storage:', describeError(err));
      showToast(`Import failed: storage unavailable (${describeError(err)})`);
      if (soundTweak) playError().catch(() => {});
      return 0;
    }

    // Dedupe by UUID + type (BP/RP halves can share a UUID), including
    // duplicates inside this same batch.
    const seen = new Set(existingPacks.map((p) => `${p.uuid}_${p.type}`));
    const trulyNew: AddonPack[] = [];
    for (const p of newPacks) {
      const key = `${p.uuid}_${p.type}`;
      if (seen.has(key)) continue;
      seen.add(key);
      trulyNew.push(p);
    }

    // Save one at a time and COUNT what actually succeeded.
    let persisted = 0;
    let memoryOnly = 0;
    let firstError: string | null = null;
    for (const p of trulyNew) {
      try {
        const where = await savePackToDB(p);
        if (where === 'saved') persisted++;
        else memoryOnly++;
      } catch (err) {
        console.error('[Import] Failed to save pack:', p.name, describeError(err));
        if (!firstError) firstError = describeError(err);
      }
    }
    const saved = persisted + memoryOnly;

    // Always refresh the list from storage, even after a partial failure.
    try {
      setInstalledPacks(await getAllPacksFromDB());
    } catch (err) {
      console.error('[Import] Could not refresh list:', describeError(err));
    }

    const skipped = newPacks.length - trulyNew.length;
    const failed = trulyNew.length - saved;
    if (failed > 0) {
      showToast(`Saved ${saved} of ${trulyNew.length} pack(s). Error: ${firstError}`, 12000);
      if (soundTweak) playError().catch(() => {});
    } else if (memoryOnly > 0) {
      showToast(
        `Added ${saved} pack(s). ${memoryOnly} couldn't be saved on this device, so they only last until you close the app — merge them now. (${getLastStorageError()})`,
        14000
      );
    } else if (skipped > 0) {
      showToast(`Added ${saved} pack(s), skipped ${skipped} duplicate(s).`);
      if (soundTweak && saved > 0) playSuccess().catch(() => {});
    } else {
      showToast(`Successfully added ${saved} pack(s) to workspace!`);
      if (soundTweak) playSuccess().catch(() => {});
    }
    return saved;
  };

  const handleGlobalFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    // Reset so picking the same file again (e.g. after deleting it) still fires onChange.
    e.target.value = '';
    if (files.length === 0) return;
    showToast(`Parsing ${files.length} archive(s)...`);

    const allParsed: AddonPack[] = [];
    for (let i = 0; i < files.length; i++) {
      try {
        const res = await parseAddonArchive(files[i], files[i].name);
        allParsed.push(...res.packs);
      } catch (err) {
        console.error('Import error:', err);
      }
    }

    if (allParsed.length > 0) {
      await handleImportPacks(allParsed);
    } else {
      showToast('No valid Minecraft Bedrock pack manifests found.');
    }
  };

  const triggerGlobalImport = () => {
    globalFileInputRef.current?.click();
  };

  // Packs in the library list carry metadata only (no file bytes). Files are loaded on demand
  // for the packs being merged and cached here for the duration of that merge.
  const hydratedPacksRef = useRef<Map<string, AddonPack>>(new Map());
  const hydratePacks = async (packs: AddonPack[]): Promise<AddonPack[]> => {
    const out: AddonPack[] = [];
    for (let i = 0; i < packs.length; i++) {
      if (!packs[i].fileBlob) showToast(`Loading ${packs[i].name} (${i + 1}/${packs.length})…`, 20000);
      out.push(await loadPackFile(packs[i])); // one at a time to limit peak memory
    }
    return out;
  };
  const mergeStartingRef = useRef(false);

  const getSelectedPacks = () =>
    installedPacks
      .filter((p) => selectedPackIds.includes(p.id))
      .map((p) => hydratedPacksRef.current.get(p.id) ?? p);

  // Open Script API check screen
  const openScriptCheck = (packsToMerge: AddonPack[]) => {
    setMergePlan(buildMergePlan(packsToMerge));
    setScreen('script_check');
  };

  // Start merge flow
  const handleStartMergeFlow = async (customConfig?: MergeSessionConfig) => {
    // Ignore extra taps while the first one is still loading packs.
    if (mergeStartingRef.current) return;
    mergeStartingRef.current = true;
    try {
      await handleStartMergeFlowInner(customConfig);
    } finally {
      mergeStartingRef.current = false;
    }
  };

  const handleStartMergeFlowInner = async (customConfig?: MergeSessionConfig) => {
    triggerHaptic(50);
    handleSoundTap();
    const selected = getSelectedPacks();
    if (selected.length === 0) {
      showToast('Please select at least one pack to merge.');
      return;
    }
    let packsToMerge: AddonPack[];
    try {
      showToast('Loading selected packs…', 20000);
      packsToMerge = await hydratePacks(selected);
      hydratedPacksRef.current = new Map(packsToMerge.map((p) => [p.id, p]));
    } catch (err) {
      console.error('[Merge] Could not load pack files:', describeError(err));
      showToast(`Could not load the selected packs: ${describeError(err)}`, 8000);
      return;
    }

    // Check for identifier conflicts
    const detected = await detectConflicts(packsToMerge);
    if (detected.length > 0 && !autoMerge) {
      setConflicts(detected);
      setScreen('conflicts');
    } else {
      openScriptCheck(packsToMerge);
    }
  };

  const doRunMergeProcess = async (
    packsToMerge: AddonPack[],
    confList: ConflictItem[] = [],
    modpackNameOverride?: string
  ) => {
    mergeLogger.info('Starting merge execution', `Packs: ${packsToMerge.length}, Name: ${modpackNameOverride || 'default'}`);
    hydratedPacksRef.current = new Map(); // the merge below holds its own reference; free the cache
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
        conflicts: confList,
        autoPrefix: autoMerge,
        scriptConflicts: scriptConflictsRef.current,
        onProgress: (step, pct) => {
          setMergeStep(step);
          setMergeProgress(pct);
          mergeLogger.info(`Merge progress: ${step}`, `${pct}%`);
        }
      });

      if (!result || (!result.outputBlob && !(result.outputs && result.outputs.some((o) => o.blob)))) {
        throw new Error('Merge completed but no output files were generated');
      }

      mergeLogger.success('Merge completed successfully', result.outputFileName, packsToMerge.length, packsToMerge.map(p => p.name));

      // Save to IndexedDB
      try {
        await saveModpackToDB(result);
        const updatedModpacks = await getAllModpacksFromDB();
        setMyModpacks(updatedModpacks);
      } catch (saveErr) {
        // The merged file itself is fine — only the history entry failed to save.
        console.error('[Aippy] Could not save merge to history:', describeError(saveErr));
        showToast('Merged OK, but could not save it to your Projects list.');
      }

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
    modpackNameOverride?: string
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

    // Port of AutoBE subpack flow: prompt for variants before merging
    const withSubpacks = packsToMerge.filter(
      (p) => p.subpacks && p.subpacks.length > 0 && p.fileBlob
    );
    // Deduplicate by UUID + type (not internal ID) to handle BP/RP halves with same UUID
    const uniqueWithSubpacks = Array.from(
      new Map(withSubpacks.map(p => [`${p.uuid}_${p.type}`, p])).values()
    );
    if (uniqueWithSubpacks.length > 0) {
      pendingMergeRef.current = { packs: packsToMerge, confList, nameOverride: modpackNameOverride };
      setSubpackPromptPacks(uniqueWithSubpacks);
      return;
    }

    await doRunMergeProcess(packsToMerge, confList, modpackNameOverride);
  };

  const handleSubpackConfirm = async (selections: Record<string, string>) => {
    const pending = pendingMergeRef.current;
    setSubpackPromptPacks(null);
    pendingMergeRef.current = null;
    if (!pending) return;

    const processed: AddonPack[] = [];
    for (const p of pending.packs) {
      // Look up selection by UUID+type (same key used for deduplication)
      const key = `${p.uuid}_${p.type}`;
      const variant = selections[key];
      if (variant && p.fileBlob) {
        try {
          processed.push(await applySubpackToPack(p, variant));
        } catch (err) {
          console.error('[Aippy] Subpack processing failed:', describeError(err));
          processed.push(p);
        }
      } else {
        processed.push(p);
      }
    }

    await doRunMergeProcess(processed, pending.confList, pending.nameOverride);
  };

  const handleSubpackCancel = () => {
    setSubpackPromptPacks(null);
    pendingMergeRef.current = null;
    setScreen('main');
  };

  // Download individual .mcpack
  const handleDownloadOutput = async (output: MergedOutput) => {
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
      showToast('This output file is not available for download. Please merge again.');
      return;
    }

    try {
      const result = await deliverFile(blob, output.fileName, (m) => showToast(m, 30000));
      if (result.ok) {
        showToast('Opening your download…');
        return;
      }
      console.warn('[Download] Cloud hand-off failed:', result.error);
      showToast(`Couldn't prepare the download: ${result.error}`, 12000);
      // Show the manual panel (with the copyable link if the upload itself worked).
      const { showManualSavePanel } = await import('@/utils/download');
      showManualSavePanel(blob, output.fileName, result.url, result.error);
      if (soundTweak) playError().catch(() => {});
    } catch (e: unknown) {
      console.error('[Aippy] Download failed:', e);
      showToast(`Download failed: ${describeError(e)}`, 12000);
      const { showManualSavePanel } = await import('@/utils/download');
      showManualSavePanel(blob, output.fileName, undefined, describeError(e));
      if (soundTweak) playError().catch(() => {});
    }
  };

  // Download combined .mcaddon
  const handleInstallToMinecraft = async (modpack: MergedModpack | null = justCompletedModpack) => {
    triggerHaptic(60);
    handleSoundTap();
    if (!modpack) return;

    console.log('[Download] Starting download for modpack:', modpack.name, 'id:', modpack.id);
    console.log('[Download] Modpack has outputBlob:', !!modpack.outputBlob);
    console.log('[Download] justCompletedModpack exists:', !!justCompletedModpack);
    console.log('[Download] justCompletedModpack has outputBlob:', !!justCompletedModpack?.outputBlob);

    // Prefer the in-memory data of the freshly completed merge (saved copies have no blobs).
    const source: MergedModpack =
      justCompletedModpack && modpack.id === justCompletedModpack.id ? justCompletedModpack : modpack;
    let blob: Blob | undefined = source.outputBlob;
    if (!blob && source.outputs?.some((o) => o.blob)) {
      try {
        showToast('Building the combined .mcaddon…', 30000);
        blob = await ensureCombinedBlob(source);
      } catch (err) {
        console.error('[Download] Could not build combined file:', describeError(err));
        showToast(`Could not build the combined file: ${describeError(err)}`, 8000);
        return;
      }
    }

    if (!blob) {
      console.error('[Aippy] Modpack blob is missing - cannot download from saved modpacks');
      showToast('Modpack file not available. Please merge again to regenerate.');
      return;
    }

    console.log('[Download] Blob size:', blob.size, 'type:', blob.type);
    const fileName = modpack.outputFileName || 'StoneByte_Modpack.mcaddon';

    try {
      const result = await deliverFile(blob, fileName, (m) => showToast(m, 30000));
      if (result.ok) {
        showToast('Opening your download…');
        return;
      }
      console.warn('[Download] Cloud hand-off failed:', result.error);
      showToast(`Couldn't prepare the download: ${result.error}`, 12000);
      const { showManualSavePanel } = await import('@/utils/download');
      showManualSavePanel(blob, fileName, result.url, result.error);
      if (soundTweak) playError().catch(() => {});
    } catch (e: unknown) {
      console.error('[Aippy] Download failed:', e);
      showToast(`Download failed: ${describeError(e)}`, 12000);
      const { showManualSavePanel } = await import('@/utils/download');
      showManualSavePanel(blob, fileName, undefined, describeError(e));
      if (soundTweak) playError().catch(() => {});
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

  // Delete pack from library
  const handleDeletePack = async (id: string) => {
    triggerHaptic(50);
    console.log('[Delete Pack] Deleting pack:', id);
    try {
      await deletePackFromDB(id);
      const updated = await getAllPacksFromDB();
      setInstalledPacks(updated);
      setSelectedPackIds((prev) => prev.filter((x) => x !== id));
      showToast('Pack removed from workspace');
    } catch (err) {
      console.error('[Delete Pack] Error:', err);
      showToast(`Failed to delete pack: ${describeError(err)}`);
    }
  };

  // Delete selected packs
  const handleDeleteSelectedPacks = async (ids: string[]) => {
    triggerHaptic(50);
    console.log('[Delete Selected] Deleting packs:', ids);
    try {
      for (const id of ids) {
        await deletePackFromDB(id);
      }
      const updated = await getAllPacksFromDB();
      setInstalledPacks(updated);
      setSelectedPackIds([]);
      showToast(`${ids.length} pack(s) removed from workspace`);
    } catch (err) {
      console.error('[Delete Selected] Error:', err);
      showToast('Failed to delete some packs');
    }
  };

  // Delete all packs
  const handleDeleteAllPacks = async () => {
    triggerHaptic(50);
    try {
      await clearAllDB();
      setInstalledPacks([]);
      setSelectedPackIds([]);
      showToast('All packs removed from workspace');
    } catch (err) {
      console.error('[Delete All] Error:', err);
      showToast(`Failed to clear storage: ${describeError(err)}`);
    }
  };

  // Download community modpack
  const handleDownloadCommunityModpack = async (modpack: CommunityModpack) => {
    triggerHaptic(50);
    handleSoundTap();

    try {
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

  const handlePublishModpack = async () => {
    if (!justCompletedModpack) return;

    console.log('[Publish] Starting publish for modpack:', justCompletedModpack.name);
    console.log('[Publish] Has outputBlob:', !!justCompletedModpack.outputBlob);

    triggerHaptic(50);
    setIsPublishing(true);

    try {
      // Get the blob
      let blob = justCompletedModpack.outputBlob;
      if (!blob && justCompletedModpack.outputs?.some((o) => o.blob)) {
        showToast('Building the combined .mcaddon…', 30000);
        blob = await ensureCombinedBlob(justCompletedModpack);
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
          showToast(`Uploading modpack… ${pct}%`, 30000);
        }
      });
      const blobUrl = uploaded.url;
      console.log('[Publish] Uploaded:', blobUrl);

      // Publish to community API
      console.log('[Publish] Publishing to community API...');
      const publishResponse = await fetch('/api/community-modpacks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: justCompletedModpack.name,
          description: justCompletedModpack.description || 'Custom Minecraft Bedrock modpack',
          author: authorName,
          author_id: authorId,
          version: justCompletedModpack.version,
          total_packs: justCompletedModpack.totalPacks,
          size: justCompletedModpack.size,
          icon_data_url: justCompletedModpack.iconDataUrl,
          blob_url: blobUrl,
          file_name: justCompletedModpack.outputFileName,
          included_packs: justCompletedModpack.includedPacks,
        }),
      });

      console.log('[Publish] Community API response status:', publishResponse.status);

      if (!publishResponse.ok) {
        const error = await publishResponse.json();
        console.error('[Publish] Community API error:', error);
        throw new Error(error.error || 'Failed to publish modpack');
      }

      console.log('[Publish] Successfully published!');
      showToast('Modpack published to community!');
      if (soundTweak) playSuccess().catch(() => {});
    } catch (e: unknown) {
      console.error('[Aippy] Publish failed:', e);
      showToast(`Publish failed: ${describeError(e)}`);
      if (soundTweak) playError().catch(() => {});
    } finally {
      setIsPublishing(false);
    }
  };

  // Delete merged modpack
  const handleDeleteModpack = async (id: string) => {
    triggerHaptic(50);
    try {
      await deleteModpackFromDB(id);
      const updated = await getAllModpacksFromDB();
      setMyModpacks(updated);
      if (activeModpack?.id === id) {
        setActiveModpack(null);
        setScreen('main');
      }
      showToast('Modpack deleted from storage');
    } catch (err) {
      console.error('[Delete Modpack] Error:', err);
      showToast(`Failed to delete modpack: ${describeError(err)}`);
    }
  };

  // Update an existing modpack in storage and UI state (e.g. after customization)
  const handleUpdateModpack = async (updated: MergedModpack) => {
    await saveModpackToDB(updated);
    setMyModpacks((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
    if (activeModpack?.id === updated.id) {
      setActiveModpack(updated);
    }
    if (justCompletedModpack?.id === updated.id) {
      setJustCompletedModpack(updated);
    }
    triggerHaptic(80);
    showToast('Pack name, description, author, and icon updated.');
  };

  // Clear demo data
  const handleClearDemoData = async () => {
    triggerHaptic(90);
    try {
      await clearAllDB();
      setInstalledPacks([]);
      setMyModpacks([]);
      setSelectedPackIds([]);
      showToast('Cleared all addons and modpacks data.');
    } catch (err) {
      showToast(`Failed to clear data: ${describeError(err)}`);
    }
  };

  const behaviorCount = installedPacks.filter((p) => p.type === 'Behavior Pack').length;
  const resourceCount = installedPacks.filter((p) => p.type === 'Resource Pack').length;

  return (
    <div className="relative w-full h-screen bg-[#08070D] text-[#F7F5FC] flex flex-col overflow-hidden font-sans select-none">
      {/* Hidden Global File Input */}
      <input
        ref={globalFileInputRef}
        type="file"
        multiple
        accept=".mcpack,.mcaddon,.zip"
        onChange={handleGlobalFileChosen}
        className="hidden"
      />

      {/* Toast Notification Banner */}
      {toastMessage && (
        <div className="absolute top-3 left-3 right-3 sm:left-auto sm:right-4 z-50 p-3 rounded-xl bg-[#15111F]/95 border border-[#762BFF]/60 text-xs font-semibold text-white shadow-[0_0_20px_rgba(118,43,255,0.4)] flex items-center justify-between gap-3 max-w-md animate-in slide-in-from-top-2 duration-150">
          <div className="flex items-center gap-2 min-w-0">
            <Info className="w-4 h-4 text-[#A855F7] shrink-0" />
            <span className="break-words line-clamp-5">{toastMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setToastMessage(null)}
            className="text-[#AAA3BB] hover:text-white p-0.5"
            aria-label="Dismiss"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Subpack Variant Selection (before merging) */}
      {subpackPromptPacks && (
        <SubpackSelectModal
          packs={subpackPromptPacks}
          onConfirm={handleSubpackConfirm}
          onCancel={handleSubpackCancel}
        />
      )}

      {/* Screen Router */}
      {screen === 'splash' && (
        <SplashScreen
          onFinished={() => setScreen('main')}
          onCreateNew={startCreate}
          onBrowseTemplates={() => {
            navigateTab('library');
          }}
          onViewDocumentation={openAbout}
        />
      )}

      {screen === 'add_packs' && (
        <AddPacksScreen
          installedPacks={installedPacks}
          selectedPackIds={selectedPackIds}
          onTogglePack={handleTogglePack}
          onSelectAll={handleSelectAll}
          onClearSelection={handleClearSelection}
          onDeleteAll={handleDeleteAllPacks}
          onContinue={handleStartMergeFlow}
          onImportPacks={handleImportPacks}
          onBack={() => setScreen('main')}
        />
      )}

      {screen === 'script_check' && mergePlan && (
        <ScriptCheckScreen
          plan={mergePlan}
          selectedPacks={getSelectedPacks()}
          onContinue={() => {
            triggerHaptic(50);
            handleSoundTap();
            runMergeProcess(getSelectedPacks(), conflicts);
          }}
          onBack={() => setScreen('main')}
        />
      )}

      {screen === 'conflicts' && (
        <ConflictScreen
          conflicts={conflicts}
          autoMerge={autoMerge}
          packs={getSelectedPacks()}
          onUpdateResolution={(cid, res) => {
            setConflicts((prev) =>
              prev.map((c) => (c.id === cid ? { ...c, resolution: res } : c))
            );
          }}
          onAutoPrefixAll={() => {
            setConflicts((prev) =>
              prev.map((c) => ({ ...c, resolution: 'prefix_all' }))
            );
            showToast('All conflicts resolved with automatic namespace prefixes.');
          }}
          onProceedMerge={() => {
            openScriptCheck(getSelectedPacks());
          }}
          onBack={() => setScreen('main')}
        />
      )}

      {screen === 'merging' && (
        <MergingScreen
          currentStep={mergeStep}
          progress={mergeProgress}
          packCount={selectedPackIds.length}
          onCancel={() => setScreen('main')}
        />
      )}

      {screen === 'merge_complete' && justCompletedModpack && (
        <MergeCompleteScreen
          modpack={justCompletedModpack}
          // NOTE: wrap in arrow functions — passing the handler directly hands it the click
          // event as its `modpack` argument, which caused "Modpack file not available".
          onInstallToMinecraft={() => handleInstallToMinecraft()}
          onSaveToFiles={() => handleInstallToMinecraft()}
          onShare={handleShareModpack}
          onDownloadOutput={handleDownloadOutput}
          onDone={() => {
            navigateTab('mypacks');
          }}
          onRename={(newName) => {
            setJustCompletedModpack({
              ...justCompletedModpack,
              name: newName,
              outputFileName: `${newName.replace(/\s+/g, '_')}.mcaddon`
            });
          }}
          onPublish={handlePublishModpack}
          isPublishing={isPublishing}
        />
      )}

      {screen === 'modpack_details' && activeModpack && (
        <ModpackDetailsScreen
          modpack={activeModpack}
          onBack={() => setScreen('main')}
          onDelete={handleDeleteModpack}
          onDownloadOutput={handleDownloadOutput}
          onReinstall={() => {
            setJustCompletedModpack(activeModpack);
            setScreen('merge_complete');
          }}
          onUpdateModpack={handleUpdateModpack}
        />
      )}

      {screen === 'pack_extract' && (
        <PackExtractTool onBack={() => setScreen('main')} />
      )}

      {screen === 'list_maker' && (
        <ListMaker packs={installedPacks} onBack={() => setScreen('main')} />
      )}

      {screen === 'tos' && (
        <LegalScreen type="tos" onBack={() => setScreen('main')} />
      )}

      {screen === 'privacy' && (
        <LegalScreen type="privacy" onBack={() => setScreen('main')} />
      )}

      {screen === 'community' && (
        <CommunityModpacksScreen
          onBack={() => setScreen('main')}
          onDownload={handleDownloadCommunityModpack}
        />
      )}

      {/* Main Studio Viewport */}
      {screen === 'main' && (
        <div className="flex w-full h-full overflow-hidden">
          {/* Permanent Desktop Left Sidebar */}
          <div className="hidden md:flex shrink-0 h-full">
            <AppSidebar
              currentTab={currentTab}
              onChangeTab={navigateTab}
              onStartCreate={startCreate}
              onImportClick={triggerGlobalImport}
              bpCount={behaviorCount}
              rpCount={resourceCount}
              projectCount={myModpacks.length}
            />
          </div>

          {/* Slide-out Mobile Drawer */}
          {isMobileDrawerOpen && (
            <div className="fixed inset-0 z-50 md:hidden flex">
              <div
                className="fixed inset-0 bg-black/70 backdrop-blur-sm transition-opacity"
                onClick={() => setIsMobileDrawerOpen(false)}
              />
              <div className="relative z-10 w-72 h-full bg-[#100D18] shadow-2xl animate-in slide-in-from-left duration-200">
                <AppSidebar
                  currentTab={currentTab}
                  onChangeTab={navigateTab}
                  onStartCreate={startCreate}
                  onImportClick={triggerGlobalImport}
                  bpCount={behaviorCount}
                  rpCount={resourceCount}
                  projectCount={myModpacks.length}
                  onCloseMobileDrawer={() => setIsMobileDrawerOpen(false)}
                />
              </div>
            </div>
          )}

          {/* Center Content Workspace */}
          <div className="flex flex-col flex-1 min-w-0 h-full overflow-hidden">
            {/* Top Bar with Breadcrumbs & Quick Actions */}
            <TopBar
              currentTab={currentTab}
              onOpenMobileNav={() => setIsMobileDrawerOpen(true)}
              onStartCreate={startCreate}
              onImportClick={triggerGlobalImport}
              installedCount={installedPacks.length}
              modpackCount={myModpacks.length}
            />

            {/* Central Work Viewport */}
            <div className="flex flex-1 min-h-0 overflow-hidden">
              <main className="flex-1 min-w-0 overflow-y-auto">
                {/* 1. Overview */}
                {(currentTab === 'overview' || currentTab === 'home') && (
                  <HomeScreen
                    onStartCreate={startCreate}
                    onNavigateTab={navigateTab}
                    onOpenAbout={openAbout}
                    onOpenModpack={(mp) => {
                      triggerHaptic(40);
                      handleSoundTap();
                      setActiveModpack(mp);
                      setScreen('modpack_details');
                    }}
                    onExportModpack={(mp) => handleInstallToMinecraft(mp)}
                    onImportClick={triggerGlobalImport}
                    modpackCount={myModpacks.length}
                    libraryCount={installedPacks.length}
                    modpacks={myModpacks}
                    installedPacks={installedPacks}
                  />
                )}

                {/* 2. Merge Workspace - The Core Studio */}
                {currentTab === 'workspace' && (
                  <MergeWorkspace
                    installedPacks={installedPacks}
                    selectedPackIds={selectedPackIds}
                    onTogglePack={handleTogglePack}
                    onSelectAll={handleSelectAll}
                    onClearSelection={handleClearSelection}
                    onStartMergeFlow={handleStartMergeFlow}
                    onImportPacks={handleImportPacks}
                    onDeletePack={handleDeletePack}
                    onDeleteSelectedPacks={handleDeleteSelectedPacks}
                    onNavigateTab={navigateTab}
                  />
                )}

                {/* 3. My Projects */}
                {currentTab === 'mypacks' && (
                  <MyPacksScreen
                    modpacks={myModpacks}
                    onSelectModpack={(mp) => {
                      triggerHaptic(40);
                      handleSoundTap();
                      setActiveModpack(mp);
                      setScreen('modpack_details');
                    }}
                    onDeleteModpack={handleDeleteModpack}
                    onStartCreate={startCreate}
                  />
                )}

                {/* 4. Library (All, Behavior, or Resource) */}
                {currentTab === 'library' && (
                  <LibraryScreen
                    packs={installedPacks}
                    filterType="all"
                    onSelectPackForMerge={(pid) => {
                      setSelectedPackIds([pid]);
                      navigateTab('workspace');
                    }}
                    onDeletePack={handleDeletePack}
                    onStartCreate={startCreate}
                  />
                )}

                {currentTab === 'bp_library' && (
                  <LibraryScreen
                    packs={installedPacks}
                    filterType="bp"
                    onSelectPackForMerge={(pid) => {
                      setSelectedPackIds([pid]);
                      navigateTab('workspace');
                    }}
                    onDeletePack={handleDeletePack}
                    onStartCreate={startCreate}
                  />
                )}

                {currentTab === 'rp_library' && (
                  <LibraryScreen
                    packs={installedPacks}
                    filterType="rp"
                    onSelectPackForMerge={(pid) => {
                      setSelectedPackIds([pid]);
                      navigateTab('workspace');
                    }}
                    onDeletePack={handleDeletePack}
                    onStartCreate={startCreate}
                  />
                )}

                {/* 5. Community Modpacks */}
                {currentTab === 'community' && (
                  <CommunityModpacksScreen
                    onBack={() => navigateTab('overview')}
                    onDownload={handleDownloadCommunityModpack}
                  />
                )}

                {/* 5. Conflict Analyzer Tool */}
                {currentTab === 'conflicts_tool' && (
                  <ConflictScreen
                    conflicts={conflicts}
                    autoMerge={autoMerge}
                    packs={installedPacks}
                    onUpdateResolution={(cid, res) => {
                      setConflicts((prev) =>
                        prev.map((c) => (c.id === cid ? { ...c, resolution: res } : c))
                      );
                    }}
                    onAutoPrefixAll={() => {
                      setConflicts((prev) =>
                        prev.map((c) => ({ ...c, resolution: 'prefix_all' }))
                      );
                      showToast('All conflicts resolved with automatic namespace prefixes.');
                    }}
                    onProceedMerge={() => {
                      navigateTab('workspace');
                    }}
                    onBack={() => navigateTab('workspace')}
                  />
                )}

                {/* 6. Dependencies Tool */}
                {currentTab === 'dependencies_tool' && (
                  <DependenciesScreen
                    packs={installedPacks}
                    onSelectPack={(pack) => {
                      setSelectedPackIds([pack.id]);
                      navigateTab('workspace');
                    }}
                  />
                )}

                {/* 7. History & Logs Tool */}
                {(currentTab === 'history_tool' || currentTab === 'logs_tool') && (
                  <LogsScreen
                    modpacks={myModpacks}
                    onSelectModpack={(mp) => {
                      setActiveModpack(mp);
                      setScreen('modpack_details');
                    }}
                  />
                )}

                {/* 8. Settings */}
                {currentTab === 'settings' && (
                  <SettingsScreen
                    autoMerge={autoMerge}
                    onToggleAutoMerge={() => {
                      triggerHaptic(40);
                      handleSoundTap();
                      setAutoMerge(!autoMerge);
                    }}
                    keepOriginals={keepOriginals}
                    onToggleKeepOriginals={() => {
                      triggerHaptic(40);
                      handleSoundTap();
                      setKeepOriginals(!keepOriginals);
                    }}
                    onOpenAbout={openAbout}
                    onOpenToS={() => setScreen('tos')}
                    onOpenPrivacy={() => setScreen('privacy')}
                    onOpenPackExtract={() => setScreen('pack_extract')}
                    onOpenListMaker={() => setScreen('list_maker')}
                    onClearDemoData={handleClearDemoData}
                  />
                )}

                {/* 9. Help / About */}
                {currentTab === 'about' && (
                  <AboutScreen onBack={() => navigateTab('overview')} />
                )}
              </main>

              {/* Right Utility Panel (on wide desktop displays) */}
              <UtilityPanel
                modpackCount={myModpacks.length}
                libraryCount={installedPacks.length}
                onStartCreate={startCreate}
                onChangeTab={navigateTab}
                onOpenAbout={openAbout}
              />
            </div>

            {/* Mobile Bottom Navigation Bar */}
            <BottomNav currentTab={currentTab} onChangeTab={navigateTab} />
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
