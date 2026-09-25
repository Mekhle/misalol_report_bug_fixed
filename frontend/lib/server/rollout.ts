import "server-only";

// Routes stay dark until their complete feature group has reached parity.
export function nativeCoreEnabled() {
  return process.env.MISA_NEXT_CORE_ROLLOUT === "true";
}