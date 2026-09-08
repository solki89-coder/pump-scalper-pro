import { describe, expect, it } from 'vitest';
import { lamportsToSol, solToLamports } from '../src/lamports.js';

describe('lamports conversions', () => {
  it('converts lamports to SOL', () => {
    expect(lamportsToSol(1_000_000_000)).toBe(1);
    expect(lamportsToSol(500_000_000)).toBe(0.5);
  });

  it('converts SOL to lamports, rounding to the nearest integer', () => {
    expect(solToLamports(1)).toBe(1_000_000_000);
    expect(solToLamports(0.000000001)).toBe(1);
    expect(solToLamports(0.1234567891)).toBe(123456789);
  });
});
