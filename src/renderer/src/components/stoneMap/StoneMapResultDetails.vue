<script setup lang="ts">
import { computed } from 'vue';
import type { MapResult } from '../../../../shared/contract.ts';
import { formatNumber } from '../../format.ts';
import { t } from '../../lib/i18n.ts';
import { biomeLabel, distributionLabel, islandModeLabel, mountainLabel, shoreLabel } from '../../lib/stoneMapLabels.ts';

const props = defineProps<{ result: MapResult }>();

const percent = (value: number, digits = 1): string => (value * 100).toFixed(digits);
const units = (value: number | null | undefined, digits = 1): string => (value ?? 0).toFixed(digits);

const navigation = computed(() => {
  const report = props.result.navigation;
  const profile = report?.selectedProfile ?? props.result.parameters.navigationProfile;
  return report?.profiles.find((candidate) => candidate.profile === profile) ?? null;
});

const stats = computed(() => {
  const { result } = props;
  const topology = result.topology;
  return [
    { label: t('stoneMap.result.generation'), value: t('stoneMap.result.seconds', { seconds: result.generationSeconds.toFixed(2) }) },
    {
      label: t('stoneMap.result.waterLand'),
      value: topology
        ? `${percent(topology.actualWaterRatio)}% / ${percent(1 - topology.actualWaterRatio)}%`
        : t('stoneMap.result.bySeed'),
    },
    { label: t('stoneMap.result.landComponents'), value: topology ? String(topology.landComponents) : '—' },
    { label: t('stoneMap.result.freeIslands'), value: topology ? String(topology.spawnFreeIslands) : '—' },
    { label: t('stoneMap.result.mexes'), value: formatNumber(result.counts.mexes) },
    { label: t('stoneMap.result.hydros'), value: formatNumber(result.counts.hydros) },
    {
      label: t('stoneMap.result.reclaim'),
      value: result.reclaim ? t('stoneMap.result.reclaimMass', { mass: formatNumber(Math.round(result.reclaim.totalMass)) }) : '—',
    },
    {
      label: t('stoneMap.result.navigation'),
      value: navigation.value
        ? t('stoneMap.result.reachable', { reachable: navigation.value.reachableSpawns, total: navigation.value.spawnCount })
        : t('stoneMap.result.navigationOff'),
      good: navigation.value?.allRequiredReachable === true,
    },
  ];
});

const lines = computed(() => {
  const { result } = props;
  const topology = result.topology;
  const out: string[] = [];
  const relief = topology?.relief;
  if (relief) {
    out.push(
      t('stoneMap.result.relief', {
        mountains: percent(relief.mountainRatio),
        depressions: percent(relief.depressionRatio),
        plains: percent(relief.plainRatio),
      }),
    );
    if (relief.structure) {
      out.push(
        t('stoneMap.result.mountainStructure', {
          style: mountainLabel(relief.structure.style),
          branches: relief.structure.branches,
          saddles: relief.structure.saddles,
        }),
      );
    }
  }
  if (topology?.coastalDetails) {
    out.push(t('stoneMap.result.coastalDetails', { samples: formatNumber(topology.coastalDetails.changedSamples) }));
  }
  if (topology?.waterSlopes) {
    out.push(
      t('stoneMap.result.waterSlopes', {
        edges: topology.waterSlopes.cliffEdges,
        passages: topology.waterSlopes.passageEdges,
        gaps: topology.waterSlopes.unexpectedGapEdges,
      }),
    );
  }
  if (topology?.bridgeShores) {
    out.push(t('stoneMap.result.bridgeShores', { shore: shoreLabel(topology.bridgeShores.shorelineStyle ?? 'DEFAULT') }));
  }
  if (result.decoration) {
    out.push(
      t('stoneMap.result.decoration', {
        coverage: result.decoration.coverage.map((zone) => `${biomeLabel(zone.biome)} ${percent(zone.fraction, 0)}%`).join(' · '),
        symmetry: result.decoration.settings.symmetry,
      }),
    );
  }
  if (topology?.erosion) {
    out.push(
      t('stoneMap.result.erosion', {
        strength: percent(topology.erosion.strength, 0),
        cut: units(topology.erosion.maximumCut, 2),
        deposit: units(topology.erosion.maximumDeposit, 2),
      }),
    );
  }
  if (result.scenery?.vegetation) {
    out.push(
      t('stoneMap.result.vegetation', {
        trees: formatNumber(result.scenery.vegetation.trees),
        moisture: percent(result.scenery.vegetation.meanMoisture, 0),
      }),
    );
  }
  if (topology?.lakes) {
    out.push(
      t('stoneMap.result.lakes', {
        lakes: topology.lakes.landlockedBodies,
        islands: topology.islands?.filter((island) => island.reservedForExpansion).length ?? 0,
      }),
    );
  }
  if (result.scenery) {
    out.push(t('stoneMap.result.scenery', { forests: result.scenery.forestGroups, ships: result.scenery.ships, shipyards: result.scenery.shipyards }));
    if (result.scenery.mountainFootRocks) {
      const rocks = result.scenery.mountainFootRocks;
      out.push(t('stoneMap.result.footRocks', { large: rocks.large, small: rocks.small, coverage: percent(rocks.coverage, 0) }));
    }
  }
  if (topology?.rivers) {
    const origins = [...new Set(topology.rivers.paths.map((river) => (river.origin === 'SEA' ? t('stoneMap.result.riverSea') : t('stoneMap.result.riverEdge'))))];
    out.push(t('stoneMap.result.rivers', { count: topology.rivers.count, origins: origins.join(', ') }));
  }
  if (topology?.randomSpawnFreeIslands) {
    out.push(t('stoneMap.result.randomFreeIslands', { count: topology.requestedSpawnFreeIslands }));
  }
  if (topology?.edgeContact) {
    const contact = topology.edgeContact;
    out.push(
      contact.applied
        ? t('stoneMap.result.edgeContact', { chance: percent(contact.requestedChance, 0), contacts: contact.contacts })
        : t('stoneMap.result.edgeContactNone', { chance: percent(contact.requestedChance, 0) }),
    );
  }
  if (topology?.spawnIslandMode && topology.spawnIslandMode !== 'AUTO') {
    const islands = (topology.spawnIslands ?? topology.islands ?? [])
      .filter((island) => island.spawnCount > 0)
      .map((island) =>
        t('stoneMap.result.spawnIsland', { id: island.id, players: island.spawnCount, teams: (island.teamIds ?? []).map((team) => team + 1).join('/') }),
      )
      .join(' · ');
    const check = result.adjustments
      ? t('stoneMap.result.spawnIslandsAdjusted')
      : topology.spawnIslandPlacementValid
        ? t('stoneMap.result.spawnIslandsChecked')
        : t('stoneMap.result.spawnIslandsFailed');
    out.push(t('stoneMap.result.spawnIslands', { mode: islandModeLabel(topology.spawnIslandMode), check, islands }));
  }
  if (topology?.teamBridges) {
    const bridges = topology.teamBridges;
    const links = new Set(bridges.paths.map((path) => [path.fromIsland, path.toIsland].sort((a, b) => a - b).join('-'))).size;
    out.push(t('stoneMap.result.teamBridges', { islands: bridges.requestedEnemyIslands, width: units(bridges.width, 0), links }));
  }
  const unitsPerRow = result.navigation?.unitsPerRow ?? 1;
  if (result.navigation && unitsPerRow > 1) {
    out.push(
      t('stoneMap.result.passages', { units: unitsPerRow, land: units(navigation.value?.minimumPassageWidth) }) +
        (result.navalNavigation?.minimumPassageWidth ? t('stoneMap.result.passagesWater', { water: units(result.navalNavigation.minimumPassageWidth) }) : ''),
    );
  }
  if (result.navalNavigation) {
    const naval = result.navalNavigation;
    out.push(
      t('stoneMap.result.naval', {
        state: naval.allMajorAreasConnected ? t('stoneMap.result.navalConnected') : t('stoneMap.result.navalGaps'),
        units: naval.unitsPerRow ?? 1,
        draft: naval.draft,
      }) +
        (naval.minimumPassageWidth ? t('stoneMap.result.navalWidth', { width: units(naval.minimumPassageWidth) }) : '') +
        ((naval.generationAttempts ?? 1) > 1 ? t('stoneMap.result.navalAttempts', { attempts: naval.generationAttempts ?? 1 }) : ''),
    );
  }
  const distances = result.teamSpawnDistances?.filter((team) => team.spawns > 1) ?? [];
  if (distances.length > 0) {
    out.push(
      t('stoneMap.result.teamDistances', {
        teams: distances
          .map((team) =>
            t('stoneMap.result.teamDistance', {
              team: team.team + 1,
              min: units(team.minimumDistance, 0),
              mean: units(team.meanDistance, 0),
              max: team.maximumDistance > 0 ? units(team.maximumDistance, 0) : '—',
            }),
          )
          .join(' / '),
      }),
    );
  }
  const placement = result.resourcePlacement;
  if (placement?.balance) {
    out.push(
      t('stoneMap.result.balance', {
        nearby: placement.balance.nearbyMexes,
        perPlayer: result.parameters.resourcePlacement?.nearbyMexesPerSpawn ?? '—',
        global: placement.balance.globalMexes,
        single: percent(placement.balance.singleFraction, 0),
      }),
    );
    if (placement.balance.styledMexes) {
      out.push(t('stoneMap.result.styledMexes', { styled: placement.balance.styledMexes, uniform: placement.balance.uniformMexes }));
    }
  }
  if (placement) {
    out.push(
      t('stoneMap.result.resources', {
        distribution: distributionLabel(placement.distribution),
        baseMex: placement.minimumMexesPerSpawn,
        baseHydro: placement.minimumHydrosPerSpawn,
        outsideMex: placement.mexesOutsideSpawns,
        outsideHydro: placement.hydrosOutsideSpawns,
      }) + (placement.waterMexes > 0 ? t('stoneMap.result.waterMexes', { count: placement.waterMexes }) : ''),
    );
    if (placement.mountainPocketMexes) {
      out.push(t('stoneMap.result.pocketMexes', { count: placement.mountainPocketMexes }));
    }
  }
  if (result.reefs) {
    out.push(
      result.reefs.count
        ? t('stoneMap.result.reefs', { count: result.reefs.count, width: units(result.reefs.minimumPassageWidth) })
        : t('stoneMap.result.reefsNone'),
    );
  }
  const buildAreas = result.spawnBuildAreas ?? [];
  if (buildAreas.length > 0) {
    out.push(
      t('stoneMap.result.buildArea', {
        radius: buildAreas[0]?.radius ?? 0,
        fraction: percent(Math.min(...buildAreas.map((area) => area.actualFraction))),
      }),
    );
  }
  if (result.settlements) {
    const settlements = result.settlements;
    out.push(
      settlements.count
        ? t('stoneMap.result.settlements', {
            count: settlements.count,
            buildings: settlements.units,
            factions: [...new Set(settlements.sites.map((site) => site.faction))].join(', '),
            distance: units(settlements.minimumSpawnDistance, 0),
          })
        : t('stoneMap.result.settlementsNone'),
    );
  }
  const azimuth = result.parameters.features?.sunAzimuth;
  if (azimuth !== null && azimuth !== undefined) {
    out.push(t('stoneMap.result.sun', { azimuth, shadows: (azimuth + 180) % 360 }));
  }
  if (result.environment) {
    const environment = result.environment;
    out.push(
      t('stoneMap.result.environment', {
        moisture: percent(environment.meanMoisture, 0),
        deposits: percent(environment.depositedFraction),
        rock: percent(environment.rockFraction),
      }) + (environment.snowFraction > 0 ? t('stoneMap.result.snow', { snow: percent(environment.snowFraction) }) : ''),
    );
  }
  return out;
});
</script>

<template>
  <div class="flex flex-col gap-2">
    <dl class="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
      <div v-for="stat in stats" :key="stat.label" class="flex flex-col rounded-md bg-muted/40 px-2.5 py-1.5">
        <dt class="text-xs text-muted-foreground">{{ stat.label }}</dt>
        <dd class="font-medium tabular-nums" :class="{ 'text-success': stat.good }">{{ stat.value }}</dd>
      </div>
    </dl>
    <ul class="flex flex-col gap-1 text-xs text-muted-foreground selectable">
      <li v-for="(line, index) in lines" :key="index">{{ line }}</li>
    </ul>
  </div>
</template>
