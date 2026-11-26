'use strict';
// Small helpers shared by the server and the game modules.
function aliveEnemies(gs){ return (gs.enemies||[]).filter(e=>e&&e.hp>0); }
function alivePlayers(room){ return room.players.filter(p=>p.char&&p.char.alive); }
function pickRandom(a){ return a[Math.floor(Math.random()*a.length)]; }

module.exports = { aliveEnemies, alivePlayers, pickRandom };
