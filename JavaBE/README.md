# JavaBE

JavaBE is a Discord Embedded Activity for converting Java Edition mods and assets into Minecraft Bedrock add-ons.

The application is deployed independently from AutoBE using the `JavaBE` directory in this repository.

## Development

Requirements: Node.js 22 and pnpm.

```bash
pnpm install
pnpm dev
```

Build and lint:

```bash
pnpm build
pnpm lint
```

## Cloudflare Pages deployment

See [DEPLOYMENT.md](./DEPLOYMENT.md) for the authoritative Cloudflare Pages configuration, required environment variables, Discord application setup, and role-gate behavior.

JavaBE uses a server-side Discord membership check. Access is restricted to members of the configured guild who hold the required role. The current required role ID is `1567798397786918993`.

Never place OAuth client secrets or bot tokens in `VITE_*` variables, browser code, source files, or commits. Keep secrets in Cloudflare Pages runtime settings.

## Conversion fidelity

JavaBE distinguishes recovered source behavior from inferred or unsupported behavior. A Java class name or animation clip name alone is not proof of an activation condition. When source state-machine data cannot be recovered, JavaBE must report the missing information rather than fabricate a controller that appears functional.

Animation export validation can verify pack structure and references, but it cannot prove actual playback inside Minecraft Bedrock. Live playback must be verified in a Bedrock client.
