// A TFAF lobby launches its matches with code of its own (roomLaunchScript.ts) and settles them the way the game's
// lobby does (launchConfig.ts, launchSpawns.ts). Both lean on code of FAF that may change with any update of the game,
// and a match launched on code TFAF has not seen could go wrong in ways nobody notices. So the launcher compares that
// code with what it was checked against, and a start waits until a TFAF release knows the change.
//
// A fingerprint is taken of the tokens alone (luaChunks.ts): a change to comments or layout passes, a change to the
// code does not. A new fingerprint is added here once the change has been read and what TFAF repeats of it updated.

import { findLuaDefinition, findLuaSpan, luaFingerprint } from '../../lua/luaChunks.ts';
import { tokenizeLua } from '../../lua/luaParser.ts';
import type { GameScripts } from '../../gameOptions/gamePackages.ts';

type WatchedPiece = { kind: 'file' } | { kind: 'definition'; name: string } | { kind: 'span'; from: string; to: string };

interface WatchedCode {
  file: string;
  piece: WatchedPiece;
  /** Only the packages of these featured mods have the file. */
  featuredMods?: readonly string[];
}

const LOBBY = '/lua/ui/lobby/lobby.lua';

function definitions(file: string, names: readonly string[]): WatchedCode[] {
  return names.map((name) => ({ file, piece: { kind: 'definition', name } }));
}

/** What the launch of a TFAF lobby repeats, replaces or relies on. */
export const WATCHED_CODE: readonly WatchedCode[] = [
  // The engine's entry to every lobby, which the launch replaces for its games.
  { file: '/lua/multiplayer/onlineprovider.lua', piece: { kind: 'file' } },
  { file: '/lua/ui/lobby/lobbyComm.lua', piece: { kind: 'file' } },
  ...definitions(LOBBY, [
    'TryLaunch',
    'GetRandomFactionIndex',
    'AssignRandomFactions',
    'FixFactionIndexes',
    'team_sort_by_sum',
    'autobalance_bestworst',
    'autobalance_avg',
    'autobalance_rr',
    'autobalance_random',
    'autobalance_quality',
    'AssignRandomStartSpots',
    'AssignAutoTeams',
    'AssignAINames',
    'ComputeAIRating',
    'GetAIPlayerData',
    'SendArmySettingsToServer',
    'ConnectToPeer',
    'DisconnectFromPeer',
    'lobbyComm.GameLaunched',
    'Launch',
  ]),
  { file: LOBBY, piece: { kind: 'span', from: 'local preGameData = {}', to: "SetPreference('PreGameData', preGameData)" } },
  ...definitions('/lua/ui/lobby/data/playerdata.lua', ['DEFAULT_MAPPING']),
  ...definitions('/lua/factions.lua', ['OrgFactions', 'GetCustomFactions']),
  ...definitions('/lua/system/Blueprints.lua', ['LoadPreGameData']),
  ...definitions('/lua/simInit.lua', ['ShuffleStartPositions']),
  // Nomads rewrites the faction choice of the game's lobby.
  { file: '/nomadhook/lua/ui/lobby/lobby.lua', piece: { kind: 'file' }, featuredMods: ['nomads'] },
];

/**
 * Fingerprints checked so far, by `watchedLabel`. One list serves every featured mod: a fingerprint is either the code
 * TFAF knows or it is not. Checked: FAF 3840 (`deploy/faf` 412ec953), `deploy/fafbeta` 2f4de724 and
 * `deploy/fafdevelop` 123dfec8 of FAForever/fa, whose second fingerprints differ from FAF in local declarations and
 * `string.split` alone, and the Nomads hook of FAForever/nomads 2fd7a874.
 */
export const SUPPORTED_LAUNCH_CODE: Readonly<Record<string, readonly string[]>> = {
  'lua/multiplayer/onlineprovider.lua': ['d3a6268b59fb9aab93d1aa6ee479316e69911e6bf09fe84f1d76521c1f3c603c'],
  'lua/ui/lobby/lobbyComm.lua': ['e3a1689a032868db12d9a4136bcb94d9538e0ccf8cf3391b17fbb86cc3b53cff'],
  'lua/ui/lobby/lobby.lua: TryLaunch': ['46a01656c7ec4b3465b9b8d77ac9209ef1ae59b180e09db3811e23d31607427d'],
  'lua/ui/lobby/lobby.lua: GetRandomFactionIndex': ['e61b91759c570cbfa211937b50433f98f14a531721dca5d3776269dc38092289'],
  'lua/ui/lobby/lobby.lua: AssignRandomFactions': ['94aa7a075eb84d520940f5471b58371c17f81d0d307732b987e51bf0da47dd82'],
  'lua/ui/lobby/lobby.lua: FixFactionIndexes': ['8491cce1e2c5bd3bdc862f2736060a94310d6b321b1a81be2bf20c415aaac09f'],
  'lua/ui/lobby/lobby.lua: team_sort_by_sum': ['885dd86a661b67d43b27cdf72eefd2d9f882bc35616814b8e1d318dd378f832a'],
  'lua/ui/lobby/lobby.lua: autobalance_bestworst': ['2d8932592f69ee20ef1c23b4fc3f0d88e5dead0530b2057f2dbede61064934b5'],
  'lua/ui/lobby/lobby.lua: autobalance_avg': ['bcd17e4203d079f90a2e62f03089631dfb75de58a5cc82a7bb901fb2bd41d413'],
  'lua/ui/lobby/lobby.lua: autobalance_rr': ['71769cc044d87b515ff007bd29831bdd8dfb5ebd4f90bd358dca24379ac8ef2b'],
  'lua/ui/lobby/lobby.lua: autobalance_random': ['b2150c679079c4a3f529401be676296caa1c6f7a1c4a635b2d7c731c824dd96b'],
  'lua/ui/lobby/lobby.lua: autobalance_quality': ['1bce5725f8d1a62b4b36f89b6c92711dc11a719aaa95d7d58835a63d5142b0a7'],
  'lua/ui/lobby/lobby.lua: AssignRandomStartSpots': [
    '70266b9734e6d2802bafbb05d44f56f1f959f95dac919edde0da8f0e5944fb7b',
    '5cd8c923fc66699ea9e200023f91ad56cd28af7963ed75ebd1139dc99ea7d58e',
  ],
  'lua/ui/lobby/lobby.lua: AssignAutoTeams': ['6ffd50c1c240229e10b6f14a96e08e7ef44a96d04a3d31b16d00bfcfcfbfdc6d'],
  'lua/ui/lobby/lobby.lua: AssignAINames': ['a18b795f73b8bd89acd50edf3da7e0fd058abeb7f996b05bb3eccb3d4a8c7c27'],
  'lua/ui/lobby/lobby.lua: ComputeAIRating': ['57041fe911a532db8239f9c4d5a290d733f433a1f595dcdc52be30b9290bb773'],
  'lua/ui/lobby/lobby.lua: GetAIPlayerData': ['660636aa2ee9b7a8fe385b7340c77d3711f1decf1e66ae0f2845abc28a30ffe5'],
  'lua/ui/lobby/lobby.lua: SendArmySettingsToServer': ['b798039b0d30963aee4580b0c7b2cd7e20f8636a528740705750a25e377afaee'],
  'lua/ui/lobby/lobby.lua: ConnectToPeer': ['864915f9712ada33d6b44f686d68eff5f8eefef5f65cff084495171be3af169d'],
  'lua/ui/lobby/lobby.lua: DisconnectFromPeer': ['53aaa6eed83eabd84a21e2eaf7ada2d675235e052fb16a3be995267b26494775'],
  'lua/ui/lobby/lobby.lua: lobbyComm.GameLaunched': ['62097fdfc5e473f7d2883875abcd407078ca34756e088aa48ab6b16f0bc9bdf6'],
  'lua/ui/lobby/lobby.lua: Launch': ['8f795a6eb4b5ba1496a8102a8dfcc52f2f657a5a8d8c5610f70069a66b65ae82'],
  'lua/ui/lobby/lobby.lua: local preGameData = {}': [
    '2ac2550af3bbd265d3ced5c65f6449b78b5cab41a724f7ed886c2ddf636e3627',
    '4a1b3c2833bf80d8eb73a967aae5af15dc5045c1a09db5456fe682a926a4c841',
  ],
  'lua/ui/lobby/data/playerdata.lua: DEFAULT_MAPPING': ['aa4751d652f4f64e98d683b400bd0efeee45893bc36ea81402455ad2d60668bc'],
  'lua/factions.lua: OrgFactions': ['4130ceaa6178fd365062274e14c6d1e368d8bd33afaf7af101e69bb627abc9ba'],
  'lua/factions.lua: GetCustomFactions': ['39fe75f9df88eb7ef6448ab496b3a2e0d849c1f43e666eb101d4e4ea8d85aef4'],
  'lua/system/Blueprints.lua: LoadPreGameData': ['c430a6ca6970abfb213414ec95f579700c266094da1987e1cb05a18cd0d5a3d8'],
  'lua/simInit.lua: ShuffleStartPositions': ['e2890c2ae6cc176f60b626ad4d315c9ef1ee36bef496a0c1360e038d022e3b27'],
  'nomadhook/lua/ui/lobby/lobby.lua': ['4f4f71a0a173d60f5081ba0967c154f19f86df94aa6afafdc727156212470a90'],
};

export function watchedLabel(code: WatchedCode): string {
  const file = code.file.slice(1);
  switch (code.piece.kind) {
    case 'file':
      return file;
    case 'definition':
      return `${file}: ${code.piece.name}`;
    case 'span':
      return `${file}: ${code.piece.from}`;
  }
}

function pieceFingerprint(source: string, piece: WatchedPiece): string | null {
  switch (piece.kind) {
    case 'file':
      return luaFingerprint(tokenizeLua(source.charCodeAt(0) === 0xfeff ? source.slice(1) : source));
    case 'definition': {
      const found = findLuaDefinition(source, piece.name);
      return found ? luaFingerprint(found.tokens) : null;
    }
    case 'span': {
      const found = findLuaSpan(source, piece.from, piece.to);
      return found ? luaFingerprint(found.tokens) : null;
    }
  }
}

/** The fingerprint of every piece the featured mod has, null for one that is gone, by label. */
export async function launchCodeFingerprints(files: Pick<GameScripts, 'script'>, featuredMod: string): Promise<Map<string, string | null>> {
  const scripts = new Map<string, Promise<string | null>>();
  const fingerprints = new Map<string, string | null>();
  for (const code of WATCHED_CODE) {
    if (code.featuredMods && !code.featuredMods.includes(featuredMod)) {
      continue;
    }
    let script = scripts.get(code.file);
    if (!script) {
      script = files.script(code.file).catch(() => null);
      scripts.set(code.file, script);
    }
    const source = await script;
    let fingerprint: string | null = null;
    try {
      fingerprint = source === null ? null : pieceFingerprint(source, code.piece);
    } catch {
      // A script that does not even tokenize is a change as well.
    }
    fingerprints.set(watchedLabel(code), fingerprint);
  }
  return fingerprints;
}

/** The pieces of the featured mod whose code TFAF has not been checked against; empty when a start may go ahead. */
export async function unsupportedLaunchCode(
  files: Pick<GameScripts, 'script'>,
  featuredMod: string,
  supported: Readonly<Record<string, readonly string[]>> = SUPPORTED_LAUNCH_CODE,
): Promise<string[]> {
  const changed: string[] = [];
  for (const [label, fingerprint] of await launchCodeFingerprints(files, featuredMod)) {
    if (fingerprint === null || !supported[label]?.includes(fingerprint)) {
      changed.push(label);
    }
  }
  return changed;
}
