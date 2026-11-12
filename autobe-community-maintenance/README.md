# AutoBE Community content lifecycle

This is a separate Cloudflare Worker because Pages Functions are request-driven and do not own a Cron Trigger.

## Safety defaults

- The Worker runs every five minutes (UTC), so previously verified creators are rechecked promptly.
- It creates lifecycle columns and audit/settings tables idempotently.
- Confirmed role loss hides the creator's Community uploads after the next daily scan, even while permanent cleanup is paused. Discord lookup failures, rate limits, and server errors are treated as unknown and never as role loss.
- Permanent cleanup is **disabled by default** (`community_cleanup_settings.enabled = 0`). Role-loss hiding and the 30-day restoration window remain active; permanent deletion waits until the owner explicitly enables it. Inactivity candidates are previewed but not warned or deleted while disabled.
- Before deleting an R2 object, the Worker checks the URL namespace, immutable R2 owner metadata, object kind, declared size, and D1 size. If any check fails, it retains the object and logs an error.
- The inactivity policy is intentionally conservative: 24 months since update AND 12 months without downloads, followed by a 90-day warning period and up to 180 days from the original warning when it remains unread.
- Creators can select **Keep published** in My Profile to reset the inactivity clock for an individual upload. Publishing something new does not reset older uploads.

## Required secrets

Set these on the Worker (not in source control):

- `DISCORD_BOT_TOKEN`: bot token for a bot installed in the configured guild.
- `MAINTENANCE_KEY`: a long random value used only for a manual authenticated scan.

The guild and role IDs are non-secret Wrangler vars aligned with the Pages configuration. Never put the bot token or maintenance key in `wrangler.toml`.

## Deploy

From `autobe-community-maintenance/`:

```sh
npx wrangler secret put DISCORD_BOT_TOKEN
npx wrangler secret put MAINTENANCE_KEY
npx wrangler deploy
```

The Worker uses the same production D1 database and R2 bucket as the Community publishing API. Do not deploy it against preview bindings. The scheduled handler is UTC.

## Rollout

The first deployment performs a read-only inactivity preview and enforces role-based visibility. Permanent deletion stays disabled until you review the preview results in the owner-only Community Cleanup section inside My Profile and explicitly enable permanent cleanup there.

The Worker must be deployed separately from the Cloudflare Pages site. The GitHub pull request does not deploy it automatically.
