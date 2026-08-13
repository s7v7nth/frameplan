import { useEffect, useState } from 'react';
import { MIN_WALL_THICKNESS_MM, parseWallThicknessMm } from '../domain/numbers';

type Props = {
  value: number;
  min?: number;
  step?: number;
  onCommit: (n: number) => void;
  onFocus?: () => void;
};

/**
 * Numeric millimetre field that does not commit while typing.
 * Prevents sticky 0 / leading-zero displays like `0150`.
 */
export function MmField({
  value,
  min = MIN_WALL_THICKNESS_MM,
  step = 10,
  onCommit,
  onFocus,
}: Props) {
  const [draft, setDraft] = useState(() => String(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setDraft(String(value));
  }, [value, focused]);

  const commit = () => {
    const parsed = parseWallThicknessMm(draft, min);
    if (parsed == null) {
      setDraft(String(value));
      return;
    }
    setDraft(String(parsed));
    if (parsed !== value) onCommit(parsed);
  };

  return (
    <input
      type="number"
      min={min}
      step={step}
      value={draft}
      onFocus={() => {
        setFocused(true);
        onFocus?.();
      }}
      onChange={(e) => {
        const v = e.target.value;
        if (v === '' || /^\d*$/.test(v)) setDraft(v);
      }}
      onBlur={() => {
        commit();
        setFocused(false);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}
