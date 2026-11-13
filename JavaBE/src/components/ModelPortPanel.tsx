import { AlertTriangle, Bone, Boxes, Film, Wrench } from 'lucide-react';
import type { ModelPortReport } from '@/utils/modelPortReport';
import type { SkeletonReconciliationReport } from '@/utils/dynamicBoneRetargeter';
import { GeometryPreviewPanel } from '@/components/GeometryPreviewPanel';

interface ModelPortPanelProps {
  report?: ModelPortReport | null;
  accent: string;
  /** The exact resource-pack files that ship, so converted geometry can be inspected. */
  resourcePackFiles?: Record<string, string | Uint8Array> | null;
  /** Reconstructed source joints, used to draw their actual exported geometry pivots. */
  skeleton?: SkeletonReconciliationReport | null;
}

const labelFor = (key: string): string => key.replace(/-/g, ' ');

const formatCount = (value: number): string => value.toLocaleString('en-US');

/**
 * Models & bones dashboard.
 *
 * Every value comes from the engines that ran during the conversion: the modelling-format
 * registry, the model port engine (GeckoLib, Java entity, polygon mesh, Blockbench, Tabula,
 * OptiFine CEM), the animation importer, the bone retargeter and the mesh repair pass.
 * Anything the engine could not express is listed instead of being hidden.
 */
export function ModelPortPanel({ report, accent, resourcePackFiles, skeleton }: ModelPortPanelProps) {
  if (!report) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
        <div className="flex items-center gap-2">
          <Boxes className="h-4 w-4" style={{ color: accent }} />
          <h2 className="text-sm font-bold text-white">Models &amp; bones</h2>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-slate-400">
          Run a conversion to see which modelling formats the archive really ships, which
          models were converted, how many source bone names survived, and which animation
          tracks were rebound onto the shipped skeleton.
        </p>
      </div>
    );
  }

  const formats = Object.entries(report.formats).filter(([, count]) => count > 0);
  const unboundMobs = report.mobsWithoutAuthenticModel;
  const tiles = [
    { icon: Boxes, label: 'Models converted', value: report.documentsConverted, hint: `${report.documentsFound} document(s) classified` },
    { icon: Bone, label: 'Bone names kept', value: report.skeletonPartsPreserved, hint: `${report.skeletonPartsReparented} re-parented from source evidence` },
    { icon: Film, label: 'Clips imported', value: report.animations.clipsImported, hint: `${report.animations.sourceFiles} source document(s)` },
    { icon: Wrench, label: 'Bone tracks rebound', value: report.animations.boneTracksRetargeted, hint: `${report.animations.boneTracksUnmapped.length} name(s) unresolved` },
  ];
  const repairs = [
    `${report.javaEntityModels} Java entity, ${report.geckolibModels} GeckoLib, ${report.polyMeshModels} polygon-mesh, ${report.blockbenchModels} Blockbench, ${report.tabulaModels} Tabula and ${report.cemModels} OptiFine CEM model(s) converted.`,
    `${report.mesh.bonesReparented} orphan bone(s) re-parented, ${report.mesh.parentCyclesBroken} parent cycle(s) broken, ${report.mesh.duplicateBonesRenamed} duplicate name(s) renamed.`,
    `${report.mesh.cubeUvsRestored} cube UV layout(s) rebuilt from the cube's own size, ${report.mesh.polyMeshBonesPreserved} polygon-mesh bone(s) preserved.`,
    `${report.mobsWithAuthenticModel} mob(s) bound to a model recovered from the archive; ${unboundMobs.length} still on a generated rig because the archive ships no model for them.`,
    `${report.animations.clipsWithheld} invented clip(s) withheld, ${report.animations.playerRigClips} player-rig clip(s) mapped (${report.animations.playerBoneMappings} bone mapping(s)).`,
  ];
  const unresolvedCount =
    report.mesh.unresolved.length +
    report.unsupportedDocuments.length +
    report.animations.boneTracksUnmapped.length +
    unboundMobs.length;

  return (
    <div className="flex flex-col gap-3">
      <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
        <div className="flex items-center gap-2">
          <Boxes className="h-4 w-4" style={{ color: accent }} />
          <h2 className="text-sm font-bold text-white">Models, geometry &amp; bones</h2>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-slate-300">{report.summary}</p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {formats.length === 0 ? (
            <span className="rounded-lg border border-slate-700 px-2 py-1 text-[10px] text-slate-400">No modelling document found in the archive</span>
          ) : (
            formats.map(([format, count]) => (
              <span key={format} className="rounded-lg border border-violet-400/30 bg-violet-400/10 px-2 py-1 text-[10px] font-semibold text-violet-100">
                {labelFor(format)} · {count}
              </span>
            ))
          )}
        </div>
      </section>

      <section className="grid grid-cols-2 gap-2">
        {tiles.map(({ icon: Icon, label, value, hint }) => (
          <div key={label} className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
            <div className="flex items-center gap-1.5">
              <Icon className="h-3.5 w-3.5" style={{ color: accent }} />
              <span className="truncate text-[10px] font-medium uppercase tracking-wide text-slate-400">{label}</span>
            </div>
            <p className="mt-1 font-mono text-lg font-bold text-white">{formatCount(value)}</p>
            <p className="mt-0.5 text-[10px] leading-tight text-slate-500">{hint}</p>
          </div>
        ))}
      </section>

      <GeometryPreviewPanel
        resourcePackFiles={resourcePackFiles}
        injectedBones={skeleton?.bonesInjected}
        accent={accent}
      />

      <section className="rounded-2xl border border-slate-800 bg-slate-900/55 p-4">
        <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">Automatic porting applied</h3>
        <ul className="mt-2 flex flex-col gap-1.5">
          {repairs.map((line) => (
            <li key={line} className="flex gap-2 text-[11px] leading-relaxed text-slate-300">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full" style={{ backgroundColor: accent }} />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </section>

      {unresolvedCount > 0 && (
        <details className="rounded-2xl border border-amber-700/40 bg-amber-950/10">
          <summary className="flex min-h-[52px] cursor-pointer items-center gap-2 px-4 text-xs font-semibold text-amber-200">
            <AlertTriangle className="h-4 w-4" />
            Unresolved model and bone items · {unresolvedCount}
          </summary>
          <div className="flex flex-col gap-2 border-t border-amber-800/30 p-3">
            {report.unsupportedDocuments.map((entry) => (
              <p key={entry.path} className="text-[11px] leading-relaxed text-amber-100/90">
                <span className="font-mono text-[10px] text-amber-300">{entry.path}</span> — {entry.reason}
              </p>
            ))}
            {report.mesh.unresolved.map((entry) => (
              <p key={entry} className="text-[11px] leading-relaxed text-amber-100/90">{entry}</p>
            ))}
            {unboundMobs.length > 0 && (
              <p className="text-[11px] leading-relaxed text-amber-100/90">
                Mobs on a generated rig (no source model shipped): {unboundMobs.slice(0, 12).join(', ')}
                {unboundMobs.length > 12 ? ' …' : ''}
              </p>
            )}
            {report.animations.boneTracksUnmapped.length > 0 && (
              <p className="text-[11px] leading-relaxed text-amber-100/90">
                Clip bone names with no matching shipped bone: {report.animations.boneTracksUnmapped.slice(0, 12).join(', ')}
                {report.animations.boneTracksUnmapped.length > 12 ? ' …' : ''}
              </p>
            )}
          </div>
        </details>
      )}
    </div>
  );
}