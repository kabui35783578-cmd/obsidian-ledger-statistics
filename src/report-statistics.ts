/** Fixed-margin, weekday-stratified exact upper tail for same-day co-occurrence.
 * Conditions on each weekday's marginals instead of treating Bernoulli days as Poisson counts.
 * Exploratory screening only: serial dependence and unmeasured context still remain.
 */
export function stratifiedAssociationTail(strata: Array<{ days: number; a: number; b: number }>, observed: number): { p: number; expected: number } {
  const chooseLog = (n: number, k: number) => {
    if (k < 0 || k > n) return -Infinity;
    let value = 0;
    for (let i = 1; i <= Math.min(k, n - k); i++) value += Math.log(n - i + 1) - Math.log(i);
    return value;
  };
  let distribution = [1], expected = 0;
  for (const s of strata) {
    if (!s.days) continue;
    expected += s.a * s.b / s.days;
    const pmf = Array(Math.min(s.a, s.b) + 1).fill(0) as number[];
    for (let k = Math.max(0, s.a + s.b - s.days); k < pmf.length; k++) pmf[k] = Math.exp(chooseLog(s.b, k) + chooseLog(s.days - s.b, s.a - k) - chooseLog(s.days, s.a));
    const mass = pmf.reduce((a, b) => a + b, 0);
    if (!mass) return { p: 1, expected };
    const next = Array(distribution.length + pmf.length - 1).fill(0) as number[];
    distribution.forEach((a, i) => pmf.forEach((b, j) => next[i + j] += a * b / mass));
    distribution = next;
  }
  return { p: Math.min(1, distribution.slice(Math.max(0, observed)).reduce((a, b) => a + b, 0)), expected };
}
