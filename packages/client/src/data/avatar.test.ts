import { describe, expect, it } from 'vitest';
import {
  AVATAR_MAX_INPUT_BYTES,
  AVATAR_SETUP_MESSAGE,
  centreSquare,
  checkAvatarFile,
  clampView,
  cropFromView,
  cropWithin,
  extensionFor,
  isMissingBucket,
  isMissingColumn,
  saveErrorMessage,
  uploadErrorMessage,
} from './avatar.js';

describe('checkAvatarFile', () => {
  it('accepts ordinary photos', () => {
    expect(checkAvatarFile({ type: 'image/jpeg', size: 3_000_000 })).toBeNull();
    expect(checkAvatarFile({ type: 'image/png', size: 1 })).toBeNull();
    expect(checkAvatarFile({ type: 'image/webp', size: AVATAR_MAX_INPUT_BYTES })).toBeNull();
    // HEIC and friends go through: the browser may be able to decode them, and
    // what is uploaded is always the re-encoded square.
    expect(checkAvatarFile({ type: 'image/heic', size: 2_000_000 })).toBeNull();
  });

  it('refuses anything that is not an image', () => {
    expect(checkAvatarFile({ type: 'application/pdf', size: 1000 })).toMatch(/image/i);
    expect(checkAvatarFile({ type: '', size: 1000 })).toMatch(/image/i);
    expect(checkAvatarFile({ type: 'text/html', size: 1000 })).toMatch(/image/i);
  });

  it('refuses SVG with its own reason', () => {
    expect(checkAvatarFile({ type: 'image/svg+xml', size: 1000 })).toMatch(/SVG/);
  });

  it('refuses an empty file, and one too big to process, before any work', () => {
    expect(checkAvatarFile({ type: 'image/png', size: 0 })).toMatch(/empty/i);
    expect(checkAvatarFile({ type: 'image/jpeg', size: AVATAR_MAX_INPUT_BYTES + 1 })).toMatch(/8 MB/);
  });
});

describe('centreSquare', () => {
  it('takes the middle of a landscape picture', () => {
    expect(centreSquare(400, 300)).toEqual({ sx: 50, sy: 0, side: 300 });
  });

  it('takes the middle of a portrait picture', () => {
    expect(centreSquare(300, 500)).toEqual({ sx: 0, sy: 100, side: 300 });
  });

  it('leaves a square alone, and rounds an odd margin down', () => {
    expect(centreSquare(256, 256)).toEqual({ sx: 0, sy: 0, side: 256 });
    expect(centreSquare(301, 300)).toEqual({ sx: 0, sy: 0, side: 300 });
    expect(centreSquare(303, 300)).toEqual({ sx: 1, sy: 0, side: 300 });
  });

  it('is null for a picture with no pixels', () => {
    expect(centreSquare(0, 300)).toBeNull();
    expect(centreSquare(300, -1)).toBeNull();
    expect(centreSquare(Number.NaN, 300)).toBeNull();
  });
});

describe('cropFromView', () => {
  const home = { zoom: 1, offsetX: 0, offsetY: 0 };

  it('frames the middle square by default, exactly as centreSquare does', () => {
    for (const [w, h] of [
      [400, 300],
      [300, 500],
      [256, 256],
      [303, 300],
      [301, 300],
    ] as const) {
      expect(cropFromView(w, h, home)).toEqual(centreSquare(w, h));
    }
  });

  it('halves the side at zoom 2, still centred', () => {
    expect(cropFromView(400, 300, { ...home, zoom: 2 })).toEqual({ sx: 125, sy: 75, side: 150 });
  });

  it('moves the window against the drag', () => {
    // Dragging the picture right by a quarter of the frame shows more of its left.
    const crop = cropFromView(400, 300, { zoom: 2, offsetX: 0.25, offsetY: 0 });
    expect(crop).toEqual({ sx: Math.floor(125 - 0.25 * 150), sy: 75, side: 150 });
  });

  it('keeps the crop inside the picture however far it is dragged', () => {
    expect(cropFromView(400, 300, { zoom: 1, offsetX: 5, offsetY: 5 })).toEqual({ sx: 0, sy: 0, side: 300 });
    expect(cropFromView(400, 300, { zoom: 1, offsetX: -5, offsetY: -5 })).toEqual({ sx: 100, sy: 0, side: 300 });
    expect(cropFromView(400, 300, { zoom: 2, offsetX: -9, offsetY: -9 })).toEqual({ sx: 250, sy: 150, side: 150 });
    expect(cropFromView(400, 300, { zoom: 4, offsetX: 9, offsetY: 9 })).toEqual({ sx: 0, sy: 0, side: 75 });
  });

  it('holds zoom to 1–4', () => {
    expect(cropFromView(400, 300, { ...home, zoom: 0.2 })?.side).toBe(300);
    expect(cropFromView(400, 300, { ...home, zoom: 40 })?.side).toBe(75);
    expect(cropFromView(400, 300, { ...home, zoom: Number.NaN })?.side).toBe(300);
  });

  it('is null for a picture with no pixels', () => {
    expect(cropFromView(0, 300, home)).toBeNull();
    expect(cropFromView(300, Number.NaN, home)).toBeNull();
  });

  it('shrugs off offsets that are not numbers', () => {
    expect(cropFromView(400, 300, { zoom: 1, offsetX: Number.NaN, offsetY: Infinity })).toEqual({
      sx: 50,
      sy: 0,
      side: 300,
    });
  });
});

describe('clampView', () => {
  it('leaves a view that is already inside alone', () => {
    const view = { zoom: 2, offsetX: 0.1, offsetY: -0.1 };
    expect(clampView(400, 300, view)).toEqual(view);
  });

  it('stops the picture leaving the circle', () => {
    // At zoom 1 a 400 × 300 picture has 100 px of slack, a third of the frame, split either side.
    const far = clampView(400, 300, { zoom: 1, offsetX: 9, offsetY: -9 });
    expect(far.offsetX).toBeCloseTo(1 / 6);
    expect(far.offsetY).toBe(0);
    // Zoomed in there is slack on both axes.
    const zoomed = clampView(400, 300, { zoom: 2, offsetX: -9, offsetY: 9 });
    expect(zoomed.offsetX).toBeCloseTo(-250 / 150 / 2);
    expect(zoomed.offsetY).toBeCloseTo(0.5);
  });

  it('holds zoom to 1–4', () => {
    expect(clampView(300, 300, { zoom: 9, offsetX: 0, offsetY: 0 }).zoom).toBe(4);
    expect(clampView(300, 300, { zoom: 0, offsetX: 0, offsetY: 0 }).zoom).toBe(1);
  });

  it('zeroes the offsets for a picture with no pixels, and for ones that are not numbers', () => {
    expect(clampView(0, 0, { zoom: 2, offsetX: 1, offsetY: 1 })).toEqual({ zoom: 2, offsetX: 0, offsetY: 0 });
    expect(clampView(300, 300, { zoom: 2, offsetX: Number.NaN, offsetY: 0 }).offsetX).toBe(0);
  });
});

describe('cropWithin', () => {
  it('keeps a crop that lies inside the picture', () => {
    expect(cropWithin({ sx: 10, sy: 0, side: 300 }, 400, 300)).toEqual({ sx: 10, sy: 0, side: 300 });
    expect(cropWithin({ sx: 100, sy: 0, side: 300 }, 400, 300)).not.toBeNull();
  });

  it('refuses one that leaves it, or is not a square of real pixels', () => {
    expect(cropWithin({ sx: 101, sy: 0, side: 300 }, 400, 300)).toBeNull();
    expect(cropWithin({ sx: -1, sy: 0, side: 100 }, 400, 300)).toBeNull();
    expect(cropWithin({ sx: 0, sy: 0, side: 0 }, 400, 300)).toBeNull();
    expect(cropWithin({ sx: Number.NaN, sy: 0, side: 100 }, 400, 300)).toBeNull();
    expect(cropWithin({ sx: 0, sy: 0, side: Infinity }, 400, 300)).toBeNull();
    expect(cropWithin(null, 400, 300)).toBeNull();
    expect(cropWithin(undefined, 400, 300)).toBeNull();
  });
});

describe('extensionFor', () => {
  it('names the three types the bucket accepts', () => {
    expect(extensionFor('image/webp')).toBe('webp');
    expect(extensionFor('image/jpeg')).toBe('jpg');
    expect(extensionFor('image/png')).toBe('png');
  });

  it('is null for anything else, so the caller tries another encoding', () => {
    expect(extensionFor('image/gif')).toBeNull();
    expect(extensionFor('')).toBeNull();
  });
});

describe('missing setup', () => {
  it('spots the column that migration 0004 adds', () => {
    expect(isMissingColumn({ code: '42703', message: 'column profiles.avatar_path does not exist' })).toBe(true);
    expect(isMissingColumn({ code: 'PGRST204', message: "Could not find the 'avatar_path' column" })).toBe(true);
    expect(isMissingColumn({ code: '23505', message: 'duplicate' })).toBe(false);
    expect(isMissingColumn(null)).toBe(false);
  });

  it('spots the bucket that migration 0004 makes', () => {
    expect(isMissingBucket({ message: 'Bucket not found', statusCode: '404' })).toBe(true);
    expect(isMissingBucket({ message: 'x', code: 'NoSuchBucket' })).toBe(true);
    expect(isMissingBucket({ message: 'Object not found', statusCode: '404' })).toBe(false);
    expect(isMissingBucket(undefined)).toBe(false);
  });
});

describe('uploadErrorMessage', () => {
  it('points at the migration when the bucket or its policies are missing', () => {
    expect(uploadErrorMessage({ message: 'Bucket not found' })).toBe(AVATAR_SETUP_MESSAGE);
    expect(uploadErrorMessage({ message: 'new row violates row-level security policy', statusCode: '403' })).toBe(
      AVATAR_SETUP_MESSAGE,
    );
  });

  it('explains a refused type or size in plain words', () => {
    expect(uploadErrorMessage({ message: 'mime type image/gif is not supported', code: 'InvalidMimeType' })).toMatch(
      /JPEG, PNG or WebP/,
    );
    expect(uploadErrorMessage({ message: 'The object exceeded the maximum allowed size', statusCode: '413' })).toMatch(
      /too large/i,
    );
  });

  it('asks for a fresh sign-in when the session has run out', () => {
    expect(uploadErrorMessage({ message: 'jwt expired', code: 'InvalidJWT' })).toMatch(/sign in/i);
  });

  it('falls back to a general message', () => {
    expect(uploadErrorMessage({ message: 'socket hang up' })).toMatch(/could not upload/i);
    expect(uploadErrorMessage(null)).toMatch(/could not upload/i);
  });
});

describe('saveErrorMessage', () => {
  it('points at the migration when the column is missing', () => {
    expect(saveErrorMessage({ code: '42703', message: 'column does not exist' })).toBe(AVATAR_SETUP_MESSAGE);
    expect(saveErrorMessage({ code: 'PGRST204', message: 'not in schema cache' })).toBe(AVATAR_SETUP_MESSAGE);
  });

  it('falls back to a general message', () => {
    expect(saveErrorMessage({ code: '23514', message: 'violates check constraint' })).toMatch(/could not save/i);
    expect(saveErrorMessage(null)).toMatch(/could not save/i);
  });
});

describe('AVATAR_SETUP_MESSAGE', () => {
  it('names the migration to run', () => {
    expect(AVATAR_SETUP_MESSAGE).toBe(
      'Profile pictures need a one-time database update — run supabase/migrations/0004_avatars.sql.',
    );
  });
});
