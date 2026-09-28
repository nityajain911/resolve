/** Indian-grouped rupee formatting: 240000 → "₹2,40,000". */
export function formatINR(amount: number): string {
  const negative = amount < 0;
  const [intPart, frac] = Math.abs(Math.round(amount * 100) / 100).toFixed(2).split(".");
  const last3 = intPart.slice(-3);
  const rest = intPart.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${last3}` : last3;
  return `${negative ? "-" : ""}₹${grouped}${frac === "00" ? "" : `.${frac}`}`;
}

/** Compact lakh/crore formatting: 240000 → "₹2.4L", 12500000 → "₹1.25Cr". */
export function formatCompactINR(amount: number): string {
  if (amount >= 1e7) return `₹${trim(amount / 1e7)}Cr`;
  if (amount >= 1e5) return `₹${trim(amount / 1e5)}L`;
  if (amount >= 1e3) return `₹${trim(amount / 1e3)}K`;
  return formatINR(amount);
}

function trim(n: number): string {
  return n.toFixed(2).replace(/\.?0+$/, "");
}

export function toPaise(rupees: number): number {
  return Math.round(rupees * 100);
}
