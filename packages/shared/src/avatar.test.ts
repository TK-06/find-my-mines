import { describe, expect, it } from 'vitest';
import { AVATAR_BUCKET, avatarPathFor, avatarUrlFor, isOwnAvatarPath } from './avatar.js';

const OWNER = '5b0c3f7e-9a41-4c2e-8f1d-2a6b7c8d9e0f';
const OTHER = '0f9e8d7c-6b5a-4f3e-9d2c-1b0a9f8e7d6c';

describe('avatarUrlFor', () => {
  it('builds the public address inside the avatars bucket', () => {
    expect(avatarUrlFor('https://abc.supabase.co', `${OWNER}/1700000000000.webp`)).toBe(
      `https://abc.supabase.co/storage/v1/object/public/${AVATAR_BUCKET}/${OWNER}/1700000000000.webp`,
    );
  });

  it('copes with a trailing slash on the project address', () => {
    expect(avatarUrlFor('https://abc.supabase.co/', `${OWNER}/1.webp`)).toBe(
      `https://abc.supabase.co/storage/v1/object/public/avatars/${OWNER}/1.webp`,
    );
  });

  it('is null without a path or without a project', () => {
    expect(avatarUrlFor('https://abc.supabase.co', null)).toBeNull();
    expect(avatarUrlFor('https://abc.supabase.co', undefined)).toBeNull();
    expect(avatarUrlFor('https://abc.supabase.co', '')).toBeNull();
    expect(avatarUrlFor('', `${OWNER}/1.webp`)).toBeNull();
  });

  it('encodes each part of the path so it cannot become a query or fragment', () => {
    expect(avatarUrlFor('https://abc.supabase.co', 'a b/c?d#e')).toBe(
      'https://abc.supabase.co/storage/v1/object/public/avatars/a%20b/c%3Fd%23e',
    );
  });
});

describe('avatarPathFor', () => {
  it('puts the picture in the owner’s own folder, named by time', () => {
    expect(avatarPathFor(OWNER, 1700000000123, 'webp')).toBe(`${OWNER}/1700000000123.webp`);
    expect(avatarPathFor(OWNER, 1700000000123, 'jpg')).toBe(`${OWNER}/1700000000123.jpg`);
  });

  it('never produces a name the database would refuse', () => {
    expect(isOwnAvatarPath(OWNER, avatarPathFor(OWNER, 1700000000123.9, 'webp'))).toBe(true);
    expect(isOwnAvatarPath(OWNER, avatarPathFor(OWNER, -5, 'png'))).toBe(true);
    expect(isOwnAvatarPath(OWNER, avatarPathFor(OWNER, Number.NaN, 'webp'))).toBe(true);
  });
});

// The same rule as the CHECK constraint in supabase/migrations/0004_avatars.sql.
describe('isOwnAvatarPath', () => {
  it('accepts a simple file in the owner’s folder', () => {
    expect(isOwnAvatarPath(OWNER, `${OWNER}/1700000000000.webp`)).toBe(true);
    expect(isOwnAvatarPath(OWNER, `${OWNER}/me_2-b.jpeg`)).toBe(true);
    expect(isOwnAvatarPath(OWNER, `${OWNER}/x.png`)).toBe(true);
  });

  it('refuses someone else’s folder', () => {
    expect(isOwnAvatarPath(OWNER, `${OTHER}/1.webp`)).toBe(false);
  });

  it('refuses climbing out of the folder or into a subfolder', () => {
    expect(isOwnAvatarPath(OWNER, `${OWNER}/../${OTHER}/1.webp`)).toBe(false);
    expect(isOwnAvatarPath(OWNER, `${OWNER}/..webp`)).toBe(false);
    expect(isOwnAvatarPath(OWNER, `${OWNER}/sub/1.webp`)).toBe(false);
  });

  it('refuses types the bucket does not take, SVG above all', () => {
    expect(isOwnAvatarPath(OWNER, `${OWNER}/1.svg`)).toBe(false);
    expect(isOwnAvatarPath(OWNER, `${OWNER}/1.gif`)).toBe(false);
    expect(isOwnAvatarPath(OWNER, `${OWNER}/1`)).toBe(false);
  });

  it('refuses odd characters, empty names and anything that is not a string', () => {
    expect(isOwnAvatarPath(OWNER, `${OWNER}/a b.webp`)).toBe(false);
    expect(isOwnAvatarPath(OWNER, `${OWNER}/.webp`)).toBe(false);
    expect(isOwnAvatarPath(OWNER, `${OWNER}/`)).toBe(false);
    expect(isOwnAvatarPath(OWNER, `${OWNER}/${'a'.repeat(65)}.webp`)).toBe(false);
    expect(isOwnAvatarPath(OWNER, null)).toBe(false);
    expect(isOwnAvatarPath(OWNER, 42)).toBe(false);
    expect(isOwnAvatarPath('', '/1.webp')).toBe(false);
  });
});
