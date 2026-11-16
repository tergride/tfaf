import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { balancedTeams } from '../src/main/game/tfafLobby/lobbyBalance.ts';
import { categoryMatcher, loadUnitCatalog, readRestrictionPresets } from '../src/main/gameOptions/unitCatalog.ts';
import { forbiddenUnits, joinRestrictions, splitRestrictions, togglePreset, toggleUnit, unitSections } from '../src/renderer/src/lib/unitRestrictions.ts';
import type { LobbyUnit } from '../src/shared/contract.ts';

const RESTRICTIONS = `
Expressions = {
    T4 = "(EXPERIMENTAL - (MOBILE * ENGINEER))",
    RAS = "(SUBCOMMANDER * ResourceAllocation)",
    HIDDEN = "AIR",
}
Enhancements = {
    RAS = { "ResourceAllocation", "ResourceAllocationRemove" },
    BILLY = { "TacticalNukeMissile" },
}
local presetsOrder = {
    "",
    "T4",
    "", -- preset separator
    --"", -- preset separator
    "RAS",
    "BILLY",
    "HIDDEN",
}
local function CreatePresets()
    CreatePreset("T4",
        "<LOC t4_help>No experimentals",
        "<LOC t4_name>No T4",
        "/textures/ui/common/icons/presets/tech-4.dds")
    CreatePreset("RAS",
        "Prevents RAS",
        "No RAS",
        "/textures/ui/common/icons/presets/enh-ras-icon.dds")
    CreatePreset("BILLY",
        "Prevents Billy",
        "No Billy",
        "/textures/ui/common/icons/presets/enh-billy-icon.dds")
end
`;

const ANALYZER = `
CategoriesAllowed = { ["SATELLITE"] = true }
CategoriesSkipped = { ["UNTARGETABLE"] = true, ["CIVILIAN"] = true, ["uab5103"] = true }
`;

function blueprint(categories: string[], extra = ''): string {
  return `UnitBlueprint { Description = "<LOC x_desc>Thing", Categories = { ${categories.map((category) => `"${category}"`).join(', ')} }, Audio = { Open = Sound { Bank = 'A', Cue = 'B' } }, ${extra} }`;
}

/** A DXT5 texture of one block, which is all `readDds` wants of an icon. */
function ddsIcon(): Buffer {
  const file = Buffer.alloc(128 + 16);
  file.writeUInt32LE(0x20534444, 0);
  file.writeUInt32LE(4, 12);
  file.writeUInt32LE(4, 16);
  file.writeUInt32LE(0x4, 80);
  file.write('DXT5', 84, 'latin1');
  return file;
}

const GAME_FILES: Record<string, string> = {
  '/units/uel0401/uel0401_unit.bp': blueprint(['UEF', 'EXPERIMENTAL', 'LAND', 'MOBILE'], 'General = { UnitName = "<LOC x_name>Fatboy" }'),
  '/units/uel0001/uel0001_unit.bp': blueprint(['UEF', 'COMMAND', 'LAND', 'MOBILE'], `Enhancements = {
    Slots = { Back = { x = 1 } },
    TacticalNukeMissile = { Name = "Billy", Icon = "tnm", Slot = "RCH" },
    TacticalNukeMissileRemove = { Name = "Remove", Slot = "RCH" },
  }`),
  '/units/uel0301/uel0301_unit.bp': blueprint(['UEF', 'SUBCOMMANDER', 'TECH3', 'LAND', 'MOBILE', 'USEBUILDPRESETS'], `Enhancements = {
    ResourceAllocation = { Name = "RAS", Icon = "ras", Slot = "Back" },
  },
  EnhancementPresets = { RAS = { UnitName = "SACU (RAS)", Enhancements = { "ResourceAllocation" } } }`),
  '/units/ueb5101/ueb5101_unit.bp': blueprint(['UEF', 'TECH1', 'STRUCTURE', 'WALL']),
  '/units/uab5103/uab5103_unit.bp': blueprint(['AEON', 'TECH1', 'STRUCTURE']),
  '/units/ueb9999/ueb9999_unit.bp': blueprint(['UEF', 'TECH1', 'UNTARGETABLE']),
  '/units/tmai2824/tmai2824_unit.bp': blueprint(['TECH1', 'STRUCTURE']),
};
const ICONS = new Set([
  '/textures/ui/common/icons/units/uel0401_icon.dds',
  '/textures/ui/common/game/uef-enhancements/tnm_btn_up.dds',
  '/textures/ui/common/icons/presets/tech-4.dds',
]);

describe('team balance', () => {
  it('finds the split nearest to half of the rating and of the uncertainty', () => {
    const ratings = [2000, 1900, 500, 400].map((mean) => ({ mean, deviation: 50 }));
    const [first, second] = balancedTeams(ratings, () => 0);
    const total = (team: number[]): number => team.reduce((sum, index) => sum + ratings[index]!.mean, 0);
    assert.equal(Math.abs(total(first) - total(second)), 0);
    assert.deepEqual([...first, ...second].sort((a, b) => a - b), [0, 1, 2, 3]);
  });

  it('weighs a team of uncertain players as the game does', () => {
    const ratings = [
      { mean: 1000, deviation: 500 },
      { mean: 1000, deviation: 500 },
      { mean: 1000, deviation: 50 },
      { mean: 1000, deviation: 50 },
    ];
    const [first] = balancedTeams(ratings, () => 0);
    assert.equal(first.filter((index) => index < 2).length, 1);
  });

  it('holds two players', () => {
    const [first, second] = balancedTeams([{ mean: 900, deviation: 0 }, { mean: 1000, deviation: 0 }], () => 0);
    assert.deepEqual([first, second], [[1], [0]]);
  });
});

describe('category expressions', () => {
  const unit = (id: string, ...categories: string[]) => ({ id, categories: new Set(categories) });

  it('read operators strictly from left to right, like the game', () => {
    const matches = categoryMatcher('AIR + LAND * TECH1');
    assert.equal(matches(unit('a', 'AIR', 'TECH3')), false);
    assert.equal(matches(unit('a', 'LAND', 'TECH1')), true);
  });

  it('honour brackets and subtraction', () => {
    const matches = categoryMatcher('(TECH1 - (MOBILE * ENGINEER) + xrl0002)');
    assert.equal(matches(unit('a', 'TECH1', 'MOBILE')), true);
    assert.equal(matches(unit('a', 'TECH1', 'MOBILE', 'ENGINEER')), false);
    assert.equal(matches(unit('xrl0002')), true);
  });

  it('take a unit id in any case and keep upgrade names apart', () => {
    assert.equal(categoryMatcher('url0301_AntiAir')(unit('url0301_antiair')), true);
    assert.equal(categoryMatcher('SUBCOMMANDER * Pod')(unit('a', 'SUBCOMMANDER', 'Pod')), true);
    assert.equal(categoryMatcher('SUBCOMMANDER * Pod')(unit('a', 'SUBCOMMANDER', 'POD')), false);
  });
});

describe('restriction presets', () => {
  it('name the groups of the game, and one the launcher does not know stays unnamed', () => {
    const lua = `
Expressions = { T1 = "TECH1", T2 = "TECH2", FABS = "ECONOMIC", NEW = "AIR" }
local presetsOrder = { "", "T1", "T2", "", "NEW", "", "FABS" }
local function CreatePresets()
    CreatePreset("T1", "a", "b", "c")
    CreatePreset("T2", "a", "b", "c")
    CreatePreset("NEW", "a", "b", "c")
    CreatePreset("FABS", "a", "b", "c")
end`;
    assert.deepEqual(readRestrictionPresets(lua, (text) => text).map(({ key, group }) => [key, group]), [['T1', 'tech'], ['T2', 'tech'], ['NEW', 'other'], ['FABS', 'economy']]);
  });

  it('follow the game order and leave out what the game does not make', () => {
    const presets = readRestrictionPresets(RESTRICTIONS, (text) => text.replace(/<LOC \w+>/, ''));
    assert.deepEqual(presets.map(({ key }) => key), ['T4', 'RAS', 'BILLY']);
    assert.equal(presets[0]!.name, 'No T4');
    assert.equal(presets[0]!.help, 'No experimentals');
    assert.deepEqual(presets[1]!.enhancements, ['ResourceAllocation', 'ResourceAllocationRemove']);
  });
});

describe('unit catalog', () => {
  let workDir = '';

  before(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), 'tfaf-unit-catalog-'));
    const mod = path.join(workDir, 'mod', 'units', 'XEL0999');
    await mkdir(mod, { recursive: true });
    await writeFile(path.join(mod, 'XEL0999_unit.bp'), blueprint(['UEF', 'EXPERIMENTAL', 'AIR', 'MOBILE']));
    await writeFile(path.join(mod, 'XEL0999_icon.dds'), ddsIcon());
    await mkdir(path.join(workDir, 'merge', 'units', 'UEL0401'), { recursive: true });
    await writeFile(path.join(workDir, 'merge', 'units', 'UEL0401', 'UEL0401_unit.bp'), 'UnitBlueprint { Merge = true, BlueprintId = "uel0401", Categories = { "UEF" } }');
  });
  after(() => rm(workDir, { recursive: true, force: true }));

  const scripts: Record<string, string> = { '/lua/ui/lobby/unitsrestrictions.lua': RESTRICTIONS, '/lua/ui/lobby/unitsanalyzer.lua': ANALYZER };
  const strings = '/loc/us/strings_db.lua';
  const load = () =>
    loadUnitCatalog({
      locale: 'en',
      files: {
        list: (folder) => Promise.resolve(folder === '/loc' ? [strings] : Object.keys(GAME_FILES)),
        read: (gamePath) =>
          Promise.resolve(
            gamePath === strings
              ? Buffer.from('x_name = "Fatboy"\nx_desc = "Thing"\n')
              : GAME_FILES[gamePath]
                ? Buffer.from(GAME_FILES[gamePath])
                : ICONS.has(gamePath)
                  ? ddsIcon()
                  : null,
          ),
        script: (gamePath) => Promise.resolve(scripts[`/${gamePath.replace(/^\//, '')}`.toLowerCase()] ?? null),
      },
      modFolders: [path.join(workDir, 'mod'), path.join(workDir, 'merge')],
    });

  it('lists what the Unit Manager lists, and no commander', async () => {
    const { units } = await load();
    assert.deepEqual(units.map((unit) => [unit.id, unit.group]), [
      ['xel0999', 'air'],
      ['uel0401', 'land'],
      ['ueb5101', 'support'],
      ['uel0301_ras', 'scu'],
      ['uel0301', 'scu'],
      ['ResourceAllocation', 'scu'],
      ['TacticalNukeMissile', 'acu'],
    ]);
    const fatboy = units.find((unit) => unit.id === 'uel0401')!;
    assert.equal(fatboy.name, 'Fatboy');
    assert.equal(fatboy.tech, 'T4');
    assert.equal(fatboy.faction, 'UEF');
  });

  it('marks what a mod brought and finds its icon next to it', async () => {
    const { units } = await load();
    const modded = units.find((unit) => unit.id === 'xel0999')!;
    assert.equal(modded.modded, true);
    assert.equal(modded.icon?.format, 'dxt5');
    assert.equal(units.find((unit) => unit.id === 'uel0401')!.modded, false);
  });

  it('finds an upgrade by its icon name and takes up the units of a commander preset', async () => {
    const { units } = await load();
    assert.ok(units.find((unit) => unit.id === 'TacticalNukeMissile')!.icon);
    assert.equal(units.find((unit) => unit.id === 'uel0301_ras')!.name, 'SACU (RAS)');
  });

  it('says what each preset forbids, upgrades included', async () => {
    const { covers, presetIcons } = await load();
    assert.deepEqual(covers.T4?.sort(), ['uel0401', 'xel0999']);
    assert.deepEqual(covers.RAS?.sort(), ['ResourceAllocation', 'uel0301_ras']);
    assert.deepEqual(covers.BILLY, ['TacticalNukeMissile']);
    assert.ok(presetIcons.T4);
    assert.equal(presetIcons.RAS, null);
  });
});

describe('unit sections', () => {
  const unit = (id: string, group: LobbyUnit['group'], tech: LobbyUnit['tech']) => ({ id, group, tech });
  const units = [unit('a', 'air', 'T2'), unit('b', 'air', 'T1'), unit('c', 'land', 'T4'), unit('d', 'land', 'T1'), unit('e', 'scu', null)];
  const ids = (sections: ReturnType<typeof unitSections<(typeof units)[number]>>) =>
    sections.map((section) => [section.group ?? section.tier, section.rows.map((row) => [row.tier, row.units.map(({ id }) => id).join('')])]);

  it('stand under their type', () => {
    assert.deepEqual(ids(unitSections(units, 'type')), [['air', [[null, 'ab']]], ['land', [[null, 'cd']]], ['scu', [[null, 'e']]]]);
  });

  it('stand under their level, upgrades last', () => {
    assert.deepEqual(ids(unitSections(units, 'tier')).map(([heading]) => heading), ['T1', 'T2', 'T4', null]);
    assert.deepEqual(unitSections(units, 'tier')[0]?.rows[0]?.units.map(({ id }) => id), ['b', 'd']);
    assert.equal(unitSections(units, 'tier').at(-1)?.group, null);
  });

  it('stand by level within each type', () => {
    assert.deepEqual(ids(unitSections(units, 'both')), [
      ['air', [['T1', 'b'], ['T2', 'a']]],
      ['land', [['T1', 'd'], ['T4', 'c']]],
      ['scu', [[null, 'e']]],
    ]);
  });
});

describe('restriction choice', () => {
  const covers = { T4: ['uel0401', 'ual0401'], NUKES: ['uel0401', 'ueb2305'], RAS: ['ResourceAllocation'] };
  const keys = new Set(Object.keys(covers));
  const known = new Set(['uel0401', 'ual0401', 'ueb2305', 'ResourceAllocation', 'xel0999']);

  it('tells presets from single units', () => {
    const choice = splitRestrictions(['T4', 'xel0999'], keys);
    assert.deepEqual([...choice.presets], ['T4']);
    assert.deepEqual([...choice.units], ['xel0999']);
    assert.deepEqual([...forbiddenUnits(choice, covers)].sort(), ['ual0401', 'uel0401', 'xel0999']);
  });

  it('adds a unit next to a preset', () => {
    const choice = toggleUnit(splitRestrictions(['T4'], keys), 'xel0999', covers);
    assert.deepEqual(joinRestrictions(choice, covers, known), ['T4', 'xel0999']);
  });

  it('breaks up only the presets that forbid the unit being allowed', () => {
    const choice = toggleUnit(splitRestrictions(['T4', 'NUKES', 'RAS'], keys), 'uel0401', covers);
    assert.deepEqual(joinRestrictions(choice, covers, known), ['RAS', 'ual0401', 'ueb2305']);
  });

  it('forgets a single unit a preset takes over, and one that left with a mod', () => {
    const choice = togglePreset(splitRestrictions(['ual0401', 'gone0001'], keys), 'T4');
    assert.deepEqual(joinRestrictions(choice, covers, known), ['T4']);
  });

  it('lifts a preset', () => {
    const choice = togglePreset(splitRestrictions(['T4', 'xel0999'], keys), 'T4');
    assert.deepEqual(joinRestrictions(choice, covers, known), ['xel0999']);
  });
});
