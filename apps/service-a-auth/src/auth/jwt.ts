import { SignJWT, jwtVerify, type JWTPayload } from 'jose';

/**
 * Symmetric HMAC secret used by both signer and verifier. In production
 * swap for an asymmetric key (RS256 / EdDSA) so the verifier never sees
 * the signing material — `jose.importSPKI` + a JWKS endpoint covers that
 * path with the same `jwtVerify` call below.
 *
 * The default is a static dev-only string for tests; production code
 * must read JWT_SECRET from the environment.
 */
const ALG = 'HS256';

export function getSecret(): Uint8Array {
  const raw = process.env.JWT_SECRET ?? 'dev-secret-do-not-use-in-prod';
  return new TextEncoder().encode(raw);
}

export interface SignedClaims extends JWTPayload {
  sub: string;
  scope?: string;
}

/** Sign a short-lived bearer token. Use a real issuer + audience in prod. */
export async function signToken(
  claims: SignedClaims,
  ttlSeconds = 60,
  secret: Uint8Array = getSecret(),
): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .setIssuer('grpc-monorepo-starter')
    .setAudience('orders.v1')
    .sign(secret);
}

/** Verify a token and return its claims, or throw on any failure. */
export async function verifyToken(
  token: string,
  secret: Uint8Array = getSecret(),
): Promise<SignedClaims> {
  const { payload } = await jwtVerify(token, secret, {
    issuer: 'grpc-monorepo-starter',
    audience: 'orders.v1',
  });
  if (typeof payload.sub !== 'string') {
    throw new Error('jwt: missing sub claim');
  }
  return payload as SignedClaims;
}
