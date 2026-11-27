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
5. Copy ALL files and folders from this zip into that folder, keeping the layout:
   ```
   server.js          ← game server and rules
   game/              ← game data (careers, spells, enemies, items) and dice helpers
   public/            ← the web client: index.html, css/, js/, tokens/ (portraits), music/ (MP3s)
   tools/             ← automated playtest (npm test)
   package.json
   railway.json
   nixpacks.toml
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
- Campfires: rest (heal half your HP, two thirds when alone) or upgrade a weapon or armour; abilities refresh either way
- Levels 1, 3, and 7 trigger path selection screens

## Races

| People | Attributes | Level 1 | Expert classes (level 3) | Master classes (level 7) |
|---|---|---|---|---|
| Human (Empire) | +1 to all | Drilled, Combined Arms, Shield Bash | State Greatsword, Witch Hunter, Imperial Engineer, Bright Wizard | Captain of the Empire, Witchfinder General, Master Engineer, Patriarch |
| Human (Bretonnia) | +4 WIL | Virtue, The Charge, Lady's Blessing, Challenge | Knight Errant, Questing Knight, Damsel of the Lady, Herrimault | Grail Knight, Paladin of the Realm, Prophetess, Enchantress |
| Dwarf | +4 STR | Dwarf-hard, Stubborn, Constitution | Troll Slayer, Ironbreaker, Thunderer, Runesmith | Daemon Slayer, Thane, Ironbeard Marksman, Runelord |
| High Elf | +4 INT | Lore of Light, Valour of Ages | Swordmaster of Hoeth, Mage of Saphery, White Lion, Sword of Hoeth | Archmage, Loremaster of Hoeth, Phoenix Guard, Shadow Warrior |
| Wood Elf | +4 AGI | Hawk Eye, longbow | Waystalker, Wardancer, Spellsinger, Deepwood Scout | Waywatcher, Wild Rider, Spellweaver, Shadowdancer |

---

## Updating

Edit files → commit in GitHub Desktop → push. Railway auto-redeploys in ~60s.

## Cost

Free tier: $5 credits/month — plenty for a small game server. No card needed.

---

## Checking changes before you deploy

With Node 18+ installed, run this in the project folder:

```
npm install
npm test
```

`npm test` syntax-checks every file, runs the rules tests (tools/mechanics-test.js),
starts the server locally and lets bots play four full games (1–4 players). It fails
if a rule test fails, the server logs an error or a game gets stuck. Use
`GAMES=10 npm test` for a longer run.

`node tools/balance.js 40` plays 40 runs per class (and a full party) with a sensible
bot and prints win rates, depth reached and how each charm and weapon performed.

On phones the game switches to the mobile layout automatically; the 📱/🖥 button in
the header swaps layouts for the current visit.


---

## Keeping games alive through redeploys

The server saves every room to `data/rooms.json` once a second and when Railway
stops it, then restores the rooms on start. Players who refresh or lose connection
drop straight back into their seat.

Railway wipes the container's disk on every deploy, so for saves to survive a
redeploy attach a **Volume**:

1. In your Railway project, add a Volume and attach it to the game service
   (see Railway's docs on Volumes for the current menu path)
2. Set its mount path to `/data`
3. In the service's **Variables**, add `DATA_DIR` = `/data`

Without the volume, games still survive a crash-restart, but not a new deploy.

## Real-game stats

Every finished run adds one line to `runs.jsonl` in the data folder: party, classes, levels, paths, depth, difficulty and what killed the warband. Open `https://<your-app>.up.railway.app/api/stats` for a summary by class, party size and difficulty, plus the enemies that end the most runs. Use it to balance from real play rather than the simulator. With a Railway Volume attached (see above) the log survives redeploys.

## Daily Run, turn timer and late joining

- **Daily Run:** the host can turn it on in the room. Each day has one blessing and one hardship (e.g. Well Provisioned + Hardened Foes) shared by everyone, and every Daily starts from the same random seed; results go on today's board in the lobby (`/api/daily`).
- **Turn timer:** with two or more players, each turn has 60 seconds; when it runs out the turn passes. Solo play has no timer.
- **Joining late:** entering the code of a run in progress takes over the character of a player who has been gone for 20+ seconds.

## Automatic checks

`.github/workflows/test.yml` runs `npm test` on every push to GitHub (see the Actions tab). Railway waits for `/health` to answer before switching players over to a new deploy, so a deploy that fails to start never replaces a working one.

## Accounts, practice and quick chat

- **Accounts:** in the lobby, a name and a 4–8 digit PIN keep Renown and run history in `accounts.json` in the data folder (PINs are stored as salted hashes; five wrong PINs lock the name for five minutes). Signing in on another device brings the Renown along.
- **Practice fight:** one easy battle with any career and a coach; no Renown, not logged.
- **Quick chat:** party games get six fixed calls ("Heal me!", "Focus the boss!", …), shown as pop-ups and in the log.

## Relics, the road and the people on it

- **Relics:** after every elite or boss fight, and on a Cursed Path, each warrior picks one of three run-long relics (`game/relics.js`). After a boss in a party, a Champion's Prize drops: Need or Pass, a d20 decides.
- **Cursed Paths (☠):** a relic now, but enemies get +15% HP and +1 damage per curse (max two) until the next boss dies. +5 Renown each.
- **Road ahead:** the crossroads shows the next two crossroads, and they don't change.
- **Rows:** front or back. Melee enemies only reach the front row while someone stands there; melee weapons from the back row get 1 bane.
- **Block and Revive:** every career has Block (uses your turn, halves damage until your next turn, 5-round cooldown) and Revive (uses your turn, raises a fallen ally at 25% HP, 12-round cooldown).
- **Enemy intents:** each enemy card says who it will attack next. **Combos:** stunned/skipped targets take +1d6 (Exploit), Condemned + burning +1d6 (Purge), poisoned + bleeding +2 (Festering).
- **Recurring characters (`game/lore.js`, `events.js`):** Old Grete the merchant, Ulla Kranz and the Black Ravens (three meetings), Brother Aldric the witch hunter (two). How you treat them first changes later meetings. Bosses speak when they appear and when they die.
- **Endless mode:** the host turns it on in the lobby. No final victory: a boss every 10 depths (the three boss tiers cycle), and each boss past the third adds a tier — foes get much more HP (growing faster each tier), +1.5 damage, +1 to hit and more silver per tier; shop and loot weapons get +1 per tier and armour +1 every other tier, legendaries +1 per tier, and the Weapon Enhancement cap rises. Runs end when the warband falls.
- **Races and classes:** players choose a people, not a career: Human (Empire) +1 to every attribute, Human (Bretonnia) +4 WIL, Dwarf +4 STR, High Elf +4 INT, Wood Elf +4 AGI; each fights with its best attribute and has its own level-1 gifts. At level 3 each people picks one of four expert classes and at level 7 one of four master classes (`CAREER_PATHS` in `game/data.js`), e.g. Dwarf: Troll Slayer / Ironbreaker / Thunderer / Runesmith, then Daemon Slayer / Thane / Ironbeard Marksman / Runelord. Masters carry their own core abilities, classes that teach magic (`lores`) make you a spellcaster in your people's lores, and some come with gear (`gift`). The old careers remain only as archetype kits for the tests.
- **Corruption and Insanity (`game/dark.js`):** Corruption from Cursed Paths, cursed gear, warpstone and dark lores gives a mutation every 3 points (max 3). Insanity from terror, bosses and fallen allies; at the limit you snap (short madness + lasting disorder). Sigmarite Incense and Laudanum at the merchant, campfires remove 1 Insanity.
- **Abilities:** every active ability uses your turn; passives always work and never appear as buttons. Team abilities (War Cry, Battle Orders, Intercept, Counterspell, Grace, Last Rites) also cover you, so they work solo.
- **Events of the peoples:** each people has its own once-per-run encounter (Dwarf grudge, Grail chapel, Wood Elf waystone, Ulthuan envoy, State Troop muster).
- **Solo:** smaller bosses, smaller elite pairs, stuns last one turn and campfires heal more when you play alone.
- **Boss phases, elite modifiers, greenskins (`game/foes.js`):** every boss changes at half HP (scaled down for solo players); elites roll one of nine modifiers; Night Goblins, Squigs, Fanatics, Orc Boyz, Shamans, Black Orcs and Warboss Grubnak join the road.
- **Endless mutators:** after each Endless boss past the third the warband votes for one of three lasting changes.
- **Zones (`game/zones.js`):** the road runs through the Drakwald (beastmen, greenskins), the Altdorf Undercity (Skaven, undead) and the Chaos Wastes (Chaos, daemons), ten depths each; each region's factions turn up far more often, it has its own place names, a tint, and its own explore/battle/elite/boss music picked from the existing tracks (`ZONE_TRACKS` in `public/js/data.js`). Endless loops the regions.
- **Campfire (`game/campfire.js`):** each warrior chooses to rest (heal half, −1 Insanity, loosen curses, boon next fight) or upgrade their equipped weapon (+1 damage) or armour (+1 Defence), three times per item. Everyone gets abilities and castings back.
- **Dark Gods:** at 9 Corruption Khorne, Nurgle, Tzeentch or Slaanesh claims the character with a mark and a matching curse; Brother Aldric then comes hunting.
- **Stats page:** `/stats` (the Ledger of the Road) shows real-run win rates by career and party size, where runs end, the deadliest foes, path and relic picks and Dark God marks, from `/api/stats`.
- **Renown unlocks:** bronze (80), silver (200) and gold (300) portrait frames; start every run with a relic (150).
- **Achievements:** 14, each with a title you can wear. Kept in the browser and on your account if signed in.
- **Hall of fame:** `/api/halloffame` lists the best runs ever, shown in the lobby. Every run also gets a one-line chronicle on the end screen, in the history and on the share image.

## Code layout

`server.js` sets up the web server, rooms and messages. Game rules live in `game/`: `castings.js` (spell pools), `spawn.js` (picking and scaling enemies), `character.js` (building characters), `records.js` (daily run, run logging), `zones.js`, `campfire.js`,
`combat.js` (rolls, buffs, damage over time), `actions.js` (attacks, spells, talents), `turns.js` (turn order, enemy turns, deaths), `nodes.js` (the road and its rooms), `items.js` (gear, merchant, items), `paths.js` (levelling), `enemies.js` and `events.js` (enemy specials and choice events), `relics.js`, `lore.js` (boss lines, the merchant), `foes.js` (boss phases, elite modifiers, greenskins, mutators), `dark.js` (corruption and insanity), `rng.js` (per-room seeded randomness), `statesync.js` (sending players only what changed), `accounts.js`, `runlog.js`, `persist.js` and `data.js` (all the tables).

Every room has its own seeded random generator, so a run can be replayed from its seed. Browsers receive small state patches after the first full state; bots and tools that don't ask for patches still get full states.

Messages are rate-limited per connection, names are cleaned of markup, and one connection can create at most five rooms.
