import React, { useMemo, useState } from 'react';
import { ArrowLeft, BookOpen, Search, ChevronDown, ChevronUp, AlertTriangle, Sparkles } from 'lucide-react';

type Topic = { id: string; title: string; intro: string; points: string[] };

const topics: Topic[] = [
  {
    id: 'quick-start',
    title: 'Quick start: build your first modpack',
    intro: 'The easiest way to go from add-on files to a combined Bedrock pack.',
    points: [
      'Open Merge Workspace and import your .mcpack, .mcaddon, or .zip files. You can also import a folder when your device supports folder selection.',
      'Select the Behavior Packs and Resource Packs you want to include. A gameplay add-on may need both its behavior and resource pack.',
      'Put packs in priority order. Packs nearer the top take priority when AutoBE must choose between competing versions of the same file.',
      'Open Config to review the output options and target Bedrock version before you build.',
      'Choose Analyze to review detected conflicts. Make any choices that are needed, then continue through the build steps.',
      'When the build finishes, choose the combined .mcaddon for the complete modpack, or download individual .mcpack outputs if you only need one part.',
      'Import the result into Minecraft and test it in a copy of your world first.'
    ]
  },
  {
    id: 'import',
    title: 'Importing add-ons',
    intro: 'Which files AutoBE can read and what happens after import.',
    points: [
      '.mcpack files usually contain one Bedrock pack. A .mcaddon can contain multiple packs. A .zip is checked for Bedrock manifests and supported nested archives.',
      'AutoBE reads each pack manifest to identify its name, type, version, dependencies, script information, and available subpack variants.',
      'Behavior Packs contain gameplay logic. Resource Packs contain textures, sounds, models, and other visual content. Import both when an add-on requires both.',
      'If a matching pack ID and pack type are already in your library, the duplicate may be skipped. Remove the older library copy before importing its replacement.',
      'Java Edition .jar mods are not Bedrock add-ons. Renaming a .jar file does not convert it.'
    ]
  },
  {
    id: 'workspace',
    title: 'Choosing packs and setting priority',
    intro: 'Control exactly which add-ons go into the next build.',
    points: [
      'Only selected packs are included in the current build. Deselecting a pack does not delete it from your library.',
      'Use the All, BP, and RP filters to narrow the list. Search helps you find a pack by name.',
      'Use the up and down arrows to change priority. The order shown in the workspace is passed into the merge process; the higher-priority pack is considered first when a conflict needs a winner.',
      'Priority does not mean every file is blindly overwritten. AutoBE can combine compatible additions, while conflicting values follow the selected resolution or the established priority rule.',
      'Removing a pack from the library is different from deselecting it. Delete All removes source packs from the workspace library; it does not delete saved merged projects.'
    ]
  },
  {
    id: 'configuration',
    title: 'Build settings and output options',
    intro: 'Understand the choices under Config before starting a merge.',
    points: [
      'Target Bedrock Version sets the requested minimum engine version for the generated pack. If an included add-on requires a newer minimum version, AutoBE raises the output requirement so it does not understate that dependency.',
      'The target version setting changes the generated manifest requirement. It does not convert newer add-on features into older Minecraft features or guarantee compatibility with every game release.',
      'Generate combined .mcaddon controls whether AutoBE creates one installable bundle containing the generated outputs.',
      'Generate separate .mcpack files controls whether the individual generated packs are also offered as separate downloads.',
      'You can create a combined bundle only, separate packs only, or both. At least one output option must be enabled to start the build.',
      'If you only want to install the complete modpack, the combined .mcaddon is usually the simplest choice.'
    ]
  },
  {
    id: 'types',
    title: 'Behavior Packs and Resource Packs',
    intro: 'Why one modpack can produce more than one output.',
    points: [
      'Behavior Packs contain gameplay content such as items, blocks, entities, recipes, loot tables, functions, and scripts.',
      'Resource Packs contain textures, sounds, models, render controllers, and other visual assets.',
      'Minecraft loads behavior and resource content as different pack types, so AutoBE keeps those outputs organized separately.',
      'A modpack can contain one resource output and more than one behavior output. This can be expected when scripted add-ons use different Script API major versions.'
    ]
  },
  {
    id: 'conflicts',
    title: 'Conflicts and your choices',
    intro: 'A conflict does not always mean one entire add-on has to be discarded.',
    points: [
      'A conflict means two selected add-ons provide different content for the same identifier or file location.',
      'Prefix & Keep Both gives supported custom identifiers a unique namespace and updates references AutoBE recognizes. This is useful when you want both custom items, blocks, entities, or other supported content to remain distinct.',
      'Keep Pack A or Keep Pack B chooses which version stays active for that finding. Pack A and Pack B refer to the two versions shown in that conflict, not a permanent label for a particular add-on.',
      'For supported item, block, and entity definitions, AutoBE can keep compatible additions even when one value conflicts. The established priority winner remains active for the conflicting value.',
      'When only part of a definition can be combined, AutoBE saves the complete alternative for review and reports that a partial conflict occurred.',
      'Some content must stay together as one unit. For example, incompatible attachable visual rigs are kept separate rather than mixing geometry and texture wiring that could break the item.',
      'Vanilla Minecraft paths cannot be renamed like custom identifiers. Choose which add-on supplies the active vanilla override when AutoBE asks.',
      'Binary assets and behavior-sensitive ordered data cannot always be merged safely. AutoBE keeps a safe active version and preserves alternatives for review instead of guessing.'
    ]
  },
  {
    id: 'automatic',
    title: 'Automatic conflict handling and prefixing',
    intro: 'What AutoBE can handle for you and where it needs caution.',
    points: [
      'Automatic conflict handling can namespace supported custom identifier collisions so both add-ons can keep their own content.',
      'AutoBE updates many recognized references across Bedrock JSON files, including supported item, block, entity, recipe, loot, attachable, texture, geometry, animation, controller, particle, sound, trade, and equipment references.',
      'Supported static identifier strings in JavaScript and TypeScript, plus recognized tokens in function, Molang, and material files, may also be updated.',
      'Dynamic script-generated identifiers and unknown or opaque formats cannot always be rewritten safely. AutoBE may report a warning instead of changing code it cannot confidently understand.',
      'Vanilla identifiers such as minecraft:* are not renamed. Vanilla asset conflicts may still require you to choose which version should remain active.',
      'Automatic handling reduces manual work, but it cannot guarantee that every third-party add-on reference or script is compatible.'
    ]
  },
  {
    id: 'scripts',
    title: 'Scripts and Script API versions',
    intro: 'Why scripted add-ons may be placed in separate behavior outputs.',
    points: [
      'AutoBE reads script module information and the declared @minecraft/server version from each behavior pack when available.',
      'Non-scripted behavior packs can be grouped into a data-only behavior output. Scripted packs that use different Script API major versions are separated into compatible behavior outputs.',
      'Those outputs still belong to the same modpack. Use the combined .mcaddon when you want the complete result.',
      'A successful archive build cannot prove that a script will run correctly in your Minecraft version. Scripts can depend on runtime APIs, other add-ons, and in-game conditions.',
      'If AutoBE reports shared script runtime properties, more than one script may write to the same game property. Review that warning and test the affected features in-game.'
    ]
  },
  {
    id: 'subpacks',
    title: 'Subpacks and variants',
    intro: 'Choose one option when an add-on includes alternate versions.',
    points: [
      'Some add-ons include variants such as different resolutions, feature sets, or gameplay options.',
      'When AutoBE asks, choose the variant you want for each listed pack. Only that selected variant is included in the build.',
      'Canceling the selection stops that merge attempt. You can return to the workspace and start again.'
    ]
  },
  {
    id: 'originals',
    title: 'Keeping or removing your original add-ons',
    intro: 'Your imported source packs and saved merged projects are separate.',
    points: [
      'Keep Originals is enabled by default. When it is on, imported source add-ons remain in your library after a successful build.',
      'When Keep Originals is off, AutoBE removes the selected source packs only after the merged project has been saved successfully.',
      'If saving the merged project fails, AutoBE keeps the original packs. If cloud cleanup cannot be completed, the originals are retained rather than being removed prematurely.',
      'Changing this setting does not delete existing saved merged projects.',
      'Local storage and cloud backup are separate. If AutoBE says a pack was saved on this device but cloud backup failed, keep your original file and retry the backup later.'
    ]
  },
  {
    id: 'results',
    title: 'Understanding your downloads',
    intro: 'Which output should you install or share?',
    points: [
      'The combined .mcaddon is the easiest way to install the complete result. It bundles the generated behavior and resource outputs together.',
      'An individual .mcpack contains only one generated output. Use it when you intentionally want to install or manage that part separately.',
      'A modpack may include a Resource Pack, a data-only Behavior Pack, and one or more Script API Behavior Packs.',
      'The build report and conflict backups help explain what AutoBE changed, combined, or preserved for review. Backup files in the conflict-review folder are not active Minecraft content.',
      'File counts, archive size, and a successful build do not prove every feature has been tested inside Minecraft.'
    ]
  },
  {
    id: 'testing',
    title: 'Test safely in Minecraft',
    intro: 'A few checks can help protect your worlds and catch missing features.',
    points: [
      'Import the combined .mcaddon into Minecraft Bedrock, or import the individual .mcpack files you need.',
      'Create a copy of the world you want to use before enabling a newly merged modpack.',
      'Activate the generated behavior and resource packs as needed, then check the features that matter: items, recipes, entities, textures, animations, sounds, and scripts.',
      'If something is missing or behaves differently, review the AutoBE report included with the output and check Minecraft’s Content Log.',
      'Do not test an unverified merge in the only copy of an important world.'
    ]
  },
  {
    id: 'troubleshooting',
    title: 'Common problems',
    intro: 'What to try when an import, build, or download does not go as expected.',
    points: [
      'No valid Bedrock manifest: make sure you selected the actual .mcpack or .mcaddon, not a Java mod or an unrelated archive. If you imported a zip, check that the Bedrock pack manifest is included.',
      'Duplicate skipped: a pack with the same pack ID and type is already in your library. Remove the older copy if you meant to replace it.',
      'Missing script entry: the pack declares a script module, but AutoBE could not confidently find its starting JavaScript file. Check that the add-on archive is complete.',
      'A conflict remains: some vanilla paths, binary assets, ordered data, or dynamic script references cannot be safely renamed or combined automatically. Read the conflict explanation and report before choosing.',
      'Cloud backup failed: your local copy may still be saved on this device. Keep the original file and retry backup when your connection is available.',
      'Download did not start: retry the download and allow the Discord or browser download prompt if one appears. Large modpacks can take longer to prepare and transfer.',
      'A feature does not work in Minecraft: check the AutoBE report and Minecraft Content Log, then test the original add-on separately if you need to identify which source pack introduced the issue.'
    ]
  }
];

export const HelpCenterScreen: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState('quick-start');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? topics.filter(topic =>
          (topic.title + ' ' + topic.intro + ' ' + topic.points.join(' ')).toLowerCase().includes(q)
        )
      : topics;
  }, [query]);

  return (
    <div className="flex flex-col h-full min-h-0 bg-[#08070D] text-white overflow-hidden">
      <header className="shrink-0 px-4 sm:px-6 py-3.5 border-b border-[#30263F]/70 bg-[#100D18]">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-1.5 px-2.5 py-2 rounded-lg bg-[#15111F] border border-[#30263F] text-[#AAA3BB] hover:text-white"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="text-xs font-semibold">Back</span>
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-[#A855F7] shrink-0" />
              <h1 className="text-base font-bold">AutoBE Help Center</h1>
            </div>
            <p className="text-[11px] text-[#AAA3BB] mt-0.5">Straightforward help for building and using Bedrock modpacks.</p>
          </div>
        </div>
        <label className="relative block mt-3">
          <span className="sr-only">Search help topics</span>
          <Search className="w-4 h-4 text-[#AAA3BB] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Search for something, like priority or downloads..."
            className="w-full bg-[#08070D] border border-[#30263F] rounded-xl pl-9 pr-3 py-2.5 text-sm outline-none focus:border-[#762BFF]"
          />
        </label>
      </header>

      <main className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 sm:p-6 pb-10 space-y-3 max-w-4xl mx-auto w-full" style={{ WebkitOverflowScrolling: 'touch' }}>
        <div className="p-4 rounded-2xl bg-[#100D18] border border-[#762BFF]/35">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[#A855F7]" />
            <h2 className="text-sm font-bold">Welcome to AutoBE</h2>
          </div>
          <p className="text-xs text-[#AAA3BB] leading-relaxed mt-1">
            Bring your Minecraft Bedrock add-ons together in one place. Start with the quick guide, then open any topic when you need more detail.
          </p>
        </div>

        {filtered.length === 0 ? (
          <div className="p-8 text-center rounded-xl bg-[#100D18] border border-[#30263F]">
            <p className="text-sm font-semibold text-white">No matching help topics</p>
            <p className="text-xs text-[#AAA3BB] mt-1">Try a shorter search, such as “priority”, “scripts”, “conflicts”, or “download”.</p>
            <button
              type="button"
              onClick={() => setQuery('')}
              className="mt-3 px-3 py-2 rounded-lg bg-[#762BFF] text-xs font-semibold text-white"
            >
              Clear search
            </button>
          </div>
        ) : (
          filtered.map(topic => {
            const open = !!query || expanded === topic.id;
            return (
              <section key={topic.id} className="rounded-xl bg-[#100D18] border border-[#30263F] overflow-hidden">
                <button
                  type="button"
                  onClick={() => setExpanded(open && !query ? '' : topic.id)}
                  aria-expanded={open}
                  className="w-full flex items-center justify-between gap-3 text-left p-4 hover:bg-[#15111F]/70"
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-bold">{topic.title}</span>
                    <span className="block text-xs text-[#AAA3BB] mt-1">{topic.intro}</span>
                  </span>
                  {open
                    ? <ChevronUp className="w-4 h-4 text-[#A855F7] shrink-0" />
                    : <ChevronDown className="w-4 h-4 text-[#AAA3BB] shrink-0" />}
                </button>
                {open && (
                  <ol className="px-4 pb-4 pt-3 border-t border-[#30263F]/70 space-y-2.5">
                    {topic.points.map((point, index) => (
                      <li key={index} className="flex gap-2.5 text-xs text-[#C7C0D4] leading-relaxed">
                        <span className="w-5 h-5 rounded-md bg-[#762BFF]/15 text-[#C9A9FF] text-[10px] font-bold flex items-center justify-center shrink-0">
                          {index + 1}
                        </span>
                        <span>{point}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            );
          })
        )}

        <div className="p-4 rounded-xl bg-amber-950/20 border border-amber-500/25">
          <div className="flex items-center gap-2 text-xs font-bold text-amber-200">
            <AlertTriangle className="w-4 h-4" />
            Important
          </div>
          <p className="text-xs text-amber-100/80 leading-relaxed mt-1.5">
            AutoBE checks and combines files, but it cannot run every add-on inside Minecraft. Always test a new modpack in a copy of your world before using it in your main world.
          </p>
        </div>
      </main>
    </div>
  );
};
