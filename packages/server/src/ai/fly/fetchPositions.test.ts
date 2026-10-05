import { describe, expect, it } from 'vitest';
import { parseSomaLocation } from '../../../../../scripts/fly/fetch-positions.mjs';

describe('parseSomaLocation', () => {
  it('reads finite coordinates from neuPrint arrays and point objects', () => {
    expect(parseSomaLocation([12, -4.5, 99])).toEqual([12, -4.5, 99]);
    expect(parseSomaLocation({ x: 12, y: -4.5, z: 99 })).toEqual([12, -4.5, 99]);
    expect(
      parseSomaLocation({ coordinates: [12, -4.5, 99], crs: { srid: 9157 }, type: 'Point' }),
    ).toEqual([12, -4.5, 99]);
  });

  it('leaves absent or malformed soma locations null', () => {
    expect(parseSomaLocation(null)).toBeNull();
    expect(parseSomaLocation([1, 2])).toBeNull();
    expect(parseSomaLocation({ x: 1, y: Number.NaN, z: 3 })).toBeNull();
    expect(parseSomaLocation('12,13,14')).toBeNull();
  });
});
