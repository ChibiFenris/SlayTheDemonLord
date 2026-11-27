'use strict';
// The road runs through three regions, ten depths each. Each has its own foes
// (the region's factions turn up far more often), places and music. Endless
// mode walks the three again and again.
const ZONES = [
  { id: 'drakwald', name: 'The Drakwald', icon: '🌲',
    blurb: 'An ancient, hungry forest east of Altdorf. Beastmen herds roam the trees and greenskins raid the woodcutters\' villages.',
    tags: ['beast', 'greenskin'],
    places: ['The Reikland Road', 'Woodcutters\' Rest', 'The Drakwald Edge', 'A Burned Coaching Inn', 'The Hanging Oak', 'Herdstone Clearing', 'Goblin Hollow', 'The Old Forest Road', 'The Ruined Shrine of Taal', 'The Beastlord\'s Glade'] },
  { id: 'undercity', name: 'The Altdorf Undercity', icon: '🕯',
    blurb: 'Beneath the Emperor\'s city lie sewers, crypts and forgotten vaults. The Skaven gnaw at its roots and the dead do not rest.',
    tags: ['skaven', 'undead'],
    places: ['The Altdorf Sewers', 'The Drowned Crypts', 'A Smugglers\' Cellar', 'The Bone Galleries', 'Skaven Under-warren', 'The Plague Cistern', 'The Catacombs of Morr', 'A Cult Meeting Hall', 'The Warpstone Seam', 'The Black Vault'] },
  { id: 'wastes', name: 'The Chaos Wastes', icon: '☄',
    blurb: 'Past the edge of the world, where the Winds of Magic howl raw and the Dark Gods are close enough to touch.',
    tags: ['chaos', 'daemon'],
    places: ['The Shattered Steppe', 'A Field of Skulls', 'The Burning Dunes', 'The Warp Rift', 'A Chaos Shrine', 'The Citadel Ruins', 'The Screaming Pass', 'The Plain of Gods', 'The Brass Gate', 'The Final Abyss'] },
];
const zoneIndex = depth => Math.floor(Math.max(0, (depth || 1) - 1) / 10) % ZONES.length;
const zoneFor = depth => ZONES[zoneIndex(depth)];
const placeFor = depth => { const z = zoneFor(depth); return z.places[Math.max(0, (depth || 1) - 1) % 10]; };

// Prefer the region's factions: 60% of the time, if the pool has any of them.
function favour(pool, depth) {
  const z = zoneFor(depth);
  const fav = pool.filter(e => (e.tags || []).some(t => z.tags.includes(t)));
  return fav.length && Math.random() < 0.6 ? fav : pool;
}

module.exports = { ZONES, zoneIndex, zoneFor, placeFor, favour };
