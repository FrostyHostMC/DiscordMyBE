# Automatic dependency graph

The automatic preparation stage now emits `reports/dependency-graph.json` for each imported package.

## What it does

- Scans bounded UTF-8 text files with common metadata/configuration/source extensions.
- Finds filename-like references in quoted or unquoted metadata text without assuming a creator, mod name, vehicle name, or directory layout.
- Resolves references against the imported package using case-insensitive relative paths and basename matching.
- Reports each edge as `resolved`, `missing`, or `ambiguous`; multiple possible targets are never silently selected.
- Deduplicates repeated references from the same source file.
- Records oversized text files that were skipped.

## Safety and limits

This is read-only analysis. XML, Lua, scripts, and metadata are never executed. The scanner is limited to 2 MiB per text file and ignores files that are not valid UTF-8 or contain binary NUL bytes. It does not yet parse RPF tables of contents, compiled RAGE resource references, hashed identifiers, or runtime-loaded paths. A detected string is a candidate dependency, not proof that the game loads it.

The dependency report is advisory: missing references may be optional, generated at runtime, or resolved by game archives; ambiguous matches require review. The graph does not change or delete imported files.
