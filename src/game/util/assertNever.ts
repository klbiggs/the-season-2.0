// Exhaustive-switch helper for discriminated unions. Throw at runtime if a
// switch's default branch is reached — TS will refuse to compile the call site
// if the union still has unhandled members.

export function assertNever(x: never): never {
  throw new Error(`Unhandled discriminated-union case: ${JSON.stringify(x)}`);
}
