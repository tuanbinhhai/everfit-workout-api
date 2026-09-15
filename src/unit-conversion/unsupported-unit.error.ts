export class UnsupportedUnitError extends Error {
  constructor(public readonly unit: string) {
    super(`Unsupported weight unit: "${unit}"`);
    this.name = 'UnsupportedUnitError';
  }
}
