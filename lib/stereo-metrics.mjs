/**
 * Lightweight stereo image measurements for offline-rendered buffers.
 * Returns energy ratios rather than imposing a genre-independent width target.
 */
export function measureStereoImage(left, right) {
  if (!left || !right || left.length !== right.length || left.length === 0) {
    return { correlation: null, midRms: null, sideRms: null, sideToMidDb: null, widthPercent: null };
  }
  let leftSum = 0, rightSum = 0, leftSq = 0, rightSq = 0, cross = 0;
  let midPower = 0, sidePower = 0;
  for (let i = 0; i < left.length; i++) {
    const l = Number(left[i]) || 0;
    const r = Number(right[i]) || 0;
    leftSum += l; rightSum += r;
    leftSq += l * l; rightSq += r * r; cross += l * r;
    const mid = (l + r) * 0.5;
    const side = (l - r) * 0.5;
    midPower += mid * mid;
    sidePower += side * side;
  }
  const count = left.length;
  const covariance = cross - (leftSum * rightSum / count);
  const leftVariance = leftSq - (leftSum * leftSum / count);
  const rightVariance = rightSq - (rightSum * rightSum / count);
  const correlation = leftVariance > 0 && rightVariance > 0
    ? Math.max(-1, Math.min(1, covariance / Math.sqrt(leftVariance * rightVariance)))
    : 0;
  const sideToMidDb = midPower > 0
    ? (sidePower > 0 ? 10 * Math.log10(sidePower / midPower) : -Infinity)
    : null;
  const total = midPower + sidePower;
  return {
    correlation,
    midRms: Math.sqrt(midPower / count),
    sideRms: Math.sqrt(sidePower / count),
    sideToMidDb,
    widthPercent: total > 0 ? (sidePower / total) * 100 : 0
  };
}
