import { Injectable } from '@nestjs/common';
import { UnsupportedUnitError } from './unsupported-unit.error';

// kg equivalent of one unit — the only place a new unit (e.g. "stone":
// 6.35029318) needs to be added.
const KG_PER_UNIT: Record<string, number> = {
  kg: 1,
  lb: 0.45359237,
};

@Injectable()
export class UnitConversionService {
  isSupported(unit: string): boolean {
    return Object.prototype.hasOwnProperty.call(KG_PER_UNIT, unit);
  }

  toKg(value: number, unit: string): number {
    return value * this.factorFor(unit);
  }

  fromKg(valueKg: number, unit: string): number {
    return valueKg / this.factorFor(unit);
  }

  private factorFor(unit: string): number {
    const factor = KG_PER_UNIT[unit];
    if (factor === undefined) {
      throw new UnsupportedUnitError(unit);
    }
    return factor;
  }
}
