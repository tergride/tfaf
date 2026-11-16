// Windows installer: `npm run dist` writes dist/TFAF-Setup-<version>.exe.
//
// Builds look for updates only if an update feed is given when they are built:
//   TFAF_UPDATE_URL=https://example.org/tfaf/  any HTTPS folder; upload the installer, its .blockmap and latest.yml
//   TFAF_UPDATE_GITHUB=owner/repo              releases of a public GitHub repository
// Without either, the installed launcher never checks for updates and new versions are installed by hand.
// Released versions are built with TFAF_UPDATE_GITHUB=tergride/tfaf and published as releases of that repository.

function updateFeed() {
  const url = process.env.TFAF_UPDATE_URL;
  if (url) {
    return { provider: 'generic', url };
  }
  const github = process.env.TFAF_UPDATE_GITHUB;
  if (github) {
    const [owner, repo] = github.split('/');
    return { provider: 'github', owner, repo, releaseType: 'release' };
  }
  return null;
}

/** @type {import('electron-builder').Configuration} */
export default {
  // Identifies the installation for updates and uninstall; must never change.
  appId: 'com.tergride.tfaf',
  productName: 'TFAF',
  directories: { output: 'dist', buildResources: 'build' },
  // The About page and the "What's new" dialog read the release notes from CHANGELOG.md.
  files: ['out/**/*', 'package.json', 'CHANGELOG.md'],
  // Chromium's own strings (form validation, built-in controls, error pages) for the system language. The launcher's
  // UI is translated by src/shared/i18n and only tells Russian from English (resolveLocale), so the other 53 packs
  // only took ~47 MB of every installation. A missing pack falls back to en-US, which resolveLocale also reads as English.
  electronLanguages: ['en-US', 'ru'],
  // The logo also goes into the screen a game of a TFAF lobby shows during a start (gameRunner.ts screenLogo). Both it
  // and the tray need at most 256 px, so the installation gets the 512 px copy `npm run art` makes, not the full art.
  extraResources: [
    { from: 'resources/native', to: 'native' },
    { from: 'resources/icon-512.png', to: 'icon.png' },
    // The installation carries the flags, emoticons and sounds of the official client, whose license asks for its notice.
    { from: 'LICENSE', to: 'LICENSE.txt' },
    { from: 'THIRD_PARTY_NOTICES.md', to: 'THIRD_PARTY_NOTICES.md' },
  ],
  npmRebuild: false,
  // Opening a replay from Explorer starts it in TFAF (the path arrives in argv, see src/main/openFiles.ts). The
  // per-user installer registers the extensions for the user; an official client kept as Windows' default stays so
  // until the user picks TFAF under "Open with".
  fileAssociations: [
    { ext: 'fafreplay', name: 'FAF replay', description: 'Forged Alliance Forever replay', role: 'Viewer' },
    { ext: 'scfareplay', name: 'SCFA replay', description: 'Supreme Commander: Forged Alliance replay', role: 'Viewer' },
  ],
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    // A square PNG of at least 256 px; electron-builder converts it to .ico for the executable and the installer.
    icon: 'resources/icon.png',
  },
  // Assisted installation offers per-user, per-machine, and a self-contained portable copy.
  nsis: {
    oneClick: false,
    perMachine: false,
    selectPerMachineByDefault: false,
    allowElevation: true,
    allowToChangeInstallationDirectory: true,
    installerLanguages: ['en_US', 'ru_RU'],
    include: 'build/installer.nsh',
    // eslint-disable-next-line no-template-curly-in-string -- electron-builder fills in these macros
    artifactName: '${productName}-Setup-${version}.${ext}',
    shortcutName: 'TFAF',
    uninstallDisplayName: 'TFAF',
    createDesktopShortcut: 'always',
  },
  electronFuses: {
    runAsNode: false,
    enableCookieEncryption: true,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    onlyLoadAppFromAsar: true,
  },
  publish: updateFeed(),
  // A beta (0.17.0-beta.1) would otherwise get beta.yml and the channel "beta" in its app-update.yml, and once the
  // player turns betas off it would look for beta.yml in regular releases, which have only latest.yml. Every build
  // writes latest.yml; a launcher that takes betas finds it in a pre-release too.
  detectUpdateChannel: false,
};
