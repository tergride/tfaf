// Makes the small copies of the artwork the interface uses: run `npm run art` after replacing
// resources/icon.png (square PNG with transparency) or resources/splash.png (square splash art).
// Runs under Electron because nativeImage resizes images without extra dependencies.
const { app, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const assets = path.join(root, 'src', 'renderer', 'src', 'assets');

function load(name) {
  const image = nativeImage.createFromPath(path.join(root, 'resources', name));
  if (image.isEmpty()) {
    throw new Error(`resources/${name} is missing or not an image`);
  }
  return image;
}

app.whenReady().then(() => {
  try {
    fs.mkdirSync(assets, { recursive: true });
    fs.writeFileSync(path.join(assets, 'logo.png'), load('icon.png').resize({ width: 128, height: 128, quality: 'best' }).toPNG());
    // The installed launcher draws its logo at 256 px at most (the TFAF screen of a game start, the tray), so it ships
    // this copy; the full-size icon.png stays the source of these copies and of electron-builder's .ico.
    fs.writeFileSync(
      path.join(root, 'resources', 'icon-512.png'),
      load('icon.png').resize({ width: 512, height: 512, quality: 'best' }).toPNG(),
    );
    fs.writeFileSync(
      path.join(assets, 'splash.jpg'),
      load('splash.png').resize({ width: 800, height: 800, quality: 'best' }).toJPEG(88),
    );
    console.log('Updated resources/icon-512.png, src/renderer/src/assets/logo.png and splash.jpg');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
  app.quit();
});
