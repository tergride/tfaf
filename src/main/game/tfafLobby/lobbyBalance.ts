// The autobalance of the game's lobby (`GUI.PenguinAutoBalance`): of all the ways to split the players into two equal
// teams it takes the one closest to half of the total rating and half of the total uncertainty.

export interface BalanceRating {
  mean: number;
  deviation: number;
}

// Uncertainty counts for more than rating here, as in the game.
const DEVIATION_WEIGHT = 1.2;
// The order players are paired in: between their displayed and their base rating.
const SORT_DEVIATIONS = 2.2;

function sum(ratings: readonly BalanceRating[], field: keyof BalanceRating): number {
  return ratings.reduce((total, rating) => total + rating[field], 0);
}

/**
 * Two teams as indexes into `ratings`, whose length is even. The n-th players of the teams are of about the same
 * strength, and pairs are shuffled, so the same players do not always get the same side of the map.
 */
export function balancedTeams(ratings: readonly BalanceRating[], random: () => number = Math.random): [number[], number[]] {
  const value = (index: number): number => ratings[index]!.mean - ratings[index]!.deviation * SORT_DEVIATIONS;
  const order = ratings.map((_, index) => index).sort((a, b) => value(b) - value(a) || a - b);
  const size = order.length / 2;
  const goalMean = sum(ratings, 'mean') / 2;
  const goalDeviation = sum(ratings, 'deviation') / 2;

  // The strongest player stays on the first team: the splits without them are the same splits, mirrored.
  const team = [0];
  let best = team;
  let lowest = Infinity;
  const walk = (next: number): void => {
    if (team.length === size) {
      const members = team.map((position) => ratings[order[position]!]!);
      const imbalance = Math.abs(sum(members, 'deviation') - goalDeviation) * DEVIATION_WEIGHT + Math.abs(sum(members, 'mean') - goalMean);
      if (imbalance < lowest) {
        lowest = imbalance;
        best = [...team];
      }
      return;
    }
    for (let position = next; position <= order.length - (size - team.length); position++) {
      team.push(position);
      walk(position + 1);
      team.pop();
    }
  };
  walk(1);

  const first = [...best];
  const second = order.map((_, position) => position).filter((position) => !best.includes(position));
  for (let pair = 0; pair < size; pair++) {
    const other = Math.floor(random() * size);
    [first[pair], first[other]] = [first[other]!, first[pair]!];
    [second[pair], second[other]] = [second[other]!, second[pair]!];
  }
  return [first.map((position) => order[position]!), second.map((position) => order[position]!)];
}
