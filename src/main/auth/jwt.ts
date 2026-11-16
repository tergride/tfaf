/** Reads JWT claims without verifying the signature; the token is only inspected, never trusted for authorization. */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const payload = token.split('.')[1];
  if (!payload) {
    return null;
  }
  try {
    const decoded: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof decoded === 'object' && decoded !== null ? (decoded as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** FAF access tokens carry an HMAC in `ext.hmac` that the API and user service expect in the `X-HMAC` header. */
export function extractHmac(token: string): string | null {
  const ext = decodeJwtPayload(token)?.ext;
  if (typeof ext !== 'object' || ext === null) {
    return null;
  }
  const hmac = (ext as Record<string, unknown>).hmac;
  return typeof hmac === 'string' ? hmac : null;
}
