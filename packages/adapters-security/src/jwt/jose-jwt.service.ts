import { SignJWT, jwtVerify } from "jose";
import type { JwtService, JwtClaims } from "@llm-gateway/domain";

// HS256 secrets should be at least the hash output length (256 bits = 32 chars). Rejecting
// anything shorter at construction makes a missing/weak secret fail at startup.
const MIN_SECRET_LENGTH = 32;

export interface JoseJwtServiceConfig {
  readonly secret: string;
  readonly issuer: string;
  readonly audience: string;
}

// Implements JwtService using jose. The secret is supplied by the caller from server-side config
// — no hardcoded or default fallback; a missing/weak secret throws.
export class JoseJwtService implements JwtService {
  private readonly secretKey: Uint8Array;
  private readonly issuer: string;
  private readonly audience: string;

  constructor(config: JoseJwtServiceConfig) {
    if (!config.secret || config.secret.length < MIN_SECRET_LENGTH) {
      throw new Error(
        `JWT secret must be provided via secure server-side configuration and be at least ` +
          `${MIN_SECRET_LENGTH} characters — refusing to start with a missing, empty, or weak secret.`,
      );
    }
    this.secretKey = new TextEncoder().encode(config.secret);
    this.issuer = config.issuer;
    this.audience = config.audience;
  }

  async sign(claims: JwtClaims, expiresInSeconds: number): Promise<string> {
    return new SignJWT({ organizationId: claims.organizationId })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(claims.userId)
      .setIssuer(this.issuer)
      .setAudience(this.audience)
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) + expiresInSeconds)
      .sign(this.secretKey);
  }

  async verify(token: string): Promise<JwtClaims> {
    // jwtVerify enforces, besides the signature: algorithms restricted to ["HS256"] (prevents
    // algorithm-confusion), issuer, audience, expiry, and not-before when present.
    const { payload } = await jwtVerify(token, this.secretKey, {
      issuer: this.issuer,
      audience: this.audience,
      algorithms: ["HS256"],
    });

    if (typeof payload.sub !== "string" || typeof payload.organizationId !== "string") {
      throw new Error("JWT payload missing required claims");
    }

    return { userId: payload.sub, organizationId: payload.organizationId };
  }
}
