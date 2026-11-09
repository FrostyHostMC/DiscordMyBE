# Bedrock UI compatibility in AutoBE

## The three UI systems are not interchangeable

### Traditional resource-pack JSON UI

Legacy JSON UI is resource-pack data under `ui/`. `ui/_ui_defs.json` registers custom UI files; `ui/hud_screen.json` modifies the in-game HUD; control definitions use anchors, offsets, sizes, bindings, factories, animations, and references.

AutoBE can merge compatible JSON UI additions and preserve source files when it encounters conflicts. It must not treat every JSON array as a generic union or silently combine two different control types.

### Ore UI

Ore UI is the newer game-owned interface implementation. Mojang's public `ore-ui` GitHub repository shares web-technology UI building blocks (React/TypeScript and React Facet), but it is not a Bedrock resource-pack plugin API and does not expose the game's native screens for add-on injection.

There is no supported public API for a resource pack or behavior pack to replace arbitrary Ore UI screens, inject custom controls into native Ore UI menus, or register an Ore UI extension. AutoBE must not copy Ore UI internals, patch game binaries, spoof internal resources, or promise that a legacy JSON UI override will affect an Ore UI screen.

The safe compatibility behavior is:
- Preserve the add-on's original UI assets and script files.
- Detect and report legacy screen overrides that target known game menu files, without claiming they will affect the corresponding Ore UI screen.
- Keep gameplay HUD JSON UI separate from native menu UI. A HUD overlay is not the same thing as the inventory, settings, pause, world-creation, or other native menus.
- Never delete a UI add-on simply because a screen override is not effective on a particular game version.
- Keep the original resource pack available as a separate output when a user needs the unmerged original behavior.

### Script UI and DDUI

The supported script UI surface is `@minecraft/server-ui`. Traditional `ActionFormData`, `MessageFormData`, and `ModalFormData` remain form-based APIs. Data-Driven UI (DDUI) adds `CustomForm`, `MessageBox`, and Observable values for reactive forms. Microsoft documents DDUI in the stable Script API documentation; `@minecraft/server-ui` 2.1.0 introduced the DDUI classes as stable APIs, with later versions adding capabilities.

DDUI's `CustomForm`, `MessageBox`, and Observable classes were released as stable in `@minecraft/server-ui` 2.1.0 (Bedrock 26.30). Newer game releases continue to add DDUI controls; for example, later 26.x changelogs add multi-button-row capabilities. AutoBE validates the declared `@minecraft/server-ui` and `@minecraft/server` peer versions when it detects DDUI class usage, but does not silently upgrade either dependency.

DDUI is a supported way for add-on authors to build their own interactive modal experiences. It is not a pixel-positioned HUD overlay and does not grant access to native Ore UI screens. AutoBE cannot safely convert an arbitrary legacy JSON UI panel into a DDUI form: the original may rely on game-provided bindings, Molang, factories, animations, input mappings, or client-only state that scripts cannot reproduce.

The latest preview documentation (26.70 preview) still describes DDUI as a modal/form surface and notes that richer layout files are planned rather than exposed as a general custom-screen extension today. It also documents limitations such as unsupported glyph rendering. AutoBE therefore treats DDUI as an add-on-authored form fallback, not as a replacement renderer for arbitrary legacy HUDs or native Ore UI screens.

Community frameworks such as MinUI can compile custom persistent screens to legacy JSON UI, but their own project documentation describes an early, single-consumer state and confirms they do not bypass Bedrock's native dialog/interaction limitations. AutoBE should not depend on an experimental third-party framework to promise universal Ore UI support.

AutoBE should preserve and merge the script modules and their declared `@minecraft/server-ui` dependencies. It must not silently inject a new UI script into unrelated behavior packs or upgrade API dependencies beyond the selected Bedrock target.

## Nine-position HUD placement

AutoBE offers these nine anchor preferences:

- Top left, top middle, top right
- Middle left, center, middle right
- Bottom left, bottom middle, bottom right

The resolver is deliberately conservative. It only moves independently inserted controls when it can resolve a numeric size, static anchor/offset values, and a full-screen parent coordinate space. The canonical `root_panel` in `hud_screen.json` is recognized as inheriting the screen-sized HUD content parent even when the standard file omits an explicit `size`; other parent controls must explicitly prove their full-screen dimensions. Controls with dynamic sizes, animation-driven layout, factories, collections, unknown parent bounds, or other unmeasurable positioning are retained unchanged and reported.

The nine positions are not a guarantee that all controls fit on every aspect ratio. Bedrock's UI scaling and device viewport vary. The resolver is a static merge-time estimate, not a runtime layout engine. Users can choose **Preserve original positions** when exact source layout is more important than automatic conflict resolution.

## Required validation

- Verify every `ui_defs` entry resolves to a file in the output.
- Verify JSON parses and referenced UI assets exist.
- Preserve all independent control registrations and HUD modification order.
- Report conflicting control identities, bindings, templates, renderers, and scalar properties.
- Keep full incoming conflict copies for recovery.
- Exercise the production archive merge with multiple synthetic HUD packs, including collisions, dynamic layouts, subpacks, and malformed UI data.
- Keep source-baseline findings separate from merge-introduced findings.

Passing archive tests does not prove Minecraft's runtime rendering behavior. Native Ore UI compatibility cannot be certified by resource-pack tests because the native screen is not a supported extension surface.
