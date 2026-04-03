# Shadows Over Reikland — Railway Deploy Guide

## What you need
- A free **GitHub** account (github.com)
- A free **Railway** account (railway.app) — sign in with GitHub

---

## Step 1 — Put the files on GitHub

### Using GitHub Desktop (easiest, no command line)
1. Download **GitHub Desktop** from desktop.github.com and install it
2. Sign in with your GitHub account
3. Click **File → New Repository**
   - Name: `shadows-over-reikland`
   - Leave everything else default → **Create Repository**
4. Click **Show in Explorer / Finder** to open the repo folder
5. Copy ALL files from this zip into that folder:
   ```
   server.js
   package.json
   railway.json
   nixpacks.toml
   Procfile
   start.sh
   .gitignore
   public/index.html   ← keep inside a public/ subfolder
   ```
6. Back in GitHub Desktop, all files appear in the left panel
7. Type commit message: `initial commit` → click **Commit to main**
8. Click **Publish repository** → uncheck **Keep this code private** → **Publish**

---

## Step 2 — Create Railway project

1. Go to **railway.app** → **Login with GitHub**
2. Click **New Project** → **Deploy from GitHub repo**
3. Select **shadows-over-reikland**
4. Railway starts building — it will fail with a Railpack error. That's expected. Continue to Step 3.

---

## Step 3 — Switch builder from Railpack to Nixpacks (CRITICAL)

Railway's new "Railpack" builder does not detect Node.js apps correctly yet.
You must switch it manually:

1. Click on the service card inside your project
2. Go to the **Settings** tab
3. Scroll down to the **Build** section
4. Find **Builder** — click it and change from **Railpack** to **Nixpacks**
5. Click **Deploy** to trigger a fresh build

The build will now complete successfully in about 60 seconds.

---

## Step 4 — Get your public URL

1. In the service **Settings** tab, scroll to **Networking**
2. Under **Public Networking**, click **Generate Domain**
3. You get a URL like `shadows-over-reikland-production.up.railway.app`

Share this URL with your friends — that's your game server.

---

## Step 5 — Play

1. **Host:** open the URL → enter name → **Create Room**
2. A **4-letter code** appears — share it with friends
3. **Friends:** open same URL → enter name → paste code → **Join Room**
4. Everyone picks a career and clicks **Ready**
5. Game begins when all players are ready

---

## Game summary

- Up to 4 players, each with their own character
- **Host** chooses the path at every crossroads
- Combat is turn-based: each player acts once per round, then the enemy attacks ALL players
- Enemy HP scales with player count (+50% per extra player)
- Shared gold pool, individual inventories
- Boss fight every 10 nodes — no fleeing allowed
- Rest nodes restore 60% HP and refresh all abilities
- Levels 1, 3, and 7 trigger path selection screens

## Careers

| Career | Stat shift | Abilities |
|---|---|---|
| State Soldier (Warrior) | STR+1 INT−1 | Weapon Training, Catch Your Breath |
| Roadwarden (Rogue) | AGI+1 WIL−1 | Trickery (+1d6), Nimble Recovery |
| Bright Wizard (Magician) | INT+1 STR−1 | Fire spells, Spell Recovery |
| Sigmarite Priest (Priest) | WIL+1 AGI−1 | Life spells, Shared Recovery |

---

## Updating

Edit files → commit in GitHub Desktop → push. Railway auto-redeploys in ~60s.

## Cost

Free tier: $5 credits/month — plenty for a small game server. No card needed.
