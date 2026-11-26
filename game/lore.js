'use strict';
// Words spoken by bosses as a fight begins and as they fall. Shown in the log
// and as a banner on the battlefield.
const BOSS_LINES = {
  'Skaven Warlord Gnashteeth': ['Yes-yes! Man-things come to die-die in Gnashteeth\'s tunnels!', 'Not fair... not fair-fair... the Council will hear-hear...'],
  'Beastlord Kragthor': ['The herd hungers. Your city-flesh will feed it.', 'The herdstone... remembers... my name...'],
  'Grey Seer Skrittar': ['The Horned Rat whispers your deaths to me. All of them.', 'The warpstone lied... it lied to Skrittar...'],
  'Bray-Shaman Ghorros': ['Your gods are far away, little men. Mine are here.', 'The dark... wind... carries me home...'],
  'Varghulf': ['(It drops something it was eating. It is still chewing.)', '(A long, almost human sigh. Then nothing.)'],
  'Bonebreaker Ratogre': ['(The chains on its arms snap one by one.)', '(It falls like a felled oak. The tunnel shakes.)'],
  'Blight King Gutrot': ['Grandfather sends his gifts. Open your mouths.', 'Rot... is patient... Rot... will come again...'],
  'Gorgrund the Stone Troll': ['Gorgrund hungry. You small. Gorgrund still hungry after.', 'Gorgrund... just... wanted... lunch...'],
  'Saurian Ancient': ['(It regards you with eyes older than the Empire.)', '(It sinks slowly, as if returning to sleep.)'],
  "Daemon Prince Vhar'kul": ['I was mortal once. I begged too. It did not help me either.', 'This flesh fails. I do not. We will meet again, in the Realm of Chaos.'],
  'Skaldrak the Elder Wyrm': ['I burned this valley when your Sigmar was a boy. I will burn it again.', 'So... this is how the old ones end. Small teeth... many of them...'],
};
const intro = name => (BOSS_LINES[name] || [])[0] || null;
const last = name => (BOSS_LINES[name] || [])[1] || null;

// The merchant who follows the warband along the road.
const MERCHANT_NAME = 'Old Grete';
const MERCHANT_GREETINGS = [
  `${MERCHANT_NAME} looks up from her cart. "Fresh faces. Coin first, questions never."`,
  `${MERCHANT_NAME} grins. "You again! Still alive — that's good for business."`,
  `${MERCHANT_NAME}: "I've started saving the good stock for you lot. Don't tell the others."`,
  `${MERCHANT_NAME} pours you a cup of something terrible. "My best customers. My only customers, down here."`,
  `${MERCHANT_NAME}: "Every time, a little deeper. Every time, a little more blood on you. Buy something."`,
];
const merchantGreeting = visits => MERCHANT_GREETINGS[Math.min(visits, MERCHANT_GREETINGS.length) - 1];

module.exports = { BOSS_LINES, intro, last, MERCHANT_NAME, merchantGreeting };
