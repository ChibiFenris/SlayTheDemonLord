'use strict';
// Static game data: careers, paths, spells, enemies, items.
// Pure tables — all rules that use them live in server.js.

const CAREERS = {
  warrior: { label:'State Soldier',    startHp:30, startAttrs:{str:12,agi:10,int:10,wil:10}, armorDef:3, weaponDmg:'1d6',   weaponStr:true,  spellcaster:false },
  rogue:   { label:'Roadwarden',       startHp:20, startAttrs:{str:10,agi:12,int:10,wil:10}, armorDef:0, weaponDmg:'1d6',   weaponStr:false, spellcaster:false },
  wizard:  { label:'Bright Wizard',    startHp:17, startAttrs:{str:10,agi:10,int:12,wil:10}, armorDef:1, weaponDmg:'1d6',   weaponStr:false, weaponIntBased:true,  spellcaster:true,  tradition:'fire' },
  priest:  { label:'Sigmarite Priest', startHp:25, startAttrs:{str:10,agi:10,int:10,wil:12}, armorDef:3, weaponDmg:'1d6',   weaponStr:false, weaponWilBased:true,  spellcaster:true,  tradition:'life' },
};

const NOVICE_PATHS = {
  // ── WARRIOR (State Soldier) ──────────────────────────────────────
  warrior: { hpGain:5, power:0,
             weaponTraining:true,   // +1 boon on all attacks
             catchBreath:true,      // once/combat: heal 1d6+STR
             shieldBash:true,        // active: stun enemy for 1 turn
             taunt:true,             // active: for 2 rounds all enemies attack only you
             bleedOnHit:true,       // passive: every hit causes 1 Bleed
             desc:'Weapon Training: +1 boon on attacks. Catch Breath: 1d6+STR heal (1/combat). Shield Bash: stun enemy 2 turns (1/combat). Taunt: for 2 rounds all enemies attack only you. Every hit causes Bleed.' },

  // ── ROGUE (Roadwarden) ────────────────────────────────────────────
  rogue:   { hpGain:5, power:0,
             trickery:true,         // first hit applies 4 poison, later hits 2
             nimbleRecovery:true,   // once/combat: heal 1d6+AGI
             evasion:true,          // passive: all attackers subtract highest bane d6 from d20
             desc:'Trickery: 4 poison on first hit, 2 on each after. Evasion: 1 bane on all attackers. Nimble Recovery: 1d6+AGI heal (1/combat).' },

  // ── MAGICIAN (Bright Wizard) ──────────────────────────────────────
  magician:{ hpGain:4, power:1,    // +1 Power (extra castings)
             spellRecovery:true,   // once/combat: heal + regain 1 rank-0 casting
             burningSoul:true,     // passive: all fire spells deal +1d6 bonus
             burnOnSpell:true,     // passive: all attack spells apply 1d6 Burn DoT
             desc:'Power 1: extra rank-0 and rank-1 spell slots. Burning Soul: fire spells deal +1d6 if target already burning. Burn on Spell: attack spells apply Burn. Spell Recovery (1/combat).' },

  // ── PRIEST (Sigmarite Priest) ─────────────────────────────────────
  priest:  { hpGain:4, power:1,    // +1 Power (divine castings)
             weaponTraining:true,  // +1 boon on weapon attacks
             sharedRecovery:true,  // once/combat: heal all allies
             holyFervor:true,      // passive: every hit deals 1d3+WIL holy dmg and heals 1d3
             divineFavour:true,    // passive: start each combat with 1 free rank-0 casting
             desc:'Power 1: divine castings. Weapon Training: +1 boon on attacks. Holy Fervor: every weapon hit deals 1d3+WIL holy damage and heals you 1d3. Shared Recovery (1/combat). Divine Favour: free rank-0 at combat start.' },
};

const EXPERT_PATHS = {
  // ── MARTIAL: DEFENDER + FIGHTER ──────────────────────────────────
  defender:    { label:'Fighter',    hpGain:5, power:0,
    levelGains:{ 3:['bulwark','bleedOnHit'], 4:['pacedStrikes','pressTheAdvantage','+1str'], 5:['combatExpertise','weaponAptitude'], 6:['deepBleed','+1str'] },
    desc:'Iron Wall & Wound Stacker. Bulwark: +5 HP and +2 Defence. Bleed on every hit. Paced Strikes: every 2nd hit = 2 Bleed. Press the Advantage: every hit grants 1 boon. Combat Expertise +1d6/hit. Weapon Aptitude +2 to hit. Deep Bleed: doubles all Bleed you apply.' },

  // ── MARTIAL: RAGE ────────────────────────────────────────────────
  // ── MARTIAL: RANGER + SCOUT ───────────────────────────────────────
  ranger:      { label:'Ranger',      hpGain:5, power:0,
    levelGains:{ 3:['quickStep','huntersMark'], 4:['fadePassive','evasion','+1agi'], 5:['skirmish'], 6:['smokeScreen','+1agi'] },
    desc:"Hunter & Ghost. Quick Step +2 Def on miss. Hunter's Mark: first hit marks, +2 dmg vs marked. Fade: Quick Step active = 1 boon. Evasion: attackers subtract highest bane d6 from d20. Skirmish: hits on marked apply 2 poison. Smoke Screen (L6): 3 banes on all enemies for 2 rounds." },

  // ── DIVINE HYBRID: ZEALOT + PALADIN ──────────────────────────────
  paladin:     { label:'Paladin',     hpGain:4, power:1,
    levelGains:{ 3:['holyFervor','divineSmite'], 4:['layOnHands','+1str'], 5:['righteousFury','combatProwess'], 6:['sacredAegis','wrathOfSigmar','+1wil'] },
    desc:'Warrior Priest. Holy Fervor: weapon hits deal 1d3+WIL holy and heal you. Divine Smite +3d6 (2x/combat). Lay on Hands: heal 1d6+WIL (2x). Righteous Fury: kills heal all allies 1d6+WIL. Combat Prowess +1d6/hit. Sacred Aegis: attacker takes 1d6 holy. Wrath of Sigmar: 6d6 holy 1x.' },

  // ── ROGUE: ASSASSIN + THIEF ───────────────────────────────────────
  assassin:    { label:'Assassin',    hpGain:5, power:0,
    levelGains:{ 3:['poisonBlade','shadowOpening'], 4:['venomOnFirstHit','quickHands','+1agi'], 5:['assassination','deadMansHand'], 6:['exploitWeakness','deathblow','+1agi'] },
    desc:"Shadow Killer. Poison Blade: every hit +2 poison stacks. Shadow Opening: first attack extra boon. Venom on First Hit (L4): first hit applies 4 poison stacks. Quick Hands: free item use. Assassination: enemy below 50% HP = +1d6+3 dmg. Dead Man's Hand: kill heals 2d6+AGI. Exploit Weakness: boon vs 5+ stacks. Deathblow: hits apply 2 poison, crits 4." },

  // ── ARCANE: ELEMENTALIST + WIZARD ────────────────────────────────
  elementalist:{ label:'Pyromancer',hpGain:4, power:1,
    levelGains:{ 3:['burningSoul','utilityFocus'], 4:['preparedSpell','+1int'], 5:['burnOnSpell','conflagration'], 6:['metamagic','lingeringMagic','+1int'] },
    desc:'Bright Wizard of the fire wind. Learns Firewall. Burning Soul: +1d6 if target burning. Utility Focus: utility spells +1 round. Prepared Spell: free rank-1 at combat start. Burn on Spell. Conflagration: re-burning resets to max. Metamagic: free cast 1x. Lingering Magic: expiring buffs grant boon.' },

  // ── ARCANE: EVOKER + SORCERER ─────────────────────────────────────
  sorcerer:    { label:'Sorcerer',    hpGain:4, power:1,
    levelGains:{ 3:['arcaneSurge','spellLeech'], 4:['surge','spellRecovery','+1int'], 5:['metamagic','resonance'], 6:['chainReaction','overload','+1int'] },
    desc:'Death & Storm. Arcane Surge: first spell each combat +1d6. Spell Leech: spell kill heals 1d6. Surge (L4): spell kill = regain all rank 0-1 castings. Spell Recovery (L4): restore all rank-0 1x/combat. Metamagic: free cast 1x. Resonance: +1d6 vs burning/bleeding/poisoned. Chain Reaction: 25% lightning fires twice. Overload (L6): 1x/combat next spell casts twice.' },

  // ── ARCANE: WITCH + WARLOCK ───────────────────────────────────────
  warlock:     { label:'Warlock',     hpGain:4, power:1,
    levelGains:{ 3:['curse','evilEye'], 4:['bloodOffering','+1int'], 5:['massHeal','hex'], 6:['darkPact','+1int'] },
    desc:'Chaos Witch. Curse: all attacks vs target +1 boon and +1 dmg until death. Evil Eye: 2 banes for 3 rounds. Blood Offering: lose 1d6 HP to regain all castings. Mass Heal. Hex: +4 dmg to cursed/Evil Eye targets. Dark Pact: lose 1d6 HP, next spell free (no action cost).' },

  // ── ARCANE: CONTROL ──────────────────────────────────────────────
  wizard:      { label:'Illusionist', hpGain:4, power:1,
    levelGains:{ 3:['utilityFocus','preparedSpell'], 4:['glamourVeil','+1int'], 5:['metamagic','misdirection'], 6:['lingeringMagic','+1int'] },
    desc:'Grey Wizard of deceit. Utility Focus: utility spells +1 round. Prepared Spell: free rank-1 at combat start. Glamour Veil (L4): the first attack against you each fight misses. Metamagic: free cast 1x. Misdirection (L5): when an enemy misses you, your next attack spell deals +1d6. Lingering Magic: expiring buffs grant 1 boon.' },

  // ── ARCANE: SPELLBINDER + BERSERKER ──────────────────────────────
  spellbinder: { label:'Spellbinder', hpGain:4, power:1,
    levelGains:{ 3:['flameEdge','arcaneStrike'], 4:['combatProwess','rageTrigger','+1int'], 5:['burningSoul','rage'], 6:['frenzy','+1str'] },
    desc:'Arcane Berserker. Flame Edge: weapon attacks deal fire damage and apply 1 Burn (triggers Burning Soul). Arcane Strike: 4%+4%/INT-mod chance to ignore enemy AC. Combat Prowess +1d6/hit. Rage Trigger: taking damage procs +1d6 boon. Burning Soul: +1d6 if target burning. Rage: after taking damage +1d6 bonus. Frenzy: Rage extends on kills.' },

  // ── DIVINE: HEALER + CLERIC ───────────────────────────────────────
  healer:      { label:'Healer',      hpGain:4, power:1,
    levelGains:{ 3:['massHeal','triage'], 4:['holyFervor','divineFavour','+1wil'], 5:['resurrection','battleMedic'], 6:['sacredGround','+1wil'] },
    desc:'Blessed Healer. Mass Heal. Triage: all allies regen 1d6/round for 2 turns. Holy Fervor: hits deal 1d3+WIL holy and heal you. Divine Favour: refresh all 1x/combat. Resurrection: fatal hit = heal to half HP + 2 boons. Battle Medic: heal ally = heal self 1d6. Sacred Ground: 1d6 regen 2 rounds + 3 boons.' },

  // ── DIVINE: DRUID + ORACLE ────────────────────────────────────────
  druid:       { label:'Druid',       hpGain:4, power:1,
    levelGains:{ 3:['sharedRecovery','natureBond'], 4:['druidFervor','foresight','+1wil'], 5:['massHeal','entangle'], 6:['druidsFury','revelation','+1wil'] },
    desc:'Wild & Wise. Shared Recovery: all allies heal. Nature Bond: immune to poison; melee hitters get 1d6 poison. Druid Fervor (L4): weapon hits deal 4+best(WIL/INT) bonus damage and heal 4+best(WIL/INT) HP. Foresight: bless self/ally next 2 attacks take higher. Mass Heal. Entangle: root 1x. Druids Fury (L6): 1x/combat — 2 rounds of +1d6 dmg, +2 boons, hits apply 2 Bleed. Revelation: curse enemy next 2 attacks take worse.' },

};

const MASTER_PATHS = {
  // ── MARTIAL: TANK ────────────────────────────────────────────────
  myrmidon:    { label:'Sentinel',    hpGain:5, power:0,
    levelGains:{ 7:['shieldwall','shieldBash'], 8:['evasion','bodyguard','+1str'], 9:['toughness','fortressStance'], 10:['perfectDefence','+1str'] },
    desc:'Sentinel — Fortress Guardian. Shieldwall +2 Def. Shield Bash: stun 1 turn. Evasion: bane on attackers. Bodyguard: redirect hit to self. Toughness -1 dmg. Fortress Stance: below 50% extra -1 dmg. Perfect Defence: negate one hit 1x.' },

  // ── MARTIAL: DAMAGE ───────────────────────────────────────────────
  brute:       { label:'Berserker',       hpGain:5, power:0,
    levelGains:{ 7:['relentless','fortitude'], 8:['combatProwess','vengeancePassive','+1str'], 9:['rallyingCry','endure'], 10:['combatExpertise','unstoppable','+1str'] },
    desc:'Berserker — Relentless Force. Relentless (L7): hits +1 dmg, misses +1 to-hit, stacks to 5. Fortitude: immune to Bleed/Poison. Combat Prowess +1d6/hit. Vengeance: ally falls = free attack. Rallying Cry heals all. Endure: if hit would reduce you below 35% HP, halve it instead (1x/rest). Combat Expertise +1d6/hit. Unstoppable (L10): survive death once.' },

  // ── MARTIAL: COMMANDER ────────────────────────────────────────────
  warlord:     { label:'Warlord',     hpGain:5, power:0,
    levelGains:{ 7:['rallyingCry','battleOrders'], 8:['warlordAura','devastatingCharge','+1str'], 9:['sweepingBlow','intercept'], 10:['killingMomentum','+1wil'] },
    desc:'Battlefield Commander. Rallying Cry heals all. Battle Orders: give ally free action. Warlord Aura (L8): all allies +1 boon. Devastating Charge: +1d6 + Prone. Sweeping Blow: hits all enemies 75% dmg. Intercept (L9): 1x/combat, enemy hits trigger damage die reroll take lower. Killing Momentum: kill = free attack.' },

  // ── MARTIAL: LEGEND ───────────────────────────────────────────────
  champion:    { label:'Champion',    hpGain:5, power:0,
    levelGains:{ 7:['quickstrike','inspire'], 8:['holyFervor','markHeretic','+1str'], 9:['unstoppable','warCry'], 10:['weaponMaster','purgeTheWicked','+1agi'] },
    desc:'Living Legend. Quick Strike (L7): round-1 attack hits twice. Inspire: kills give all allies 2 boons. Holy Fervor: hits deal 1d3+WIL holy and heal you. Mark Heretic: hits mark target, attacks vs marked gain +2 boons. Unstoppable. War Cry: all allies +3 ATK and +3 dmg for 2 rounds. Weapon Master (L10): damage rolls can never do less than half max. Purge: marked kill heals all 1d6.' },

  // ── MARTIAL: SHADOW ───────────────────────────────────────────────
  shadowblade: { label:'Shadowblade', hpGain:5, power:0,
    levelGains:{ 7:['phantomStrike','shadowStep'], 8:['evasion','acrobaticRiposte','+1agi'], 9:['bladestorm','vanish'], 10:['swiftFeet','flicker','+1agi'] },
    desc:'Unseen Blade. Phantom Strike: first attack auto-hits. Shadow Step: first attack extra boon. Evasion: attackers subtract bane d6. Acrobatic Riposte: miss = free counter. Bladestorm: 3 attacks. Vanish: kill = enemies bane vs you. Swift Feet: 2 boons on all attacks. Flicker: negate one hit 1x.' },

  // ── MARTIAL: ASSASSIN ─────────────────────────────────────────────
  executioner: { label:'Executioner', hpGain:5, power:0,
    levelGains:{ 7:['deathblow','cleanup'], 8:['poisonBlade','unrelenting','+1agi'], 9:['phantomStrike','deadAim'], 10:['bladestorm','flurryBleed','+1agi'] },
    desc:'No Survivors. Deathblow: crits apply 8 poison. Cleanup: kill = free attack. Poison Blade +2 stacks/hit. Unrelenting: Bladestorm hits gain +1 boon. Phantom Strike: first attack auto-hits. Dead Aim: declare before attack, hit = crit. Bladestorm: 3 attacks. Flurry Bleed: Bladestorm crits apply Bleed.' },

  // ── ARCANE: FIRE + STORM ─────────────────────────────────────────
  transmuter:  { label:'Transmuter',  hpGain:4, power:1,
    levelGains:{ 7:['burningSoul','elementalAttunement'], 8:['ballLightning','+1int'], 9:['overcast','volatileForm'], 10:['catastrophe','overcharge','+1int'] },
    desc:'Alchemist & Storm. Burning Soul +1d6 on burning. Elemental Attunement: spells ×1.25 vs foes with no weakness. Ball Lightning: kills arc 1d6. Overcast +2d6. Volatile Form: first attack spell each combat hits all enemies. Catastrophe: 10d6 all. Overcharge: free cast 1x.' },

  // ── ARCANE: DEATH + CHAOS ────────────────────────────────────────
  necromancer: { label:'Necromancer', hpGain:4, power:1,
    levelGains:{ 7:['lifeDrain'], 8:['metamagic','chaosTouch','+1int'], 9:['spellsurge','undyingHunger'], 10:['uncontrolledPower','+1int'] },
    desc:'Death & Chaos. Life Drain: kill heals 1d4. Metamagic: free cast 1x. Chaos Touch: Metamagic triggers random bonus. Spell Surge: free cast 1x. Undying Hunger: DoT kill = free rank-0. Uncontrolled Power: double dice, take 1d6 backlash.' },

  // ── ARCANE: PROTECTION + BATTLE ──────────────────────────────────
  abjurer:     { label:'Abjurer',     hpGain:4, power:1,
    levelGains:{ 7:['shieldwall','counterspell'], 8:['overcast','doubleCharge','+1int'], 9:['toughness','ward'], 10:['spellsurge','forceOfWill','+1wil'] },
    desc:'Protection & Battle Mage. Shieldwall +2 Def. Counterspell: negate on-hit ability. Overcast +2d6 (twice per combat). Double Charge: Overcast 2x/combat. Toughness -1 dmg. Ward: all allies +1 Def. Spell Surge: free cast. Force of Will: Overcast spells can stun.' },

  // ── ARCANE: SCHOLAR + PINNACLE ───────────────────────────────────
  archmage:    { label:'Archmage',    hpGain:4, power:2,
    levelGains:{ 7:['spellsurge','arcaneMastery'], 8:['utilityFocus','esotericKnowledge','+1int'], 9:['catastrophe','spellEcho'], 10:['metamagic','lingeringMagic','+1int'] },
    desc:'Arcane Pinnacle. +2 Power. Spell Surge: free cast. Arcane Mastery: +1 Power, know all rank-0. Utility Focus: spells last +1 round. Esoteric Knowledge: use scroll without consuming. Catastrophe: 10d6 all. Spell Echo: half-damage echo 1x. Metamagic. Lingering Magic: DoTs doubled.' },

  // ── DIVINE: HEALER + HIGH PRIEST ─────────────────────────────────
  healer_m:    { label:'High Healer', hpGain:4, power:2,
    levelGains:{ 7:['massHeal','overflowingGrace'], 8:['holyFervor','banish','+1wil'], 9:['miracleHeal','protectiveBlessing'], 10:['resurrection','sanctify','+1wil'] },
    desc:'Blessed & Anointed. +2 Power. Mass Heal. Overflowing Grace: Mass Heal removes debuffs. Holy Fervor: hits deal 1d3+WIL holy and heal you. Banish: chaos/undead loses next action 1x. Miracle Heal: full HP restore. Protective Blessing: +2 Def after heal. Resurrection: fatal hit = heal to half HP + 2 boons. Sanctify: killed chaos/undead cannot trigger death abilities.' },

  // ── DIVINE: WAR PRIEST + TEMPLAR ─────────────────────────────────
  chaplain:    { label:'Templar',    hpGain:4, power:1,
    levelGains:{ 7:['rallyingCry','lastRites'], 8:['holyFervor','blessedBlade','+1wil'], 9:['massHeal','vigil'], 10:['divineSmite','holyFire','combatProwess','+1wil'] },
    desc:'Templar — War Priest. Rallying Cry heals all. Last Rites: ally falls, rest heal 1 HP. Holy Fervor: hits deal 1d3+WIL holy and heal you. Blessed Blade: ignore DR vs undead/chaos. Mass Heal. Vigil: full-HP allies 1 boon next attack. Divine Smite +3d6 (2x). Holy Fire: Smite applies Burn. Combat Prowess +1d6/hit.' },

};

const CASTINGS_TABLE = {
  0:  [1, 0, 0, 0],
  1:  [2, 1, 0, 0],
  2:  [3, 2, 1, 0],
  3:  [4, 2, 1, 1],
  4:  [5, 2, 2, 1],
  5:  [6, 3, 2, 2],
  6:  [7, 3, 2, 2],
  7:  [8, 3, 2, 2],
  8:  [9, 3, 3, 2],
  9:  [10,3, 3, 3],
  10: [11,3, 3, 3],
};

const TRADITIONS = {
  fire: {
    elemType:'fire',
    label:'Fire',
    spells:[
      {name:'Flame Missile', rank:0, type:'attack', dmg:'1d6', applyBurn:true, burnDiceOverride:1,
       desc:'Rank 0. 1d6 + INT to one enemy. Burn 1d6 (loses 1 die each round). Fire: ×2 vs Undead.'},
      {name:'Meteor',        rank:1, type:'attack', dmg:'2d6+2', aoe:true, applyBurn:true, burnDiceOverride:2,
       desc:'Rank 1. 2d6+2 + INT to ALL enemies. Burn 2d6 (loses 1 die each round). Fire: ×2 vs Undead.'},
      {name:'Fiery Volley',  rank:1, type:'attack', dmg:'1d6+1', tripleHit:true, applyBurn:true, burnDiceOverride:2,
       desc:'Rank 1. Three missiles at one enemy, each 1d6+1, plus INT once. Burn 2d6 (loses 1 die each round). Fire: ×2 vs Undead.'},
      {name:'Fireball',      rank:2, type:'attack', dmg:'5d6', applyBurn:true, aoe:true,
       desc:'Rank 2. 5d6 + INT to ALL enemies. Burn 2d6 (loses 1 die each round). Fire: ×2 vs Undead.'},
      {name:'Immolate',      rank:3, type:'attack', dmg:'4d6', applyBurn:true, burnDiceOverride:3,
       desc:'Rank 3. 4d6 + INT to one enemy. Burn 3d6 (loses 1 die each round). Fire: ×2 vs Undead.'},
    ]
  },
  life: {
    elemType:'holy',
    label:'Life',
    spells:[
      {name:"Sigmar's Smite",   rank:0, type:'attack', dmg:'1d6',
       desc:"Rank 0. 1d6 + WIL to one enemy. Holy: ×2 vs Chaos."},
      {name:'Minor Healing',    rank:0, type:'heal', dmg:'1d6_wil2',
       desc:'Rank 0. Heal yourself or an ally 1d6 + WIL.'},
      {name:'Cure',             rank:1, type:'utility', dmg:'1d6_wil', cure:true,
       desc:'Rank 1. Clear all debuffs from yourself, then heal 1d6 + WIL.'},
      {name:'Light Healing',    rank:1, type:'heal', dmg:'2d6_wil2',
       desc:'Rank 1. Heal yourself or an ally 2d6 + WIL.'},
      {name:'Moderate Healing', rank:2, type:'heal', dmg:'3d6_wil2',
       desc:'Rank 2. Heal yourself or an ally 3d6 + WIL.'},
      {name:'Vitality Burst',   rank:2, type:'heal', dmg:'2d6_wil2_multi', multiTarget:true,
       desc:'Rank 2. Every living ally heals 2d6 + WIL.'},
      {name:'Major Healing',    rank:3, type:'heal', dmg:'max',
       desc:'Rank 3. Restore yourself or an ally to full HP.'},
    ]
  },
  death: {
    elemType:'dark',
    label:'Death (Necromancy)',
    spells:[
      {name:'Spectral Grasp',   rank:0, type:'attack', dmg:'1d3',
       desc:'Rank 0. 1d3 + INT to one enemy. Dark: ×2 vs Beastmen.'},
      {name:'Grave Grasp',      rank:1, type:'attack', dmg:'1d6', applyChilled:true,
       desc:'Rank 1. 1d6 + INT. Chilled: 1d3 damage and 1 bane per round for 2 rounds. Dark: ×2 vs Beastmen.'},
      {name:'Bone Splinters',   rank:2, type:'attack', dmg:'3d6', boneSplinters:true,
       desc:'Rank 2. 3d6 + INT. If the target is left at 25% HP or less, d20 10+ kills it outright. Dark: ×2 vs Beastmen.'},
      {name:'Cannibalize Magic',rank:3, type:'attack', dmg:'3d6',
       desc:'Rank 3. 3d6 + INT. On a hit you regain one rank-1 casting. Dark: ×2 vs Beastmen.'},
    ]
  },
  shadow: {
    elemType:'dark',
    label:'Shadow',
    spells:[
      {name:'Nightfall Blade',  rank:0, type:'utility', dmg:'0', shadowBlade:true,
       desc:'Rank 0. Your weapon hits deal +1d6 (rolled when cast) for 5 rounds.'},
      {name:'Shadow Dart',      rank:1, type:'attack', dmg:'2d6',
       desc:'Rank 1. 2d6 + INT to one enemy. Dark: ×2 vs Beastmen.'},
      {name:'Shadow Strike',    rank:2, type:'attack', dmg:'2d6', tripleHit:true,
       desc:'Rank 2. Three strikes at one enemy, each 2d6, plus INT once. Dark: ×2 vs Beastmen.'},
      {name:'Enervation',       rank:3, type:'attack', dmg:'0', healthPenalty:20,
       desc:'Rank 3. Target loses 20 max HP for the rest of combat.'},
    ]
  },
  battle: {
    elemType:'arcane',
    label:'Battle',
    spells:[
      {name:'Augmented Attack', rank:0, type:'utility', dmg:'0', dmgBuff:true,
       desc:'Rank 0. Your next weapon hit deals +1d6 (rolled when cast).'},
      {name:'Close Wounds',     rank:1, type:'heal', dmg:'1d6_str2',
       desc:'Rank 1. Heal yourself or an ally 1d6 + STR.'},
      {name:'Mighty Attack',    rank:1, type:'utility', dmg:'2d6extra', mightyAtk:true,
       desc:'Rank 1. Your next weapon hit gets 2 boons and +2d6 damage (rolled when cast).'},
      {name:'Battle Prowess',   rank:3, type:'utility', dmg:'0', battleProwessSpell:true,
       desc:'Rank 3. For 7 rounds your attacks have 1 boon and deal +1d6.'},
    ]
  },
  celestial: {
    elemType:'holy',
    label:'Celestial',
    spells:[
      {name:'Burning Beam',  rank:0, type:'attack', dmg:'1d6', applyBurn:true, burnDiceOverride:1,
       desc:'Rank 0. 1d6 + INT to one enemy. Burn 1d6 (loses 1 die each round). Holy: ×2 vs Chaos.'},
      {name:'Flash',         rank:1, type:'attack', dmg:'0', blind:true, applyBlinded:true, aoe:true,
       desc:'Rank 1. Blinds the target: 3 banes on its attacks until it misses.'},
      {name:'Sunrays',       rank:2, type:'attack', dmg:'1d6', tripleHit:true,
       desc:'Rank 2. Three beams at one enemy, each 1d6, plus INT once. Holy: ×2 vs Chaos.'},
      {name:'Radiation',     rank:3, type:'attack', dmg:'3d6', applyBlinded:true,
       desc:'Rank 3. 3d6 + WIL to one enemy and Blinds it (3 banes until it misses). Holy: ×2 vs Chaos.'},
    ]
  },
  chaos: {
    elemType:'arcane',
    label:'Chaos',
    spells:[
      {name:'Erratic Bolt',          rank:0, type:'attack', dmg:'1d6', chaosBolt:true,
       desc:'Rank 0. 1d6 + INT. Roll d20: on 12+ deal 2d6 extra. Arcane: ×1.25 vs Skaven, Chaos, Undead, Beastmen.'},
      {name:'Capricious Devastation',rank:1, type:'attack', dmg:'2d6', chaosBolt:true,
       desc:'Rank 1. 2d6 + INT. Roll d20: on 12+ deal 2d6 extra. Arcane: ×1.25 vs Skaven, Chaos, Undead, Beastmen.'},
      {name:'Color of Magic',        rank:2, type:'attack', dmg:'1d6+2', chaosBolt:true,
       desc:'Rank 2. 1d6+2 + INT. Roll d20: on 12+ deal 2d6 extra. Arcane: ×1.25 vs Skaven, Chaos, Undead, Beastmen.'},
      {name:'Chaotic Lance',         rank:3, type:'attack', dmg:'4d6', chaosBolt:true, aoe:true,
       desc:'Rank 3. 4d6 + INT to ALL enemies. Roll d20: on 12+ your target takes 2d6 extra. Arcane: ×1.25 vs Skaven, Chaos, Undead, Beastmen.'},
    ]
  },
  earth: {
    elemType:'arcane',
    label:'Earth',
    spells:[
      {name:'Earth Spike',   rank:0, type:'attack', dmg:'1d6', prone:true, applyBleed:true,
       desc:'Rank 0. 1d6 + INT. Knocks the target Prone (1 bane until it misses) and applies 1 Bleed. Arcane: ×1.25 vs Skaven, Chaos, Undead, Beastmen.'},
      {name:'Stone Blades',  rank:1, type:'attack', dmg:'2d6', bleed:true, applyBleed:true, aoe:true,
       desc:'Rank 1. 2d6 + INT to ALL enemies and 1 Bleed on each. Arcane: ×1.25 vs Skaven, Chaos, Undead, Beastmen.'},
      {name:'Avalanche',     rank:2, type:'attack', dmg:'4d6', applyMajorBleed:true, aoe:true,
       desc:'Rank 2. 4d6 + INT to ALL enemies and 2 Bleed on each. Arcane: ×1.25 vs Skaven, Chaos, Undead, Beastmen.'},
      {name:'Eruption',      rank:3, type:'attack', dmg:'5d6', applyMajorBleed:true, aoe:true,
       desc:'Rank 3. 5d6 + INT to ALL enemies and 2 Bleed on each. Arcane: ×1.25 vs Skaven, Chaos, Undead, Beastmen.'},
    ]
  },
  storm: {
    elemType:'lightning',
    label:'Storm',
    spells:[
      {name:'Forked Lightning', rank:0, type:'attack', dmg:'1d6+2', tripleHit:false, doubleHit:true,
       desc:'Rank 0. Hits one enemy twice, each 1d6+2, plus INT once. Lightning: ×2 vs Skaven.'},
      {name:'Freezing Fog',    rank:1, type:'attack', dmg:'1d3', slowDebuff:true, applyChilled:true,
       desc:'Rank 1. 1d3 + INT. Chilled (1d3 damage and 1 bane per round, 2 rounds) and Slowed (+1 bane, 2 rounds). Lightning: ×2 vs Skaven.'},
      {name:'Call Lightning',  rank:2, type:'attack', dmg:'3d6+5', stunCheck:true,
       desc:'Rank 2. 3d6+5 + INT. Roll d20: on 15+ the target is Stunned for 2 turns. Lightning: ×2 vs Skaven.'},
      {name:'Lightning Bolt',  rank:3, type:'attack', dmg:'5d6', lightningDoubleCheck:true,
       desc:'Rank 3. 5d6 + INT. Roll d20: on 15+ it strikes again for the same damage. Lightning: ×2 vs Skaven.'},
    ]
  },
  protection: {
    elemType:'arcane',
    label:'Protection',
    spells:[
      {name:'Force Field',      rank:0, type:'utility', dmg:'0', forceFieldNew:true,
       desc:'Rank 0. You take 35% less damage for 2 rounds.'},
      {name:'Sanctuary',        rank:1, type:'utility', dmg:'0', sanctuaryNew:true,
       desc:'Rank 1. All allies take 35% less damage for 2 rounds.'},
      {name:'Vigor',            rank:2, type:'utility', dmg:'0', vigorNew:true,
       desc:'Rank 2. +10 max HP and heal 10, until combat ends.'},
      {name:'Protective Field', rank:3, type:'utility', dmg:'0', protectiveFieldNew:true,
       desc:'Rank 3. All allies are immune to damage this round.'},
    ]
  },
  illusion: {
    elemType:'arcane',
    label:'Illusion',
    spells:[
      {name:'Figment',   rank:0, type:'utility', dmg:'0', figmentNew:true,
       desc:'Rank 0. One enemy attacks with 1 bane until it misses.'},
      {name:'Vertigo',   rank:1, type:'utility', dmg:'0', vertigoNew:true,
       desc:'Rank 1. Your next attack has 2 boons.'},
      {name:'Glamer',    rank:2, type:'utility', dmg:'0', glamerNew:true,
       desc:'Rank 2. Target enemy loses its next action.'},
      {name:'Phantasm',  rank:3, type:'attack', dmg:'4d6',
       desc:'Rank 3. 4d6 + INT psychic damage to one enemy. Arcane: ×1.25 vs Skaven, Chaos, Undead, Beastmen.'},
    ]
  },
  nature: {
    elemType:'arcane',
    label:'Nature',
    spells:[
      {name:'Oak Hide',        rank:0, type:'utility', dmg:'0', defBonus:2,
       desc:'Rank 0. +2 Defence for 3 rounds.'},
      {name:'Healing Berries', rank:1, type:'heal', dmg:'berries',
       desc:'Rank 1. Heal yourself or an ally 1d3 + WIL, three times.'},
      {name:'Shillelagh',      rank:1, type:'utility', dmg:'0', dmgBuff:true,
       desc:'Rank 1. Your next weapon hit deals +1d6 (rolled when cast).'},
      {name:'Wrath of Nature', rank:3, type:'attack', dmg:'3d6', wrathNature:true,
       desc:'Rank 3. 3d6 + INT. Vines give the target 2 banes for 3 rounds. Arcane: ×1.25 vs Skaven, Chaos, Undead, Beastmen.'},
    ]
  },
  transformation: {
    elemType:'arcane',
    label:'Transformation',
    spells:[
      {name:'Beast Within', rank:0, type:'utility', dmg:'0', dmgBuff:true,
       desc:'Rank 0. Your next weapon hit deals +1d6 (rolled when cast).'},
      {name:'Dire Beast',   rank:1, type:'utility', dmg:'0', direBeast:true,
       desc:'Rank 1. Your weapon hits deal +1d6 (rolled when cast) for 5 rounds.'},
      {name:'Mist Form',    rank:2, type:'utility', dmg:'0', mistFormNew:true,
       desc:'Rank 2. You take 35% less damage for 3 rounds.'},
      {name:'Speed Healing',rank:3, type:'heal', dmg:'3d6_wil2',
       desc:'Rank 3. Heal yourself or an ally 3d6 + WIL.'},
    ]
  },
  time: {
    elemType:'arcane',
    label:'Time',
    spells:[
      {name:'Swiftness',       rank:0, type:'utility', dmg:'0', swiftnessNew:true,
       desc:'Rank 0. +1 boon on all your attacks for 3 rounds.'},
      {name:'Rewrite Moment',  rank:1, type:'utility', dmg:'0', rewriteNew:true,
       desc:'Rank 1. For 3 rounds, a missed weapon attack is rerolled once.'},
      {name:'Minor Paradox',   rank:2, type:'utility', dmg:'0', minorParadoxNew:true,
       desc:'Rank 2. Regain one casting of each rank 0–2.'},
      {name:'Precognition',    rank:3, type:'utility', dmg:'0', precognitionNew:true,
       desc:'Rank 3. For 3 rounds: 2 boons on your attacks and +4 Defence.'},
    ]
  },
};

const ENEMY_POOLS = {
  // Each enemy has ONE signature mechanic (see "ENEMY SIGNATURE MECHANICS" in server.js).
  low: [
    {name:'Skaven Clanrat',  type:'Skaven',  threat:'Low', hp:13,ac:11,atk:1,xp:1,gold:[2,8],  tags:['skaven'],
     packInstinct:true, hideBehind:true},
    {name:'Beastman Gor',    type:'Beastmen',threat:'Low', hp:16,ac:12,atk:2,xp:1,gold:[3,10], tags:['beast'],
     recklessCharge:true, bloodOnHit:true, gore:true},
    {name:'Undead Skeleton', type:'Undead',  threat:'Low', hp:18,ac:10,atk:1,xp:1,gold:[0,5],  tags:['undead'],undead:true,
     undying:true, weakToBlunt:true, stunImmune:true, shieldWall:true},
    {name:'Mutant Thug',     type:'Mutant',  threat:'Low', hp:12,ac:12,atk:2,xp:1,gold:[5,15], tags:['chaos'],chaos:true,
     mutation:true},
    {name:'Ghoul',           type:'Corpse-eater',threat:'Low', hp:15,ac:12,atk:2,xp:1,gold:[2,8], tags:['undead'],
     paralysingClaws:true, carrionFeast:true},
    {name:'Zombie',          type:'Undead',  threat:'Low', hp:13,ac:9, atk:0,xp:1,gold:[0,4],  tags:['undead'],undead:true,
     horde:true, shambling:true, rotFeast:true},
    {name:'Pox Rat Swarm',   type:'Vermin',  threat:'Low', hp:10,ac:10,atk:1,xp:1,gold:[0,3],  tags:['vermin'],
     swarm:true},
    {name:'Ungor Skirmisher',type:'Beastmen',threat:'Low', hp:12,ac:13,atk:2,xp:1,gold:[2,8],  tags:['beast'],
     skirmisher:true},
  ],
  mid: [
    {name:'Chaos Marauder',    type:'Chaos',  threat:'Moderate',hp:36,ac:13,atk:3,xp:2,gold:[10,25],tags:['chaos'],chaos:true,
     battleFury:true},
    {name:'Skaven Stormvermin',type:'Skaven', threat:'Moderate',hp:29,ac:16,atk:3,xp:2,gold:[8,20], tags:['skaven'],
     skavenDiscipline:true, halberdGuard:true, callsPack:true},
    {name:'Wight',             type:'Undead', threat:'Moderate',hp:34,ac:12,atk:3,xp:2,gold:[5,15], tags:['undead'],undead:true,
     barrowChill:true},
    {name:'Plague Monk',       type:'Skaven', threat:'Moderate',hp:27,ac:13,atk:3,xp:2,gold:[5,15], tags:['chaos'],chaos:true,
     virulentBlade:true, plagueFrenzy:true, deathCloud:true},
    {name:'Blue Horror',       type:'Daemon', threat:'Moderate',hp:24,ac:12,atk:2,xp:2,gold:[5,15], tags:['chaos'],chaos:true,
     splitOnDeath:true},
    {name:'Gutter Runner',     type:'Skaven', threat:'Moderate',hp:22,ac:15,atk:3,xp:2,gold:[10,25],tags:['skaven'],
     assassinTarget:true, vanish:true},
    {name:'Nurgle Cultist',    type:'Cultist',threat:'Moderate',hp:26,ac:11,atk:2,xp:2,gold:[5,20], tags:['chaos'],chaos:true,
     sacrifice:true, pestilentCall:true},
    {name:'Banshee',           type:'Undead', threat:'Moderate',hp:28,ac:13,atk:2,xp:2,gold:[5,15], tags:['undead'],undead:true,
     wail:true, ethereal:true},
    {name:'Plague Rat Lord',   type:'Skaven', threat:'Moderate',hp:30,ac:14,atk:3,xp:2,gold:[10,25],tags:['skaven'],
     ratLord:true},
  ],
  high: [
    {name:'Chaos Warrior',  type:'Chaos',  threat:'High',hp:63,ac:16,atk:4,xp:4,gold:[15,40],tags:['chaos'],chaos:true,
     damageReduction:2, cleaveSpill:true},
    {name:'Vampire Count', type:'Undead', threat:'High',hp:50,ac:14,atk:4,xp:4,gold:[20,60],tags:['undead'],undead:true,lifeLeech:true,
     lifeLeechFrac:0.5, mistForm:true, dominate:true},
    {name:'Bloodletter',   type:'Daemon', threat:'High',hp:55,ac:15,atk:4,xp:4,gold:[25,50],tags:['chaos'],chaos:true,
     hellblade:true, bloodOnHit:true, bloodTithe:true},
    {name:'Skaven Warlord',type:'Skaven', threat:'High',hp:53,ac:13,atk:3,xp:4,gold:[10,30],tags:['skaven'],
     warlordCommand:true, scurryAway:true, coward:true},
    {name:'Minotaur',      type:'Beastmen',threat:'High',hp:66,ac:14,atk:4,xp:4,gold:[15,40],tags:['beast'],
     bullCharge:true, bloodgreedKill:true},
    {name:'River Troll',   type:'Troll',  threat:'High',hp:75,ac:12,atk:3,xp:4,gold:[10,30],tags:['fire-weak'],
     trollRegen:true, trollVomit:true},
    {name:'Ratling Gun Team',type:'Skaven',threat:'High',hp:46,ac:13,atk:3,xp:4,gold:[15,35],tags:['skaven'],
     ratlingGun:true},
    {name:'Warlock Engineer',type:'Skaven',threat:'High',hp:44,ac:13,atk:3,xp:4,gold:[20,40],tags:['skaven'],
     warpLightning:true},
  ],
  // Bosses telegraph a big attack a round ahead: stun them, Taunt, or heal up in time.
  boss1: [
    {name:'Skaven Warlord Gnashteeth',type:'Skaven Boss', threat:'Boss',hp:68,ac:14,atk:2,xp:5,gold:[30,80], tags:['skaven'],
     skavencunning:true, seethingRage:true, packBoss:true, telegraph:'warpGas'},
    {name:'Beastlord Kragthor',       type:'Beastmen Boss',threat:'Boss',hp:72,ac:14,atk:2,xp:5,gold:[25,70], tags:['beast'],
     stampede:true, bloodlust:true, belowRoar:true, telegraph:'goreCharge'},
  ],
  boss2: [
    {name:'Varghulf',            type:'Undead Boss', threat:'Boss',hp:115,ac:15,atk:4,xp:5,gold:[200,200],tags:['undead'],undead:true,lifeLeech:true,
     lifeLeechFrac:0.25, frenzyMulti:{threshold:0.5}, critMajorBleed:true, telegraph:'leap'},
    {name:'Bonebreaker Ratogre', type:'Skaven Boss', threat:'Boss',hp:105,ac:16,atk:3,xp:5,gold:[200,200],tags:['skaven'],insanityAtk:true,
     packLeader:true, skavenPackTactics:true, telegraph:'slam'},
  ],
  boss3: [
    {name:'Saurian Ancient',type:'Ancient Boss',threat:'Boss',hp:200,ac:15,atk:5,xp:5,gold:[60,150],tags:['fire-weak'],
     regen:true, primordialRoar:true, crushingTail:true, extinctionPulse:true, ancientScales:true, telegraph:'stomp'},
  ],
};

// Enemies that only ever appear as summons.
const SUMMONS = {
  clanrat:   {name:'Skaven Clanrat', type:'Skaven', threat:'Low', hp:13,ac:11,atk:0,xp:0,gold:[0,0], tags:['skaven'], packInstinct:true},
  poxRats:   {name:'Pox Rat Swarm',  type:'Vermin', threat:'Low', hp:10,ac:10,atk:1,xp:0,gold:[0,0], tags:['vermin'], swarm:true},
  brimstone: {name:'Brimstone Horror',type:'Daemon',threat:'Low', hp:7, ac:11,atk:1,xp:0,gold:[0,0], tags:['chaos'], chaos:true},
};


const XP_THRESHOLDS = [0,0,2,10,19,24,29,34,51,68,84]; // Lv3@depth8, Lv4@depth11, Lv7@depth17, Lv10@depth27 // Lv3@boss1(~18xp), Lv7@boss2(~52xp), Lv10@end

const POISON_CAP = 15; // max poison stacks on one enemy

const NODE_TYPES = ['combat','combat','rest','merchant','loot','elite','unknown','unknown'];

const SCROLL_SPELLS_LIST = [
  {name:'Fireball',          desc:'8d6 fire dmg to one target',                type:'attack', dmgDice:'8d6'},
  {name:'Smite',             desc:'4d6 holy dmg',                              type:'attack', dmgDice:'4d6'},
  {name:'Chain Lightning',   desc:'6d6 lightning to all enemies',              type:'attack', dmgDice:'6d6', allTargets:true},
  {name:"Sigmar's Wrath",    desc:'5d6 holy dmg, ×2 vs undead/chaos',         type:'attack', dmgDice:'5d6', holyBonus:true},
  {name:'Cure Wounds',       desc:'Heal 3d6+4 HP',                             type:'heal',   dmgDice:'3d6'},
  {name:'Winds of Death',    desc:'4d6 dmg to all enemies, kills restore 1d6 HP to random ally', type:'attack', dmgDice:'4d6', allTargets:true, deathWind:true},
  {name:"Shallya's Touch",   desc:'Remove all debuffs from one ally, heal 3d6+WIL HP',           type:'heal',   dmgDice:'3d6', cleanse:true},
  {name:'Arcane Bolt Storm', desc:'2d6 dmg to all enemies, crits stun',                          type:'attack', dmgDice:'2d6', allTargets:true, boltStorm:true},
  {name:'Veil of Shadows',   desc:'All enemies have 2 banes this round',                         type:'utility', dmgDice:'0d0', veilShadows:true},
  {name:'Earthshatter',      desc:'5d6 dmg, target Prone 2 rounds, ×1.5 vs heavy armour',        type:'attack', dmgDice:'5d6', earthshatter:true},
  {name:'Daemonsbane',       desc:'8d6 holy dmg, ×2 vs Chaos and Undead',                        type:'attack', dmgDice:'8d6', holyBonus:true, daemonBonus:true},
  {name:'Wall of Faith',     desc:'All allies +3 Defense and 1 boon for 3 rounds',               type:'utility', dmgDice:'0d0', wallFaith:true},
  {name:'Bone Prison',       desc:'One enemy loses their next turn (Stunned)',                    type:'utility', dmgDice:'0d0', bonePrison:true},
];

const LOOT_CONS_LIST=['Healing Draught','Greater Healing Draught','Incendiary Flask','Daemon Fire','Lucky Pendant','Sharpening Stone','Antitoxin','Smoke Bomb',
  'Troll Blood','Dwarf Ale','Warpstone Dust','Black Lotus Oil','Holy Water','Hellfire Bomb','Fly Agaric'];

const WEAPON_BASES=[
  {name:'Reiklander Sword', dice:'1d6', stat:'str', dmgType:'slashing', special:{key:'bladeguard',  desc:'Passive: +1 Defense while equipped. Blade catches enemy weapons — lost if you are stunned.'}},
  {name:'War Axe',          dice:'2d6', stat:'str', dmgType:'slashing', special:{key:'cleave',      desc:'Active: killing an enemy arms a cleave — your next attack this round deals +1d6 damage.'}},
  {name:'Halberd',          dice:'2d6', stat:'str', dmgType:'slashing', special:{key:'reach',       desc:'Passive: +1 boon on round 1 attacks. Your reach means charging enemies cannot use Reckless Charge vs you.'}},
  {name:'Duelling Sabre',   dice:'1d6', stat:'agi', dmgType:'slashing', special:{key:'riposte',     desc:'Active: when an enemy misses you, immediately make one free counterattack with 1 boon (once/round).'}},
  {name:'Silvered Rapier',  dice:'1d6', stat:'agi', dmgType:'slashing', special:{key:'silverEdge',  desc:'Passive: blessed silver edge — all attacks ignore damage reduction on undead enemies.'}},
  {name:'Runestaff',        dice:'1d6', stat:'int', dmgType:'slashing', special:{key:'arcaneFocus', desc:'Passive: rank 0 spells deal +INT mod bonus damage. Missing with a weapon attack gives 1 boon on your next spell.'}},
  {name:'Engraved Blade',   dice:'2d6', stat:'int', dmgType:'slashing', special:{key:'spellblade',  desc:'Active (1/combat): channel a rank-0 spell into a weapon strike — deals weapon damage and spell damage simultaneously.'}},
  {name:"Sigmar's Mace",    dice:'1d6', stat:'wil', dmgType:'slashing', special:{key:'blessedStrike',desc:"Passive: Sigmar's blessing — +1d6 bonus damage vs undead and Chaos. These attacks always ignore enemy damage reduction."}},
  {name:'Consecrated Blade',dice:'2d6', stat:'wil', dmgType:'slashing', special:{key:'smiteTheFallen',desc:'Active (1/combat): after landing a hit, expend 1 spell casting to add 3d6 holy bonus damage to that strike.'}},
  {name:'Warhammer',        dice:'2d6', stat:'str', dmgType:'blunt',    special:{key:'sunder',      desc:'Active: on a crit, the crushing blow cracks enemy armour — target loses 2 AC for the rest of combat.'}},
  {name:'Pistol',           dice:'1d6', stat:'agi', dmgType:'blunt',    special:{key:'openingShot', desc:'Active: your round-1 shot has 2 boons and ignores damage reduction. Spend the next round reloading.'}},
  {name:'Crossbow',         dice:'1d6', stat:'agi', dmgType:'blunt',    special:{key:'marksmanship',desc:'Passive: 1 boon on all round-1 attacks. On a crit, the bolt pins the target — 1 bane on their next attack.'}},
  {name:'Alchemical Rod',   dice:'1d6', stat:'int', dmgType:'blunt',    special:{key:'unstableCharge',desc:'Passive: on a crit, the unstable charge detonates — target takes 1d6 acid damage at the start of their next turn.'}},
  {name:'Arcane Hammer',    dice:'2d6', stat:'int', dmgType:'blunt',    special:{key:'runeStrike',  desc:'Active (1/combat): overcharge the rune — next hit ignores all enemy damage reduction and defensive buff bonuses.'}},
  {name:'Blessed Staff',    dice:'1d6', stat:'wil', dmgType:'blunt',    special:{key:'channelFaith',desc:'Passive: divine focus — adds your WIL modifier to all healing spells cast with this staff.'}},
  {name:'War Censer',       dice:'2d6', stat:'wil', dmgType:'blunt',    special:{key:'holySmoke',   desc:'Passive: burning incense coats each hit with 1 poison stack from the sacred fumes.'}},
  {name:'Paired Daggers',dice:'2d4',stat:'agi',dmgType:'slashing',special:{key:'twinBlades',desc:'Passive: two quick blades — you crit on 19–20.'}},
  {name:'Greatsword',   dice:'3d6',stat:'str',dmgType:'slashing',special:{key:'greatBlade',desc:'Passive: a huge two-handed blade — −1 Defence while equipped.'}},
  {name:'Flail',        dice:'2d6',stat:'str',dmgType:'blunt',   special:{key:'flailSwing',desc:'Passive: +2 to hit against Defence 15 or higher. On a fumble the head swings back — you take 1d6.'}},
  {name:'Longbow',      dice:'1d8',stat:'agi',dmgType:'slashing',special:{key:'longbow',   desc:'Passive: 1 boon on round-1 attacks; 1 bane if you were hit since your last turn.'}}
];

const ARMOR_BASES=[
  {name:'Leather Jack',      def:1, special:null},
  {name:'Chain Shirt',       def:2, special:null},
  {name:'Breastplate',       def:3, special:null},
  {name:'Full Plate',        def:4, special:null},
  {name:'Shadowweave Cloak', def:2, special:{key:'lastTarget',  desc:'Passive: your shadowy movement draws less attention — enemies always attack other allies before you.'}},
  {name:'Wardstone Pauldrons',def:3,special:{key:'chaosWard',   desc:'Passive: warded against corruption — -2 damage from all Chaos enemies. +1 boon on WIL checks vs Chaos.'}},
  {name:'Gromril Plate',     def:5, special:{key:'dwarfForged', desc:'Passive: Gromril is the hardest metal in the world — cannot be stunned more than once per combat. -1 to all incoming damage.'}},
  {name:'Runebonded Hauberk',def:3, special:{key:'spellbound',  desc:'Passive: arcane binding in the armour — gain 1 free rank-1 casting per combat. Rank-0 spells gain +1 casting.'}},
  {name:'Beastpelt Mantle',  def:1, special:{key:'bloodscent',  desc:'Passive: the scent of your blood drives the warband to fury — when you fall below 25% HP, all allies gain 1 boon on their next attack.'}},
  {name:'Flagellant Tabard', def:1, special:{key:'righteousSuffering', desc:'Passive: pain fuels the strike — after taking 5+ damage in one hit, your next attack deals +1d6 bonus damage.'}},
  {name:'Dragonscale Vest',  def:4, special:{key:'fireImmune',  desc:'Passive: dragonscale absorbs flame — immune to all fire damage. Your fire-element attacks and items deal +1d6 bonus damage.'}},
  {name:'Verminplate Coif',  def:4, special:{key:'packScorn',   desc:'Passive: carved from a Skaven warlord — Skaven attackers have 1 bane vs you. Each Skaven you kill restores 1 HP.'}},
  {name:'Kite Shield',      def:2,special:{key:'shieldBlock',desc:'Passive: blocks the first hit against you each fight.'}},
  {name:'Witch-Hunter Coat',def:2,special:{key:'witchCoat',  desc:'Passive: immune to Insanity. +1 boon on attacks against Chaos.'}}
];

const LEGENDARY_ITEMS = {
  boss1: [
    {
      id:'leg', name:'Warpstone Gauntlet', type:'weapon', dice:'2d6', stat:'str', bonus:4,
      dmgType:'blunt', legendary:true,
      special:{key:'warpstoneGauntlet', desc:'Legendary: kills grant +1 STR (stacks to +3, resets between combats).'},
      desc:"2d6+4 · STR · blunt — Legendary. Kills grant +1 STR (max +3, resets per combat).",
    },
    {
      id:'leg', name:"Gnashteeth's Fang", type:'weapon', dice:'2d6', stat:'agi', bonus:4,
      dmgType:'slashing', legendary:true,
      special:{key:'venomFang', desc:'Legendary: every hit applies 2 poison stacks. On kill, gain 1 boon on your next attack this round.'},
      desc:"2d6+4 · AGI · slashing — Legendary. Every hit: 3 poison stacks. Kill: 1 boon on your next attack.",
    },
    {
      id:'leg', name:"Kragthor's Warplate", type:'armor', defBonus:7, legendary:true,
      special:{key:'berserkPlate', desc:'Legendary: when you fall below 50% HP, gain +2 ATK bonus permanently for this combat. Triggers once.'},
      desc:"+7 Defense — Legendary. Below 50% HP: +2 ATK bonus for this combat.",
    },
    {
      id:'leg', name:'Ratking Crown', type:'armor', defBonus:6, legendary:true,
      special:{key:'ratkingCrown', desc:'Legendary: Skaven enemies have 2 banes on all attacks against you. You gain +1 boon on ALL attacks. Additionally +1 boon vs Skaven.'},
      desc:"+6 Defense — Legendary. Skaven have 2 banes vs you. +1 boon on all attacks (+1 more vs Skaven).",
    },
    {
      id:'leg', name:'Beastlord Maul', type:'weapon', dice:'3d6', stat:'str', bonus:5,
      dmgType:'blunt', legendary:true,
      special:{key:'beastlordMaul', desc:'Legendary: on crit, deal +2d6 bonus and the target is Stunned (loses next action). Once per combat.'},
      desc:"3d6+5 · STR · blunt — Legendary. Crit: +2d6 bonus and Stun target (once/combat).",
    },
  ],
  boss2: [
    {
      id:'leg', name:"Varghulf's Talon", type:'weapon', dice:'3d6', stat:'str', bonus:5,
      dmgType:'slashing', legendary:true,
      special:{key:'varghulfTalon', desc:'Legendary: steal ¼ of all damage dealt as HP (life leech). On kill, fully heal yourself.'},
      desc:"3d6+5 · STR · slashing — Legendary. Leech ¼ dmg as HP. Kill: full heal.",
    },
    {
      id:'leg', name:'Shroud of Undeath', type:'armor', defBonus:7, legendary:true,
      special:{key:'shroudUndeath', desc:'Legendary: when you die, you rise at 1d6 HP once per combat. While at or below 25% HP, enemies have 1 bane vs you.'},
      desc:"+7 Defense — Legendary. Rise at 1d6 HP once on death. Below 25%: enemies have 1 bane vs you.",
    },
    {
      id:'leg', name:'Ratogre Chainbreaker', type:'weapon', dice:'3d6', stat:'str', bonus:6,
      dmgType:'blunt', legendary:true,
      special:{key:'chainbreaker', desc:'Legendary: ignore all enemy damage reduction. Critical hits knock the target Prone (loses next action).'},
      desc:"3d6+6 · STR · blunt — Legendary. Crits knock the target Prone (it loses its next action).",
    },
    {
      id:'leg', name:"Blood Drinker's Plate", type:'armor', defBonus:8, legendary:true,
      special:{key:'bloodDrinker', desc:'Legendary: after each enemy turn, if any ally was hit this round, you heal 1d6 HP.'},
      desc:"+8 Defense — Legendary. After each enemy turn where an ally was hit, heal 1d6 HP.",
    },
  ],
  boss3: [
    {
      id:'leg', name:'Sunstone Blade', type:'weapon', dice:'3d6', stat:'int', bonus:6,
      dmgType:'slashing', legendary:true,
      special:{key:'sunstoneBlade', desc:'Legendary: on hit, deals additional +INT mod fire damage. On crit, also burns all other enemies for 1d6 fire.'},
      desc:"3d6+6 · INT · slashing — Legendary. +INT mod fire on hit. Crit: 1d6 fire splash to all enemies.",
    },
    {
      id:'leg', name:'Scale of the Ancient', type:'armor', defBonus:9, legendary:true,
      special:{key:'ancientScale', desc:'Legendary: immune to fire damage. All incoming damage reduced by 2. Once per combat, negate one hit entirely.'},
      desc:"+9 Defense — Legendary. Negates the first damaging hit each combat. Immune to Crushing Blow stuns.",
    },
    {
      id:'leg', name:"Primordial Staff", type:'weapon', dice:'3d6', stat:'int', bonus:6,
      dmgType:'blunt', legendary:true,
      special:{key:'primordialStaff', desc:'Legendary: rank 0 spells deal double damage. Rank 1 spells gain +3 castings per combat.'},
      desc:"3d6+6 · INT · blunt — Legendary. Rank 0 spells deal ×2 dmg. Rank 1 spells +3 castings.",
    },
    {
      id:'leg', name:'Extinction Aegis', type:'armor', defBonus:8, legendary:true,
      special:{key:'extinctionAegis', desc:'Legendary: all allies within the warband gain +2 Defense while you are alive. You cannot be stunned.'},
      desc:"+8 Defense — Legendary. All allies +2 Defense while you live. Cannot be stunned.",
    },
    {
      id:'leg', name:'Primordial Talisman', type:'armor', defBonus:7, legendary:true,
      special:{key:'primordialTalisman', desc:'Legendary: once per combat, absorb one attack completely and convert 50% of its damage into HP instead.'},
      desc:"+7 Defense — Legendary. Once per combat: absorb one attack, heal for 50% of its damage.",
    },
  ],
};

const SHOP_CONSUMABLES=[
  {name:'Healing Draught',        desc:'Heal 1d6 HP',cost:12},
  {name:'Greater Healing Draught',desc:'Heal 2d6 HP',cost:22},
  {name:'Incendiary Flask',       desc:'2d6 fire dmg',cost:17},
  {name:'Daemon Fire',            desc:'3d6 fire dmg',cost:27},
  {name:'Lucky Pendant',          desc:'Next attack = crit',cost:40},
  {name:'Sharpening Stone',       desc:'+1d6 damage on hits this combat',cost:40},
  {name:'Antitoxin',              desc:'Clear all your poison stacks',cost:18},
  {name:'Smoke Bomb',             desc:'All enemies attack with 2 banes this round',cost:20},
  {name:"Sigmar's Token",         desc:'Heal 1d6+3 HP and remove one debuff',cost:30},
  {name:'Troll Blood',     desc:'Regenerate 3 HP a round for 3 rounds, but −2 Defence meanwhile', cost:24},
  {name:'Dwarf Ale',       desc:'Heal 2d6 HP, but 1 bane on your next attack', cost:16},
  {name:'Warpstone Dust',  desc:'+2 damage for the rest of the fight, and you gain 1 Corruption', cost:22},
  {name:'Black Lotus Oil', desc:'Your next 3 weapon hits each add 3 poison', cost:26},
  {name:'Holy Water',      desc:'3d6 holy damage to an undead or daemonic target', cost:20},
  {name:'Hellfire Bomb',   desc:'4d6 fire to every enemy — and 1d6 to you', cost:34},
  {name:'Fly Agaric',      desc:'Your next spell costs no casting and deals +1d6, but you take 1d4', cost:20}
];

const SCROLL_SPELLS_SHOP=[
  {name:'Fireball',          desc:'8d6 fire dmg',                          type:'attack',  dmgDice:'8d6'},
  {name:'Smite',             desc:'4d6 holy dmg',                          type:'attack',  dmgDice:'4d6'},
  {name:'Chain Lightning',   desc:'6d6 lightning to all enemies',          type:'attack',  dmgDice:'6d6', allTargets:true},
  {name:"Sigmar's Wrath",    desc:'5d6 holy dmg, ×2 vs undead/chaos',     type:'attack',  dmgDice:'5d6', holyBonus:true},
  {name:'Cure Wounds',       desc:'Heal 3d6+4 HP',                         type:'heal',    dmgDice:'3d6'},
  {name:'Veil of Shadows',   desc:'All enemies have 2 banes this round',   type:'utility', dmgDice:'0d0', veilShadows:true},
  {name:'Daemonsbane',       desc:'8d6 holy dmg, ×2 vs Chaos/Undead',     type:'attack',  dmgDice:'8d6', holyBonus:true, daemonBonus:true},
  {name:'Wall of Faith',     desc:'All allies +3 Defense, 1 boon 3 rounds',type:'utility', dmgDice:'0d0', wallFaith:true},
  {name:'Bone Prison',       desc:'Stun one enemy (lose next turn)',        type:'utility', dmgDice:'0d0', bonePrison:true},
  {name:'Earthshatter',      desc:'5d6 dmg, Prone 2 rounds, ×1.5 heavy',  type:'attack',  dmgDice:'5d6', earthshatter:true},
  {name:"Sigmar's Shield",   desc:'All allies +2 Def for 2 rounds',         type:'utility', dmgDice:'0d0', sigmarsShield:true},
  {name:'Plague Wind',        desc:'All enemies gain 3 poison stacks',        type:'utility', dmgDice:'0d0', plagueWind:true},
  {name:'Battle Hymn',        desc:'All allies +2 ATK for 2 rounds',          type:'utility', dmgDice:'0d0', battleHymn:true},
];


// ─── ITEM TRAITS ───────────────────────────────────────────────────────────
// Found and bought weapons/armour roll 0–2 of these. Bad traits are real downsides.
const WEAPON_TRAITS = {
  keen:     {label:'Keen',     good:true,  desc:'crits on 19–20'},
  balanced: {label:'Balanced', good:true,  desc:'+1 to hit'},
  serrated: {label:'Serrated', good:true,  desc:'hits cause Bleed'},
  blessed:  {label:'Blessed',  good:true,  desc:'+2 damage vs undead and Chaos; counts as holy'},
  vicious:  {label:'Vicious',  good:true,  desc:'+1 damage'},
  venomous: {label:'Venomous', good:true,  desc:'hits add 1 poison'},
  notched:  {label:'Notched',  good:false, desc:'−1 damage'},
  unwieldy: {label:'Unwieldy', good:false, desc:'1 bane on your first attack each fight'},
  clumsy:   {label:'Clumsy',   good:false, desc:'−1 to hit'},
  brittle:  {label:'Brittle',  good:false, desc:'each fumble permanently costs 1 damage'},
};
const ARMOR_TRAITS = {
  reinforced:{label:'Reinforced',good:true,  desc:'+1 Defence'},
  padded:    {label:'Padded',    good:true,  desc:'crits against you deal no extra dice'},
  sanctified:{label:'Sanctified',good:true,  desc:'heal 1 HP at the end of each round'},
  warded:    {label:'Warded',    good:true,  desc:'immune to Insanity'},
  heavy:     {label:'Heavy',     good:false, desc:'−1 to hit with AGI weapons, −3 to flee'},
  rusted:    {label:'Rusted',    good:false, desc:'−1 Defence'},
  creaking:  {label:'Creaking',  good:false, desc:'enemies have +1 to hit you in round 1'},
};

// ─── CHARMS (one trinket slot; most trade a strength for a weakness) ───────
const CHARMS = {
  haresFoot:  {name:"Lucky Hare's Foot",     desc:'+1 to hit, but −1 Defence.', atkMod:1, defMod:-1},
  ironTooth:  {name:'Iron Tooth Charm',      desc:'−1 damage taken, but −1 damage dealt.'},
  witchSeal:  {name:"Witch-Hunter's Seal",   desc:'1 boon against Chaos, but 1 bane against everything else.'},
  gamblerDie: {name:"Gambler's Die",         desc:'Each fight: +2 to a random attribute and −1 to another.'},
  boneRosary: {name:'Bone Rosary',           desc:'Once per fight a killing blow leaves you at 1 HP, but you start each fight 3 HP lower.'},
  wolfTotem:  {name:'Wolf-Pelt Totem',       desc:'+2 damage below half HP, but enemies have +1 to hit you.'},
  ranaldCoin: {name:"Ranald's Coin",         desc:'+50% silver from kills, but −1 Defence.', defMod:-1},
  morrFeather:{name:"Morr's Raven Feather",  desc:'Undead have 1 bane against you, but healing draughts heal 2 less.'},
  grailToken: {name:"Grail Pilgrim's Token", desc:'Heal 1 HP at the end of each round, but −1 to hit.', atkMod:-1},
  brassSkull: {name:'Brass Skull of Khorne', desc:'+1d3 damage on weapon hits, but you cannot cast spells.'},
  // cursed charms
  warpAmulet: {name:'Warpstone Amulet',      desc:'Cursed. +1 Power, but each spell you cast has a 1-in-6 chance to give you Corruption.', cursed:true},
  tzeentchLens:{name:"Tzeentch's Lens",      desc:'Cursed. Reroll your first missed attack each fight, but −25% max HP while worn.', cursed:true},
};
const CHARM_SHOP_KEYS = ['haresFoot','ironTooth','witchSeal','gamblerDie','boneRosary','wolfTotem','ranaldCoin','morrFeather','grailToken','brassSkull'];

// Cursed weapons/armour: strong, but the downside is real and you can't swap them out
// until you rest at a campfire or use a Sigmar's Token.
const CURSED_GEAR = {
  khornateAxe: {type:'weapon',name:'Khornate Axe',dice:'3d6',stat:'str',dmgType:'slashing',bonus:2,
    special:{key:'khornateAxe',desc:'Cursed. If you end your turn without attacking, the axe drinks from you — take 1d6.'}},
  nurgleMask:  {type:'armor',name:'Skull-Mask of Nurgle',def:4,
    special:{key:'nurgleMask',desc:'Cursed. Immune to poison, but you lose 2 max HP at the start of each fight until you rest.'}},
  shroudFlies: {type:'armor',name:'Shroud of Flies',def:3,
    special:{key:'shroudFlies',desc:'Cursed. Enemies have 1 bane against you, but the flies feed — lose 1 HP each round (never below 1).'}},
};

const ENEMY_DROPS = {
  'Skaven Clanrat':    [{type:'weapon',name:'Clanrat Blade',    dice:'1d6',stat:'agi',dmgType:'slashing',bonus:1,special:{key:'holySmoke',desc:'Passive: each hit applies 1 poison stack from filth-coated blade.'},chance:0.10}],
  'Beastman Gor':      [{type:'weapon',name:'Gor Cleaver',      dice:'1d6',stat:'str',dmgType:'slashing',bonus:1,special:{key:'cleave',  desc:'Active: after a kill, next attack this round deals +1d6 dmg.'},chance:0.10},{type:'charm',key:'wolfTotem',chance:0.08}],
  'Undead Skeleton':   [{type:'armor', name:'Bone-Laced Mail',  def:2, special:{key:'dwarfForged',desc:'Passive: Gromril is the hardest metal in the world — cannot be stunned more than once per combat. -1 to all incoming damage.'},chance:0.10}],
  'Mutant Thug':       [{type:'weapon',name:'Chaos Cudgel',     dice:'1d6',stat:'str',dmgType:'blunt',  bonus:1,special:{key:'sunder',   desc:'Active: on a crit, target loses 2 AC for the rest of combat.'},chance:0.10},{type:'charm',key:'gamblerDie',chance:0.08}],
  'Chaos Marauder':    [{type:'armor', name:'Marauder Hide',    def:2, special:{key:'chaosWard',desc:'Passive: warded against corruption — -2 damage from all Chaos enemies. +1 boon on WIL checks vs Chaos.'},chance:0.10},{type:'charm',key:'witchSeal',chance:0.08}],
  'Skaven Stormvermin':[{type:'weapon',name:'Stormvermin Halberd',dice:'2d6',stat:'str',dmgType:'slashing',bonus:2,special:{key:'reach',desc:'Passive: +1 boon on round 1 attacks. Your reach means charging enemies cannot use Reckless Charge vs you.'},chance:0.12}],
  'Wight':             [{type:'armor', name:'Wight Shroud',     def:2, special:{key:'lastTarget',desc:'Passive: your shadowy movement draws less attention — enemies always attack other allies before you.'},chance:0.12},{type:'charm',key:'ironTooth',chance:0.08}],
  'Plague Monk':       [{type:'weapon',name:'Plague Censer',    dice:'2d6',stat:'wil',dmgType:'blunt',  bonus:2,special:{key:'holySmoke',desc:'Passive: each hit applies 1 poison stack from sacred incense.'},chance:0.12}],
  'Chaos Warrior':     [{type:'armor', name:'Chaos Plate',      def:4, special:{key:'chaosWard',desc:'Passive: warded against corruption — -2 damage from all Chaos enemies. +1 boon on WIL checks vs Chaos.'},chance:0.12}],
  'Vampire Count':     [{type:'weapon',name:'Vampiric Blade',   dice:'2d6',stat:'agi',dmgType:'slashing',bonus:2,special:{key:'riposte', desc:'Active: when an enemy misses you, make a free counterattack with 1 boon. Once/round.'},chance:0.12},{type:'charm',key:'grailToken',chance:0.08}],
  'Bloodletter':       [{type:'weapon',name:"Bloodletter's Axe",dice:'2d6',stat:'str',dmgType:'slashing',bonus:3,special:{key:'cleave',  desc:'Active: after a kill, next attack this round deals +1d6 dmg.'},chance:0.12},{type:'charm',key:'brassSkull',chance:0.1}],
  'Skaven Warlord':    [{type:'weapon',name:'Warlord Blade',    dice:'2d6',stat:'agi',dmgType:'slashing',bonus:3,special:{key:'bladeguard',desc:'Passive: +1 Defense while equipped. Blade catches enemy weapons — lost if you are stunned.'},chance:0.15},{type:'charm',key:'ranaldCoin',chance:0.1}],
  'Ghoul':             [{type:'charm',key:'boneRosary',chance:0.12}],
  'Zombie':            [{type:'weapon',name:'Rotting Flail',dice:'2d6',stat:'str',dmgType:'blunt',bonus:1,chance:0.08,special:{key:'flailSwing',desc:'Passive: +2 to hit against Defence 15 or higher. On a fumble the head swings back — you take 1d6.'}}],
  'Pox Rat Swarm':     [{type:'charm',key:'haresFoot',chance:0.08}],
  'Ungor Skirmisher':  [{type:'weapon',name:'Ungor Longbow',dice:'1d8',stat:'agi',dmgType:'slashing',bonus:1,chance:0.12,special:{key:'longbow',desc:'Passive: 1 boon on round-1 attacks; 1 bane if you were hit since your last turn.'}}],
  'Blue Horror':       [{type:'cursed',key:'tzeentchLens',chance:0.10}],
  'Gutter Runner':     [{type:'weapon',name:'Gutter Runner Blades',dice:'2d4',stat:'agi',dmgType:'slashing',bonus:2,chance:0.12,special:{key:'twinBlades',desc:'Passive: two quick blades — you crit on 19–20.'}}],
  'Nurgle Cultist':    [{type:'cursed',key:'nurgleMask',chance:0.10}],
  'Banshee':           [{type:'charm',key:'morrFeather',chance:0.12}],
  'Plague Rat Lord':   [{type:'cursed',key:'shroudFlies',chance:0.10}],
  'Minotaur':          [{type:'cursed',key:'khornateAxe',chance:0.12}],
  'River Troll':       [{type:'consumable',name:'Troll Blood',chance:0.5}],
  'Ratling Gun Team':  [{type:'cursed',key:'warpAmulet',chance:0.12}],
  'Warlock Engineer':  [{type:'consumable',name:'Warpstone Dust',chance:0.5}]
};

module.exports = {
  SUMMONS, WEAPON_TRAITS, ARMOR_TRAITS, CHARMS, CHARM_SHOP_KEYS, CURSED_GEAR,
  CAREERS,
  NOVICE_PATHS,
  EXPERT_PATHS,
  MASTER_PATHS,
  CASTINGS_TABLE,
  TRADITIONS,
  ENEMY_POOLS,
  XP_THRESHOLDS,
  POISON_CAP,
  NODE_TYPES,
  SCROLL_SPELLS_LIST,
  LOOT_CONS_LIST,
  WEAPON_BASES,
  ARMOR_BASES,
  LEGENDARY_ITEMS,
  SHOP_CONSUMABLES,
  SCROLL_SPELLS_SHOP,
  ENEMY_DROPS,
};
