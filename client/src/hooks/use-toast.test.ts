import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { reducer, toast, useToast } from './use-toast';
import { renderHook, act } from '@testing-library/react';

// The reducer is a pure function we can test directly.
// ToasterToast at minimum needs an id property.

const makeToast = (id: string, title?: string) => ({
  id,
  title,
  open: true,
  onOpenChange: () => {},
});

describe('use-toast reducer', () => {
  const emptyState = { toasts: [] };

  // ── ADD_TOAST ───────────────────────────────────────────────────

  describe('ADD_TOAST', () => {
    it('adds a toast to empty state', () => {
      const result = reducer(emptyState, {
        type: 'ADD_TOAST',
        toast: makeToast('t1', 'Hello'),
      });
      expect(result.toasts).toHaveLength(1);
      expect(result.toasts[0].id).toBe('t1');
    });

    it('limits toasts to TOAST_LIMIT (1)', () => {
      const state1 = reducer(emptyState, {
        type: 'ADD_TOAST',
        toast: makeToast('t1', 'First'),
      });
      const state2 = reducer(state1, {
        type: 'ADD_TOAST',
        toast: makeToast('t2', 'Second'),
      });
      // TOAST_LIMIT is 1, so only most recent toast kept
      expect(state2.toasts).toHaveLength(1);
      expect(state2.toasts[0].id).toBe('t2');
    });
  });

  // ── UPDATE_TOAST ────────────────────────────────────────────────

  describe('UPDATE_TOAST', () => {
    it('updates an existing toast', () => {
      const state = reducer(emptyState, {
        type: 'ADD_TOAST',
        toast: makeToast('t1', 'Original'),
      });
      const updated = reducer(state, {
        type: 'UPDATE_TOAST',
        toast: { id: 't1', title: 'Updated' },
      });
      expect(updated.toasts[0].title).toBe('Updated');
    });

    it('does not affect non-matching toasts', () => {
      const state = reducer(emptyState, {
        type: 'ADD_TOAST',
        toast: makeToast('t1', 'Keep'),
      });
      const result = reducer(state, {
        type: 'UPDATE_TOAST',
        toast: { id: 'nonexistent', title: 'Nope' },
      });
      expect(result.toasts[0].title).toBe('Keep');
    });
  });

  // ── DISMISS_TOAST ───────────────────────────────────────────────

  describe('DISMISS_TOAST', () => {
    it('sets open to false for specific toast', () => {
      const state = reducer(emptyState, {
        type: 'ADD_TOAST',
        toast: makeToast('t1', 'Dismiss me'),
      });
      const dismissed = reducer(state, {
        type: 'DISMISS_TOAST',
        toastId: 't1',
      });
      expect(dismissed.toasts[0].open).toBe(false);
    });

    it('dismisses all toasts when no toastId', () => {
      const state = reducer(emptyState, {
        type: 'ADD_TOAST',
        toast: makeToast('t1'),
      });
      const dismissed = reducer(state, {
        type: 'DISMISS_TOAST',
      });
      expect(dismissed.toasts.every(t => t.open === false)).toBe(true);
    });
  });

  // ── REMOVE_TOAST ────────────────────────────────────────────────

  describe('REMOVE_TOAST', () => {
    it('removes a specific toast', () => {
      const state = reducer(emptyState, {
        type: 'ADD_TOAST',
        toast: makeToast('t1'),
      });
      const removed = reducer(state, {
        type: 'REMOVE_TOAST',
        toastId: 't1',
      });
      expect(removed.toasts).toHaveLength(0);
    });

    it('removes all toasts when no toastId', () => {
      const state = reducer(emptyState, {
        type: 'ADD_TOAST',
        toast: makeToast('t1'),
      });
      const removed = reducer(state, {
        type: 'REMOVE_TOAST',
      });
      expect(removed.toasts).toHaveLength(0);
    });
  });
});

// ── toast() function ──────────────────────────────────────────────

describe('toast function', () => {
  it('returns an object with id, dismiss, and update', () => {
    const result = toast({ title: 'Test toast' });
    expect(result.id).toBeDefined();
    expect(result.dismiss).toBeInstanceOf(Function);
    expect(result.update).toBeInstanceOf(Function);
  });

  it('returns unique ids for each toast', () => {
    const t1 = toast({ title: 'First' });
    const t2 = toast({ title: 'Second' });
    expect(t1.id).not.toBe(t2.id);
  });

  it('dismiss function does not throw', () => {
    const t = toast({ title: 'Dismissable' });
    expect(() => t.dismiss()).not.toThrow();
  });

  it('update function does not throw', () => {
    const t = toast({ title: 'Updatable' });
    expect(() => t.update({ id: t.id, title: 'Updated' } as any)).not.toThrow();
  });
});

// ── useToast hook ─────────────────────────────────────────────────

describe('useToast', () => {
  it('returns toast state and functions', () => {
    const { result } = renderHook(() => useToast());
    expect(result.current.toasts).toBeDefined();
    expect(result.current.toast).toBeInstanceOf(Function);
    expect(result.current.dismiss).toBeInstanceOf(Function);
  });

  it('toasts array is initially available', () => {
    const { result } = renderHook(() => useToast());
    expect(Array.isArray(result.current.toasts)).toBe(true);
  });

  it('dismiss does not throw when called', () => {
    const { result } = renderHook(() => useToast());
    expect(() => result.current.dismiss('nonexistent')).not.toThrow();
  });
});
