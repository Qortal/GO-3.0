import { createJSONStorage } from 'jotai/utils';

/**
 * JSON storage for jotai's atomWithStorage on window.localStorage. When
 * localStorage can't be reached it falls back to a store that reads nothing
 * and keeps nothing, so the atom just uses its default.
 */
export const localJsonStorage = <T>() =>
  createJSONStorage<T>(() => {
    try {
      return window.localStorage;
    } catch {
      return {
        getItem: () => null,
        setItem: () => undefined,
        removeItem: () => undefined,
      } as unknown as Storage;
    }
  });
