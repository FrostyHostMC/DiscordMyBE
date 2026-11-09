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
import { HelpCenterScreen } from '@/components/HelpCenterScreen';
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
  const [keepOriginals, setKeepOriginals] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem('autobe.keepOriginals');
      return stored === null ? true : stored === 'true';
    } catch {
      return true;
    }
  });

  // Merging runtime states
  const [conflicts, setConflicts] = useState<ConflictItem[]>([]);

  const [mergePlan, setMergePlan] = useState<MergePlan | null>(null);
  const [mergeStep, setMergeStep] = useState<string>('Reading addons');
  const [mergeProgress, setMergeProgress] = useState<number>(0);
  const [justCompletedModpack, setJustCompletedModpack] = useState<MergedModpack | null>(null);

  // Discord user state for community modpacks and personalized greetings.
  const [discordUser, setDiscordUser] = useState<{ id: string; username?: string; global_name?: string } | null>(null);
  const [isReturningUser, setIsReturningUser] = useState(false);

  // Automatically greet first-time and returning Discord users separately on this device.
  // Each Discord account has its own key, so shared devices don't mix up greetings.
  useEffect(() => {
    const user = getDiscordUser();
    if (!user) return;

    setDiscordUser(user);
    try {
      const seenKey = `autobe_seen_discord_user_${user.id}`;
      const hasVisited = window.localStorage.getItem(seenKey) === '1';
      setIsReturningUser(hasVisited);
      window.localStorage.setItem(seenKey, '1');
    } catch {
      // Embedded browsers may block local storage; default to a first-visit greeting.
      setIsReturningUser(false);
    }
  }, []);

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
  const pendingTargetEngineRef = useRef<string>('1.20.0');
  const pendingHudPlacementRef = useRef<NonNullable<MergeSessionConfig['hudPlacement']>>('auto');
  const pendingOutputOptionsRef = useRef<Pick<MergeSessionConfig, 'generateAddon' | 'generateSeparatePacks'>>({ generateAddon: true, generateSeparatePacks: true });

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
    try {
      if (localStorage.getItem('autobe.keepOriginals') === null) {
        setKeepOriginals(keepOriginalsTweak);
      }
    } catch {
      // Keep the in-memory default when browser storage is unavailable.
    }
  }, [keepOriginalsTweak]);

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
        if (variant && p.fileBlob) {
          // Never silently merge the unprocessed source if the selected UI/assets
          // variant failed to extract. That would recreate the missing-interface
          // bug while falsely reporting a successful merge.
          processed.push(await applySubpackToPack(p, variant));
        } else {
          processed.push(p);
        }
      }
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

  // Delete pack from library
  const handleDeletePack = async (id: string) => {
    triggerHaptic(50);
    console.log('[Delete Pack] Deleting pack:', id);
    try {
      // Confirm cloud deletion before removing the only local copy. Fire-and-forget
      // deletes race app closure and allow startup sync to resurrect the item.
      if (getDiscordAuth()?.token) await deleteWorkspaceItemFromCloud('pack', id);
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

  // Remove selected source packs locally first. Cloud cleanup is best-effort:
  // a transient network failure must never block deleting the device copies.
  const handleDeleteSelectedPacks = async (ids: string[]) => {
    triggerHaptic(50);
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.length === 0) return;
    console.log('[Delete Selected] Deleting packs:', uniqueIds);
    const localResults = await Promise.allSettled(uniqueIds.map((id) => deletePackFromDB(id)));
    const failedLocal = localResults.filter((result) => result.status === 'rejected').length;

    try {
      const updated = await getAllPacksFromDB();
      setInstalledPacks(updated);
      const remainingIds = new Set(updated.map((pack) => pack.id));
      setSelectedPackIds((previous) => previous.filter((id) => remainingIds.has(id)));
    } catch (err) {
      console.error('[Delete Selected] Could not refresh workspace:', describeError(err));
    }

    const auth = getDiscordAuth();
    let cloudError: string | null = null;
    if (auth?.token) {
      try {
        await deleteWorkspaceItemsFromCloud(uniqueIds.map((id) => ({ type: 'pack' as const, id })));
      } catch (err) {
        cloudError = describeError(err);
        console.error('[Delete Selected] Cloud cleanup failed:', cloudError);
      }
    }
    if (failedLocal > 0 || cloudError) {
      const localMessage = failedLocal > 0 ? `${failedLocal} local deletion(s) failed` : 'All local copies deleted';
      const cloudMessage = cloudError ? `Cloud cleanup failed: ${cloudError}` : 'Cloud copies deleted';
      showToast(`${localMessage}. ${cloudMessage}. Retry cloud cleanup if needed.`, 12000);
      return;
    }
    showToast(`${uniqueIds.length} selected pack(s) removed from workspace`);
  };

  // Delete every source pack, regardless of the current selection. Saved projects
  // are intentionally kept; cloud failures cannot interrupt local workspace cleanup.
  const handleDeleteAllPacks = async () => {
    triggerHaptic(50);
    try {
      const packs = await getAllPacksFromDB();
      if (packs.length === 0) {
        setInstalledPacks([]);
        setSelectedPackIds([]);
        showToast('Workspace is already empty');
        return;
      }
      await handleDeleteSelectedPacks(packs.map((pack) => pack.id));
      const remaining = await getAllPacksFromDB();
      if (remaining.length === 0) {
        setInstalledPacks([]);
        setSelectedPackIds([]);
      }
    } catch (err) {
      console.error('[Delete All] Error:', err);
      showToast(`Could not delete all packs: ${describeError(err)}`, 9000);
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

  // Delete merged modpack
  const handleDeleteModpack = async (id: string) => {
    triggerHaptic(50);
    try {
      // Wait for private cloud deletion before removing the local project.
      if (getDiscordAuth()?.token) await deleteWorkspaceItemFromCloud('project', id);
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
    if (getDiscordAuth()?.token) {
      void syncProjectToCloud(updated).catch(err => {
        console.error('[WorkspaceSync] Project update backup failed:', describeError(err));
        showToast(`Project updated locally, but cloud backup failed: ${describeError(err)}`, 9000);
      });
    }
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
      // Remove cloud copies first so the next startup cannot resurrect explicitly cleared data.
      if (getDiscordAuth()?.token) {
        const [packs, projects] = await Promise.all([getAllPacksFromDB(), getAllModpacksFromDB()]);
        for (const pack of packs) await deleteWorkspaceItemFromCloud('pack', pack.id);
        for (const project of projects) await deleteWorkspaceItemFromCloud('project', project.id);
      }
      await clearAllDB();
      setInstalledPacks([]);
      setMyModpacks([]);
      setSelectedPackIds([]);
      showToast('Cleared all addons and modpacks data.');
    } catch (err) {
      showToast(`Could not fully clear workspace data: ${describeError(err)}`, 9000);
    }
  };

  const behaviorCount = installedPacks.filter((p) => p.type === 'Behavior Pack').length;
  const resourceCount = installedPacks.filter((p) => p.type === 'Resource Pack').length;

  return (
    <div className="relative w-full h-[100dvh] min-h-[100svh] pt-[calc(var(--autobe-host-top-inset)+env(safe-area-inset-top,0px))] pb-[env(safe-area-inset-bottom,0px)] bg-[#08070D] text-[#F7F5FC] flex flex-col overflow-hidden font-sans select-none">
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
        <div className="fixed top-[calc(env(safe-area-inset-top)+4.25rem)] left-3 right-3 sm:left-auto sm:right-4 z-[100] p-3 rounded-xl bg-[#15111F]/95 border border-[#762BFF]/60 text-xs font-semibold text-white shadow-[0_0_20px_rgba(118,43,255,0.4)] flex items-center justify-between gap-3 max-w-md animate-in slide-in-from-top-2 duration-150">
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
            runMergeProcess(getSelectedPacks(), conflicts, undefined, pendingTargetEngineRef.current, pendingOutputOptionsRef.current);
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
              prev.map((c) => ({ ...c, resolution: c.type === 'vanilla_asset' || c.identifier === 'minecraft:player' ? 'keep_a' : 'prefix_all' }))
            );
            showToast('Applied safe defaults: namespace custom conflicts and keep the first vanilla override.');
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
            setJustCompletedModpack(null);
            navigateTab('workspace');
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
          activeTransfer={activeTransfer}
          transferProgress={transferProgress}
          transferStatus={transferStatus}
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
          currentUserId={discordUser?.id}
        />
      )}

      {/* Main Studio Viewport */}
      {screen === 'main' && (
        <div className="flex w-full flex-1 min-h-0 min-w-0 overflow-hidden">
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
            <div className="fixed left-0 right-0 top-[calc(var(--autobe-host-top-inset)+env(safe-area-inset-top,0px))] bottom-[env(safe-area-inset-bottom,0px)] z-50 md:hidden flex min-h-0">
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
          <div className="flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden">
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
            <div className="flex flex-1 min-h-0 min-w-0 overflow-hidden">
              <main className="flex-1 min-w-0 min-h-0 overflow-y-auto overscroll-contain" style={{ WebkitOverflowScrolling: "touch" }}>
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
                    welcomeName={discordUser?.username || discordUser?.global_name || undefined}
                    isReturningUser={isReturningUser}
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
                    onDeleteAllPacks={handleDeleteAllPacks}
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
                    currentUserId={discordUser?.id}
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
                        prev.map((c) => ({ ...c, resolution: c.type === 'vanilla_asset' || c.identifier === 'minecraft:player' ? 'keep_a' : 'prefix_all' }))
                      );
                      showToast('Applied safe defaults: namespace custom conflicts and keep the first vanilla override.');
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
                      setKeepOriginals(previous => {
                        const next = !previous;
                        try {
                          localStorage.setItem('autobe.keepOriginals', String(next));
                        } catch {
                          showToast('Could not save this preference on this device.', 6000);
                        }
                        return next;
                      });
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
                  <HelpCenterScreen onBack={() => navigateTab('overview')} />
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
