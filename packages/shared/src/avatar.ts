/** The Supabase Storage bucket that holds profile pictures. */
export const AVATAR_BUCKET = 'avatars';

/** What a stored picture may be. No SVG: it can carry script. Matches the bucket in 0004. */
export type AvatarExtension = 'webp' | 'jpg' | 'png';

/**
 * A picture's name inside its owner's folder: plain characters and an image
 * extension, nothing else. The same rule as the CHECK constraint in
 * supabase/migrations/0004_avatars.sql — keep the two in step.
 */
const FILE_NAME = /^[A-Za-z0-9_-]{1,64}\.(webp|jpg|jpeg|png)$/;

/**
 * The public address of a stored profile picture, or null when there is none.
 * The database keeps only the object's path inside the bucket (the owner's id
 * as the folder), so nothing a player writes can point the picture elsewhere.
 */
export function avatarUrlFor(supabaseUrl: string, path: string | null | undefined): string | null {
  if (!supabaseUrl || !path) return null;
  const base = supabaseUrl.replace(/\/+$/, '');
  const safePath = path.split('/').map(encodeURIComponent).join('/');
  return `${base}/storage/v1/object/public/${AVATAR_BUCKET}/${safePath}`;
}

/**
 * Where a new picture goes: the owner's folder, named by the time it was
 * chosen. A fresh name per upload means the old address is never reused, so
 * it can be cached for a long time without anyone seeing a stale picture.
 */
export function avatarPathFor(ownerId: string, stamp: number, ext: AvatarExtension): string {
  const name = Number.isFinite(stamp) ? Math.max(0, Math.floor(stamp)) : 0;
  return `${ownerId}/${name}.${ext}`;
}

/**
 * Whether a stored path is a picture in this account's own folder. Everyone
 * who turns a path into an address checks this first, so a row that somehow
 * slipped past the database rule still cannot show someone else's file.
 */
export function isOwnAvatarPath(ownerId: string, path: unknown): path is string {
  if (!ownerId || typeof path !== 'string') return false;
  const folder = `${ownerId}/`;
  if (!path.startsWith(folder) || path.includes('..')) return false;
  return FILE_NAME.test(path.slice(folder.length));
}
