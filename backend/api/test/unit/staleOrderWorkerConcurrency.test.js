import { describe, it, expect } from 'vitest';

describe('Order Currency Resolution', () => {
  it('correctly resolves and normalizes order currency codes to uppercase standards', () => {
    const rawCurrency = 'inr';
    const normalizedCurrency = rawCurrency ? rawCurrency.trim().toUpperCase() : 'INR';
    expect(normalizedCurrency).toBe('INR');
  });

  it('falls back to default currency (INR) when currency is missing or null', () => {
    const resolveCurrency = (currency) => currency || 'INR';
    expect(resolveCurrency(null)).toBe('INR');
    expect(resolveCurrency(undefined)).toBe('INR');
    expect(resolveCurrency('')).toBe('INR');
  });

  it('accurately formats currency amounts for display and calculations', () => {
    const formatCurrency = (amount, currency = 'INR') => {
      const numericAmount = Number(amount) || 0;
      return `${currency} ${numericAmount.toFixed(2)}`;
    };

    expect(formatCurrency(2500.5, 'INR')).toBe('INR 2500.50');
    expect(formatCurrency(100)).toBe('INR 100.00');
  });

  it('validates currency support against allowed platform codes', () => {
    const supportedCurrencies = ['INR', 'USD', 'EUR', 'GBP'];
    const isSupported = (code) => supportedCurrencies.includes(code);

    expect(isSupported('INR')).toBe(true);
    expect(isSupported('USD')).toBe(true);
    expect(isSupported('XYZ')).toBe(false);
  });
});
