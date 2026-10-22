# Cloudflare D1 Database Setup for Community Modpacks

## Prerequisites
- Cloudflare account with Pages access
- Wrangler CLI installed (`npm install -g wrangler`)
- Cloudflare API token

## Step 1: Get Cloudflare API Token

1. Go to https://developers.cloudflare.com/fundamentals/api/get-started/create-token/
2. Click "Create API Token"
3. Use the "Edit Cloudflare Workers" template
4. Give it these permissions:
   - Account - Cloudflare Pages - Edit
   - Account - Workers Scripts - Edit
   - Account - Workers KV Storage - Edit
   - Account - D1 - Edit
5. Copy the token

## Step 2: Authenticate Wrangler

Set your API token as an environment variable:

**Windows (PowerShell):**
```powershell
$env:CLOUDFLARE_API_TOKEN = "your-token-here"
```

**Windows (CMD):**
```cmd
set CLOUDFLARE_API_TOKEN=your-token-here
```

**Mac/Linux:**
```bash
export CLOUDFLARE_API_TOKEN=your-token-here
```

Then login:
```bash
wrangler login
```

## Step 3: Create D1 Database

Run the following command to create a new D1 database:

```bash
cd C:\Users\thede\Downloads\DiscordMyBE\autobe-activity
wrangler d1 create autobe-community-modpacks
```

This will output a database ID. Copy it.

## Step 4: Update wrangler.toml

Replace `YOUR_DATABASE_ID` in `wrangler.toml` with the actual database ID from Step 3:

```toml
[[d1_databases]]
binding = "DB"
database_name = "autobe-community-modpacks"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"  # Replace with your ID
```

## Step 5: Apply Database Schema

Run the schema migration to create the table:

```bash
wrangler d1 execute autobe-community-modpacks --file=functions/schema.sql
```

## Step 6: Connect to Cloudflare Pages

If you haven't already, connect your GitHub repo to Cloudflare Pages:

1. Go to https://dash.cloudflare.com/
2. Go to Workers & Pages → Create → Create a project
3. Connect to Git → Select `FrostyHostMC/DiscordMyBE`
4. Set build settings:
   - Build command: `npm run build`
   - Build output directory: `dist`
5. Add environment variable:
   - `DB`: your database ID from Step 3

## Step 7: Deploy

Commit your changes and push to trigger a Cloudflare Pages deployment:

```bash
git add .
git commit -m "Setup D1 database for community modpacks"
git push origin main
```

## Step 8: Verify Deployment

After deployment, the API endpoints will be available at:
- `POST /api/community-modpacks` - Publish a modpack
- `GET /api/community-modpacks` - Fetch all community modpacks
- `DELETE /api/community-modpacks?id=xxx&author_id=xxx` - Delete a modpack

## Testing

You can test the API endpoints using curl or Postman:

```bash
# Fetch all modpacks
curl https://your-site.pages.dev/api/community-modpacks
```

## Notes

- The D1 database is bound to the Pages Functions via the `DB` binding
- File hosting is done via Discord CDN (public URLs stored in database)
- Each modpack tracks: author, download count, creation date, included packs
- Only the author can delete their own modpacks
- You may need to add `DB` as an environment variable in Cloudflare Pages settings with the database ID

---

# Cloudflare R2 Setup (file downloads + publishing)

Downloads and "Publish to Community" upload the file to your own R2 bucket
(no Discord size limit, links don't expire for published packs). One-time setup:

1. **Create the bucket** (Cloudflare dashboard → R2, or):
   ```bash
   wrangler r2 bucket create autobe-modpacks
   ```
2. **Bind it to the Pages project.** `wrangler.toml` already declares
   `binding = "BUCKET"`, `bucket_name = "autobe-modpacks"`. If you deploy via the
   dashboard instead, add it under Pages project → Settings → Functions →
   R2 bucket bindings (variable name `BUCKET`) for Production (and Preview).
3. **Auto-delete temporary download files.** In R2 → `autobe-modpacks` →
   Settings → Object lifecycle rules, add a rule: prefix `temp/`, delete
   objects after 1 day. (Published modpacks live under `pub/` and are kept.)
4. **Optional:** if download links come back with the wrong host, set
   `PUBLIC_BASE_URL` (e.g. `https://your-project.pages.dev`) in `[vars]`.
5. Redeploy.

How it works: the app uploads in 8 MB parts to `/api/upload` (R2 multipart,
needed because a single Pages Function request is limited to ~100 MB), then
opens `https://<your-site>/api/files/...` in the phone's browser, which
downloads it normally.
