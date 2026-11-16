// TrueSkill match quality (Herbrich, Minka, Graepel 2007): the chance of a draw between the teams, 0..1, from the
// players' ratings. It is the formula jskills' TrueSkillCalculator.calculateMatchQuality gives the official client;
// teams are compared in order, each with the next.

export interface SkillRating {
  mean: number;
  deviation: number;
}

/** The skill-class width FAF uses (faf-client.true-skill.beta in the official client's application.yml). */
export const FAF_BETA = 240;

type Matrix = number[][];

function multiply(a: Matrix, b: Matrix): Matrix {
  return a.map((row) => b[0]!.map((_, column) => row.reduce((sum, value, index) => sum + value * b[index]![column]!, 0)));
}

function transpose(a: Matrix): Matrix {
  return a[0]!.map((_, column) => a.map((row) => row[column]!));
}

function add(a: Matrix, b: Matrix): Matrix {
  return a.map((row, i) => row.map((value, j) => value + b[i]![j]!));
}

function scale(a: Matrix, factor: number): Matrix {
  return a.map((row) => row.map((value) => value * factor));
}

/** Gauss-Jordan elimination with partial pivoting; the matrices here are symmetric positive definite. */
function invertWithDeterminant(matrix: Matrix): { inverse: Matrix; determinant: number } {
  const size = matrix.length;
  const work = matrix.map((row, i) => [...row, ...Array.from({ length: size }, (_, j) => (i === j ? 1 : 0))]);
  let determinant = 1;
  for (let column = 0; column < size; column++) {
    let pivot = column;
    for (let row = column + 1; row < size; row++) {
      if (Math.abs(work[row]![column]!) > Math.abs(work[pivot]![column]!)) {
        pivot = row;
      }
    }
    if (pivot !== column) {
      [work[pivot], work[column]] = [work[column]!, work[pivot]!];
      determinant = -determinant;
    }
    const lead = work[column]![column]!;
    determinant *= lead;
    work[column] = work[column]!.map((value) => value / lead);
    for (let row = 0; row < size; row++) {
      if (row !== column) {
        const factor = work[row]![column]!;
        work[row] = work[row]!.map((value, index) => value - factor * work[column]![index]!);
      }
    }
  }
  return { inverse: work.map((row) => row.slice(size)), determinant };
}

/** Null when a team is empty or there are fewer than two teams. */
export function matchQuality(teams: readonly (readonly SkillRating[])[], beta = FAF_BETA): number | null {
  if (teams.length < 2 || teams.some((team) => team.length === 0)) {
    return null;
  }
  const players = teams.flatMap((team, teamIndex) => team.map((rating) => ({ rating, teamIndex })));
  // One column per pair of neighbouring teams: +1 for the players of the first, -1 for those of the second.
  const comparison: Matrix = players.map(({ teamIndex }) =>
    Array.from({ length: teams.length - 1 }, (_, pair) => (teamIndex === pair ? 1 : teamIndex === pair + 1 ? -1 : 0)),
  );
  const means: Matrix = players.map(({ rating }) => [rating.mean]);
  const variances: Matrix = players.map(({ rating }, i) => players.map((_, j) => (i === j ? rating.deviation ** 2 : 0)));

  const comparisonT = transpose(comparison);
  const betaPart = scale(multiply(comparisonT, comparison), beta ** 2);
  const middle = add(betaPart, multiply(multiply(comparisonT, variances), comparison));
  const { inverse, determinant: middleDeterminant } = invertWithDeterminant(middle);
  const { determinant: betaDeterminant } = invertWithDeterminant(betaPart);

  const meanDifferences = multiply(comparisonT, means);
  const exponent = -0.5 * multiply(multiply(transpose(meanDifferences), inverse), meanDifferences)[0]![0]!;
  return Math.exp(exponent) * Math.sqrt(betaDeterminant / middleDeterminant);
}
