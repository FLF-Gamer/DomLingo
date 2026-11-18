import { describe, expect, it } from 'vitest';
import { overlaps, placeTranslation, rectangle } from '../../src/pdf/region';

describe('PDF translation placement', () => {
  const bounds = { left: 0, top: 100, width: 1200, height: 700 };
  it('normalizes a rectangle drawn in either direction', () => {
    expect(rectangle(300, 250, 40, 20)).toEqual({ left: 40, top: 20, width: 260, height: 230 });
  });
  it.each([
    { left: 100, top: 150, width: 350, height: 200 },
    { left: 800, top: 150, width: 350, height: 200 },
    { left: 50, top: 150, width: 1100, height: 200 },
    { left: 50, top: 550, width: 1100, height: 200 },
  ])('places the panel entirely outside the selected original: %j', (region) => {
    const placed = placeTranslation(region, bounds);
    expect(placed).not.toBeNull();
    expect(overlaps(placed!, region)).toBe(false);
    expect(placed!.top).toBeGreaterThanOrEqual(bounds.top);
    expect(placed!.top + placed!.height).toBeLessThanOrEqual(bounds.top + bounds.height);
    expect(placed!.left + placed!.width).toBeLessThanOrEqual(bounds.width);
  });
  it('uses a separate panel when no floating position avoids the original', () => {
    expect(placeTranslation({ left: 10, top: 110, width: 1180, height: 680 }, bounds)).toBeNull();
    expect(
      placeTranslation({ left: 20, top: 120, width: 240, height: 300 }, { ...bounds, width: 280 }),
    ).toBeNull();
  });
});
