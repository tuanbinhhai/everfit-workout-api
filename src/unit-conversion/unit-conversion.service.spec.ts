import { UnitConversionService } from './unit-conversion.service';
import { UnsupportedUnitError } from './unsupported-unit.error';

describe('UnitConversionService', () => {
  let service: UnitConversionService;

  beforeEach(() => {
    service = new UnitConversionService();
  });

  describe('isSupported', () => {
    it('returns true for kg and lb', () => {
      expect(service.isSupported('kg')).toBe(true);
      expect(service.isSupported('lb')).toBe(true);
    });

    it('returns false for an unsupported unit', () => {
      expect(service.isSupported('stone')).toBe(false);
    });
  });

  describe('toKg', () => {
    it('is the identity conversion for kg -> kg', () => {
      expect(service.toKg(100, 'kg')).toBe(100);
      expect(service.toKg(0, 'kg')).toBe(0);
    });

    it('converts lb -> kg using the exact avoirdupois pound factor', () => {
      expect(service.toKg(1, 'lb')).toBeCloseTo(0.45359237, 8);
      expect(service.toKg(220, 'lb')).toBeCloseTo(99.7903214, 6);
    });

    it('does not round the result to 2 decimal places', () => {
      // 5 lb -> kg has 8 significant decimal digits; a service that
      // pre-rounded to 2dp would return 2.27, not 2.26796185.
      expect(service.toKg(5, 'lb')).toBeCloseTo(2.26796185, 6);
    });

    it('throws UnsupportedUnitError for an unrecognized unit', () => {
      expect(() => service.toKg(10, 'oz')).toThrow(UnsupportedUnitError);
      expect(() => service.toKg(10, 'oz')).toThrow(
        'Unsupported weight unit: "oz"',
      );
    });
  });

  describe('fromKg', () => {
    it('is the identity conversion for kg -> kg', () => {
      expect(service.fromKg(75, 'kg')).toBe(75);
    });

    it('converts kg -> lb', () => {
      expect(service.fromKg(1, 'lb')).toBeCloseTo(2.20462262, 6);
    });

    it('throws UnsupportedUnitError for an unrecognized unit', () => {
      expect(() => service.fromKg(10, 'oz')).toThrow(UnsupportedUnitError);
    });
  });

  describe('round-trip conversion', () => {
    it('recovers the original value within floating-point tolerance', () => {
      const original = 150;
      const roundTripped = service.fromKg(service.toKg(original, 'lb'), 'lb');
      expect(roundTripped).toBeCloseTo(original, 6);
    });
  });
});
