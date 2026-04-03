# Shadows Over Reikland — Railway Deploy Guide

## What you need
- A free **GitHub** account (github.com)
- A free **Railway** account (railway.app) — sign in with GitHub

---

## Step 1 — Put the files on GitHub

### Option A — GitHub Desktop (easiest, no command line)
1. Download **GitHub Desktop** from desktop.github.com
2. Click **File → New Repository**
   - Name: `shadows-over-reikland`
   - Leave everything else default → **Create Repository**
3. Click **Show in Explorer / Finder** to open the folder
4. Copy ALL the files from this zip into that folder:
   - `server.js`
   - `package.json`
   - `railway.json`
   - `.gitignore`
   - `public/index.html`  ← make sure the `public` folder exists inside
5. Back in GitHub Desktop, you'll see the files listed on the left
6. At the bottom left, type a commit message like `initial commit` → click **Commit to main**
7. Click **Publish repository** (top right) → make sure **Keep this code private** is unchecked → **Publish**

### Option B — Command line (if you have Git installed)
```bash
cd path/to/this/folder
git init
git add .
git commit -m "initial commit"
gh repo create shadows-over-reikland --public --push --source=.
```
(requires GitHub CLI: `winget install GitHub.cli` or `brew install gh`)

---

## Step 2 — Deploy on Railway

1. Go to **railway.app** and click **Login** → sign in with GitHub
2. On your dashboard, click **New Project**
3. Select **Deploy from GitHub repo**
4. Find and click **shadows-over-reikland**
5. Railway detects Node.js automatically and starts building
6. Wait ~60 seconds for the build to finish (you'll see a green tick)

---

## Step 3 — Get your public URL

1. Click on your deployed service (the card in the project view)
2. Click the **Settings** tab
3. Scroll to **Networking → Public Networking**
4. Click **Generate Domain**
5. Railway gives you a URL like: `shadows-over-reikland-production.up.railway.app`

That's it — your game is live. Share that URL with friends.

---

## Step 4 — Play

1. **You (Host):** open the URL, enter your name, click **Create Room**
2. A **4-letter room code** appears at the top
3. **Friends:** open the same URL, enter their name, type the room code, click **Join Room**
4. Everyone picks a career and clicks **Ready**
5. Game starts when all players are ready

---

## How the game works

| Thing | Detail |
|---|---|
| Max players | 4 |
| Path selection | Host only |
| Combat turns | Round-robin — each player acts once, then the enemy attacks everyone |
| Enemy HP scaling | +50% HP per extra player beyond the first |
| Boss fights | Every 10 nodes — no fleeing |
| Rest nodes | Heal 60% HP, restore all abilities and spell castings |
| Merchant | Shared gold pool — any player can buy, one purchase per item |
| Level up | Triggers novice path pick at Level 1, expert at Level 3, master at Level 7 |
| Death | Individual — fallen players are skipped in turn order; game ends if all die |

## Careers

| Career | Path | Stat bonuses | Key abilities |
|---|---|---|---|
| State Soldier | Warrior | STR+1, INT−1 | Weapon Training (+boon), Catch Your Breath |
| Roadwarden | Rogue | AGI+1, WIL−1 | Trickery (+1d6 dmg), Nimble Recovery |
| Bright Wizard | Magician | INT+1, STR−1 | Fire spells (Ignite, Burning Hands), Spell Recovery |
| Sigmarite Priest | Priest | WIL+1, AGI−1 | Life spells (healing), Shared Recovery |

---

## Updating the game later

If you make changes to the files:
- **GitHub Desktop:** save the files, they appear in GitHub Desktop → commit → push
- Railway auto-detects the push and redeploys within ~60 seconds

## Cost

Railway's **Hobby plan** is free with $5 of credits per month, which is more than enough for a game server with a few players. No credit card needed for the free tier.

If your project sleeps due to inactivity, it wakes up automatically when someone visits the URL (takes ~5 seconds).
