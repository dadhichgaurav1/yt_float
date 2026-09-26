// Ad-hoc sign the unsigned bundle so Apple Silicon doesn't report it as "damaged".
// Signing happens in a temp dir because iCloud-synced folders (e.g. ~/Documents) keep
// re-adding extended attributes that codesign rejects.
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

exports.default = async function (context) {
  // Universal builds pack each arch into a *-temp dir first; sign only the merged app.
  if (context.appOutDir.endsWith('-temp')) return;
  const name = `${context.packager.appInfo.productFilename}.app`;
  const app = path.join(context.appOutDir, name);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ytfloat-sign-'));
  const tmpApp = path.join(tmp, name);
  try {
    execFileSync('ditto', ['--norsrc', '--noextattr', app, tmpApp]);
    execFileSync('xattr', ['-cr', tmpApp]);
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', tmpApp], { stdio: 'inherit' });
    fs.rmSync(app, { recursive: true, force: true });
    execFileSync('ditto', ['--norsrc', '--noextattr', tmpApp, app]);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
};
