import React, { useCallback, useEffect, useRef, useState } from 'react';
import { vibrate } from '@aippy/runtime/device';

import {
  AddonPack,
  MergedModpack,
  MergedOutput,
  ConflictItem,
  TabType,
  ScreenType
} from '@/types/modpack';
import { INITIAL_DEMO_MODPACKS } from '@/utils/demoData';
import { buildDemoPacksWithContent } from '@/utils/demoPackFactory';
import {
  getAllPacksFromDB,
  savePackToDB,
  deletePackFromDB,
  getAllModpacksFromDB,
  saveModpackToDB,
  deleteModpackFromDB,
  clearAllDB
} from '@/utils/storage';
import { detectConflicts } from '@/utils/addonParser';
import { executeMergePacks, buildMergePlan, MergePlan } from '@/utils/mergeEngine';
import { describeError } from '@/utils/errorLog';
import { buildCodebaseZip, downloadBlob, saveBlobToDisk } from '@/utils/codebaseExport';
import {
  AppSettings,
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  hasSeededDemo,
  markDemoSeeded,
  clearDemoSeedFlag
} from '@/utils/settings';
import { validatePacks, applySubpackChoice, CompatibilityReport } from '@/utils/packValidator';
import { useModpackAudio } from '@/hooks/useModpackAudio';

import { AppHeader } from '@/components/AppHeader';
import { BottomNav } from '@/components/BottomNav';
import { SplashScreen } from '@/components/SplashScreen';
import { HomeScreen } from '@/components/HomeScreen';
import { AddPacksScreen } from '@/components/AddPacksScreen';
import { CompatibilityScreen } from '@/components/CompatibilityScreen';
import { SubpackScreen } from '@/components/SubpackScreen';
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

export const App: React.FC = () => {
  // Audio synthesizer hook
  const { playClick, playSuccess, playError } = useModpackAudio();

  // Navigation & screen state
  const [screen, setScreen] = useState<ScreenType>('splash');
  const [currentTab, setCurrentTab] = useState<TabType>('home');
  const [splashProgress, setSplashProgress] = useState(0);
  const [dataLoaded, setDataLoaded] = useState(false);

  // Data
  const [installedPacks, setInstalledPacks] = useState<AddonPack[]>([]);
  const [myModpacks, setMyModpacks] = useState<MergedModpack[]>([]);
  const [selectedPackIds, setSelectedPackIds] = useState<string[]>([]);
  const [activeModpack, setActiveModpack] = useState<MergedModpack | null>(null);

  // Settings: lazy initialiser so the persisted values are available on the
  // very first render instead of flashing defaults.
  const [settings, setSettings] = useState<AppSettings>(loadSettings);

  // Merge flow state
  const [compatReport, setCompatReport] = useState<CompatibilityReport | null>(null);
  const [pendingPacks, setPendingPacks] = useState<AddonPack[]>([]);
  const [subpackPacks, setSubpackPacks] = useState<AddonPack[]>([]);
  const [conflicts, setConflicts] = useState<ConflictItem[]>([]);
  const [mergePlan, setMergePlan] = useState<MergePlan | null>(null);
  const [mergeStep, setMergeStep] = useState<string>('Reading addons');
  const [mergeProgress, setMergeProgress] = useState<number>(0);
  const [justCompletedModpack, setJustCompletedModpack] = useState<MergedModpack | null>(null);

  // UI
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMessage(null), 4000);
  }, []);

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    []
  );

  const triggerHaptic = useCallback((duration = 50) => {
    if (settings.hapticEnabled) vibrate(duration).catch(() => {});
  }, [settings.hapticEnabled]);

  const handleSoundTap = useCallback(() => {
    if (settings.soundEnabled) playClick().catch(() => {});
  }, [settings.soundEnabled, playClick]);

  // --- Settings -----------------------------------------------------------

  const toggleSetting = useCallback((key: keyof AppSettings) => {
    setSettings((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      saveSettings(next);
      return next;
    });
  }, []);

  // --- Splash + data load -------------------------------------------------

  useEffect(() => {
    let progressVal = 0;
    const interval = setInterval(() => {
      progressVal += 12;
      setSplashProgress(Math.min(100, progressVal));
      if (progressVal >= 100) clearInterval(interval);
    }, 120);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const storedPacks = await getAllPacksFromDB();
        if (cancelled) return;

        if (storedPacks.length > 0) {
          setInstalledPacks(storedPacks);
        } else if (!hasSeededDemo()) {
          // Seed with real archives so the merge flow works end to end.
          const demoPacks = await buildDemoPacksWithContent();
          for (const p of demoPacks) await savePackToDB(p);
          markDemoSeeded();
          setInstalledPacks(demoPacks);
        } else {
          setInstalledPacks([]);
        }

        const storedModpacks = await getAllModpacksFromDB();
        if (cancelled) return;
        if (storedModpacks.length > 0) {
          setMyModpacks(storedModpacks);
        } else if (!hasSeededDemo()) {
          for (const m of INITIAL_DEMO_MODPACKS) await saveModpackToDB(m);
          setMyModpacks(INITIAL_DEMO_MODPACKS);
        } else {
          setMyModpacks([]);
        }
      } catch (err) {
        console.error('[AutoBE] Initialization error:', describeError(err));
      } finally {
        if (!cancelled) setDataLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // --- Splash completion --------------------------------------------------

  const handleFinishSplash = useCallback(() => {
    if (!dataLoaded) return;
    triggerHaptic(60);
    handleSoundTap();
    setScreen('main');
  }, [dataLoaded, triggerHaptic, handleSoundTap]);

  // --- Selection ----------------------------------------------------------

  const getSelectedPacks = useCallback(
    () => installedPacks.filter((p) => selectedPackIds.includes(p.id)),
    [installedPacks, selectedPackIds]
  );

  const togglePack = useCallback(
    (id: string) => {
      triggerHaptic(40);
      handleSoundTap();
      setSelectedPackIds((prev) =>
        prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
      );
    },
    [triggerHaptic, handleSoundTap]
  );

  const selectAll = useCallback(() => {
    triggerHaptic(40);
    handleSoundTap();
    setSelectedPackIds(installedPacks.map((p) => p.id));
  }, [installedPacks, triggerHaptic, handleSoundTap]);

  const clearSelection = useCallback(() => {
    triggerHaptic(40);
    handleSoundTap();
    setSelectedPackIds([]);
  }, [triggerHaptic, handleSoundTap]);

  // --- Import -------------------------------------------------------------

  const handleImportPacks = useCallback(
    async (newPacks: AddonPack[]) => {
      triggerHaptic(80);
      if (settings.soundEnabled) playSuccess().catch(() => {});
      for (const p of newPacks) await savePackToDB(p);
      const updated = await getAllPacksFromDB();
      setInstalledPacks(updated);
      const obf = newPacks.filter((p) => p.isObfuscated).length;
      showToast(
        `Added ${newPacks.length} addon${newPacks.length === 1 ? '' : 's'}` +
          (obf ? ` · ${obf} flagged obfuscated` : '')
      );
    },
    [triggerHaptic, settings.soundEnabled, playSuccess, showToast]
  );

  // --- Merge flow: selection -> check -> subpack -> conflicts -> plan -----

  const handleStartMergeFlow = useCallback(() => {
    triggerHaptic(50);
    handleSoundTap();
    const packs = getSelectedPacks();
    if (packs.length === 0) {
      showToast('Select at least one addon first.');
      return;
    }

    // Step 1: pack validation (manifest, obfuscation, Script API, engine).
    const report = validatePacks(packs);
    setCompatReport(report);

    // Step 2: subpacks must be resolved before anything else can run.
    const withSubpacks = packs.filter((p) => (p.subpacks?.length || 0) > 0);
    if (withSubpacks.length > 0) {
      setSubpackPacks(withSubpacks);
      setPendingPacks(packs);
      setScreen('subpack');
      return;
    }

    setPendingPacks(packs);
    setScreen('compatibility');
  }, [getSelectedPacks, triggerHaptic, handleSoundTap, showToast]);

  const resolveSubpacks = useCallback(
    async (choices: Record<string, number>) => {
      const resolved: AddonPack[] = [];
      for (const pack of pendingPacks) {
        const idx = choices[pack.id];
        if (typeof idx === 'number' && idx >= 0 && (pack.subpacks?.length || 0) > 0) {
          try {
            resolved.push(await applySubpackChoice(pack, idx));
          } catch (err) {
            console.error('[AutoBE] Subpack extraction failed:', describeError(err));
            resolved.push(pack); // fall back to the whole pack
          }
        } else {
          resolved.push(pack);
        }
      }
      // Persist the flattened version so later merges reuse it.
      for (const p of resolved) {
        if (!p.subpacks && pendingPacks.find((o) => o.id === p.id)?.subpacks) {
          await savePackToDB(p);
        }
      }
      const updated = await getAllPacksFromDB();
      setInstalledPacks(updated);
      setPendingPacks(resolved);
      setSelectedPackIds(resolved.map((p) => p.id));
      setCompatReport(validatePacks(resolved));
      setScreen('compatibility');
    },
    [pendingPacks]
  );

  const removePacksFromSelection = useCallback((ids: string[]) => {
    setSelectedPackIds((prev) => prev.filter((id) => !ids.includes(id)));
  }, []);

  const proceedFromCompatibility = useCallback(async () => {
    const packs = pendingPacks.length > 0 ? pendingPacks : getSelectedPacks();
    if (packs.length === 0) return;

    setScreen('merging');
    setMergeStep('Scanning identifiers');
    setMergeProgress(5);

    try {
      const detected = await detectConflicts(packs);
      if (detected.length > 0 && !settings.autoMergeConflicts) {
        setConflicts(detected);
        setScreen('conflicts');
        return;
      }
      setConflicts(detected);
      setMergePlan(buildMergePlan(packs));
      setScreen('script_check');
    } catch (err) {
      const msg = describeError(err);
      console.error('[AutoBE] Conflict scan failed:', msg);
      showToast(`Could not scan identifiers: ${msg}`);
      setScreen('add_packs');
    }
  }, [pendingPacks, getSelectedPacks, settings.autoMergeConflicts, showToast]);

  const openScriptCheck = useCallback((packs: AddonPack[]) => {
    setMergePlan(buildMergePlan(packs));
    setScreen('script_check');
  }, []);

  // --- Merge execution ----------------------------------------------------

  const runMergeProcess = useCallback(
    async (packs: AddonPack[], confList: ConflictItem[]) => {
      setScreen('merging');
      setMergeProgress(5);
      setMergeStep('Reading addons');

      try {
        const stamp = new Date()
          .toLocaleDateString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit' })
          .replace(/\//g, '-');
        const mergedName = `StoneByte_Modpack_${stamp}`;

        const result = await executeMergePacks(packs, {
          modpackName: mergedName,
          conflicts: confList,
          autoPrefix: settings.autoMergeConflicts,
          onProgress: (step, pct) => {
            setMergeStep(step);
            setMergeProgress(pct);
          }
        });

        await saveModpackToDB(result);
        const updatedModpacks = await getAllModpacksFromDB();
        setMyModpacks(updatedModpacks);

        // "Keep Originals" off -> remove the source addons after a successful merge.
        if (!settings.keepOriginals) {
          for (const p of packs) await deletePackFromDB(p.id);
          const remaining = await getAllPacksFromDB();
          setInstalledPacks(remaining);
          setSelectedPackIds([]);
        } else {
          setSelectedPackIds([]);
        }

        setJustCompletedModpack(result);
        setScreen('merge_complete');
        triggerHaptic(120);
        if (settings.soundEnabled) playSuccess().catch(() => {});
      } catch (err) {
        const msg = describeError(err);
        console.error('[AutoBE] Merge error:', msg);
        showToast(`Merge failed: ${msg}`);
        if (settings.soundEnabled) playError().catch(() => {});
        setScreen('add_packs');
      }
    },
    [settings.autoMergeConflicts, settings.keepOriginals, settings.soundEnabled, triggerHaptic, playSuccess, playError, showToast]
  );

  // --- Downloads ----------------------------------------------------------

  const handleDownloadOutput = useCallback(
    (output: MergedOutput) => {
      triggerHaptic(50);
      handleSoundTap();
      if (!output.blob) {
        showToast('This output is not available for download.');
        return;
      }
      downloadBlob(output.blob, output.fileName);
      showToast(`${output.fileName} downloaded.`);
    },
    [triggerHaptic, handleSoundTap, showToast]
  );

  /**
   * Primary action: hand over the single .mcaddon that contains every output
   * pack (RP + each BP), so Minecraft installs them all in one tap.
   */
  const handleInstallToMinecraft = useCallback(
    async (modpack: MergedModpack | null = justCompletedModpack) => {
      triggerHaptic(60);
      handleSoundTap();
      if (!modpack) return;
      if (!modpack.outputBlob) {
        showToast('This modpack has no stored file (demo entry). Re-create it to get a download.');
        return;
      }
      const name = modpack.outputFileName || 'StoneByte_Modpack.mcaddon';
      await saveBlobToDisk(modpack.outputBlob, name, 'application/octet-stream');
      const count = modpack.outputs?.length || 0;
      showToast(
        count > 1
          ? `Saved ${name} — ${count} packs install together.`
          : 'Saved. Open the file from your Downloads to launch Minecraft.'
      );
    },
    [justCompletedModpack, triggerHaptic, handleSoundTap, showToast]
  );

  /**
   * Explicit "save the .mcaddon" action. Uses the system file picker when the
   * browser supports it so the user controls where it lands.
   */
  const handleSaveToFiles = useCallback(
    async (modpack: MergedModpack | null = justCompletedModpack) => {
      triggerHaptic(60);
      handleSoundTap();
      if (!modpack) return;
      if (!modpack.outputBlob) {
        showToast('Nothing to save — this entry has no stored file.');
        return;
      }
      const name = modpack.outputFileName || 'StoneByte_Modpack.mcaddon';
      const result = await saveBlobToDisk(modpack.outputBlob, name, 'application/octet-stream');
      showToast(
        result === 'picker'
          ? `Saved ${name}.`
          : `Downloaded ${name}. Open it from your Downloads to import into Minecraft.`
      );
    },
    [justCompletedModpack, triggerHaptic, handleSoundTap, showToast]
  );

  /** AutoBE metadata sidecar (kept out of the .mcaddon on purpose). */
  const handleDownloadManifest = useCallback(
    (modpack: MergedModpack | null = justCompletedModpack) => {
      if (!modpack?.mergeManifest) {
        showToast('No merge metadata for this modpack.');
        return;
      }
      triggerHaptic(30);
      const blob = new Blob([JSON.stringify(modpack.mergeManifest, null, 2)], {
        type: 'application/json'
      });
      downloadBlob(blob, `${modpack.name.replace(/\s+/g, '_')}_merge_manifest.json`);
    },
    [justCompletedModpack, triggerHaptic, showToast]
  );

  const handleShareModpack = useCallback(async () => {
    triggerHaptic(40);
    handleSoundTap();
    if (!justCompletedModpack) return;
    const shareData = {
      title: justCompletedModpack.name,
      text: `Merged ${justCompletedModpack.totalPacks} Bedrock addons with AutoBE by StoneByte.`,
      url: window.location.href
    };
    if (navigator.share && navigator.canShare?.({ files: [] }) !== false) {
      try {
        if (justCompletedModpack.outputBlob && (navigator as any).canShare) {
          const file = new File([justCompletedModpack.outputBlob], justCompletedModpack.outputFileName, {
            type: 'application/octet-stream'
          });
          if ((navigator as any).canShare({ files: [file] })) {
            await navigator.share({ ...shareData, files: [file] });
            return;
          }
        }
        await navigator.share(shareData);
      } catch {
        /* user cancelled */
      }
    } else {
      await handleInstallToMinecraft(justCompletedModpack);
    }
  }, [justCompletedModpack, triggerHaptic, handleSoundTap, handleInstallToMinecraft]);

  // --- Library / modpack management --------------------------------------

  const handleDeletePack = useCallback(
    async (id: string) => {
      triggerHaptic(50);
      await deletePackFromDB(id);
      const updated = await getAllPacksFromDB();
      setInstalledPacks(updated);
      setSelectedPackIds((prev) => prev.filter((x) => x !== id));
      showToast('Addon removed from library');
    },
    [triggerHaptic, showToast]
  );

  const handleDeleteModpack = useCallback(
    async (id: string) => {
      triggerHaptic(50);
      await deleteModpackFromDB(id);
      const updated = await getAllModpacksFromDB();
      setMyModpacks(updated);
      if (activeModpack?.id === id) {
        setActiveModpack(null);
        setScreen('main');
      }
      showToast('Modpack deleted');
    },
    [triggerHaptic, showToast, activeModpack]
  );

  const handleClearData = useCallback(async () => {
    if (!window.confirm('Remove every imported addon, modpack and saved setting from this device?')) {
      return;
    }
    triggerHaptic(90);
    await clearAllDB();
    clearDemoSeedFlag();
    saveSettings(DEFAULT_SETTINGS);
    setSettings(DEFAULT_SETTINGS);
    setInstalledPacks([]);
    setMyModpacks([]);
    setSelectedPackIds([]);
    setActiveModpack(null);
    setJustCompletedModpack(null);
    setConflicts([]);
    setCompatReport(null);
    setPendingPacks([]);
    showToast('All local AutoBE data cleared.');
  }, [triggerHaptic, showToast]);

  const handleExportCodebase = useCallback(async () => {
    if (exporting) return;
    triggerHaptic(50);
    handleSoundTap();
    setExporting(true);
    showToast('Building codebase ZIP…');
    try {
      const result = await buildCodebaseZip();
      downloadBlob(result.blob, result.fileName);
      showToast(`Codebase exported: ${result.fileCount} files!`);
    } catch (err) {
      const msg = describeError(err);
      console.error('[AutoBE] Codebase export error:', msg);
      showToast(`Export failed: ${msg}`);
      if (settings.soundEnabled) playError().catch(() => {});
    } finally {
      setExporting(false);
    }
  }, [exporting, triggerHaptic, handleSoundTap, showToast, settings.soundEnabled, playError]);

  // --- Render -------------------------------------------------------------

  const headerTitle =
    currentTab === 'library'
      ? 'Addons Library'
      : currentTab === 'mypacks'
      ? 'My Modpacks'
      : currentTab === 'settings'
      ? 'Settings'
      : undefined;

  return (
    <div className="relative w-full h-screen max-w-md mx-auto bg-[#07050F] text-white flex flex-col overflow-hidden font-sans select-none border-x border-purple-500/20 shadow-2xl">
      {toastMessage && (
        <div className="absolute top-4 left-4 right-4 z-50 p-3 rounded-xl bg-purple-900/95 border border-purple-400 text-xs font-semibold text-white shadow-[0_0_20px_rgba(168,85,247,0.6)] backdrop-blur-md flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span>✨</span>
            <span className="truncate">{toastMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setToastMessage(null)}
            className="text-purple-300 font-bold px-1 flex-shrink-0"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      {/* Screen Router */}
      {screen === 'splash' && (
        <SplashScreen
          progress={dataLoaded ? splashProgress : Math.min(95, splashProgress)}
          onFinished={handleFinishSplash}
        />
      )}


      {screen === 'add_packs' && (
        <AddPacksScreen
          installedPacks={installedPacks}
          selectedPackIds={selectedPackIds}
          onTogglePack={togglePack}
          onSelectAll={selectAll}
          onClearSelection={clearSelection}
          onContinue={handleStartMergeFlow}
          onImportPacks={handleImportPacks}
          onBack={() => setScreen('main')}
        />
      )}

      {screen === 'subpack' && (
        <SubpackScreen
          packs={subpackPacks}
          onResolve={resolveSubpacks}
          onBack={() => setScreen('add_packs')}
        />
      )}

      {screen === 'compatibility' && compatReport && (
        <CompatibilityScreen
          report={compatReport}
          packs={pendingPacks}
          onContinue={proceedFromCompatibility}
          onRemovePacks={removePacksFromSelection}
          onBack={() => setScreen('add_packs')}
        />
      )}

      {screen === 'conflicts' && (
        <ConflictScreen
          conflicts={conflicts}
          autoMerge={settings.autoMergeConflicts}
          onUpdateResolution={(cid, res) =>
            setConflicts((prev) => prev.map((c) => (c.id === cid ? { ...c, resolution: res } : c)))
          }
          onAutoPrefixAll={() =>
            setConflicts((prev) => prev.map((c) => ({ ...c, resolution: 'prefix_all' })))
          }
          onProceedMerge={() => openScriptCheck(pendingPacks)}
          onBack={() => setScreen('compatibility')}
        />
      )}

      {screen === 'script_check' && mergePlan && (
        <ScriptCheckScreen
          plan={mergePlan}
          onContinue={() => {
            triggerHaptic(50);
            handleSoundTap();
            runMergeProcess(
              pendingPacks.length > 0 ? pendingPacks : getSelectedPacks(),
              conflicts
            );
          }}
          onBack={() => (conflicts.length > 0 ? setScreen('conflicts') : setScreen('compatibility'))}
        />
      )}

      {screen === 'merging' && (
        <MergingScreen
          currentStep={mergeStep}
          progress={mergeProgress}
          packCount={(pendingPacks.length > 0 ? pendingPacks : getSelectedPacks()).length}
        />
      )}

      {screen === 'merge_complete' && justCompletedModpack && (
        <MergeCompleteScreen
          modpack={justCompletedModpack}
          onInstallToMinecraft={() => handleInstallToMinecraft()}
          onSaveToFiles={() => handleSaveToFiles()}
          onShare={handleShareModpack}
          onDownloadOutput={handleDownloadOutput}
          onDownloadManifest={() => handleDownloadManifest()}
          onDone={() => {
            setCurrentTab('mypacks');
            setScreen('main');
          }}
          onRename={async (newName) => {
            const updated: MergedModpack = {
              ...justCompletedModpack,
              name: newName,
              outputFileName: `${newName.replace(/\s+/g, '_')}.mcaddon`
            };
            setJustCompletedModpack(updated);
            await saveModpackToDB(updated);
            setMyModpacks(await getAllModpacksFromDB());
          }}
        />
      )}

      {screen === 'modpack_details' && activeModpack && (
        <ModpackDetailsScreen
          modpack={activeModpack}
          onBack={() => setScreen('main')}
          onDelete={handleDeleteModpack}
          onDownloadOutput={handleDownloadOutput}
          onDownloadAddon={() => handleSaveToFiles(activeModpack)}
          onReinstall={() => {
            setJustCompletedModpack(activeModpack);
            setScreen('merge_complete');
          }}
        />
      )}

      {screen === 'about' && <AboutScreen onBack={() => setScreen('main')} />}

      {screen === 'pack_extract' && <PackExtractTool onBack={() => setScreen('main')} />}

      {screen === 'list_maker' && (
        <ListMaker packs={installedPacks} onBack={() => setScreen('main')} />
      )}

      {screen === 'tos' && <LegalScreen type="tos" onBack={() => setScreen('main')} />}

      {screen === 'privacy' && <LegalScreen type="privacy" onBack={() => setScreen('main')} />}

      {screen === 'main' && (
        <div className="flex flex-col h-full overflow-hidden">
          <AppHeader
            onOpenSettings={() => {
              triggerHaptic(40);
              handleSoundTap();
              setCurrentTab('settings');
            }}
            title={headerTitle}
          />

          <div className="flex-1 overflow-y-auto">
            {currentTab === 'home' && (
              <HomeScreen
                onStartCreate={() => {
                  triggerHaptic(50);
                  handleSoundTap();
                  setScreen('add_packs');
                }}
                onNavigateTab={(tab) => {
                  triggerHaptic(40);
                  handleSoundTap();
                  setCurrentTab(tab);
                }}
                onOpenAbout={() => {
                  triggerHaptic(40);
                  handleSoundTap();
                  setScreen('about');
                }}
                modpackCount={myModpacks.length}
                libraryCount={installedPacks.length}
              />
            )}

            {currentTab === 'library' && (
              <LibraryScreen
                packs={installedPacks}
                onSelectPackForMerge={(pid) => {
                  setSelectedPackIds([pid]);
                  setPendingPacks([]);
                  setScreen('add_packs');
                }}
                onDeletePack={handleDeletePack}
                onStartCreate={() => setScreen('add_packs')}
              />
            )}

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
                onStartCreate={() => setScreen('add_packs')}
              />
            )}

            {currentTab === 'settings' && (
              <SettingsScreen
                settings={settings}
                onToggle={toggleSetting}
                onOpenAbout={() => setScreen('about')}
                onOpenToS={() => setScreen('tos')}
                onOpenPrivacy={() => setScreen('privacy')}
                onOpenPackExtract={() => setScreen('pack_extract')}
                onOpenListMaker={() => setScreen('list_maker')}
                onExportCodebase={handleExportCodebase}
                onClearData={handleClearData}
                exporting={exporting}
              />
            )}
          </div>

          <BottomNav
            currentTab={currentTab}
            onChangeTab={(t) => {
              triggerHaptic(30);
              handleSoundTap();
              setCurrentTab(t);
            }}
          />
        </div>
      )}
    </div>
  );
};

export default App;