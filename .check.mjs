import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync('index.html', 'utf8');
const m = html.match(/<script>([\s\S]*)<\/script>/);
if (!m) { console.error('no inline script found'); process.exit(1); }

new vm.Script(m[1], { filename: 'index.html-inline-script' });
console.log('JS syntax OK');

const checks = {
  hasCanvas: /<canvas/.test(html),
  hasViewport: /<meta name="viewport"/.test(html),
  hasGameHook: /window\.__GAME\s*=/.test(html),
  hasRestart: /function restart\s*\(/.test(html),
  hasGameOver: /function triggerGameOver\s*\(/.test(html) || /gameover/i.test(html),
  fileSizeBytes: Buffer.byteLength(html, 'utf8'),
};
console.log(JSON.stringify(checks, null, 2));

const failed = !checks.hasCanvas || !checks.hasViewport || !checks.hasGameHook || !checks.hasRestart || checks.fileSizeBytes > 2 * 1024 * 1024;
process.exit(failed ? 1 : 0);
