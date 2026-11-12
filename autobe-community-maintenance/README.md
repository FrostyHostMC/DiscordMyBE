# AutoBE Community content lifecycle

A separate Cloudflare Worker checks verified Community creators against Discord and maintains published uploads in the existing Community D1/R2 storage.

## Discord role revocation

- The Worker checks up to 200 previously published creator accounts every five minutes (UTC), using a persisted cursor to cover larger Communities across successive runs.
- If Discord confirms that a creator no longer has the required role, all of that creator's Community uploads are immediately hidden and their exact, ownership-verified R2 files and D1 listings are deleted in that scan.
- There is **no grace period** for role loss. This is separate from the optional age-based cleanup setting.
- Every app session checks the signed-in user's role at startup and every 30 seconds. A missing role returns `DISCORD_ROLE_REQUIRED`, immediately gates the entire AutoBE Activity, and displays the unverified-role message. Re-adding the role allows the user to verify again. The merger is gated too.
- If a file cannot be safely verified for deletion, its listing remains hidden and the Worker retries on a later scan. It never deletes an R2 object unless its public key, immutable owner metadata, kind, and exact size match.
- Only Discord's specific `Unknown Member` response or a confirmed member response without the required role counts as role loss. API errors, rate limits, missing configuration, and 5xx responses are unknown and do not trigger deletion.

## Long-term inactivity cleanup

- Inactivity cleanup is disabled by default.
- An upload is considered only after 24 months without an update AND 12 months without a download.
- If enabled by the owner, it receives a 90-day warning period, extended to 180 days from the original warning if the notification remains unread.
- Creators can select **Keep published** in My Profile to reset the inactivity clock for an individual upload. Publishing a new upload does not reset older uploads.

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

The Worker reuses the production Community D1 database and R2 bucket. Do not deploy it against preview bindings. Cron times are UTC.

## Rollout

The Worker must be deployed separately from Cloudflare Pages. The GitHub pull request does not deploy it automatically. The first deployment applies idempotent schema migrations, begins role checks, and previews inactivity candidates. The owner can enable permanent inactivity cleanup from the owner-only Community Cleanup section inside My Profile.
