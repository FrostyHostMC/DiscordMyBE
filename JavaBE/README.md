# JavaBE — Discord Activity

JavaBE is a standalone Java-to-Bedrock mod analysis and conversion app. It is separate from AutoBE and is deployed as its own Discord Activity.

## Discord application
- Application ID: 1374571021889310821
- Embedded Activity SDK: @discord/embedded-app-sdk
- OAuth scope: identify
- The SDK authorizes the Discord user; the server exchanges the one-time code.

## Cloudflare Pages
Create a separate Pages project named javabe-activity from this repository.

| Setting | Value |
|---|---|
| Production branch | main |
| Root directory | JavaBE |
| Build command | pnpm build |
| Build output directory | dist |
| Node.js | 22 |

Set these variables in the JavaBE Pages project:
- Build variable: VITE_DISCORD_CLIENT_ID=1374571021889310821
- Runtime variable: DISCORD_CLIENT_ID=1374571021889310821
- Runtime secret: DISCORD_CLIENT_SECRET — use the newly rotated client secret.

Do not add the bot token or client secret to Vite variables, source files, or GitHub. The Activity's current sign-in flow does not require a bot token.

## Discord Developer Portal
1. Enable Activities.
2. Add the deployed Pages origin as an Activity URL Mapping, for example https://javabe-activity.pages.dev.
3. Configure https://127.0.0.1/ as the OAuth2 redirect URI for the SDK authorization-code exchange if required by the portal.
4. Save the Activity settings and test JavaBE from a Discord voice channel Activity launcher.

The bot account is optional for opening the Activity. Invite a bot separately only if JavaBE later needs bot-driven server actions.

## Local development
Run pnpm install, pnpm dev, and pnpm build from this directory.
