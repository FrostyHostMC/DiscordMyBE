# AutoBE Cloudflare free-tier safeguards

These code safeguards do not replace account-level Cloudflare settings. Verify the deployed Pages project and R2 bucket before relying on them.

## 1. R2 temporary-file lifecycle

In Cloudflare Dashboard:

1. Open **R2 Object Storage** → bucket **autobe-modpacks**.
2. Open **Settings** / **Object lifecycle rules** (the exact menu label may vary).
3. Add a rule scoped to the object prefix `temp/`.
4. Expire objects after **7 days**.
5. Do **not** apply this rule to `pub/`: community files are intended to remain available until their owner deletes them.
6. Save the rule and verify it appears as enabled.

This rule is not created by a Git commit; it must be enabled in the Cloudflare account.

## 2. Owner-only usage estimate

In the Cloudflare Pages project settings, add the environment variable `ADMIN_DISCORD_USER_ID` for both Production and Preview only if you want the dashboard in both environments. Set it to the owner's numeric Discord user ID, then redeploy.

The endpoint is `GET /api/admin/usage` and requires the owner's valid Discord OAuth bearer token. It reports published-listing count, estimated bytes based on the merged archive size recorded at publish time, and a percentage of the nominal 10 GB R2 free storage allowance.

Important limitations:
- It estimates published files from D1 metadata. It does not enumerate R2 and therefore excludes temporary files, orphaned objects, unfinished multipart uploads, and other objects.
- Use the Cloudflare R2 dashboard for authoritative bucket storage and operation usage.
- The 10 GiB figure is the published free allowance, not a guarantee that all Cloudflare products in the account are on free plans.

## 3. Code-level limits

- Individual R2 uploads are capped at 500 MiB.
- New published uploads are paused when recorded published archive sizes plus the incoming file would exceed a 7 GB safety threshold, leaving headroom below the nominal 10 GB allowance. This is based on D1 metadata and is not an atomic reservation system, so concurrent uploads and older inaccurate size records can still cause the estimate to differ from actual R2 usage.
- Each Discord user can start at most 3 published uploads per rolling 24-hour window and 20 temporary uploads per rolling 24-hour window.
- Each Discord user can create at most 3 community listings per rolling 24-hour window.
- Community list refresh is manual (plus the initial load), rather than polling every 15 seconds.
- Publish and upload failures return clearer limit/unavailable messages.

Rate-limit rows are stored in D1 table `autobe_rate_limits`. The limits are intentionally conservative for a small free-tier service and can be adjusted in code if actual usage warrants it.
