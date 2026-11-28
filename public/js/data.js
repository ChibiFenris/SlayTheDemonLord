'use strict';
// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const CAREER_LABELS={empire:'Human (Empire)',bretonnia:'Human (Bretonnia)',dwarf:'Dwarf',highelf:'High Elf',woodelf:'Wood Elf'};
const XP_T=[0,0,2,10,19,24,29,34,51,68,84]; // default; refreshed from the server's XP_THRESHOLDS on load
const LOCS=['The Reikland Road','Altdorf Sewers','The Grey Mountains','The Forest of Shadows','Bogenhafen Catacombs','Ruins of Mordheim','The Dark Moors','The Chaos Wastes','A Forsaken Temple','The River Reik','Skaven Under-warren','Corrupted Village','The Blighted Marshes','Chaos Shrine','The Final Abyss'];

const CAREER_DETAILS={
  empire:{
    name:'Human (Empire)',
    stats:'STR 11 · AGI 11 · INT 11 · WIL 11 (+1 to all)',
    armor:'State Troop Mail (+3 Def)', hp:'37 HP', defence:'14 Defence',
    weapon:'State Hand Weapon 1d8+3 (STR)',
    role:'Sigmar\'s people: good at everything. Becomes a Greatsword, Witch Hunter, Engineer or Bright Wizard — the widest choice of any people.',
    level1:'Drilled (+1 boon on attacks) · Combined Arms (each hit: +1 boon next attack) · Shield Bash (cooldown 8) · Catch Breath (cooldown 12)'
  },
  bretonnia:{
    name:'Human (Bretonnia)',
    stats:'STR 10 · AGI 10 · INT 10 · WIL 14 (+4 WIL)',
    armor:'Knightly Plate (+4 Def)', hp:'35 HP', defence:'14 (+2) Defence',
    weapon:'Knightly Sword 1d8+5 (WIL)',
    role:'Knights of the Lady: faith guides the blade. Charges, holy smites, a healing Damsel or a greenwood outlaw.',
    level1:'Knightly Virtue (steadier mind) · The Charge (+1 boon on your first attack) · Lady\'s Blessing (+2 Defence) · Challenge (Taunt) · Catch Breath (cooldown 12)'
  },
  dwarf:{
    name:'Dwarf',
    stats:'STR 14 · AGI 10 · INT 10 · WIL 10 (+4 STR)',
    armor:'Dwarf Mail (+3 Def)', hp:'32 HP', defence:'13 Defence',
    weapon:'Dwarf Axe 1d8+4 (STR)',
    role:'Stubborn, tough and hard-hitting. Slayers, Ironbreakers, Thunderers with handguns, or Runesmiths.',
    level1:'Dwarf-hard (10% less damage) · Stubborn (never stunned) · Catch Breath (cooldown 12)'
  },
  highelf:{
    name:'High Elf',
    stats:'STR 10 · AGI 10 · INT 14 · WIL 10 (+4 INT)',
    armor:'Ithilmar Scale (+4 Def)', hp:'35 HP', defence:'14 Defence',
    weapon:'Ithilmar Blade 1d8+4 (INT)',
    role:'Born to magic; even their swordsmen fight with the mind. Starts with the Lore of Light. Swordmasters, Mages, White Lions, Swords of Hoeth.',
    level1:'Power 1 and the Lore of Light · Asur Discipline (+1 boon on attacks) · Valour of Ages (+1 boon, +2 damage vs elites and bosses) · Spell Recovery (cooldown 12)'
  },
  woodelf:{
    name:'Wood Elf',
    stats:'STR 10 · AGI 14 · INT 10 · WIL 10 (+4 AGI)',
    armor:'Woodland Cloak (no armour)', hp:'21 HP', defence:'14 Defence',
    weapon:'Asrai Longbow 1d6+4 (AGI)',
    role:'Archers and dancers of Athel Loren. Shoots from the back row. Waystalkers, Wardancers, Spellsingers, Deepwood Scouts.',
    level1:'Strike from Hiding (+1 boon on your first attack each fight) · Nimble Recovery (cooldown 12)'
  },
};
const NOVICE_INFO={
  empire:{name:'Human (Empire)', gains:'Lv1: +5 Max HP. Drilled: +1 boon on attacks. Combined Arms: each hit gives +1 boon on your next attack. Shield Bash (cooldown 8). Catch Breath (cooldown 12).'},
  bretonnia:{name:'Human (Bretonnia)', gains:'Lv1: +5 Max HP. Knightly Virtue: Insanity limit +1. The Charge: +1 boon on your first attack. Lady\'s Blessing: +2 Defence. Challenge (Taunt). Catch Breath (cooldown 12).'},
  dwarf:{name:'Dwarf', gains:'Lv1: +6 Max HP. Dwarf-hard: 10% less damage. Stubborn: never stunned, Insanity limit +1. Catch Breath (cooldown 12).'},
  highelf:{name:'High Elf', gains:'Lv1: +5 Max HP. Power 1 and the Lore of Light. Asur Discipline: +1 boon on attacks. Valour of Ages: +1 boon and +2 damage vs elites and bosses. Spell Recovery (cooldown 12).'},
  woodelf:{name:'Wood Elf', gains:'Lv1: +4 Max HP. Strike from Hiding: +1 boon on your first attack each fight. Nimble Recovery (cooldown 12).'},
  engineer:{name:'Engineer', gains:'Lv1: +4 Max HP. Volley Gun (uses your turn): a turret fires at a foe at the end of each round for 3 rounds (cooldown 8). Bomb: 2d6+INT to every enemy (cooldown 6). Tinkerer: +1 Defence, Healing Draughts heal 2 more. Gunnery Drill: +1 boon on attacks. Riveted Plate: 10% less damage taken. Catch Breath (cooldown 12).'},
  waywatcher:{name:'Waywatcher', gains:'Lv1: +4 Max HP. Hawk Eye: +2 to hit from the back row. Arrow Storm: 1d6+AGI to every enemy (cooldown 8). Evasion. Nimble Recovery (cooldown 12).'},
  warrior:{name:'Warrior',    gains:'Lv1: +5 Max HP. Weapon Training: +1 boon on all attacks. Catch Breath: heal 1d6+STR, cooldown 12. Shield Bash: stun one enemy for 2 turns, cooldown 8. Taunt: for 2 rounds all enemies attack only you (ready again after 3 rounds). Bleed on Hit: every weapon hit applies 1 Bleed stack.'},
  rogue:  {name:'Rogue',      gains:'Lv1: +4 Max HP. Trickery: first hit applies 3 poison stacks, subsequent hits apply 2 stacks. Evasion: the first attacker each round subtracts the highest bane d6 from d20. Nimble Recovery: heal 1d6+AGI, cooldown 12. Venom on First Hit: first attack applies 4 poison stacks.'},
  magician:{name:'Magician',  gains:'Lv1: +4 Max HP. +1 Power (extra casting slots). Burning Soul: fire spells deal +1d6 if target is already Burning. Burn on Spell: attack spells apply 1d6 Burn DoT. Spell Recovery: restore rank-0 castings, cooldown 12.'},
  witchhunter:{name:'Witch Hunter', gains:'Lv1: +5 Max HP. Condemn (uses your turn, cooldown 6): +1 boon and +1d6 on hits against your target. Silver Shot: +2 dmg vs undead, daemons, Chaos. First Volley: +1 boon on your first attack. Catch Breath (cooldown 12).'},
  slayer: {name:'Slayer',     gains:"Lv1: +6 Max HP. Slayer's Oath: +1d6 vs elites and bosses. Death Wish: below half HP +1 boon and +2 dmg. Rage: when hit, next attack +1 boon +1d6. Catch Breath (cooldown 12)."},
  priest: {name:'Priest',     gains:'Lv1: +4 Max HP. +1 Power (divine casting slots). Weapon Training: +1 boon on all attacks. Holy Fervor: every weapon hit deals 1d3+WIL holy damage and heals you 1d3 HP. Shared Recovery: all allies heal, cooldown 12. Divine Favour: refresh your recharging abilities (cooldown 14).'},
};

const EXPERT_INFO={
  inquisitor:{name:'Inquisitor',     gains:"+5 HP. Lv3: Mark Heretic (marked target +2 boons), Burn the Witch (hits on your Condemned foe apply Burn). Lv4: Hunter's Mark (+2 dmg vs marked), +1 AGI. Lv5: Resonance (+1d6 vs afflicted foes), Dead Man's Hand (kills heal you). Lv6: Purge the Wicked, +1 AGI.",desc:'Witch Hunter path. Condemn, mark and burn one heretic at a time.'},
  giantSlayer:{name:'Giant Slayer',  gains:'+6 HP. Lv3: Bleed on Hit, Rage Trigger (any hit taken readies a raging strike). Lv4: Combat Expertise (+1d6 vs stunned), +1 STR. Lv5: Combat Prowess (+1d6 per hit), Relentless (damage builds each attack). Lv6: Unstoppable (survive a killing blow once per run), +1 STR.',desc:'Slayer path. Bleeds, rages and refuses to die.'},
  defender:{name:'Fighter',      gains:'+5 HP. Lv3: Bulwark (+5 HP, +2 Def), Bleed on Hit. Lv4: Paced Strikes (every 2nd hit = 2 Bleed), Press the Advantage (hit = +1 boon next attack), +1 STR. Lv5: Combat Expertise (+1d6 vs stunned targets), Weapon Aptitude (+2 to hit). Lv6: Deep Bleed (all Bleed doubled), +1 STR.',desc:'Iron Wall. Bulwark gives HP and Defence. Paced Strikes and Deep Bleed stack Bleed fast. Press the Advantage chains boons every hit.'},
  ranger:   {name:'Ranger',       gains:'+5 HP. Lv3: Quick Step (miss = +2 Def), Hunter\'s Mark (first hit marks, +2 dmg vs marked). Lv4: Fade (Quick Step active = +1 boon), Evasion (first attacker each round subtracts bane d6), +1 AGI. Lv5: Skirmish (hits on marked = 2 poison). Lv6: Smoke Screen (3 banes on all enemies 2 rounds), +1 AGI.',desc:'Hunter and Ghost. Mark targets for bonus damage. Evasion and Smoke Screen keep you untouchable.'},
  paladin:  {name:'Paladin',      gains:'+4 HP, +1 Power. Lv3: Holy Fervor (hits deal 1d3+WIL holy and heal you 1d3), Divine Smite (+3d6, cooldown 4). Lv4: Lay on Hands (weapon hits heal 1d6+WIL, 2×/combat), +1 STR. Lv5: Righteous Fury (kills heal all allies 1d6+WIL), Combat Prowess (+1d6/hit). Lv6: Sacred Aegis (attacker takes 1d6 holy), Wrath of Sigmar (Divine Smite deals 6d6), +1 WIL.',desc:'Warrior Priest. Holy Fervor triggers on every weapon hit. Wrath of Sigmar is a devastating execute. Righteous Fury turns kills into group heals.'},
  assassin: {name:'Assassin',     gains:'+5 HP. Lv3: Poison Blade (+2 poison/hit), Shadow Opening (first attack extra boon). Lv4: Venom on First Hit (4 poison first hit), Quick Hands (items free action), +1 AGI. Lv5: Assassination (above 50% HP: +2 poison; below: +1d6+3 dmg), Dead Man\'s Hand (kill heals 2d6+AGI). Lv6: Exploit Weakness (5+ stacks = +1 boon), Deathblow (hits 2 poison, crits 4), +1 AGI.',desc:'Shadow Killer. Stack poison fast with Poison Blade then detonate at 50% with Assassination. Deathblow crits apply 4 stacks.'},
  elementalist:{name:'Pyromancer',    gains:'+4 HP, +1 Power. Lv3: Burning Soul (+1d6 if target burning), Utility Focus (spells +1 round). Lv4: Prepared Spell (free rank-1 at combat start), +1 INT. Lv5: Burn on Spell (attack spells apply Burn DoT), Conflagration (re-burning resets to max dice). Lv6: Metamagic (free cast, 1×), Lingering Magic (DoTs apply twice), +1 INT.',desc:'Bright Wizard of the fire wind. Burning Soul, Ignite, and Conflagration combine for massive fire damage. Lingering Magic doubles every DoT you apply.'},
  sorcerer:    {name:'Sorcerer',  gains:'+4 HP, +1 Power. Lv3: Arcane Surge (first spell each combat +1d6), Spell Leech (spell kill = heal 1d6). Lv4: Surge (spell kill = regain all rank 0-1 castings), Spell Recovery (restore rank-0, 1×), +1 INT. Lv5: Metamagic (free cast, 1×), Resonance (+1d6 vs burning/bleeding/poisoned). Lv6: Chain Reaction (25% lightning fires twice), Overload (next spell casts twice, 1×), +1 INT.',desc:'Death and Storm. Dual elemental mastery. Surge keeps you casting. Chain Reaction and Overload are late-game spell nova.'},
  warlock:     {name:'Warlock',   gains:'+4 HP, +1 Power. Lv3: Curse (target takes +1 boon/+1 dmg from all attacks), Evil Eye (target 2 banes on attacks 3 rounds). Lv4: Blood Offering (lose 1d6 HP to regain castings), +1 INT. Lv5: Mass Heal (all allies 1d6), Hex (+4 dmg to cursed/Evil Eye targets). Lv6: Dark Pact (lose 1d6 HP, next spell free), +1 INT.',desc:'Chaos Witch. Curse marks a target for the whole party. Blood Offering and Dark Pact trade HP for raw spell power. Hex amplifies your curse damage.'},
  wizard:      {name:'Illusionist', gains:'+4 HP, +1 Power. Lv3: Utility Focus (utility spells +1 round), Prepared Spell (free rank-1 at combat start). Lv4: Glamour Veil (the first attack against you each fight misses), +1 INT. Lv5: Metamagic (free cast, 1×), Misdirection (an enemy miss gives your next attack spell +1d6). Lv6: Lingering Magic (expiring buffs grant 1 boon), +1 INT.',desc:'Grey Wizard of deceit. Hard to pin down and rewards the enemy for missing.'},
  spellbinder: {name:'Spellbinder',gains:'+4 HP, +1 Power. Lv3: Flame Edge (weapon attacks deal fire dmg, apply Burn, trigger Burning Soul), Arcane Strike (4%+4%/INT-mod chance to bypass enemy AC). Lv4: Combat Prowess (+1d6/hit), Rage Trigger (damage procs +1 boon +1d6), +1 INT. Lv5: Burning Soul (+1d6 if target burning), Rage (after taking dmg +1d6 bonus). Lv6: Frenzy (kills extend Rage), +1 STR.',desc:'Arcane Berserker. Flame Edge turns every swing into fire damage. Stack Burning Soul on top for massive hybrid damage.'},
  healer:      {name:'Healer',    gains:'+4 HP, +1 Power. Lv3: Mass Heal (all allies 1d6), Triage (all allies regen 1d6/round 2 turns). Lv4: Holy Fervor (hits deal 1d3+WIL holy and heal you 1d3), Divine Favour (cooldown 14: refresh abilities, restore rank-0), +1 WIL. Lv5: Resurrection (fatal hit = heal to half HP + 2 boons), Battle Medic (heal ally = heal self 1d6). Lv6: Sacred Ground (regen 1d6/round + 3 boons, 2 turns), +1 WIL.',desc:'Blessed Healer. Mass Heal, Triage, and Sacred Ground keep everyone alive. Resurrection acts as a death prevention shield.'},
  druid:       {name:'Druid',     gains:'+4 HP, +1 Power. Lv3: Shared Recovery (all allies heal), Nature Bond (immune to poison, melee attackers get 1d6 poison). Lv4: Druid Fervor (hits deal 4+best(WIL/INT) nature dmg and heal same), Foresight (bless: next 2 attacks reroll take higher, 1×), +1 WIL. Lv5: Mass Heal (all allies 1d6), Entangle (root 1 enemy, 1×). Lv6: Druid\'s Fury (2 rounds: +1d6 dmg, +2 boons, 2 Bleed per hit), Revelation (curse: next 2 attacks reroll take worse, 1×), +1 WIL.',desc:'Wild and Wise. Nature Bond makes you poison-immune and punishes melee attackers. Druid Fervor triggers on every weapon hit. Druid\'s Fury is a powerful no-action burst.'},
};

Object.assign(EXPERT_INFO,{
  gunner:{name:'Master Gunner', gains:"+5 HP. Lv3: Weapon Aptitude (+2 to hit), First Volley (+1 boon first shot). Lv4: Hunter's Mark, +1 INT. Lv5: Combat Prowess (+1d6/hit), Dead Aim (next hit is a crit). Lv6: Killing Momentum (kill = free attack), +1 INT.", desc:'Engineer path. A crack shot with handgun and long gun.'},
  sapper:{name:'Sapper', gains:'+6 HP. Lv3: Big Bombs (bombs +1d6, stun on a 6), Toughness (10% damage reduction). Lv4: Combat Expertise, +1 INT. Lv5: Improved Turret (Volley Gun lasts 4 rounds, +1d6), Quick Hands (items are free actions). Lv6: Ward (allies +1 Defence while you stand), +1 INT.', desc:'Engineer path. Bigger bangs and a sturdier gun.'},
});
Object.assign(EXPERT_INFO,{
  witchHunter:{name:'Witch Hunter', gains:'+5 HP. Lv3: Condemn (uses your turn: +1 boon, +1d6 on hits vs your target), Silver Shot, First Volley. Lv4: Mark Heretic, +1 AGI. Lv5: Burn the Witch, Resonance. Lv6: Purge the Wicked, +1 WIL.'},
  empEngineer:{name:'Imperial Engineer', gains:'+5 HP. Lv3: Volley Gun (free-action turret), Bomb (hits every enemy). Lv4: Big Bombs, +1 INT. Lv5: Improved Turret, Quick Hands. Lv6: Tinkerer (+1 Def, better draughts), +1 INT.'},
  knightErrant:{name:'Knight Errant', gains:'+6 HP. Lv3: Devastating Charge (+1d6 and Prone), Press the Advantage. Lv4: Shield Bash, +1 WIL. Lv5: Combat Prowess (+1d6/hit), Weapon Aptitude (+2 to hit). Lv6: Sweeping Blow, +1 STR.'},
  questingKnight:{name:'Questing Knight', gains:'+5 HP. Lv3: Holy Fervor (hits deal holy damage and heal 1d3), Vigil. Lv4: Divine Smite (+3d6), +1 WIL. Lv5: Blessed Blade, Combat Expertise. Lv6: Wrath of the Lady (Smite for 6d6), +1 WIL.'},
  herrimault:{name:'Herrimault', gains:'+5 HP. Lv3: Trickery (poison on hit), Smoke Screen. Lv4: Venom on First Hit, +1 AGI. Lv5: Skirmish, Hunter\'s Mark. Lv6: Exploit Weakness, +1 WIL.'},
  trollSlayer:{name:'Troll Slayer', gains:'+7 HP. Lv3: Slayer\'s Oath (+1d6 vs elites/bosses), Death Wish, Rage. Lv4: Rage Trigger, +1 STR. Lv5: Relentless, Combat Prowess. Lv6: Unstoppable (survive death once), +1 STR.'},
  ironbreaker:{name:'Ironbreaker', gains:'+7 HP. Lv3: Taunt, Shieldwall (+2 Def), Bulwark (+5 HP, +2 Def). Lv4: Rebound (throw back half of every hit), +1 STR. Lv5: Fortress Stance, Intercept. Lv6: Perfect Defence, +1 STR.'},
  thunderer:{name:'Thunderer', gains:'+5 HP and a Dwarf Handgun (1d10+1, STR, ranged). Lv3: Weapon Aptitude (+2 to hit), First Volley. Lv4: Dead Aim, +1 STR. Lv5: Combat Prowess, Quick Hands. Lv6: Killing Momentum, +1 AGI.'},
  runesmith:{name:'Runesmith', gains:'+5 HP, +1 Power and a rune lore (Protection, Earth or Battle). Lv3: Ward (allies +1 Def), Counterspell. Lv4: Blessed Blade, +1 INT. Lv5: Overcast, Force of Will. Lv6: Shieldwall, +1 WIL.'},
  swordmaster:{name:'Swordmaster of Hoeth', gains:'+5 HP. Lv3: Acrobatic Riposte (enemy miss = free counter), Quick Strike. Lv4: Bladestorm (an extra strike per hit), +1 INT. Lv5: Weapon Master, Swift Feet (+2 boons). Lv6: Flicker (negate a hit), +1 AGI.'},
  whiteLion:{name:'White Lion of Chrace', gains:'+6 HP. Lv3: Rebound bodyguard (throw back half of every hit), Bleed on Hit. Lv4: Taunt, +1 STR. Lv5: Combat Prowess, Fortitude (immune to bleed and poison). Lv6: Sweeping Blow, +1 STR.'},
  wardancer:{name:'Wardancer', gains:'+5 HP. Lv3: Bladestorm (an extra strike per hit), Fade. Lv4: Quick Step (+2 Def after a miss), +1 AGI. Lv5: Flurry Bleed, Acrobatic Riposte. Lv6: Flicker, +1 AGI.'},
});
const MASTER_INFO={
  thane:{name:'Thane', gains:'+6 HP. Lv7: Warlord Aura (allies +1 boon), Battle Orders. Lv8: War Cry, +1 STR. Lv9: Intercept, Sweeping Blow. Lv10: Killing Momentum, +1 WIL.'},
  runelord:{name:'Runelord', gains:'+5 HP, +2 Power and a rune lore. Lv7: Spell Surge, Ward. Lv8: Overcast, +1 INT. Lv9: Anvil of Doom (Catastrophe: 10d6 to every enemy), Esoteric Knowledge. Lv10: Force of Will, +1 WIL.'},
  phoenixGuard:{name:'Phoenix Guard', gains:'+6 HP. Lv7: Taunt, Shieldwall, Perfect Defence. Lv8: Rebound, +1 INT. Lv9: Toughness, Endure. Lv10: Flicker, +1 WIL.'},
  wayMaster:{name:'Waywatcher', gains:'+5 HP. Lv7: Arrow Storm (every enemy), Phantom Strike (first shot always hits). Lv8: Dead Aim, +1 AGI. Lv9: Bladestorm (a second arrow per hit), Killing Momentum. Lv10: Swift Feet, +1 AGI.'},
  spellweaver:{name:'Spellweaver', gains:'+4 HP, +2 Power and a lore. Lv7: Druid\'s Fury, Nature Bond. Lv8: Entangle, +1 INT. Lv9: Lingering Magic, Overcast. Lv10: Catastrophe, +1 WIL.'},
  guildMaster:{name:'Guild Master', gains:'+5 HP. Lv7: Improved Turret, Big Bombs. Lv8: Weapon Master (damage never below half), +1 INT. Lv9: Fortress Stance, Toughness. Lv10: Steam Barrage (6d6 to every enemy, cooldown 9), +1 INT.', desc:'Engineer master. The Gunnery School\'s finest.'},
  longRifle:{name:'Hochland Long Rifle', gains:'+5 HP. Lv7: Quick Strike (round-1 shot hits twice), Phantom Strike (first shot auto-hits). Lv8: Dead Aim, +1 AGI. Lv9: Bladestorm (hits fire a second shot), Killing Momentum. Lv10: Swift Feet (+2 boons on every attack), +1 INT.', desc:'Engineer master. One shot, one kill.'},
  witchfinder:{name:'Witchfinder General', gains:'+4 HP. Lv7: Judgement (Condemn twice per combat, Condemned foes take +2 more), Quickstrike. Lv8: Dead Aim (next hit is a crit), +1 AGI. Lv9: Exploit Weakness, Inspire. Lv10: Phantom Strike (first attack auto-hits), +1 AGI.',desc:'Witch Hunter master. Two condemnations a fight and executions on demand.'},
  daemonSlayer:{name:'Daemon Slayer',      gains:'+5 HP. Lv7: Frenzy (kills extend rage), Fortitude. Lv8: Devastating Charge (next hit +1d6 and Prone), +1 STR. Lv9: Sweeping Blow, Endure. Lv10: Killing Momentum, +1 STR.',desc:'Slayer master. The last Slayer standing.'},
  myrmidon:   {name:'Sentinel',      gains:'+5 HP. Lv7: Shieldwall (+2 Def), Shield Bash (stun, uses your turn). Lv8: Evasion (bane on first attack each round; every attack while Taunting), Rebound (reflect half dmg to attacker), +1 STR. Lv9: Toughness (10% dmg reduction), Fortress Stance (below 50% HP = extra 10% reduction). Lv10: Perfect Defence (first damaging hit deals 0, 1×), +1 STR.',desc:'Fortress Guardian. Toughness and Fortress Stance stack for up to 20% damage reduction. Perfect Defence makes you completely untouchable for one round.'},
  brute:      {name:'Berserker',     gains:'+5 HP. Lv7: Relentless (hits +1 dmg stack, misses +1 to-hit stack, max 5), Fortitude (immune to Bleed/Poison). Lv8: Combat Prowess (+1d6/hit), Vengeance (ally falls = free attack), +1 STR. Lv9: Rallying Cry (all allies heal), Endure (if hit would drop you below 35% HP, halve it, 1×/combat). Lv10: Combat Expertise (+1d6 vs stunned targets), Unstoppable (survive death once/run), +1 STR.',desc:'Relentless Force. Relentless builds damage and accuracy stacks separately. Endure prevents burst kills. Unstoppable at L10 is the last resort.'},
  warlord:    {name:'Warlord',       gains:'+5 HP. Lv7: Rallying Cry (all allies heal), Battle Orders (you and an ally: 1 boon, +2 damage). Lv8: Warlord Aura (all allies +1 boon), Devastating Charge (+1d6 + Prone first hit), +1 STR. Lv9: Sweeping Blow (hits deal 75% dmg to all others), Intercept (you and an ally take the lower of two damage rolls for 2 rounds). Lv10: Killing Momentum (kill = free attack), +1 WIL.',desc:'Battlefield Commander. Warlord Aura buffs the whole party passively. Intercept protects everyone by weakening all enemy hits at once.'},
  champion:   {name:'Champion',      gains:'+5 HP. Lv7: Quick Strike (round-1 attack hits twice), Inspire (kills give all allies 2 boons). Lv8: Holy Fervor (hits deal 1d3+WIL holy and heal you 1d3), Mark Heretic (hits mark target, +2 boons vs marked), +1 STR. Lv9: Unstoppable (survive death once/run), War Cry (you and all allies +3 ATK +3 dmg for 2 rounds). Lv10: Weapon Master (dmg rolls never below half max), Purge the Wicked (marked kill heals all 1d6), +1 AGI.',desc:'Living Legend. Quick Strike hits twice on round 1. Inspire turns every kill into boons for the whole party. War Cry is a free-action group buff.'},
  shadowblade:{name:'Shadowblade',   gains:'+5 HP. Lv7: Phantom Strike (first attack auto-hits), Shadow Step (all attacks +1 boon). Lv8: Evasion (first attacker each round subtracts bane d6), Acrobatic Riposte (enemy miss = free counter, 1×/round), +1 AGI. Lv9: Bladestorm (hit = 1 extra strike), Vanish (kill = enemies 1 bane vs you 1 round). Lv10: Swift Feet (all attacks +2 boons), Flicker (negate one hit, 1×), +1 AGI.',desc:'Unseen Blade. Shadow Step gives +1 boon on every attack permanently. Swift Feet stacks on top for +2 boons. Phantom Strike opens every combat with an auto-hit.'},
  executioner:{name:'Executioner',   gains:'+5 HP. Lv7: Deathblow (hits 2 poison, crits 4 poison), Cleanup (kill = free attack). Lv8: Poison Blade (+2 poison/hit), Unrelenting (Bladestorm hits each gain +1 boon), +1 AGI. Lv9: Phantom Strike (first attack auto-hits), Dead Aim (declare before attack, hit = crit, 1×). Lv10: Bladestorm (hit = 1 extra strike), Flurry Bleed (all Bladestorm hits apply Bleed), +1 AGI.',desc:'No Survivors. Cleanup chains free attacks on kills. Poison Blade + Deathblow stacks poison fast. Bladestorm with Unrelenting and Flurry Bleed is a late-game finisher.'},
  transmuter: {name:'Transmuter',    gains:'+4 HP, +1 Power. Lv7: Burning Soul (+1d6 if target burning), Elemental Attunement (spells ×1.25 vs foes with no weakness). Lv8: Ball Lightning (spell kill arcs 1d6 to next enemy), +1 INT. Lv9: Overcast (+2d6 bonus, spend 2 slots), Volatile Form (first attack spell each combat hits all enemies). Lv10: Catastrophe (10d6 all enemies, 1×), Overcharge (free cast, 1×), +1 INT.',desc:'Alchemist and Storm. Transmute spells to exploit any weakness. Ball Lightning chains damage on kills. Catastrophe is your win button.'},
  necromancer:{name:'Necromancer',   gains:'+4 HP, +1 Power. Lv7: Life Drain (spell kill = heal 1d4). Lv8: Metamagic (free cast, 1×), Chaos Touch (all chaos spell bonuses trigger 100%), +1 INT. Lv9: Spell Surge (free cast, 1×), Undying Hunger (DoT tick kill = +1 cast all spells + heal 1d6+INT). Lv10: Uncontrolled Power (double spell dice, take 1d6 backlash, 1×), +1 INT.',desc:'Death and Chaos. Dark Evoker pushes dark spell damage to ×2.5. Undying Hunger rewards DoT kills with massive casting refunds. Chaos Touch makes all bonus effects guaranteed.'},
  abjurer:    {name:'Abjurer',       gains:'+4 HP, +1 Power. Lv7: Shieldwall (+2 Def), Counterspell (negate on-hit ability targeting ally, 1×). Lv8: Overcast (+2d6 bonus, spend 2 slots), Double Charge (re-arm Overcast, cooldown 4), +1 INT. Lv9: Toughness (10% dmg reduction), Ward (all allies +1 Def while you live). Lv10: Spell Surge (free cast, 1×), Force of Will (Overcast stuns on d20 11+), +1 WIL.',desc:'Protection and Battle Mage. Ward and Shieldwall make the whole party tankier. Overcast + Double Charge + Force of Will creates repeated stun pressure.'},
  archmage:   {name:'Archmage',      gains:'+4 HP, +2 Power. Lv7: Spell Surge (free cast, 1×), Arcane Mastery (+1 Power, know all rank-0 spells from tradition). Lv8: Utility Focus (spells +1 round), Esoteric Knowledge (use scroll without consuming, 1×), +1 INT. Lv9: Catastrophe (10d6 all enemies, 1×), Spell Echo (spell fires again at half dmg, 1×). Lv10: Metamagic (free cast, 1×), Lingering Magic (DoTs apply twice), +1 INT.',desc:'Arcane Pinnacle. +2 Power gives dramatically more casting slots. Arcane Mastery at L7 unlocks all tradition rank-0 spells. Lingering Magic + Catastrophe is a late-game wipe.'},
  healer_m:   {name:'High Healer',   gains:'+4 HP, +2 Power. Lv7: Mass Heal (all allies 1d6), Overflowing Grace (Mass Heal also removes one debuff each). Lv8: Holy Fervor (hits deal 1d3+WIL holy and heal you 1d3), Banish (chaos/undead loses next action, 1×), +1 WIL. Lv9: Miracle Heal (restore one target to full HP, 1×), Protective Blessing (healed target +2 Def next turn). Lv10: Resurrection (fatal hit = heal to half HP + 2 boons, 1×), Sanctify (killed chaos/undead can\'t trigger death abilities), +1 WIL.',desc:'Blessed and Anointed. +2 Power means vast casting slots. Overflowing Grace makes every Mass Heal also cleanse debuffs. Combines healing, anti-chaos, and death prevention.'},
  chaplain:   {name:'Templar',       gains:'+4 HP, +1 Power. Lv7: Rallying Cry (all allies heal), Last Rites (ally falls = all others heal 1 HP). Lv8: Holy Fervor (hits deal 1d3+WIL holy and heal you 1d3), Blessed Blade (ignore DR vs undead/chaos), +1 WIL. Lv9: Mass Heal (all allies 1d6), Vigil (full-HP allies +1 boon next attack). Lv10: Divine Smite (+3d6, 2×), Holy Fire (Smite on chaos applies Burn), Combat Prowess (+1d6/hit), +1 WIL.',desc:'War Priest and Templar. Blessed Blade ignores damage reduction on undead and chaos. Last Rites makes every ally death trigger a group heal. Holy Fire adds Burn on top of smite damage.'},
};

const TALENT_DESCS={
  virtue:'Passive — The Knightly Virtue: your Insanity limit is 1 higher.',
  stubborn:'Passive — Dwarven stubbornness: you can never be stunned, and your Insanity limit is 1 higher.',
  valourOfAges:'Passive — Valour of Ages: +1 boon and +2 damage on weapon attacks against elite and boss enemies.',
  rage:'Passive — Whenever an enemy hits you, your next attack gets +1 boon and +1d6 damage.',
  rageTrigger:'Passive — The first hit you take each fight readies a raging strike: your next attack gets +1 boon and +1d6 damage.',
  frenzy:'Passive — Killing an enemy while raging keeps your rage ready for the next attack.',
  turret:'Active (uses your turn, cooldown 8 rounds) — Set up a Volley Gun that fires at a random enemy at the end of each round for 3 rounds (1d6 + INT + half your level).',
  grenade:'Active (uses your turn, cooldown 6 rounds) — A bomb hits every enemy for 2d6+INT.',
  tinkerer:'Passive — +1 Defence from riveted plates, and your Healing Draughts heal 2 more.',
  hawkEye:'Passive — +2 to hit while you stand in the back row (+1 for Wood Elves).',
  arrowStorm:'Active (uses your turn, cooldown 8 rounds) — An arrow into every enemy for 1d6+AGI.',
  bigBombs:'Passive — Your bombs deal +1d6 and stun an enemy on a 6.',
  improvedTurret:'Passive — Your Volley Gun fires for 4 rounds and deals +1d6.',
  steamBarrage:'Active (uses your turn, cooldown 9 rounds) — 6d6 to every enemy.',
  revive:'Active (uses your turn) — Bring a fallen ally back into the fight at a quarter of their max HP. Only shows when someone has fallen.',
  block:'Active (uses your turn, cooldown 5 rounds) — Every career can Block: all damage you take is halved until your next turn.',
  condemn:'Active (uses your turn, cooldown 6 rounds; 3 with Judgement) — Name your target a heretic: your attacks on it get +1 boon and your hits deal +1d6. When it dies, the mark passes to the next enemy you attack.',
  silverShot:'Passive — +2 damage on hits against undead, daemons and servants of Chaos.',
  firstVolley:'Passive — Your first attack each combat gets +1 boon.',
  burnTheWitch:'Passive — Your hits on a Condemned enemy apply 1 Burn.',
  judgement:'Passive — Condemn recharges in 3 rounds instead of 6, and hits on Condemned foes deal +2 more.',
  slayerOath:"Passive — Slayer's Oath: +1d6 damage on hits against elites and bosses.",
  deathWish:'Passive — While below half HP, your attacks get +1 boon and your hits deal +2 damage.',
  glamourVeil:'Passive (once per fight) — The first attack against you strikes an illusion and misses.',
  misdirection:'Passive — Whenever an enemy misses you, your next attack spell deals +1d6.',
  // ── NOVICE ──────────────────────────────────────────────────────────────
  weaponTraining:'Passive — All weapon attack rolls add a boon d6 (roll d6, add highest to d20). Net effect: attacks rarely miss.',
  catchBreath:'Active (uses your turn, cooldown 12 rounds) — Heal 2d6 + your best attribute bonus.',
  shieldBash:'Active (uses your turn, cooldown 8 rounds) — Stun one enemy: it loses its next 2 turns.',
  bleedOnHit:'Passive — Every weapon hit applies 1 Bleed stack (DoT: 1d3 dmg/round, fades after 2 rounds).',
  bleedOnCrit:'Passive — Critical hits apply 1 Bleed stack.',
  trickery:'Passive — First hit each combat applies 3 poison stacks. Every later hit applies 2.',
  loneSurvivor:'Passive — You started this run alone. Warrior: +6 max HP. Wizard, Priest and Witch Hunter: +5 max HP. All gain +1 extra HP every level.',
  nimbleRecovery:'Active (uses your turn, cooldown 12 rounds) — Heal 2d6 + your best attribute bonus.',
  spellRecovery:'Active (uses your turn, cooldown 12 rounds) — Restore all rank-0 casting slots.',
  sharedRecovery:'Active (uses your turn, cooldown 12 rounds) — You and every ally heal 2d6 + your best attribute bonus.',
  holyFervor:'Passive — Every weapon hit deals 1d3 + WIL holy damage and heals you 1d3 HP.',
  divineFavour:'Active (uses your turn, cooldown 14 rounds) — Refresh all your recharging abilities and restore 1 rank-0 casting slot.',
  // ── EXPERT ──────────────────────────────────────────────────────────────
  bulwark:'Passive — +5 max HP and +2 Defence in combat.',
  pacedStrikes:'Passive — Every 2nd weapon hit applies 2 Bleed stacks to the target.',
  pressTheAdvantage:'Passive — After any hit, your next attack gains +1 boon (add highest d6 to d20).',
  combatExpertise:'Passive — Weapon hits against a stunned enemy deal +1d6.',
  weaponAptitude:'Passive — +2 bonus to all weapon attack rolls.',
  deepBleed:'Passive — All Bleed you apply is doubled.',
  bleedDeep:'Passive — All Bleed you apply is doubled.',
  combatProwess:'Passive — Every weapon hit deals +1d6 bonus damage.',
  quickStep:'Passive — On a miss, gain +2 Defence for 1 round.',
  huntersMark:'Passive — First hit marks the target. All your attacks vs marked target deal +2 bonus damage.',
  fadePassive:'Passive — When Quick Step is active, your next attack gains +1 boon.',
  evasion:'Passive — The first enemy attack against you each round subtracts the highest bane d6 from its d20 roll.',
  skirmish:'Passive — Every hit against your Marked target applies 2 poison stacks.',
  smokeScreen:'Active (uses your turn, cooldown 10 rounds) — All enemies roll with 3 banes on attacks for 2 rounds.',
  divineSmite:'Active (uses your turn, cooldown 4 rounds) — Deal +3d6 holy bonus damage on your next attack.',
  layOnHands:'Passive (2×/combat) — When your weapon hit deals damage, you heal 1d6 + WIL.',
  righteousFury:'Passive — When you kill any enemy, all living allies heal 1d6 + WIL HP.',
  sacredAegis:'Passive — When an enemy hits you, they take 1d6 holy retribution damage.',
  wrathOfSigmar:'Passive — Divine Smite deals 6d6 holy damage instead of 3d6.',
  poisonBlade:'Passive — Every weapon hit applies +2 poison stacks.',
  shadowOpening:'Passive — Your first attack each combat always has an extra boon.',
  venomOnFirstHit:'Passive — First hit of combat applies 4 poison stacks. (Doubled to 8 with Lingering Magic.)',
  quickHands:'Passive — Using an item in combat does not cost your action.',
  assassination:'Passive — Hits on an enemy above 50% HP add 2 poison stacks; below 50% they deal +1d6+3 damage.',
  deadMansHand:'Passive — When Assassination kills a target, heal 2d6 + AGI HP.',
  exploitWeakness:'Passive — Target with 5+ poison stacks: your attacks gain +1 boon.',
  deathblow:'Passive — Hits apply 2 poison stacks. Crits apply 4 poison stacks.',
  burningSoul:'Passive — Fire spells (and Flame Edge) deal +1d6 if the target is already Burning.',
  utilityFocus:'Passive — All utility spell effects last 1 extra round.',
  preparedSpell:'Passive — At combat start, cast one rank-1 spell for free.',
  burnOnSpell:'Passive — All attack spells apply a 1d6 Burn DoT to the target.',
  conflagration:'Passive — Re-applying Burn to a burning target resets it to maximum dice.',
  metamagic:'Active (uses your turn, cooldown 6 rounds) — Your next spell costs no casting.',
  lingeringMagic:'Passive — When you apply any DoT (Burn, Bleed, Poison), apply it twice.',
  flameEdge:'Passive — Weapon attacks deal fire damage and apply 1 Burn. Triggers Burning Soul.',
  arcaneStrike:'Passive — 4% + 4% per INT modifier chance to bypass enemy AC entirely (INT 10=4%, INT 11=8%, INT 12=12%).',
  surge:'Passive — When a spell kills an enemy, regain all your rank 0 and rank 1 castings.',
  resonance:'Passive — Spells deal +1d6 to targets already Burning, Bleeding, or Poisoned.',
  chainReaction:'Passive — Each lightning attack spell has a 25% chance to strike its target a second time.',
  overload:'Active (uses your turn, cooldown 8 rounds) — Your next attack spell is cast twice.',
  curse:'Active (uses your turn, cooldown 6 rounds) — Cursed target: all attacks +1 boon and +1 dmg until it dies.',
  evilEye:'Active (uses your turn, cooldown 6 rounds) — Target rolls with 2 banes on all attacks for 3 rounds.',
  bloodOffering:'Active (uses your turn) — Lose 1d6 HP to regain 1 casting of every rank 0–2 spell.',
  massHeal:'Active (uses your turn, cooldown 12 rounds) — All living allies heal 1d6 HP.',
  hex:'Passive — Evil Eye or Cursed targets take +4 damage from all sources.',
  darkPact:'Active (uses your turn, cooldown 8 rounds) — Lose 1d6 HP; your next spell costs no casting.',
  natureBond:'Passive — Immune to poison. Enemies that melee-hit you receive 1d6 poison stacks.',
  druidFervor:'Passive — Every weapon hit deals 4 + best(WIL/INT) nature damage and heals you 4 + best(WIL/INT) HP.',
  druidsFury:'Active (uses your turn, cooldown 6 rounds) — For 2 rounds: +1d6 damage per hit, +2 boons on attacks, hits apply 2 Bleed stacks.',
  foresight:'Active (uses your turn, cooldown 6 rounds) — Bless self or ally: next 2 attacks add a boon d6, take the higher result.',
  entangle:'Active (uses your turn, cooldown 8 rounds) — Roots your target enemy: it loses its next action.',
  revelation:'Active (uses your turn, cooldown 6 rounds) — Curse enemy: next 2 attacks subtract a bane d6, take the lower result.',
  triage:'Active (uses your turn, cooldown 12 rounds) — All living allies regen 1d6 HP/round for 2 rounds.',
  resurrection:'Active (uses your turn, cooldown 16 rounds) — Bless the most wounded ally: their next killing blow leaves them at half HP with 2 boons instead.',
  battleMedic:'Passive — When you heal an ally, you also heal 1d6 HP.',
  sacredGround:'Active (uses your turn, cooldown 12 rounds) — All allies regen 1d6/round for 2 rounds and gain 3 boons.',
  // ── MASTER ──────────────────────────────────────────────────────────────
  shieldwall:'Passive — +2 Defence while in combat.',
  bodyguard:'Passive — When an enemy hits you, reflect half the damage back at the attacker.',
  toughness:'Passive — All damage you take is reduced by 10%.',
  fortressStance:'Passive — While below 50% HP, take an additional 10% less damage.',
  perfectDefence:'Passive (1×/combat) — The first hit that would damage you deals 0.',
  relentless:'Passive — Each hit deals +1 extra damage per hit so far (up to +5). Each miss gives +1 to hit (up to +5). Both reset when the fight ends.',
  fortitude:'Passive — Immune to Bleed and Poison conditions.',
  vengeancePassive:'Passive — When an ally falls, or the first time each fight you drop to a quarter of your HP or less, your next attack has 2 boons.',
  endure:'Passive — If an attack would drop you below 35% HP, halve its damage instead. 1×/combat.',
  unstoppable:'Passive (once per run) — Survive one killing blow at 1 HP.',
  battleOrders:'Active (uses your turn, cooldown 8 rounds) — You and an ally each get 1 boon and +2 damage on your next attack. If that ally has already acted this round, they may act again.',
  warlordAura:'Passive — You and every ally gain +1 boon on weapon attacks while you are alive.',
  devastatingCharge:'Passive — Your first hit each fight deals +1d6 damage and knocks the target Prone.',
  sweepingBlow:'Passive — On a successful hit, all other enemies take 75% of the damage dealt.',
  intercept:'Active (uses your turn, cooldown 8 rounds) — For 2 rounds, enemies roll their damage twice against you and an ally and keep the lower.',
  killingMomentum:'Passive (once per fight) — When you kill an enemy, immediately make a free weapon attack against another.',
  quickstrike:'Passive — Round 1 only: your attack hits twice.',
  inspire:'Passive — When you kill an enemy, all living allies gain 2 boons on their next action.',
  markHeretic:'Passive — Your hits mark the target. All attacks vs marked target gain +2 boons.',
  warCry:'Active (uses your turn, cooldown 8 rounds) — You and every ally gain +3 to hit and +3 damage for 2 rounds.',
  weaponMaster:'Passive — Damage rolls can never do less than half the maximum possible.',
  purgeTheWicked:'Passive — When you kill a Marked target, all living allies heal 1d6 HP.',
  phantomStrike:'Passive — Your first attack each combat automatically hits, bypassing Defence.',
  shadowStep:'Passive — All your attacks have +1 boon.',
  acrobaticRiposte:'Passive (1×/round) — When an enemy misses you, make a free counter-attack.',
  bladestorm:'Passive — When your weapon attack hits, you strike once more.',
  vanish:'Passive — When you kill an enemy, all remaining enemies roll with 1 bane against you for 1 round.',
  swiftFeet:'Passive — All your attack rolls add 2 boon dice (add highest to d20).',
  flicker:'Passive (1×/combat) — The first enemy attack against you is negated.',
  cleanup:'Passive (once per fight) — When you kill an enemy, immediately make a free attack against another.',
  unrelenting:'Passive — Each hit in a Bladestorm gains +1 boon.',
  deadAim:'Active (uses your turn, cooldown 6 rounds) — Declare before attacking. If you hit, it is automatically a critical hit.',
  flurryBleed:'Passive — All hits during Bladestorm apply 1 Bleed stack.',
  elementalAttunement:'Passive — Attack spells deal ×1.25 damage to enemies with no elemental weakness.',
  ballLightning:'Passive — When a lightning spell kills an enemy, 1d6 lightning arcs to another enemy.',
  overcast:'Passive — Your first attack spell each fight spends a second casting of that rank (if you have one) to deal +2d6 damage.',
  volatileForm:'Passive (1×/combat) — Your first attack spell each combat hits all enemies.',
  catastrophe:'Active (uses your turn, cooldown 9 rounds) — Deal 10d6 damage to all enemies.',
  overcharge:'Active (uses your turn, cooldown 8 rounds) — Your next spell costs no casting and deals +2d6 damage.',
  lifeDrain:'Passive — When a spell kills an enemy, heal 1d4 HP.',
  arcaneSurge:'Passive — Your first attack spell each combat deals +1d6 damage.',
  spellLeech:'Passive — When a spell kills an enemy, heal 1d6 HP.',
  chaosTouch:'Passive — Your chaos spells\' surge roll always succeeds.',
  spellsurge:'Active (uses your turn, cooldown 8 rounds) — Your next spell costs no casting. Also +1 Power.',
  undyingHunger:'Passive — When a DoT tick kills an enemy, regain 1 casting for every known spell and heal 1d6+INT HP.',
  uncontrolledPower:'Active (uses your turn, cooldown 8 rounds) — Double all spell dice on your next spell. Take 1d6 backlash damage.',
  counterspell:'Active (uses your turn, cooldown 6 rounds) — Ward yourself and an ally for 3 rounds: the next enemy hit on each of you carries no poison, bleed, stun or other effect.',
  doubleCharge:'Passive — Overcast works on your first two attack spells each fight instead of one.',
  ward:'Passive — You and every ally gain +1 Defence while you are alive.',
  forceOfWill:'Passive — Overcast spells stun their target on d20 11+.',
  esotericKnowledge:'Active (uses your turn, cooldown 8 rounds) — The next spell scroll you read this fight isn\'t used up.',
  arcaneMastery:'Passive — +1 Power permanently. Learn all rank-0 spells from your tradition.',
  spellEcho:'Passive (1×/combat) — Your first damaging spell echoes for half its damage.',
  overflowingGrace:'Passive — Each target healed by Mass Heal also removes one debuff.',
  holyAura:'Passive — You and every ally gain +2 Defence while you are alive.',
  divineVessel:'Passive — All healing spells you cast deal +1d6 additional healing.',
  miracleHeal:'Active (uses your turn, cooldown 14 rounds) — Restore the most wounded ally to full HP. Also +1 Power.',
  protectiveBlessing:'Passive — Anyone you heal gains +2 Defence this round.',
  grace:'Passive (once per fight) — When you or an ally would fall, they survive at 1 HP instead.',
  banish:'Active (uses your turn, cooldown 8 rounds) — One chaos or undead enemy loses their next action.',
  sanctify:'Passive — Chaos and undead enemies you kill cannot trigger on-death abilities.',
  lastRites:'Passive — The first time each fight that you or an ally drops to a quarter of their HP or less, they heal 1d6 + your WIL bonus.',
  blessedBlade:'Passive — Your weapon attacks vs undead and chaos ignore any damage reduction.',
  vigil:'Passive — While you are alive, you and every ally at full HP gain +1 boon on weapon attacks.',
  holyFire:'Passive — When Divine Smite hits a chaos enemy, it also applies a 1d6 Burn DoT.',
  rallyingCry:'Active (uses your turn, cooldown 12 rounds) — You and every ally heal 2d6 + their best attribute bonus.',
  taunt:'Active (uses your turn, ready again 3 rounds after use) — For 2 rounds all enemies attack only you, and you have +2 Defence while they do.',
};

const ITEM_DESCS={
  'Healing Draught':'Drink to heal 1d6 + your level HP. Can also be given to an ally (heals by their level).',
  'Bandages':'Stop all bleeding on you and heal 1d4.',
  'Smelling Salts':'Shake off Stunned, Prone, Shaken and similar, and get 1 boon on your next attack.',
  'Ironhide Tonic':'+2 Defence for 3 rounds. Combat only.',
  'Throwing Knives':'Throw at your target for 2d4 + AGI damage.',
  'Tar Pot':'Your target attacks with 2 banes for 2 rounds.',
  'Greater Healing Draught':'Drink to heal 2d6 + twice your level HP. Can also be given to an ally (heals by their level).',
  'Flask of Oil':'Throw in combat to deal 2d6 fire damage to the enemy.',
  'Fire Jar':'Smash in combat to deal 3d6 fire damage to the enemy.',
  'Lucky Pendant':'Activate before attacking — your next attack is automatically a critical hit.',
  'Sharpening Stone':'Activate in combat — your weapon deals +1d6 bonus damage for this combat.',
  'Incendiary Flask':'Throw in combat for 2d6 fire damage to your target.',
  'Daemon Fire':'Smash in combat for 3d6 fire damage to your target.',
  'Antitoxin':'Clears all your poison.',
  'Smoke Bomb':'In combat: every enemy attacks with 2 banes this round.',
  "Sigmar's Token":'Heal 1d6+3 HP, remove one debuff, and loosen any curse so cursed gear can be removed.',
  'Spell Scroll':'Cast a random spell once. Consumed on use.',
  'Weapon Enhancement':'+1 damage AND +1 to hit on equipped weapon.',
  '+1 Attribute':'Choose any attribute (STR/AGI/INT/WIL) to increase by 1.',
  'Troll Blood':'In combat: regenerate 3 HP a round for 3 rounds, but −2 Defence meanwhile.',
  'Dwarf Ale':'Heal 2d6 HP, but 1 bane on your next attack.',
  'Sigmarite Incense':'Out of combat: remove 2 Corruption. Mutations stay.',
  'Laudanum':'Remove 2 Insanity.',
  'Warpstone Dust':'In combat: +2 damage for the rest of the fight, and you gain 1 Corruption.',
  'Black Lotus Oil':'Your next 3 weapon hits each add 3 poison.',
  'Holy Water':'In combat: 3d6 holy damage to an undead or daemonic target. Does nothing to others.',
  'Hellfire Bomb':'In combat: 4d6 fire to every enemy — and 1d6 to you.',
  'Fly Agaric':'In combat: your next spell costs no casting and deals +1d6, but you take 1d4.',
};


// ─── DEBUFF TOOLTIPS ──────────────────────────────────────────────────────────
const DEBUFF_INFO = {
  'Bleed': {icon:'🩸',desc:'Takes 1d3 per Bleed stack each round (max 4 stacks).',mech:'Each new Bleed adds a die (1d3 → 4d3) and refreshes 3 rounds. On players: 1d3 per round for 2 rounds. Fortitude blocks it.'},
  'Burn': {icon:'🔥',desc:'Takes fire damage each round, fading over time.',mech:'Starts at 1–3d6 and loses one die each round. Re-applying adds a die (max 4d6).'},
  'Poison': {icon:'☠',desc:'Takes 1 damage per poison stack each round.',mech:'Max 15 stacks on an enemy. Stacks drop by 2 each round. 5+ stacks: 1 bane on attacks. Enemies at 10+ stacks lose 1 max HP per round.'},
  'Chilled': {icon:'❄',desc:'Takes 1d3 damage and has 1 bane each round.',mech:'Lasts 2 rounds. Applied by Grave Grasp, Freezing Fog and Wights.'},
  'Stunned': {icon:'💫',desc:'Loses their next actions.',mech:'Player and enemy stuns last 2 turns unless noted. Stunned turns are skipped automatically.'},
  'Prone': {icon:'⬇',desc:'Knocked down — 1 bane on their next attack.',mech:'Clears when they miss. Chainbreaker’s Prone instead costs the target its next action.'},
  'Frightened': {icon:'😱',desc:'Attacks are made with 1 bane.',mech:'Subtract the highest bane d6 from the d20.'},
  'Rattled': {icon:'😰',desc:'Temporary debuff that clears when an enemy is slain.',mech:'Removed when any enemy dies.'},
  'Cursed': {icon:'🌙',desc:'Attacks against this target gain 1 boon and +1 damage.',mech:'Applied by Curse (Warlock L3). Lasts until it dies.'},
  'Curse': {icon:'🌙',desc:'Attacks against this target gain 1 boon and +1 damage.',mech:'Applied by Curse (Warlock L3). Lasts until it dies.'},
  'Evil Eye': {icon:'👁',desc:'Attacks with 2 banes for 3 rounds.',mech:'Applied by Evil Eye (Warlock L3). Hex adds +4 damage against it.'},
  'Marked': {icon:'⚖',desc:'Attacks against this target gain 2 boons.',mech:'Applied by Mark Heretic (Champion L8). Lasts until it dies.'},
  'Revelation': {icon:'📖',desc:'Its next 2 attacks roll twice and take the worse.',mech:'Applied by Revelation (Druid L6).'},
  'Vine Snare': {icon:'🌿',desc:'2 banes on its attacks for 3 rounds.',mech:'Applied by Wrath of Nature.'},
  'Rooted': {icon:'🌿',desc:'Loses its next action.',mech:'Applied by Entangle (Druid L5).'},
  'Blinded': {icon:'🌑',desc:'3 banes on attacks.',mech:'From Flash/Radiation: until it misses. From Extinction Pulse: 2 rounds.'},
  'Slowed': {icon:'🐢',desc:'1 bane on attacks for 2 rounds.',mech:'Applied by Freezing Fog.'},
  'Figment': {icon:'👻',desc:'1 bane on attacks until it misses.',mech:'Applied by Figment.'},
  'Enervated': {icon:'🩻',desc:'Max HP reduced for this combat.',mech:'Applied by Enervation.'},
  'Intercepted': {icon:'🛡',desc:'Damage rolls are made twice, taking the lower.',mech:'Applied by Intercept (Warlord L9).'},
  'Bane': {icon:'⬇',desc:'Attacks subtract the highest bane d6 from the d20 roll.',mech:'Several banes: roll that many d6 and use the highest.'},
  'Sundered': {icon:'💥',desc:'Armour cracked — Defence reduced by 2.',mech:'Applied by Warhammer crits. Lasts this combat.'},
  'Insanity': {icon:'🌀',desc:'Gained from terrifying foes.',mech:'Applied by Bloodletters and the Bonebreaker.'},
  'Gutter Poison': {icon:'🗡',desc:'1 bane on your next attack.',mech:'Applied by Stormvermin when you were already poisoned.'},
  'Chaos Bane': {icon:'🔴',desc:'1 bane on attacks for 2 rounds.',mech:'Applied by Chaos Worship and Chosen of the Gods.'},
  'Corroded': {icon:'🟢',desc:'You deal 1 less damage this round.',mech:'Applied by Mutant Thug bites.'},
  'Hypnotised': {icon:'👁',desc:'1 bane on your next attack.',mech:'Applied by the Vampire Count’s gaze.'},
  'Roared': {icon:'🐂',desc:'1 bane on your next attack.',mech:'Applied by Kragthor’s Bellowing Roar.'},
  'Primordial Roar': {icon:'🦎',desc:'You deal half damage.',mech:'Applied by the Saurian Ancient on round 1. Lasts 3 rounds.'},
};

const BUFF_INFO = {
  'War Cry ATK': {icon:'📣',desc:'+3 to all attack rolls for 2 rounds.',mech:'Applied by War Cry. Uses your turn; you and every ally.'},
  'War Cry DMG': {icon:'📣',desc:'+3 damage on all hits for 2 rounds.',mech:'Applied by War Cry. Uses your turn; you and every ally.'},
  'Triage Regen': {icon:'💉',desc:'Regenerate 1d6 HP each round.',mech:'Applied by Triage (Healer L3). Lasts 2 rounds.'},
  'Sacred Ground': {icon:'⛪',desc:'Regenerate 1d6 HP each round.',mech:'Applied by Sacred Ground (Healer L6). Lasts 2 rounds.'},
  'Inspired': {icon:'👑',desc:'2 boons on your next attack.',mech:'Applied by Inspire (Champion L7) on kills.'},
  'Overload': {icon:'💥',desc:'Your next attack spell fires twice.',mech:'Applied by Overload. Uses your turn.'},
  'Druids Fury': {icon:'🌿',desc:'+1d6 damage and 2 boons on attacks; hits apply 2 Bleed.',mech:'Applied by Druid’s Fury (Druid L6). Lasts 2 rounds.'},
  'Resurrection Shield': {icon:'✝',desc:'The next killing blow leaves you at half HP with 2 boons.',mech:'Applied by Resurrection (Healer L5). Lasts this combat.'},
  'Foresight': {icon:'🔮',desc:'Your next 2 attack rolls roll twice and keep the higher.',mech:'Applied by Foresight (Druid L4).'},
  'Vigil': {icon:'🙏',desc:'+1 boon while at full HP.',mech:'Vigil (Templar L9). Passive.'},
  'Well Rested': {icon:'🛏',desc:'1 boon on your first attack.',mech:'From resting. Consumed when you attack.'},
  'Taunting': {icon:'📯',desc:'All enemies attack only this warrior.',mech:'From Taunt. Lasts 2 rounds; ready again 3 rounds after use.'},
  'Protective Blessing': {icon:'🛡',desc:'+2 Defence this round.',mech:'From being healed by a High Healer.'},
  'Force Field (35% DR)': {icon:'🛡',desc:'You take 35% less damage.',mech:'Force Field. 2 rounds.'},
  'Sanctuary (35% DR)': {icon:'⛪',desc:'You take 35% less damage.',mech:'Sanctuary. 2 rounds.'},
  'Mist Form (35% DR)': {icon:'🌫',desc:'You take 35% less damage.',mech:'Mist Form. 3 rounds.'},
};

// ─── TRADITIONS DATA (mirrors server) ────────────────────────────────────────
const TRADITION_INFO = {
  fire:           {label:'Fire', desc:'Fire — ×2 vs Undead. Flame Missile (R0, 1d6 + Burn) → Meteor (R1, all enemies) / Fiery Volley (R1, 3 hits) → Fireball (R2, 5d6 all enemies) → Immolate (R3, 4d6 + heavy Burn).'},
  life:           {label:'Life', desc:'Holy — ×2 vs Chaos. Sigmar\'s Smite (R0, 1d6+WIL) / Minor Healing (R0) → Cure / Light Healing (R1) → Moderate Healing / Vitality Burst (R2, heals all) → Major Healing (R3, full HP).'},
  death:          {label:'Death', desc:'Dark — ×2 vs Beastmen. Spectral Grasp (R0, 1d3) → Grave Grasp (R1, Chilled) → Bone Splinters (R2, 3d6, may kill outright) → Cannibalize Magic (R3, 3d6, regain a casting).'},
  shadow:         {label:'Shadow', desc:'Dark — ×2 vs Beastmen. Nightfall Blade (R0, +1d6 weapon hits) → Shadow Dart (R1, 2d6) → Shadow Strike (R2, 3 × 2d6) → Enervation (R3, −20 max HP).'},
  battle:         {label:'Battle', desc:'Arcane. Augmented Attack (R0, +1d6 next hit) → Close Wounds (R1, heal) / Mighty Attack (R1, +2d6 & 2 boons) → Battle Prowess (R3, boon and +1d6 for 7 rounds).'},
  celestial:      {label:'Celestial', desc:'Holy — ×2 vs Chaos. Burning Beam (R0, 1d6 + Burn) → Flash (R1, Blind) → Sunrays (R2, 3 × 1d6) → Radiation (R3, 3d6+WIL + Blind).'},
  chaos:          {label:'Chaos', desc:'Arcane. Every spell can surge for +2d6 on d20 12+. Erratic Bolt (R0, 1d6) → Capricious Devastation (R1, 2d6) → Color of Magic (R2) → Chaotic Lance (R3, 4d6 all enemies).'},
  earth:          {label:'Earth', desc:'Arcane. Earth Spike (R0, 1d6 + Prone + Bleed) → Stone Blades (R1, 2d6 all + Bleed) → Avalanche (R2, 4d6 all + 2 Bleed) → Eruption (R3, 5d6 all + 2 Bleed).'},
  storm:          {label:'Storm', desc:'Lightning — ×2 vs Skaven. Forked Lightning (R0, hits twice) → Freezing Fog (R1, Chilled + Slowed) → Call Lightning (R2, 3d6+5, may stun) → Lightning Bolt (R3, 5d6, may strike twice).'},
  protection:     {label:'Protection', desc:'Defensive. Force Field (R0, −35% damage) → Sanctuary (R1, −35% for all allies) → Vigor (R2, +10 max HP) → Protective Field (R3, all allies immune this round).'},
  illusion:       {label:'Illusion', desc:'Arcane. Figment (R0, enemy bane) → Vertigo (R1, 2 boons next attack) → Glamer (R2, enemy loses its action) → Phantasm (R3, 4d6).'},
  nature:         {label:'Nature', desc:'Arcane. Oak Hide (R0, +2 Defence) → Healing Berries / Shillelagh (R1) → Wrath of Nature (R3, 3d6 + 2 banes).'},
  transformation: {label:'Transformation', desc:'Self-buffs. Beast Within (R0, +1d6 next hit) → Dire Beast (R1, +1d6 hits for 5 rounds) → Mist Form (R2, −35% damage) → Speed Healing (R3, 3d6+WIL heal).'},
  time:           {label:'Time', desc:'Tempo. Swiftness (R0, +1 boon for 3 rounds) → Rewrite Moment (R1, reroll misses) → Minor Paradox (R2, regain castings) → Precognition (R3, 2 boons and +4 Defence).'},
};

// Rules tables owned by the server. These defaults are replaced by /api/game-data
// on load (see core.js), so the client can never drift from the server's numbers.
const SPELL_ELEMENT={}; // spell name -> fire | holy | lightning | dark | arcane

// ─── CASTINGS TABLE (default; refreshed from the server) ─────────────────────────────────────────
const CASTINGS_TABLE_C = {
  0:[1,0,0,0], 1:[2,1,0,0], 2:[3,2,1,0], 3:[4,2,1,1],
  4:[5,2,2,1], 5:[6,3,2,2], 6:[7,3,2,2], 7:[8,3,2,2],
  8:[9,3,3,2], 9:[10,3,3,3], 10:[11,3,3,3],
};
function maxCastingsC(power, rank) {
  const row = CASTINGS_TABLE_C[Math.min(power,10)] || CASTINGS_TABLE_C[0];
  return row[Math.min(rank,3)] || 0;
}
function castingsLeftC(char, spellName, rank) {
  if (!char.castingPools) return maxCastingsC(char.power, rank);
  const v = char.castingPools['R'+rank]; // spells of the same rank share one pool
  return v !== undefined ? v : maxCastingsC(char.power, rank);
}

// ── Talent tap ───────────────────────────────────────────────────────────────
// Active talents usable in combat that are not covered by the explicit buttons above.
// [key, button label, short subtitle, used(char, gs)]
// Ability cooldowns (rounds), filled in from the server's rules on load.
let COOLDOWNS_C={};
// What an enemy will do on its next turn, worked out from what the client can see.
// ── Front and back lines ─────────────────────────────────────────────────────
// Bows, guns and other ranged weapons work from the back line (mirrors the server).
function rangedWeaponC(c){
  const w=c&&c.equippedWeapon; if(!w) return false;
  if(w.special&&['openingShot','marksmanship','longbow'].includes(w.special.key)) return true;
  if(w.dmgType==='piercing') return true;
  return /bow|pistol|gun|sling|javelin|blunderbuss|handgun|rifle/i.test(w.name||'');
}
function myTurnNow(gs){ const t=gs&&gs.turnOrder&&gs.turnOrder.length?gs.turnOrder[gs.activeTurnIdx||0]:null; return !!(t&&t.type==='player'&&t.id===myId); }
// Can this warrior change line right now? {ok, why}
function rowMoveState(c,gs){
  if(!c||!c.alive) return {ok:false,why:'Fallen'};
  if(!gs||gs.phase!=='combat') return {ok:true,why:''};
  if(!myTurnNow(gs)) return {ok:false,why:'On your turn'};
  if(c._rowMovedRound===gs.roundNumber) return {ok:false,why:'Already moved this turn'};
  return {ok:true,why:'Free, once per turn'};
}
// One line on what your line means for you.
function rowNote(c){
  if(c.row==='back') return rangedWeaponC(c)?'Back line: only archers, gunners and casters can reach you.':'Back line: safe from melee foes, but your melee attacks have 1 bane.';
  return 'Front line: melee foes can reach you.';
}
const lineExposed=players=>{ const a=(players||[]).filter(p=>p.char&&p.char.alive); return a.length>0&&a.every(p=>p.char.row==='back'); };
// Banes your next weapon attack will have from where everyone stands (for the Attack button).
function attackLineNotes(c,target){
  const out=[]; if(!c) return out;
  if(c.row==='back'&&!rangedWeaponC(c)) out.push('1 bane: melee from the back line');
  if(target&&target._screened&&!rangedWeaponC(c)) out.push('1 bane: target is behind their front line');
  return out;
}
function enemyIntent(e,gs,players){
  if((e.activeDebuffs||[]).some(d=>d.skipTurn)) return {cls:'calm',text:'💫 Stunned — loses its next turn'};
  if(e._windup) return {cls:'alert',text:`⚠ Next: ${(typeof TELEGRAPH_NAMES!=='undefined'&&TELEGRAPH_NAMES[e._windup])||'a big attack'}`};
  const alive=(players||[]).filter(p=>p.char&&p.char.alive);
  const taunter=alive.find(p=>(p.char.activeBuffs||[]).some(b=>b.taunting));
  const n=e.attacks||(e.multi?2:1), dmg=`${e.dmgDisplay||'1d6'}${n>1?' ×'+n:''}`;
  if(taunter) return {cls:'',text:`⚔ Next: attacks ${taunter.name} (taunted) · ${dmg}`};
  const front=alive.filter(p=>p.char.row!=='back');
  const who=alive.length<=1?(alive[0]?alive[0].name:'you'):(e.ranged||!front.length)?'everyone':front.length===1?front[0].name:'the front line';
  const me=alive.find(p=>p.id===myId);
  const safe=me&&alive.length>1&&!e.ranged&&front.length&&me.char.row==='back';
  return {cls:safe?'calm':'',text:`${e.ranged?'🏹':'⚔'} Next: attacks ${who} · ${dmg}${safe?' — can\'t reach you':''}`};
}
// How many rounds until a used ability is ready; null if it isn't recharging.
function cooldownLeft(c,k){
  const d=COOLDOWNS_C[k]; if(!d) return null;
  const left=(c._cd||{})[k];
  if(left!=null) return left;
  return (k==='condemn'&&c.judgement&&d.judgement)?d.judgement:d.rounds; // used this round: full cooldown ahead
}
function cooldownText(c,k){ const n=cooldownLeft(c,k); return n==null?'Used':`Ready in ${n} round${n===1?'':'s'}`; }
const EXTRA_ACTIVES=[
  ['taunt','📯 Taunt','Draw attacks, +2 Defence',(c,gs)=>(c._tauntReadyRound||0)>(gs.roundNumber||0)],
  ['block','🛡 Block','Halve damage until your turn',c=>!!c._blockUsed],
  ['turret','🔧 Volley Gun','Turret fires each round',c=>!!c._turretUsed],
  ['grenade','💣 Bomb','2d6+INT to every enemy',c=>!!c._grenadeUsed],
  ['arrowStorm','🏹 Arrow Storm','1d6+AGI to every enemy',c=>!!c._arrowStormUsed],
  ['steamBarrage','🚂 Steam Barrage','6d6 to every enemy',c=>!!c._steamBarrageUsed],
  ['revive','🙏 Revive','Raise a fallen ally at 25% HP',c=>!!c._reviveUsed,(gs,players)=>(players||[]).some(p=>p.char&&!p.char.alive&&p.id!==myId)],
  ['condemn','⚖ Condemn','+1 boon, +1d6 on target',c=>!!c._condemnUsed],
  ['entangle','🌿 Entangle','Enemy loses next action',c=>c._entangleUsed],
  ['miracleHeal','🌟 Miracle Heal','Ally to full HP',c=>c.miracleUsed],
  ['spellsurge','✨ Spell Surge','Next spell free',c=>c.spellsurgeUsed],
  ['warCry','📣 War Cry','You and allies +3 hit/+3 dmg',c=>c._warCryUsed],
  ['battleOrders','⚔ Battle Orders','You + ally: boon, +2 dmg',c=>c._battleOrdersUsed],
  ['intercept','🛡 Intercept','You + ally take lower damage',c=>c._interceptUsed],
  ['deadAim','🎯 Dead Aim','Next hit is a crit',c=>c._deadAimUsed],
  ['smokeScreen','💨 Smoke Screen','Enemies get banes',c=>c._smokeScreenUsed],
  ['curse','🎃 Curse','Target: +1 boon/+1 dmg vs it',c=>c._curseUsed],
  ['evilEye','👁 Evil Eye','Target 2 banes, 3 rounds',c=>c._evilEyeUsed],
  ['darkPact','🩸 Dark Pact','−1d6 HP, next spell free',c=>c._darkPactUsed],
  ['triage','💉 Triage','Party regen 1d6/round',c=>c._triageUsed],
  ['sacredGround','⛪ Sacred Ground','Party regen + boons',c=>c._sacredGroundUsed],
  ['divineFavour','🙏 Divine Favour','Refresh talents',c=>c._divineFavourUsed],
  ['banish','✝ Banish','Chaos/Undead loses action',c=>c._banishUsed],
  ['counterspell','🚫 Counterspell','Ward you + ally from effects',c=>c._counterspellUsed],
  ['foresight','🔮 Foresight','Next 2 rolls: best of 2',c=>c._foresightUsed],
  ['revelation','📖 Revelation','Enemy rolls twice, worse',c=>c._revelationUsed],
  ['druidsFury','🌿 Druid\'s Fury','+1d6, 2 boons, Bleed',c=>c._druidsFuryUsed],
  ['overload','💥 Overload','Next spell fires twice',c=>c._overloadUsed],
  ['overcharge','⚡ Overcharge','Next spell free, +2d6',c=>c._overchargeUsed],
  ['uncontrolledPower','🌪 Uncontrolled Power','Double spell dice',c=>c._uncontrolledPowerUsed],
  ['esotericKnowledge','📜 Esoteric Knowledge','Scroll not consumed',c=>c._esotericKnowledgeUsed],
];

// ─── AUDIO SYSTEM ────────────────────────────────────────────────────────────
// Music lives in public/music as compressed MP3 (the original WAVs were ~330 MB).
const TRACKS = {
  lobby:      'music/main-theme.mp3',
  explore:    'music/explore-theme.mp3',
  battle:     ['music/battle-theme.mp3', 'music/2ndbattle-theme.mp3'],
  elite:      'music/elite-theme.mp3',
  boss1:      'music/1stboss-theme.mp3',
  boss2:      'music/2ndboss-theme.mp3',
  boss3:      'music/final-boss-theme.mp3',
  merchant:   'music/merchant-theme.mp3',
  victory:    'music/victory-theme.mp3',
  defeat:     'music/defeat-theme.mp3',
};


// ─── ENEMY ABILITIES (flag on enemy → name, plain-language effect) ────────────
const ENEMY_ABILITY_INFO=[
  ['packInstinct','Pack Instinct','+1 to hit while another Skaven is alive.'],
  ['hideBehind','Cower','Below 30% HP it hides behind its friends and can\'t be targeted (or attack) while they stand.'],
  ['recklessCharge','Reckless Charge','Round 1: its attack has 1 boon and +1d6 damage.'],
  ['bloodOnHit','Bloodletting','Its hits make you Bleed (1d3 per round, 2 rounds).'],
  ['gore','Gore','+3 damage against anyone already Bleeding.'],
  ['undying','Undying','1-in-6 chance to rise again at 1 HP when slain.'],
  ['weakToBlunt','Brittle Bones','Takes 50% more damage from blunt weapons.'],
  ['stunImmune','Mindless','Cannot be stunned.'],
  ['shieldWall','Shield Wall','+2 Defence while another undead is alive.'],
  ['mutation','Mutation','Rolls a random mutation each fight — shown under its name.'],
  ['paralysingClaws','Paralysing Claws','Its hits numb you — 1 bane on your next attack.'],
  ['carrionFeast','Carrion Feast','+2 damage against warriors below half HP.'],
  ['horde','Horde','Always appears in pairs. When one falls, the other gets +2 damage and heals 4.'],
  ['shambling','Shambling','Always acts last in the round.'],
  ['swarm','Swarm','Attacks three times for small damage. Spells that hit every enemy deal double damage to it.'],
  ['skirmisher','Skirmisher','Dodges the first weapon hit each fight. 1 bane against warriors with ranged weapons.'],
  ['battleFury','Battle Fury','+1 damage each time you hit it with a weapon (up to +4). Burst it down.'],
  ['skavenDiscipline','Skaven Discipline','All its attacks have 1 boon.'],
  ['halberdGuard','Halberd Guard','The first weapon attack against it each round has 1 bane.'],
  ['callsPack','Call the Pack','Below 60% HP it calls a Clanrat (cooldown).'],
  ['barrowChill','Barrow Chill','Its hits lower your max HP by 2 until you rest (up to −10).'],
  ['virulentBlade','Virulent Blade','On hit: 3 poison.'],
  ['plagueFrenzy','Plague Frenzy','1 boon against warriors with 5+ poison.'],
  ['deathCloud','Plague Censer','When it dies, every warrior gains 2 poison.'],
  ['splitOnDeath','Split','When slain it bursts into two Brimstone Horrors.'],
  ['assassinTarget','Assassin','Always attacks the warrior with the lowest HP (Taunt still works).'],
  ['vanish','Vanish','After it hits, it disappears until its next turn and returns with 1 boon.'],
  ['sacrifice','Blood Sacrifice','Spends 6 of its own HP to heal a badly hurt ally 2d6 instead of attacking.'],
  ['pestilentCall','Pestilent Call','Left alone, it summons a Pox Rat Swarm (once).'],
  ['wail','Wail','Every other round it wails instead of attacking: 1d6 to every warrior (ignores armour) and Insanity.'],
  ['ethereal','Ethereal','Weapon attacks have 1 bane against it unless the weapon is holy or blessed.'],
  ['ratLord','Rat Lord','Arrives with a Pox Rat Swarm. Other Skaven get +1 Defence and +1 damage while it lives.'],
  ['damageReduction','Armour of Chaos','Weapon hits deal 2 less damage.'],
  ['cleaveSpill','Cleave','Its hits spill half their damage onto a second warrior.'],
  ['lifeLeech','Life Leech','Heals for part of the damage it deals.'],
  ['mistForm','Mist Form','Once, below 25% HP: takes half damage for 2 rounds.'],
  ['dominate','Dominate','Once a fight (round 2+), a warrior loses their next turn.'],
  ['hellblade','Hellblade','Ignores your armour\'s Defence bonus.'],
  ['bloodTithe','Blood Tithe','At the start of its turn it heals 1d4 for each Bleeding warrior.'],
  ['warlordCommand','Warlord\'s Command','Rallies or summons Skaven to its side.'],
  ['scurryAway','Scurry Away','+3 Defence while a Clanrat is alive.'],
  ['coward','Coward','A weapon hit of 10+ damage is taken by a Clanrat instead, if one lives.'],
  ['bullCharge','Bull Charge','Round 1: +2d6 damage and knocks you Prone.'],
  ['bloodgreedKill','Bloodgreed','Killing a warrior fully heals it.'],
  ['trollRegen','Troll Regeneration','Heals 1d6+2 every turn unless it was burned since its last turn.'],
  ['trollVomit','Troll Vomit','Every third round: 2d6 to one warrior ignoring armour, and Corroded.'],
  ['ratlingGun','Ratling Gun','Sprays 2–4 shots at random warriors. Sometimes jams and loses a turn.'],
  ['warpLightning','Warp Lightning','Every other round: 2d6 to every warrior. 1-in-6 chance it backfires.'],
  ['skavencunning','Skaven Cunning','On hit: 2 poison.'],
  ['seethingRage','Warlord\'s Decree','Below 40% HP: +2 Defence per Clanrat, and Clanrats deal +2 damage.'],
  ['packBoss','Pack Boss','Calls a Clanrat at 60% and 30% HP.'],
  ['stampede','Stampede','Round 1: every warrior loses 1 Defence for the fight.'],
  ['belowRoar','Bellowing Roar','Below 50% HP: every warrior has 1 bane on their next attack.'],
  ['bloodlust','Bloodlust','Below 50% HP: +2 to hit, −2 Defence.'],
  ['frenzyMulti','Blood Frenzy','Once, below 50% HP: its next attack always hits and its life leech rises to 35%.'],
  ['critMajorBleed','Frenzied Rending','Its hits make you Bleed.'],
  ['insanityAtk','Terror','On hit: 50% chance you gain 1 Insanity.'],
  ['packLeader','Pack Leader','Its Skaven allies gain +2 to hit.'],
  ['skavenPackTactics','Pack Tactics','Enters battle with two Clanrats.'],
  ['regen','Regeneration','Heals 1d6 HP every turn.'],
  ['primordialRoar','Primordial Roar','Round 1: every warrior deals half damage for 3 rounds.'],
  ['crushingTail','Crushing Tail','On hit: 20% chance to stun you.'],
  ['extinctionPulse','Extinction Pulse','Once, below 30% HP: blinds every warrior and regenerates fast for 2 turns.'],
  ['ancientScales','Ancient Scales','10% chance to shrug off a weapon hit entirely.'],
  ['fortitude','Plague-Hardened','Bleeding does not affect it.'],
  ['telegraph','Big Attack','Every few rounds it warns of a big attack, then strikes on its next turn. Stun it to cancel; Taunt redirects most of them.'],
];
function enemyAbilities(enemy){ return ENEMY_ABILITY_INFO.filter(([k])=>enemy[k]).map(([,n,d])=>[n,d]); }

// ─── PATHS AND RELICS ────────────────────────────────────────────────────────
const PATH_ICONS={combat:'⚔',elite:'💀',rest:'🔥',merchant:'🛒',loot:'📦',unknown:'❓',boss:'👑',cursed:'☠'};
const PATH_NAMES={combat:'Combat',elite:'Elite',rest:'Rest',merchant:'Merchant',loot:'Loot',unknown:'Unknown',boss:'Boss',cursed:'Cursed Path'};
const PATH_DESCS={combat:'An enemy emerges.',elite:'A powerful foe. Winning earns a relic.',rest:'A campfire — rest and recover.',merchant:'A merchant with wares.',loot:'A cache to plunder.',unknown:'Unknown dangers.',boss:'⚠ BOSS — face it!',cursed:'A relic now; tougher foes until the next boss.'};
let RELICS_C={};
function relicChipsHtml(c){
  if(!c.relics||!c.relics.length) return '';
  return `<div class="wide"><dt>Relics</dt><dd class="relic-chips">${c.relics.map(k=>{const r=RELICS_C[k]||{name:k,icon:'✨',desc:''};return `<span class="relic-chip" tabindex="0" title="${r.name}: ${r.desc}">${r.icon} ${r.name}</span>`;}).join('')}</dd></div>`;
}

// Paths open to each career (with their career names) and the lores each may learn: sent by the server.
let PATRONS_C={}, CAREER_PATHS_C={}, TRADITION_ACCESS_C={}, MUTATIONS_C={}, DISORDERS_C={}, MUTATORS_C={}, AFFIXES_C={};
function darkHtml(c){
  const muts=(c.mutations||[]).map(k=>{const m=MUTATIONS_C[k]||{label:k,desc:''};return `<span class="chip chip-bad tip" tabindex="0">🧬 ${m.label}<span class="tiptext">${m.desc}</span></span>`;});
  const dis=(c.disorders||[]).map(k=>{const m=DISORDERS_C[k]||{label:k,desc:''};return `<span class="chip chip-bad tip" tabindex="0">🌀 ${m.label}<span class="tiptext">${m.desc}</span></span>`;});
  if(c.patron){ const m=PATRONS_C[c.patron]||{label:c.patron,icon:'☠',desc:''}; muts.unshift(`<span class="chip chip-bad tip patron" tabindex="0">${m.icon} ${m.label}<span class="tiptext">${m.desc}</span></span>`); }
  return {muts,dis,line:`☢ ${c.corruption||0} Corruption · 🌀 ${c.insanity||0}/${insanityLimit(c)} Insanity`};
}
function insanityLimit(c){ return 4+(c.patron==='slaanesh'?-1:0)+Math.max(0,Math.floor((((c.attrs&&c.attrs.wil)||10)-10)/2))+((c.career==='witchhunter'||c.career==='slayer')?1:0); }

// One line of Warhammer flavour for each career's paths (the mechanics follow underneath).
const PATH_FLAVOUR={
  empire:{ defender:'A State Greatsword: two-handed blade, veteran\'s nerve, and a wall the enemy bleeds against.', witchHunter:'A templar of the Order of the Silver Hammer, pistol and torch in hand.', empEngineer:'A graduate of the Imperial Gunnery School, never far from a volley gun or a bomb.', elementalist:'An apprentice of the Bright College, burning with Aqshy.',
    warlord:'An officer of the State Troops who wins fights by leading them.', witchfinder:'A Witchfinder General: judge, jury and executioner.', guildMaster:'A Master Engineer of Nuln: turrets, bombs and the Steam Barrage.', archmage:'A Patriarch of the Colleges of Magic.' },
  bretonnia:{ knightErrant:'A young knight out to prove himself: the lance charge breaks lines.', questingKnight:'A knight who has forsaken the lance to seek the Grail, greatsword blessed by the Lady.', healer:'A Damsel of the Lady, trained in the Grail chapels to heal the faithful.', herrimault:'An outlaw of the greenwood, robbing the rich with poison and smoke.',
    champion:'A Grail Knight, who has drunk from the Grail and fights with the Lady\'s own strength.', myrmidon:'A Paladin of the Realm: armoured, unbreakable, the knight who holds the line.', healer_m:'A Prophetess of the Lady, whose prayers turn back death itself.', abjurer:'An Enchantress, keeper of the Lady\'s wards.' },
  dwarf:{ trollSlayer:'A Dwarf who has sworn the Slayer Oath and seeks a glorious death.', ironbreaker:'A tunnel fighter in gromril armour: nothing gets past.', thunderer:'A Dwarf handgunner. Takes up a handgun and shoots from the back row.', runesmith:'A Runesmith: strikes runes of warding and power instead of casting spells.',
    daemonSlayer:'A Daemon Slayer, the last and greatest of the doomed.', thane:'A Thane of the hold, whose presence steadies the whole warband.', longRifle:'An Ironbeard marksman with a long rifle. One shot, one kill.', runelord:'A Runelord, master of the anvil and its doom.' },
  highelf:{ swordmaster:'A Swordmaster of Hoeth: every enemy miss earns a counter-cut.', sorcerer:'A Mage of Saphery, reading the storms of magic.', whiteLion:'A White Lion of Chrace, axe-wielding bodyguard in a lion\'s pelt.', spellbinder:'A Sword of Hoeth, weaving spells into every swing.',
    archmage:'An Archmage of Saphery, among the greatest wizards in the world.', transmuter:'A Loremaster of Hoeth, master of both blade and elements.', phoenixGuard:'A Phoenix Guard, a silent guardian who has seen their own death.', shadowblade:'A Shadow Warrior of Nagarythe, striking unseen.' },
  woodelf:{ ranger:'A Waystalker of Athel Loren, hunting trespassers in the forest.', wardancer:'A Wardancer of Loec, all blades and acrobatics.', druid:'A Spellsinger, weaving the magic of the wildwood.', assassin:'A Deepwood Scout with poisoned arrows.',
    wayMaster:'A Waywatcher, the finest archer of the Wood Elves.', brute:'A Wild Rider of Kurnous, hunter-god\'s fury in every blow.', spellweaver:'A Spellweaver, mistress of the forest\'s deepest magic.', executioner:'A Shadowdancer, who leaves no survivors.' },
};

// ─── ZONES ────────────────────────────────────────────────────────────────────
// Three regions of ten depths each (Endless loops them). Names come from the server.
let ZONES_C=[];
const zoneIdx=d=>Math.floor(Math.max(0,(d||1)-1)/10)%3;
function zoneOf(gs){ return ZONES_C[zoneIdx(gs&&gs.depth)]||null; }
function placeName(gs){ const z=zoneOf(gs); return z?z.places[Math.max(0,((gs.depth||1)-1))%10]:LOCS[Math.min((gs&&gs.depth)||0,LOCS.length-1)]; }
// Music for each region, chosen from the game's tracks to fit its mood:
// the Drakwald gets the airy explore theme and the brisk battle theme; the
// Undercity the brooding main theme and the fast, bass-heavy second battle theme;
// the Chaos Wastes the slow, sparse defeat theme while exploring and the elite
// and second boss themes in its fights, so everything there feels like a big fight.
const ZONE_TRACKS={
  drakwald: { explore:'music/explore-theme.mp3', battle:'music/battle-theme.mp3',     elite:'music/elite-theme.mp3',      boss:'music/1stboss-theme.mp3' },
  undercity:{ explore:'music/main-theme.mp3',    battle:'music/2ndbattle-theme.mp3',  elite:'music/elite-theme.mp3',      boss:'music/2ndboss-theme.mp3' },
  wastes:   { explore:'music/defeat-theme.mp3',  battle:'music/elite-theme.mp3',      elite:'music/2ndboss-theme.mp3',    boss:'music/final-boss-theme.mp3' },
};
