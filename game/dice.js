'use strict';
// Dice helpers shared by the game rules.
const d = n => Math.floor(Math.random() * n) + 1;              // one die with n sides
function rd(num, sides) { let t = 0; for (let i = 0; i < num; i++) t += d(sides); return t; } // NdS
const modVal = s => s - 10; // attribute modifier (simplified: attr − 10, not SotDL's halved value)

module.exports = { d, rd, modVal };
