# Third-party notices

TFAF's own code is Copyright (C) 2026 Tergride and is licensed under the GNU General Public License, version 3 or any later version, see [LICENSE](LICENSE). The files below come from other projects and keep their licenses.

## Files in this repository

| Files | Source | License |
|---|---|---|
| `src/renderer/src/assets/flags/*.png` | [FAForever/downlords-faf-client](https://github.com/FAForever/downlords-faf-client), `src/main/resources/images/flags` | MIT, see below |
| `src/renderer/src/assets/emoticons.json` | [FAForever/downlords-faf-client](https://github.com/FAForever/downlords-faf-client), `src/main/resources/images/emoticons/emoticons.json` | MIT, see below |
| `src/renderer/src/assets/friendJoinedGame.mp3`, `friendOffline.mp3`, `friendOnline.mp3`, `friendStartedPlaying.mp3`, `matchFound.mp3`, `mention.mp3`, `notification.mp3`, `privateMessage.mp3` | [FAForever/downlords-faf-client](https://github.com/FAForever/downlords-faf-client), `src/main/resources/theme/sounds`, which takes them from Pixabay | [Pixabay Content License](https://pixabay.com/service/license/) |
| `src/renderer/src/assets/filesDiffer.ogg` | "Short alarm" by yd, [OpenGameArt.org](https://opengameart.org) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `src/shared/stoneMap/contracts.ts`, `src/shared/stoneMap/catalog.ts` | StoneMap, a map generator for Supreme Commander: Forged Alliance after [Neroxis Map Generator](https://github.com/FAForever/Neroxis-Map-Generator): the types of its local API and its parameter catalog, generated from its C# contracts | MIT, see below |

## Files the build adds

| Files | Source | License |
|---|---|---|
| `faf-uid.exe`, downloaded by `scripts/fetch-native.mjs` and packed into the installer | [FAForever/uid](https://github.com/FAForever/uid), release v4.0.7 | GPL-3.0; the source code is in that repository |
| npm packages bundled into the application, including the fonts `@fontsource-variable/exo-2` and `@fontsource-variable/ibm-plex-sans` | npm | Each package's own license; the fonts are under the SIL Open Font License 1.1 |

## Files the launcher downloads

| Files | Source | License |
|---|---|---|
| `stonemap-<build>-win-x64.zip`, a file of a release of this repository that the launcher downloads on first use of the map generator | StoneMap's local API built for Windows with the .NET runtime | StoneMap: MIT, see below. The .NET runtime: MIT, its notices are in the archive's `LICENSES`. `FdLibm.cs`, `Ziggurat.cs` and `ArgbBlend.cs` are ports of OpenJDK code under GPLv2 with the Classpath exception; their source is in the archive's `source` and the license in `LICENSES`. Parts after Squish keep its MIT notice in `LICENSES`. |

## FAForever/downlords-faf-client

```
The MIT License (MIT)

Copyright (c) 2015 Michel Jung

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## StoneMap

```
MIT License

Copyright (c) 2020 Peter Ziegler

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
