import { inject, type InjectionKey, type Ref } from 'vue';

/** The settings the generator picks from the seed, shared by the fields of the StoneMap form. */
export interface RandomChoice {
  random: Ref<string[]>;
  toggle(path: string, enabled: boolean): void;
}

export const RANDOM_CHOICE: InjectionKey<RandomChoice> = Symbol('stoneMapRandom');

/** The select value that stands for a setting left to the seed. */
export const RANDOM_VALUE = '__random__';

/** Topology settings left to the seed make every dependent field selectable, as in StoneMap's editor. */
const TOPOLOGY_PATHS = ['topology.kind', 'topology.mode', 'topology.symmetryPattern'];

export function useRandomChoice() {
  const choice = inject(RANDOM_CHOICE);
  if (!choice) {
    throw new Error('StoneMap fields need the form');
  }
  return {
    isRandom: (path: string | undefined): boolean => path !== undefined && choice.random.value.includes(path),
    randomTopology: (): boolean => TOPOLOGY_PATHS.some((path) => choice.random.value.includes(path)),
    toggle: choice.toggle,
  };
}
