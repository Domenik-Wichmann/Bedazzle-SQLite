'use strict';
// Claude's embedded Node host can supply wrapped protocol streams. Forward those
// streams explicitly; inheriting OS descriptors 0/1/2 loses that transport.
const {spawn} = require('node:child_process');
const path = require('node:path');
const [app, workspace] = process.argv.slice(2);
if (!app || !workspace) {
  console.error('Bedazzle: configure the application folder and workspace home.');
  process.exitCode = 1;
} else {
  const child = spawn(path.join(app, 'runtime', 'python', 'python.exe'),
    ['-X', 'utf8', '-u', path.join(app, 'companion_mcp.py'), '--workspace', workspace],
    {stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: false});
  process.stdin.pipe(child.stdin);
  child.stdout.pipe(process.stdout, {end: false});
  child.stderr.pipe(process.stderr, {end: false});
  child.stdin.on('error', error => {
    if (error.code !== 'EPIPE' && error.code !== 'ERR_STREAM_DESTROYED') {
      console.error('Bedazzle input stream:', error.message);
    }
  });
  child.on('error', error => {
    console.error('Bedazzle could not launch bundled Python:', error.message);
    process.stdin.unpipe(child.stdin);
    process.stdin.pause();
    process.exitCode = 1;
  });
  child.on('close', (code, signal) => {
    process.stdin.unpipe(child.stdin);
    process.stdin.pause();
    if (code || signal) console.error(`Bedazzle Python exited (${signal || code}).`);
    process.exitCode = code ?? 1;
  });
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, () => child.kill());
  }
}
