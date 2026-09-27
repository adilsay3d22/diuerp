# Put DIU ERP online for free: Vercel + Turso + Vercel Blob

Total time: about 30 minutes. Everything below is on free plans; no card is needed for Turso or Vercel Hobby.

| Piece | What it does | Free plan |
|---|---|---|
| **Vercel** | Runs the website | Hobby (non-commercial) |
| **Turso** | The database (hosted SQLite, same SQL the app already uses) | 5 GB, never sleeps |
| **Vercel Blob** | Uploaded files (certificates, assignments, papers) | Hobby allowance |

## Step 1. Put the code on GitHub

Vercel deploys from a GitHub repository.

1. Install **GitHub Desktop** (desktop.github.com) and sign in.
2. **File → Add local repository →** choose `D:\code\UNI ERP System\web` → it says "not a Git repository" → click **create a repository** → **Create repository**.
3. Check that the file list does **not** include `node_modules`, `.next`, `data` or `.env.turso` (they are ignored on purpose).
4. Click **Publish repository**. Keep **Private** ticked. Publish.

## Step 2. Create the Turso database

1. Go to **turso.tech** → **Sign up** (use "Continue with GitHub").
2. **Create database** → name `diu-erp` → location **Mumbai (aws-ap-south-1)** → Create.
   - If Mumbai is not offered, pick the closest one and see "Region" at the end.
3. Open the database → **Connect** (or "Create token") → generate a token (Read & Write, no expiry).
4. Copy two values somewhere safe:
   - **Database URL**, looks like `libsql://diu-erp-yourname.aws-ap-south-1.turso.io`
   - **Auth token**, a long string starting with `ey…`

## Step 3. Load the classroom demo data into Turso (on your PC)

1. In `D:\code\UNI ERP System\web`, copy `.env.turso.example` and name the copy `.env.turso`.
2. Open `.env.turso` in Notepad and paste your two values:
   ```
   TURSO_DATABASE_URL=libsql://diu-erp-yourname.aws-ap-south-1.turso.io
   TURSO_AUTH_TOKEN=ey...
   ```
3. In a terminal in the `web` folder run:
   ```
   npm run turso:demo
   ```
   It ends with `Turso now holds the classroom demo data: … 13 accounts.`
   (`npm run turso:full` loads the big test dataset instead.)

## Step 4. Create the site on Vercel

1. Go to **vercel.com** → **Sign up** with GitHub (Hobby plan).
2. **Add New… → Project** → pick your repository → **Import**.
3. Framework is detected as **Next.js**. Leave build settings as they are.
4. Open **Environment Variables** and add these four:

| Name | Value |
|---|---|
| `TURSO_DATABASE_URL` | the Database URL from Step 2 |
| `TURSO_AUTH_TOKEN` | the token from Step 2 |
| `GATEWAY_SECRET` | any long random text, e.g. `diu-erp-8f3k2m9q7x1v5b` |
| `DEMO_SHOW_CODES` | `1` (shows 2-step sign-in codes on screen, because no email/SMS provider is connected) |

5. Click **Deploy**. After 2–3 minutes you get a link like `https://diu-erp.vercel.app`.

## Step 5. Add file storage (Vercel Blob)

1. In the Vercel project → **Storage** tab → **Create** → **Blob**.
2. Name it `diu-erp-files`, choose **Private** access, and connect it to this project (all environments).
   This adds `BLOB_READ_WRITE_TOKEN` automatically.
3. **Deployments** tab → the latest deployment → **⋯ → Redeploy**, so the site picks up the new variable.

## Step 6. Try it

Open your link and sign in with the accounts in `DIU-ERP-Demo-Script.pdf` (password `diu12345`).
Office accounts ask for a 6-digit code; with `DEMO_SHOW_CODES=1` it is shown right on the code screen.

## Everyday tasks

- **Reset the demo before class:** run `npm run turso:demo` on your PC. The live site uses the fresh data immediately.
- **Publish a change:** commit and push in GitHub Desktop. Vercel redeploys by itself.
- **Local development** is unchanged: `npm run dev` uses the local file `data/erp.db`, not Turso.

## Region (why the site might feel slow)

The site's server region is set in `vercel.json` to **Mumbai (`bom1`)**, next to the Turso database.
If you created Turso somewhere else, change `bom1` to the matching Vercel region and push:
Singapore `sin1`, Tokyo `hnd1`, Frankfurt `fra1`, US East `iad1`.

## Troubleshooting

| You see | Fix |
|---|---|
| "The database is from an older build" | Run `npm run turso:demo` again. |
| Error page right after deploying | Check the four environment variables (Step 4), then Redeploy. |
| Upload fails with a storage error | The Blob store must be connected to the project (Step 5). If you created it as **Public**, add the variable `BLOB_ACCESS` = `public`. Then Redeploy. |
| "Files must be 4 MB or smaller" | Vercel limits uploads to 4.5 MB; compress the PDF or photo. |
| Office sign-in asks for a code you never got | Set `DEMO_SHOW_CODES` to `1` and Redeploy. |

Before real students use it: change every `diu12345` password, remove `DEMO_SHOW_CODES`, and connect a real email/SMS provider.
