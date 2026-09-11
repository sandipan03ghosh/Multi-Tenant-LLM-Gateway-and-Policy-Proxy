// Construction-time invariant violation, raised by every entity's create() factory. One error
// class with a field/reason pair rather than a bespoke class per field.
export class DomainValidationError extends Error {
  constructor(
    public readonly entity: string,
    public readonly field: string,
    public readonly reason: string,
  ) {
    super(`${entity}.${field}: ${reason}`);
    this.name = "DomainValidationError";
  }
}
