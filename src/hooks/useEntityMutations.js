import { useCallback, useMemo, useRef, useState } from 'react';

function normalizeMutationKey(key) {
  if (Array.isArray(key)) return key.filter(Boolean).join(':');
  return String(key || 'default');
}

export function useEntityMutations() {
  const countsRef = useRef(new Map());
  const [revision, setRevision] = useState(0);

  const beginMutation = useCallback((key) => {
    const normalizedKey = normalizeMutationKey(key);
    countsRef.current.set(normalizedKey, (countsRef.current.get(normalizedKey) || 0) + 1);
    setRevision((current) => current + 1);
    return normalizedKey;
  }, []);

  const endMutation = useCallback((key) => {
    const normalizedKey = normalizeMutationKey(key);
    const nextCount = Math.max(0, (countsRef.current.get(normalizedKey) || 0) - 1);
    if (nextCount) countsRef.current.set(normalizedKey, nextCount);
    else countsRef.current.delete(normalizedKey);
    setRevision((current) => current + 1);
  }, []);

  const runMutation = useCallback(async (key, mutation) => {
    const normalizedKey = beginMutation(key);
    try {
      return await mutation();
    } finally {
      endMutation(normalizedKey);
    }
  }, [beginMutation, endMutation]);

  return useMemo(() => ({
    beginMutation,
    endMutation,
    runMutation,
    isMutating: (key) => (countsRef.current.get(normalizeMutationKey(key)) || 0) > 0,
    anyMutating: countsRef.current.size > 0,
    activeMutationKeys: [...countsRef.current.keys()],
  }), [beginMutation, endMutation, revision, runMutation]);
}

export { normalizeMutationKey };
