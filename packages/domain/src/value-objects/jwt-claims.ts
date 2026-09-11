// Minimal claim set this system uses. JwtService.verify() returns exactly this shape, having
// already validated issuer/audience/algorithm/expiry/not-before at the adapter boundary.
export interface JwtClaims {
  readonly userId: string;
  readonly organizationId: string;
}
