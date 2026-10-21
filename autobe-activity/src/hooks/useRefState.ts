import { useState, useRef, useCallback } from 'react';

/** useState + synchronized ref. `ref.current` is always fresh in callbacks/timeouts. */
export function useRefState<T>(
  initialValue: T | (() => T),
): [T, (value: T | ((prev: T) => T)) => void, React.RefObject<T>] {
  const [state, setStateInternal] = useState(initialValue);
  const ref = useRef(state);

  const setState = useCallback((value: T | ((prev: T) => T)) => {
    if (typeof value === 'function') {
      setStateInternal(prev => {
        const next = (value as (prev: T) => T)(prev);
        ref.current = next;
        return next;
      });
    } else {
      ref.current = value;
      setStateInternal(value);
    }
  }, []);

  return [state, setState, ref];
}
