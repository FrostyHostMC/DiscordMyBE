# JavaBE Discord Activity deployment

JavaBE is a separate Discord Activity and Cloudflare Pages project. It must not reuse AutoBE's OAuth application credentials or role policy.

## Cloudflare Pages project

- Project: `javabe-activity`
- Repository: `FrostyHostMC/DiscordMyBE`
- Root directory: `JavaBE`
- Build command: `pnpm build`
- Output directory: `dist`
- Node.js: `22`

## Required environment variables

Set these in **both Production and Preview** for the `javabe-activity` Pages project.

| Variable | Type | Value |
|---|---|---|
| `VITE_DISCORD_CLIENT_ID` | Plain text | JavaBE Application ID |
| `JAVABE_DISCORD_CLIENT_ID` | Plain text | Same JavaBE Application ID |
| `JAVABE_DISCORD_GUILD_ID` | Plain text | Discord server ID |
| `JAVABE_DISCORD_REQUIRED_ROLE_ID` | Plain text | `1567798397786918993` |
| `JAVABE_DISCORD_CLIENT_SECRET` | Secret | JavaBE OAuth2 Client Secret |
| `JAVABE_DISCORD_BOT_TOKEN` | Secret | JavaBE bot token |

Never put the Client Secret or bot token in `VITE_*` variables, source files, commits, or browser code. The two secrets are read only by Pages Functions on the server.

## Discord bot setup

The JavaBE bot associated with the JavaBE application must be added to the same server as the required role and be able to read guild members. Enable the Server Members privileged Gateway Intent for the bot in the Developer Portal if Discord requires it for member verification.

## How the gate works

1. The Activity connects to Discord Embedded App SDK.
2. Discord issues an authorization code to the JavaBE app.
3. `/api/token` exchanges that code server-side using the JavaBE Client Secret.
4. `/api/access` validates the resulting token with Discord, checks that it belongs to the JavaBE application, and fetches the member record using the JavaBE bot token.
5. The app renders only if the member has role `1567798397786918993`. Missing role, missing server membership, or an invalid session remains locked out.

The server fails closed when credentials or role settings are missing. AutoBE's credentials, role, database, and storage bindings are not used.
