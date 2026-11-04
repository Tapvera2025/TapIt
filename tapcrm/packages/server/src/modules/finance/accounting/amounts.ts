export function decimalToMinor(value: string): bigint {
  const [whole = '0', fraction = ''] = value.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2));
}

export function decimalToBaseMinor(value: string, rate: string): bigint {
  const [whole = '0', fraction = ''] = rate.split('.');
  const scaledRate = BigInt(whole) * 100000000n + BigInt(fraction.padEnd(8, '0').slice(0, 8));
  return (decimalToMinor(value) * scaledRate + 5000000n) / 10000000n;
}

export function baseMinorToDecimal(value: bigint): string {
  return `${value / 100n}.${(value % 100n).toString().padStart(2, '0')}`;
}
