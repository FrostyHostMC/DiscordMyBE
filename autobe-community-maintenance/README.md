# AutoBE Community content lifecycle

This is a separate Cloudflare Worker because Pages Functions are request-driven and do not own a Cron Trigger.

## Safety defaults

- The Worker runs daily at 04:00 UTC.
- It creates lifecycle columns and audit/settings tables idempotently.
- Cleanup is **disabled by default** (`community_cleanup_settings.enabled = 0`). A daily scan still reports candidates in Worker logs, but it does not hide, notify, or delete content while disabled.
- Discord lookup failures, rate limits, and server errors are treated as unknown. They never count as role loss.
- Before deleting an R2 object, the Worker checks the URL namespace, immutable R2 owner metadata, object kind, declared size, and D1 size. If any check fails, it retains the object and logs an error.
- The first release intentionally uses the conservative fixed policy: 30-day role restoration window; 24 months since update plus 12 months without downloads for inactivity; 90-day warning window and up to 180 days total when the warning remains unread.
- A future owner control should enable cleanup only after preview results have been reviewed. No automatic destructive cleanup is enabled by deployment.

## Required secrets

Set these on the Worker (not in source control):

- `DISCORD_BOT_TOKEN`: bot token for a bot installed in the configured guild.
- `DISCORD_GUILD_ID`: the AutoBE Community guild ID.
- `DISCORD_REQUIRED_ROLE_ID`: the publishing eligibility role ID.
- `MAINTENANCE_KEY`: a long random value used only for a manual authenticated scan.

The guild and role IDs are already present in the Pages project's Wrangler vars, but Worker secrets should be configured separately. Never put the bot token or maintenance key in `wrangler.toml`.

## Deploy

From `autobe-community-maintenance/`:

```sh
npx wrangler secret put DISCORD_BOT_TOKEN
npx wrangler secret put DISCORD_GUILD_ID
npx wrangler secret put DISCORD_REQUIRED_ROLE_ID
npx wrangler secret put MAINTENANCE_KEY
npx wrangler deploy
```

The Worker uses the same production D1 database and R2 bucket as the Community publishing API. Do not deploy it against preview bindings. The scheduled handler is UTC.

## Important rollout note

The current profile admin UI does not enable this Worker by itself. Keep the settings row disabled until the preview scan output and Discord bot permissions have been checked. Enabling the setting requires an owner-authenticated control in the Pages API; do not toggle it manually without reviewing the candidate counts.
