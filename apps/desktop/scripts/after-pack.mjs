/**
 * electron-builder afterPack hook: give the macOS bundle a signature that is merely *unsigned*
 * rather than *broken*.
 *
 * electron-builder sets `hardenedRuntime` and entitlements but, with no Developer ID available,
 * skips signing entirely. What survives is the linker's ad-hoc placeholder from the prebuilt
 * Electron binary: `Identifier=Electron`, `Sealed Resources=none`, no `_CodeSignature` directory.
 * A signature that claims sealed resources and ships none does not read as unsigned to macOS — it
 * reads as *tampered*, which is why a quarantined download reported "SDODS is damaged and can't be
 * opened" instead of the ordinary unidentified-developer prompt.
 *
 * Re-signing ad-hoc costs nothing and produces a valid signature with the app's own identifier, so
 * the failure mode becomes the honest one users are told how to get past.
 *
 * Ordering matters and is the reason this is `afterPack` and not `afterSign`: electron-builder
 * signs *after* this hook, so when real Developer ID credentials are present (CSC_LINK et al.)
 * its signature simply replaces this one. This is a floor, never a ceiling.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export default async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  if (!existsSync(app)) throw new Error(`afterPack: no .app to sign at ${app}`);

  // `--deep` is deprecated for distribution signing but is correct here: every nested binary
  // carries the same placeholder, and the bundled Node runtime must be sealed along with them.
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });

  // Verify rather than assume. A silent no-op here would ship the exact bundle this hook exists
  // to prevent, and the packaging log would say nothing at all.
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
  console.log(`  • ad-hoc signed and verified ${app}`);
}
