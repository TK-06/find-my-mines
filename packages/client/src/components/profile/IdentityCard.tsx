import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { supabase } from '../../auth/supabase.js';
import {
  AVATAR_SETUP_MESSAGE,
  checkAvatarFile,
  pictureUrl,
  removeAvatar,
  uploadAvatar,
  type CropSquare,
} from '../../data/avatar.js';
import { formatDay, topPercent } from '../../data/profileStats.js';
import type { ProfileRow } from '../../data/queries.js';
import { Avatar } from '../Avatar.js';
import { AvatarCropDialog } from './AvatarCropDialog.js';

interface Props {
  profile: ProfileRow;
  /** Consecutive days played, ending today or yesterday. */
  streak: number;
  /** Leaderboard position; null before the first ranked match. */
  standing: { rank: number; total: number | null } | null;
  /** Renames through updateUsername; resolves with its result. */
  onRename: (name: string) => Promise<{ ok: boolean; error?: string }>;
}

/**
 * Who you are: your picture (or initial), display name (renamed in place), how
 * long you've played, and your rating with its place on the leaderboard.
 *
 * The rating is only ever shown here — it is written by the game server, and a
 * database trigger ignores any client attempt to change it.
 *
 * The picture is uploaded straight to Supabase Storage with your own session
 * (see data/avatar.ts); the card keeps the current path itself, so a change
 * shows at once without reloading the page.
 */
export function IdentityCard({ profile, streak, standing, onRename }: Props) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(profile.username);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; failed: boolean } | null>(null);

  /** Where the picture is stored, or null for none. */
  const [picturePath, setPicturePath] = useState<string | null>(profile.avatar_path ?? null);
  /** A picture change in flight, so its buttons cannot be pressed twice. */
  const [pictureBusy, setPictureBusy] = useState<'upload' | 'remove' | null>(null);
  /** The file waiting in the crop dialog; nothing is uploaded until it is saved. */
  const [cropFile, setCropFile] = useState<File | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const editRef = useRef<HTMLButtonElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const chooseRef = useRef<HTMLButtonElement>(null);
  const removeRef = useRef<HTMLButtonElement>(null);
  /** Set when the form closes, so focus goes back to the button that opened it. */
  const refocusEdit = useRef(false);

  /**
   * Which picture button gets focus when a change finishes. Both are disabled
   * while it runs, and a disabled button cannot take focus, so focus goes
   * back only once the render that enables them again has happened. The same
   * goes for a closed crop dialog, which has just been holding focus.
   */
  const refocusTo = useRef<'choose' | 'remove' | null>(null);

  // A fresh profile row (say, after a rename) is the truth about the picture.
  useEffect(() => {
    setPicturePath(profile.avatar_path ?? null);
  }, [profile.avatar_path]);

  useEffect(() => {
    if (pictureBusy !== null || cropFile || !refocusTo.current) return;
    const target = refocusTo.current === 'remove' ? removeRef.current : chooseRef.current;
    refocusTo.current = null;
    target?.focus();
  }, [pictureBusy, cropFile]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    } else if (refocusEdit.current) {
      refocusEdit.current = false;
      editRef.current?.focus();
    }
  }, [editing]);

  function startEditing() {
    setName(profile.username);
    setMessage(null);
    setEditing(true);
  }

  function cancel() {
    refocusEdit.current = true;
    setMessage(null);
    setEditing(false);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    const result = await onRename(name);
    setSaving(false);
    if (result.ok) {
      refocusEdit.current = true;
      setEditing(false);
      setMessage({ text: 'Saved.', failed: false });
    } else {
      setMessage({ text: result.error ?? 'Could not save.', failed: true });
    }
  }

  function onFormKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key === 'Escape' && !saving) {
      event.preventDefault();
      cancel();
    }
  }

  function onPictureChosen(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Cleared at once, so choosing the same file again still counts as a change.
    event.target.value = '';
    if (!file || !client || pictureBusy) return;

    // A refusal needs no dialog: say so on the card, as every other picture message.
    const refusal = checkAvatarFile(file);
    if (refusal) {
      setMessage({ text: refusal, failed: true });
      return;
    }
    setMessage(null);
    setCropFile(file);
  }

  function cancelCrop() {
    refocusTo.current = 'choose';
    setCropFile(null);
  }

  async function savePicture(crop: CropSquare) {
    if (!cropFile || !client || pictureBusy) return;

    setPictureBusy('upload');
    setMessage(null);
    const result = await uploadAvatar(client, profile.id, cropFile, picturePath, crop);
    refocusTo.current = 'choose';
    setCropFile(null);
    setPictureBusy(null);
    if (result.ok) {
      setPicturePath(result.path);
      setMessage({
        text: result.note ?? 'Picture saved. Games show it from the next time you load the page.',
        failed: false,
      });
    } else {
      setMessage({ text: result.error, failed: true });
    }
  }

  async function removePicture() {
    if (!client || pictureBusy) return;
    setPictureBusy('remove');
    setMessage(null);
    const result = await removeAvatar(client, profile.id, picturePath);
    // After a removal the Remove button is gone, so focus goes to the picture
    // button; after a failure, back to Remove to try again.
    refocusTo.current = result.ok ? 'choose' : 'remove';
    setPictureBusy(null);
    if (result.ok) {
      setPicturePath(null);
      setMessage({ text: 'Picture removed.', failed: false });
    } else {
      setMessage({ text: result.error, failed: true });
    }
  }

  const joined = new Date(profile.created_at);
  const since = [
    Number.isNaN(joined.getTime()) ? null : `Joined ${formatDay(joined)}`,
    streak >= 2 ? `played ${streak} days in a row` : null,
  ].filter(Boolean);

  const percent = standing ? topPercent(standing.rank, standing.total) : null;
  const eloCaption = [
    'Elo',
    standing ? `rank #${standing.rank}` : null,
    percent !== null ? `top ${percent}%` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const unchanged = name.trim() === profile.username || name.trim() === '';
  const client = supabase;
  /** False until migration 0004 adds the column: the profile loaded without it. */
  const picturesReady = profile.avatar_path !== undefined;

  return (
    <section className="card profile-id" aria-label="Your profile">
      <div className="profile-id-head">
        {/* Your name is right beside it, so the picture stays silent. */}
        <Avatar
          className="profile-avatar"
          name={profile.username}
          url={pictureUrl(profile.id, picturePath)}
          size={56}
        />

        <div className="profile-id-main">
          {editing ? (
            <form className="profile-rename" onSubmit={(e) => void save(e)} onKeyDown={onFormKeyDown}>
              <input
                ref={inputRef}
                type="text"
                value={name}
                maxLength={20}
                aria-label="Display name"
                aria-describedby="profile-rename-help"
                disabled={saving}
                onChange={(e) => setName(e.target.value)}
              />
              <div className="profile-rename-actions">
                <button type="submit" className="small" disabled={saving || unchanged}>
                  {saving ? 'Saving…' : 'Save'}
                </button>
                <button type="button" className="ghost small" disabled={saving} onClick={cancel}>
                  Cancel
                </button>
              </div>
              <p id="profile-rename-help" className="muted">
                2–20 characters. Esc cancels.
              </p>
            </form>
          ) : (
            <div className="profile-name-row">
              <h2 className="profile-name">{profile.username}</h2>
              <button
                ref={editRef}
                type="button"
                className="ghost small"
                aria-label="Edit display name"
                onClick={startEditing}
              >
                edit
              </button>
            </div>
          )}
          {since.length > 0 && <p className="muted">{since.join(' · ')}</p>}
        </div>
      </div>

      {client &&
        (picturesReady ? (
          <div className="profile-picture-actions" aria-busy={pictureBusy !== null}>
            {/* The real control is the button; the input is only the browser's picker. */}
            <input
              ref={fileRef}
              className="avatar-file"
              type="file"
              accept="image/*"
              tabIndex={-1}
              aria-hidden="true"
              onChange={onPictureChosen}
            />
            <button
              ref={chooseRef}
              type="button"
              className="ghost small"
              disabled={pictureBusy !== null}
              onClick={() => fileRef.current?.click()}
            >
              {pictureBusy === 'upload' ? 'Uploading…' : picturePath ? 'Change picture' : 'Add a picture'}
            </button>
            {picturePath && (
              <button
                ref={removeRef}
                type="button"
                className="ghost small"
                disabled={pictureBusy !== null}
                onClick={() => void removePicture()}
              >
                {pictureBusy === 'remove' ? 'Removing…' : 'Remove picture'}
              </button>
            )}
          </div>
        ) : (
          <p className="muted profile-picture-setup">{AVATAR_SETUP_MESSAGE}</p>
        ))}

      {/* Always rendered, so screen readers announce the message when it appears. */}
      <p role="status" className={`profile-status ${message?.failed ? 'failed' : ''}`}>
        {message?.text}
      </p>

      <div className="profile-elo-row">
        <div>
          <p className="profile-elo">{profile.elo}</p>
          <p className="muted">{eloCaption}</p>
        </div>
        {client && (
          <button
            type="button"
            className="ghost small"
            onClick={() => void client.auth.signOut().then(() => window.location.reload())}
          >
            Sign out
          </button>
        )}
      </div>

      {cropFile && (
        <AvatarCropDialog
          file={cropFile}
          saving={pictureBusy === 'upload'}
          onCancel={cancelCrop}
          onSave={(crop) => void savePicture(crop)}
        />
      )}
    </section>
  );
}
