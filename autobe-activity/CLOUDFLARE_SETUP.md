# Cloudflare D1 Database Setup for Community Modpacks

## Prerequisites
- Cloudflare account with Pages access
- Wrangler CLI installed (`npm install -g wrangler`)
- Cloudflare Pages project already set up for this app

## Step 1: Create D1 Database

Run the following command to create a new D1 database:

```bash
wrangler d1 create autobe-community-modpacks
```

This will output a database ID. Copy it.

## Step 2: Update wrangler.toml

Replace `YOUR_DATABASE_ID` in `wrangler.toml` with the actual database ID from Step 1:

```toml
[[d1_databases]]
binding = "DB"
database_name = "autobe-community-modpacks"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"  # Replace with your ID
```

## Step 3: Apply Database Schema

Run the schema migration to create the table:

```bash
wrangler d1 execute autobe-community-modpacks --file=functions/schema.sql
```

## Step 4: Deploy to Cloudflare Pages

Commit your changes and push to trigger a Cloudflare Pages deployment:

```bash
git add .
git commit -m "Setup D1 database for community modpacks"
git push origin main
```

## Step 5: Verify Deployment

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
