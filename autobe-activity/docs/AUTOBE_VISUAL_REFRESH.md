# AutoBE visual refresh

## Direction

Build an original, friendly voxel-world identity for AutoBE: colorful block-built environments, expressive original characters, chunky readable objects, and restrained violet lighting. The inspiration is the approachable toy-like readability of Crossy Road, not its characters, assets, or exact visual style. All artwork must be original and clearly AutoBE-owned.

## Design principles

- **Artwork first, labels always:** major navigation and feature entry points pair a custom illustration with a visible text label. Never make a decorative image the only way to identify an action.
- **One coherent art bible:** consistent isometric/perspective rules, soft studio lighting, block geometry, material treatment, outline/shadow language, and violet accent lighting.
- **Use art where it adds meaning:** custom illustrations for Home, Merge, Community, My Packs, Upload, Premium, empty states, and featured community packs. Keep tiny utility controls simple and accessible.
- **Do not make every surface a card:** use clear page hierarchy, compact toolbars, workspace layouts, tables, split panes, and focused panels where they fit the task.
- **Preserve behavior:** this is a visual and interaction redesign. Do not alter merge logic, archive parsing, conflict resolution, authentication, storage, uploads, or Cloudflare configuration as part of styling work.
- **Responsive by design:** artwork crops and scales intentionally on narrow screens; labels and primary actions remain visible without excessive vertical scrolling.

## Initial color and surface tokens

The initial tokens live in src/styles/brand-tokens.css. They are additive and do not change existing screens until a component opts into the new classes or variables.

## Original asset library plan

Create a small, optimized, reusable library under public/assets/brand/:
- mascot/ — original AutoBE guide character and a few expressive poses.
- navigation/ — home, merge, community, packs, settings, and help illustrations.
- features/ — import portal, merge puzzle, pack chest, upload beacon, premium crown.
- environments/ — hero landscapes and section backdrops.
- categories/ — reusable community category thumbnails.

Prefer transparent WebP/AVIF or optimized PNG for character/feature art; use responsive WebP/AVIF for wide environments. Keep meaningful labels in the React UI, not baked into the image. Add alt text for informative images and empty alt text for purely decorative backgrounds.

## Rollout sequence

1. Establish this art direction and token foundation.
2. Build and review the original asset library at real UI sizes.
3. Introduce a shared navigation/header shell without changing route or state behavior.
4. Refresh the merge workspace and its guided steps.
5. Refresh Community and pack browsing.
6. Apply responsive, accessibility, and performance checks.
7. Run typecheck, lint, tests, and a production build before opening a PR.