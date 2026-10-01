import {
  AVATAR_BUCKET,
  avatarPathFor,
  avatarUrlFor,
  isOwnAvatarPath,
  type AvatarExtension,
} from '@fmm/shared';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Profile pictures: checking a chosen file, turning it into a small square,
 * and storing it.
 *
 * The browser does the work with its own session, fenced by migration 0004:
 * it can only write inside its own folder of the `avatars` bucket, and the
 * profile row can only point there. What is uploaded is never the original
 * file — always a fresh 256 px square, re-encoded here — so a photo's
 * location data and anything else hidden in the original never leaves the
 * device.
 *
 * The Supabase client is passed in rather than imported, so the pure rules at
 * the top can be tested without one. Nothing here throws: every call returns
 * something the profile card can show.
 */

/** Shown until migration 0004 has been run. */
export const AVATAR_SETUP_MESSAGE =
  'Profile pictures need a one-time database update — run supabase/migrations/0004_avatars.sql.';

/**
 * The biggest file worth decoding. Refused before any work, so a huge photo
 * cannot stall the tab; the upload itself is only a few kilobytes.
 */
export const AVATAR_MAX_INPUT_BYTES = 8 * 1024 * 1024;

/** The stored picture's width and height. Plenty for the largest place it appears. */
export const AVATAR_PIXELS = 256;

/** A year. Every upload gets a new name, so a cached copy can never be out of date. */
const CACHE_SECONDS = '31536000';
const WEBP_QUALITY = 0.85;
const JPEG_QUALITY = 0.88;

export const AVATAR_UNREADABLE = 'That picture could not be read — try a JPEG, PNG or WebP.';

/** A database error, as supabase-js reports it. */
export interface DbError {
  code?: string;
  message: string;
}

/** A storage error, as supabase-js reports it. */
export interface StorageFailure {
  message: string;
  code?: string;
  statusCode?: string;
  status?: number;
}

// ── pure rules ──────────────────────────────────────────────────────────────

/** Why this file will not do, or null when it is worth trying. */
export function checkAvatarFile(file: { type: string; size: number }): string | null {
  if (file.type === 'image/svg+xml') {
    return 'SVG pictures aren’t supported — choose a JPEG, PNG or WebP.';
  }
  if (!file.type.startsWith('image/')) return 'Choose an image file — a JPEG, PNG or WebP.';
  if (file.size <= 0) return 'That file is empty.';
  if (file.size > AVATAR_MAX_INPUT_BYTES) return 'That picture is over 8 MB — choose a smaller one.';
  return null;
}

/** The largest square in the middle of a picture, or null when it has no pixels. */
export function centreSquare(
  width: number,
  height: number,
): { sx: number; sy: number; side: number } | null {
  if (!(width > 0) || !(height > 0)) return null;
  const side = Math.min(width, height);
  return { sx: Math.floor((width - side) / 2), sy: Math.floor((height - side) / 2), side };
}

/** The smallest and largest zoom. At 1 the whole short side shows; at 4, a quarter of it. */
export const AVATAR_MIN_ZOOM = 1;
export const AVATAR_MAX_ZOOM = 4;

/** A square of the source picture, in its own pixels. */
export interface CropSquare {
  sx: number;
  sy: number;
  side: number;
}

/**
 * How the crop dialog frames a picture. Offsets are in frame units — the
 * frame's side is 1 — and say how far the picture has been dragged: positive x
 * means it moved right, so the window over the source moves left.
 */
export interface CropView {
  zoom: number;
  offsetX: number;
  offsetY: number;
}

/** Zoom held to its range; anything that is not a number counts as no zoom. */
function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return AVATAR_MIN_ZOOM;
  return Math.min(AVATAR_MAX_ZOOM, Math.max(AVATAR_MIN_ZOOM, zoom));
}

/** How far the picture may be dragged either way, per axis, before the frame would show past its edge. */
function dragLimits(width: number, height: number, zoom: number): { x: number; y: number } {
  const side = Math.min(width, height) / zoom;
  return { x: (width - side) / 2 / side, y: (height - side) / 2 / side };
}

function clampOffset(offset: number, limit: number): number {
  if (!Number.isFinite(offset)) return 0;
  // + 0 turns a clamped -0 into 0, which is how it will be compared and shown.
  return Math.min(limit, Math.max(-limit, offset)) + 0;
}

/**
 * The view, with zoom in range and the picture kept over the frame: dragged as
 * far as its edge and no further, so the circle can never show empty space.
 * A picture with no pixels leaves nothing to drag, so the offsets are zero.
 */
export function clampView(width: number, height: number, view: CropView): CropView {
  const zoom = clampZoom(view.zoom);
  if (!(width > 0) || !(height > 0)) return { zoom, offsetX: 0, offsetY: 0 };
  const limit = dragLimits(width, height, zoom);
  return {
    zoom,
    offsetX: clampOffset(view.offsetX, limit.x),
    offsetY: clampOffset(view.offsetY, limit.y),
  };
}

/**
 * The square of the picture that `view` frames, or null when it has no pixels.
 * The default view (zoom 1, no offset) is exactly `centreSquare`, so a
 * picture saved without touching the dialog comes out as it always did.
 */
export function cropFromView(width: number, height: number, view: CropView): CropSquare | null {
  if (!(width > 0) || !(height > 0)) return null;
  const { zoom, offsetX, offsetY } = clampView(width, height, view);
  const side = Math.min(width, height) / zoom;
  // The window starts centred, then moves against the drag; clamping the
  // view above has already kept it inside. Whole pixels, rounded down; the
  // sliver added first stops a sum like 99.99999999 losing a pixel it owns.
  const sx = Math.floor((width - side) / 2 - offsetX * side + 1e-9);
  const sy = Math.floor((height - side) / 2 - offsetY * side + 1e-9);
  return { sx: Math.max(0, sx), sy: Math.max(0, sy), side };
}

/** The crop if it lies wholly inside a picture of this size, otherwise null. */
export function cropWithin(crop: CropSquare | null | undefined, width: number, height: number): CropSquare | null {
  if (!crop) return null;
  const { sx, sy, side } = crop;
  if (![sx, sy, side].every(Number.isFinite) || side <= 0 || sx < 0 || sy < 0) return null;
  // A sliver of slack for arithmetic on fractions, never a visible amount.
  if (sx + side > width + 1e-6 || sy + side > height + 1e-6) return null;
  return { sx, sy, side };
}

/** The file extension for an encoded picture, or null for a type the bucket refuses. */
export function extensionFor(type: string): AvatarExtension | null {
  switch (type) {
    case 'image/webp':
      return 'webp';
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    default:
      return null;
  }
}

/**
 * The avatar_path column does not exist yet: Postgres's "undefined column"
 * (42703) when reading it, PostgREST's "not in the schema cache" (PGRST204)
 * when writing it.
 */
export function isMissingColumn(error: { code?: string; message?: string } | null | undefined): boolean {
  return error?.code === '42703' || error?.code === 'PGRST204';
}

/** The avatars bucket does not exist yet. */
export function isMissingBucket(error: StorageFailure | null | undefined): boolean {
  if (!error) return false;
  return error.code === 'NoSuchBucket' || /bucket not found/i.test(error.message);
}

/** What to tell the player when the file could not be stored. */
export function uploadErrorMessage(error: StorageFailure | null | undefined): string {
  if (!error) return 'Could not upload your picture. Try again.';
  if (isMissingBucket(error)) return AVATAR_SETUP_MESSAGE;
  // The upload always goes into the player's own folder, so a policy refusing
  // it means the policies are not there yet.
  if (/row-level security/i.test(error.message)) return AVATAR_SETUP_MESSAGE;
  if (error.code === 'InvalidJWT' || /jwt/i.test(error.message)) {
    return 'Your sign-in has expired — sign in again, then try once more.';
  }
  if (error.code === 'InvalidMimeType' || /mime type/i.test(error.message)) {
    return 'That kind of picture isn’t accepted — choose a JPEG, PNG or WebP.';
  }
  if (
    error.code === 'EntityTooLarge' ||
    error.statusCode === '413' ||
    error.status === 413 ||
    /maximum allowed size/i.test(error.message)
  ) {
    return 'That picture is too large to upload.';
  }
  return 'Could not upload your picture. Try again.';
}

/** What to tell the player when the profile row could not be changed. */
export function saveErrorMessage(
  error: DbError | null | undefined,
  fallback = 'Could not save your picture. Try again.',
): string {
  return isMissingColumn(error) ? AVATAR_SETUP_MESSAGE : fallback;
}

/**
 * The address of an account's picture, or null. Only a path inside that
 * account's own folder becomes an address — the database enforces the same
 * rule; this keeps the page from relying on it.
 */
export function pictureUrl(ownerId: string, path: unknown): string | null {
  if (!isOwnAvatarPath(ownerId, path)) return null;
  return avatarUrlFor(String(import.meta.env.VITE_SUPABASE_URL ?? ''), path);
}

// ── turning a file into the stored square ──────────────────────────────────

/** A picture read into pixels. `close` frees it once nothing more will be drawn. */
export interface DecodedImage {
  image: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
}

/**
 * Reads the file into pixels, upright as the camera meant it. The crop dialog
 * decodes with this too, so what it frames and what `squareAvatar` cuts are
 * the same pixels. Rejects when the file cannot be read.
 */
export async function decodeImage(file: Blob): Promise<DecodedImage> {
  if (typeof createImageBitmap === 'function') {
    // Older engines reject the orientation option; they decode fine without it.
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() =>
      createImageBitmap(file),
    );
    return { image: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
  }

  // No createImageBitmap: an <img> reads the file just as well, only slower.
  const address = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = address;
    await img.decode();
    return { image: img, width: img.naturalWidth, height: img.naturalHeight, close: () => {} };
  } finally {
    URL.revokeObjectURL(address);
  }
}

function encode(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * The chosen square of the picture at 256 × 256, as WebP — or JPEG where the
 * browser cannot write WebP. With no crop, or one that does not lie inside the
 * picture, it is the middle square. Throws when the file cannot be read.
 */
export async function squareAvatar(
  file: Blob,
  chosen?: CropSquare | null,
): Promise<{ blob: Blob; ext: AvatarExtension }> {
  const decoded = await decodeImage(file);
  try {
    const crop = cropWithin(chosen, decoded.width, decoded.height) ?? centreSquare(decoded.width, decoded.height);
    if (!crop) throw new Error('The picture has no pixels.');

    const canvas = document.createElement('canvas');
    canvas.width = AVATAR_PIXELS;
    canvas.height = AVATAR_PIXELS;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser has no 2D canvas.');

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(decoded.image, crop.sx, crop.sy, crop.side, crop.side, 0, 0, AVATAR_PIXELS, AVATAR_PIXELS);

    // A browser that cannot write WebP quietly hands back a PNG instead, so
    // the type of what came out is what counts.
    const webp = await encode(canvas, 'image/webp', WEBP_QUALITY);
    if (webp && extensionFor(webp.type) === 'webp') return { blob: webp, ext: 'webp' };

    // JPEG has no transparency: paint white underneath first, or see-through
    // pixels turn black.
    context.globalCompositeOperation = 'destination-over';
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, AVATAR_PIXELS, AVATAR_PIXELS);
    const jpeg = await encode(canvas, 'image/jpeg', JPEG_QUALITY);
    if (jpeg && extensionFor(jpeg.type) === 'jpg') return { blob: jpeg, ext: 'jpg' };

    throw new Error('This browser could not encode the picture.');
  } finally {
    decoded.close();
  }
}

// ── storing it ──────────────────────────────────────────────────────────────

/** How a change went. `path` is the new avatar_path (null once removed). */
export type AvatarResult =
  | { ok: true; path: string | null; note?: string }
  | { ok: false; error: string };

/**
 * Makes `file` the account's picture: square it (the `crop` the player chose,
 * else the middle), upload it under a new name, point the profile at it, then
 * delete the picture it replaces.
 *
 * The old file goes last, once nothing points at it any more, so a failure
 * halfway never leaves the profile showing a picture that is gone.
 */
export async function uploadAvatar(
  client: SupabaseClient,
  userId: string,
  file: File,
  previousPath: string | null | undefined,
  crop?: CropSquare | null,
): Promise<AvatarResult> {
  const refusal = checkAvatarFile(file);
  if (refusal) return { ok: false, error: refusal };

  let picture: { blob: Blob; ext: AvatarExtension };
  try {
    picture = await squareAvatar(file, crop);
  } catch (error) {
    console.error('[avatar] could not read the picture:', error);
    return { ok: false, error: AVATAR_UNREADABLE };
  }

  const path = avatarPathFor(userId, Date.now(), picture.ext);
  const bucket = client.storage.from(AVATAR_BUCKET);

  try {
    const { error: uploadError } = await bucket.upload(path, picture.blob, {
      cacheControl: CACHE_SECONDS,
      contentType: picture.blob.type,
      upsert: false,
    });
    if (uploadError) {
      console.error('[avatar] upload failed:', uploadError.message);
      return { ok: false, error: uploadErrorMessage(uploadError) };
    }

    const { data, error: saveError } = await client
      .from('profiles')
      .update({ avatar_path: path })
      .eq('id', userId)
      .select('id');
    if (saveError || !data?.length) {
      // The file is up but nothing points at it: take it down again.
      if (saveError) console.error('[avatar] could not save the picture:', saveError.message);
      await bucket.remove([path]);
      return { ok: false, error: saveErrorMessage(saveError) };
    }

    if (previousPath && previousPath !== path && isOwnAvatarPath(userId, previousPath)) {
      const { error: removeError } = await bucket.remove([previousPath]);
      if (removeError) {
        console.error('[avatar] could not delete the old picture:', removeError.message);
        return { ok: true, path, note: 'Saved, but the old picture could not be deleted.' };
      }
    }
    return { ok: true, path };
  } catch (error) {
    console.error('[avatar] upload failed:', error);
    return { ok: false, error: uploadErrorMessage(null) };
  }
}

/**
 * Takes the picture down: the file first, then the profile's pointer to it.
 * In that order, a reported success always means the file is gone; if the
 * second step fails, the card falls back to the initial and Remove can simply
 * be pressed again.
 */
export async function removeAvatar(
  client: SupabaseClient,
  userId: string,
  path: string | null | undefined,
): Promise<AvatarResult> {
  const failed = 'Could not remove your picture. Try again.';

  try {
    if (path && isOwnAvatarPath(userId, path)) {
      const { error: removeError } = await client.storage.from(AVATAR_BUCKET).remove([path]);
      if (removeError) {
        console.error('[avatar] could not delete the picture:', removeError.message);
        return { ok: false, error: isMissingBucket(removeError) ? AVATAR_SETUP_MESSAGE : failed };
      }
    }

    const { data, error } = await client
      .from('profiles')
      .update({ avatar_path: null })
      .eq('id', userId)
      .select('id');
    if (error || !data?.length) {
      if (error) console.error('[avatar] could not clear the picture:', error.message);
      return { ok: false, error: saveErrorMessage(error, failed) };
    }
    return { ok: true, path: null };
  } catch (error) {
    console.error('[avatar] remove failed:', error);
    return { ok: false, error: failed };
  }
}
