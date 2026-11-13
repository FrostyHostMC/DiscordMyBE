# JavaBE

JavaBE is a standalone Java-to-Bedrock conversion application in the DiscordMyBE repository.

## Separation

- This application is independent of `autobe-activity/`.
- It must not import AutoBE source code or change AutoBE behavior.
- It is intended to be exposed as a separate application entry in the same Discord server.
- Discord launch/routing and a separate deployment target must be configured before it is considered available to users.

## Source package

The original JavaBE source package contains 237 files. The source files and build configuration belong directly in this directory, preserving their relative paths. Do not nest the application inside AutoBE.

## Local development

Requirements: Node.js 22.13+ and pnpm.

```bash
pnpm install
pnpm dev
pnpm build
```

## Integration status

This directory establishes the isolated app boundary. The original ZIP source still needs to be expanded into this directory before JavaBE can build or be deployed. Do not point the production Discord route at this directory until that source import and its independent build/deployment checks are complete.
