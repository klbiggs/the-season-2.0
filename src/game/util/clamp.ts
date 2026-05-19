// Generic 3-arg numeric clamp used by combat resolver, aging orphan-prune
// affection clamp, and the sendBallroomMessage targeted-Immer-draft mutation
// site. Lives in src/game/util/ so game-rules and store actions can both
// import it (game-util is on the game-rules allow list).
//
// CLAUDE.md non-negotiable §6: "Clamp affection/composure/reputation/scandal/
// favor/hostility/happiness at every mutation site." Reuse this helper at
// every mutation site rather than inlining `Math.min/Math.max` calls.
export function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}
