/**
 * A stable string hash, used to derive display values from ids and words.
 *
 * Lives in `utils` rather than next to its first consumer because it is not a
 * component and three different surfaces need it: `ProfileImage` for avatar
 * colours, `interests.ts` for tag swatches, and anything else that needs "this
 * word always looks the same" without inventing a colour. `ProfileImage`
 * re-exports it so the existing import path keeps working.
 *
 * Not a cryptographic hash and not trying to be. It only has to be stable across
 * renders and platforms, which is what the 32-bit coercion is for.
 */
export function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    // Force a 32-bit int so the value is stable across platforms.
    hash |= 0;
  }
  return Math.abs(hash);
}