// Static classifications only: JWTs, claims and arbitrary server text never
// become diagnostics. PGRST303 alone does not establish clock skew as a cause.
export function safeSupabaseJwtIssue(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("code" in error) || error.code !== "PGRST303") return null;
  const message = "message" in error && typeof error.message === "string" ? error.message.toLowerCase() : "";
  if (/issued\s+(?:at|in)\s+(?:the\s+)?future/.test(message)) return "issued_in_future";
  if (/\bexpired\b|expiration|expiry/.test(message)) return "expired";
  if (/not\s+yet\s+valid|not\s+before/.test(message)) return "not_yet_valid";
  if (/signature/.test(message)) return "signature_validation";
  if (/parsing|parse|malformed/.test(message)) return "jwt_parsing";
  return "jwt_claims_validation";
}

/** Retry only an idempotent SELECT result, with identical query/auth settings.
 * This is deliberately not used for RPCs or writes. Validation remains enabled;
 * persistent invalid credentials still fail after the two short retries. */
export async function retrySnapshotSelect<T extends { error: { code?: string } | null }>(
  select: () => PromiseLike<T>, sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)),
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const result = await select();
    if (result.error?.code !== "PGRST303" || attempt >= 2) return result;
    await sleep(attempt === 0 ? 500 : 1500);
  }
}
