// Launcher versions are `major.minor.patch`; betas add a pre-release part, such as `0.17.0-beta.1`. Release tags add a
// leading `v`.

const VERSION = /^v?(\d{1,9})\.(\d{1,9})\.(\d{1,9})(?:-([0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*))?$/;

/** `1.2.3` for `1.2.3` or `v1.2.3`, `1.2.3-beta.1` for a beta; null for anything else. */
export function parseVersion(text: string): string | null {
  const match = VERSION.exec(text.trim());
  if (!match) {
    return null;
  }
  const release = `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}`;
  return match[4] ? `${release}-${match[4]}` : release;
}

/** A beta or another pre-release; parsed versions only. */
export function isPrerelease(version: string): boolean {
  return version.includes('-');
}

function comparePrereleaseParts(a: string, b: string): number {
  const left = a.split('.');
  const right = b.split('.');
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const x = left[index];
    const y = right[index];
    if (x === undefined || y === undefined) {
      return x === undefined ? -1 : 1;
    }
    const xNumber = /^\d+$/.test(x);
    const yNumber = /^\d+$/.test(y);
    if (xNumber && yNumber) {
      const difference = Number(x) - Number(y);
      if (difference !== 0) {
        return difference;
      }
    } else if (xNumber !== yNumber) {
      return xNumber ? -1 : 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

/**
 * Negative when `a` is older than `b`, positive when it is newer; both are parsed versions. As in semver, a beta comes
 * before its release (`0.17.0-beta.2` < `0.17.0`) and after the release before it.
 */
export function compareVersions(a: string, b: string): number {
  const [leftRelease = '', leftPre] = a.split('-', 2);
  const [rightRelease = '', rightPre] = b.split('-', 2);
  const left = leftRelease.split('.').map(Number);
  const right = rightRelease.split('.').map(Number);
  for (let index = 0; index < 3; index++) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  if (leftPre === undefined || rightPre === undefined) {
    return leftPre === rightPre ? 0 : leftPre === undefined ? 1 : -1;
  }
  return comparePrereleaseParts(leftPre, rightPre);
}
