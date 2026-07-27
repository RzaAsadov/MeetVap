import { useCallback, useRef } from 'react';

export function useStableCallback<Args extends unknown[], Result>(
  callback: (...args: Args) => Result,
) {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  return useCallback((...args: Args) => callbackRef.current(...args), []);
}
