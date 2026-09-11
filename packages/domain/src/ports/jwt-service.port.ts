import type { JwtClaims } from "../value-objects/jwt-claims.js";

// Implemented by adapters-security (JoseJwtService). verify() validates signature, algorithm
// (restricted to what sign() uses, preventing algorithm-confusion), issuer, audience, expiry,
// and not-before.
export interface JwtService {
  sign(claims: JwtClaims, expiresInSeconds: number): Promise<string>;
  verify(token: string): Promise<JwtClaims>;
}
