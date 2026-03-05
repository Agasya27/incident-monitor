import { describe, it, expect } from 'vitest';
import { queryClient } from './queryClient';

describe('queryClient', () => {
  it('is a QueryClient instance', () => {
    expect(queryClient).toBeDefined();
    expect(queryClient.getDefaultOptions).toBeDefined();
  });

  it('has staleTime: Infinity', () => {
    const opts = queryClient.getDefaultOptions();
    expect(opts.queries?.staleTime).toBe(Infinity);
  });

  it('has retry: false for queries', () => {
    const opts = queryClient.getDefaultOptions();
    expect(opts.queries?.retry).toBe(false);
  });

  it('has retry: false for mutations', () => {
    const opts = queryClient.getDefaultOptions();
    expect(opts.mutations?.retry).toBe(false);
  });

  it('has refetchOnWindowFocus: false', () => {
    const opts = queryClient.getDefaultOptions();
    expect(opts.queries?.refetchOnWindowFocus).toBe(false);
  });
});
