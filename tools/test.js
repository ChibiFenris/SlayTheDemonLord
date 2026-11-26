'use strict';
// npm test — syntax-checks every source file, then boots the server and lets
// bots play a handful of full games. Fails on any server error, stall or timeout.
//   GAMES=8 npm test     (default 4 games, 1–4 players each)
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { runGames } = require('./playtest');

const root = path.join(__dirname, '..');
const sources = ['server.js', ...['game', 'public/js', 'tools'].flatMap(dir =>
  fs.readdirSync(path.join(root, dir)).filter(f => f.endsWith('.js')).map(f => path.join(dir, f)))];

let failed = false;
for (const file of sources) {
  try { new vm.Script(fs.readFileSync(path.join(root, file), 'utf8'), { filename: file }); }
  catch (e) { failed = true; console.error(`✗ syntax: ${file}\n  ${e.message}`); }
}
if (failed) process.exit(1);
console.log(`✓ syntax ok (${sources.length} files)`);

const port = 4100 + Math.floor(Math.random() * 500);
// Rule checks first (in-process), then a live server for the bot games.
const dataDir = require('path').join(require('os').tmpdir(), 'sor-test-data');
const mech = require('child_process').spawnSync(process.execPath, ['tools/mechanics-test.js'], { cwd: root, encoding: 'utf8', env: { ...process.env, DATA_DIR: dataDir } });
process.stdout.write(mech.stdout.split('\n').filter(l => l.startsWith('FAIL')).join('\n'));
if (mech.status !== 0) { console.error(`✗ mechanics tests failed\n${mech.stdout}${mech.stderr}`); process.exit(1); }
console.log('✓ mechanics tests ok');

const server = spawn(process.execPath, ['-r', './tools/fast-timers.js', 'server.js'], {
  cwd: root, env: { ...process.env, PORT: String(port), DATA_DIR: dataDir },
});
let serverErrors = 0, serverOut = '';
const onData = buf => { const s = buf.toString(); serverOut += s; serverErrors += (s.match(/@@ERR/g) || []).length; };
server.stdout.on('data', onData);
server.stderr.on('data', onData);

const waitForServer = () => new Promise((resolve, reject) => {
  const t0 = Date.now();
  const tick = setInterval(() => {
    if (serverOut.includes(`:${port}`)) { clearInterval(tick); resolve(); }
    else if (Date.now() - t0 > 10000) { clearInterval(tick); reject(new Error('server did not start')); }
  }, 50);
});

(async () => {
  try {
    await waitForServer();
    const results = await runGames(+process.env.GAMES || 4, port);
    const bad = results.filter(r => !['VICTORY', 'GAMEOVER'].includes(r.outcome));
    if (bad.length) { failed = true; console.error(`✗ ${bad.length} game(s) stalled or timed out`); }
    if (serverErrors) { failed = true; console.error(`✗ ${serverErrors} server error(s):\n` + serverOut.split('\n').filter(l => l.includes('@@ERR')).slice(0, 10).join('\n')); }
    if (!failed) console.log('✓ playtest ok');
  } catch (e) { failed = true; console.error('✗', e.message); }
  server.kill();
  process.exit(failed ? 1 : 0);
})();
