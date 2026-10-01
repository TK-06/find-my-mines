import type { AiModel } from '@fmm/shared';
import { useState, type CSSProperties } from 'react';
import { initialOf } from '../data/friendsModel.js';
import { BotMark } from './BotMark.js';

export interface AvatarProps {
  /** Whose picture: used for the initial and, when it stands alone, the alt text. */
  name: string;
  /** The profile picture, when the account has one. */
  url?: string | null;
  /** Rendered size in pixels (square). */
  size?: number;
  /**
   * A computer opponent: drawn differently from people. Pass the seat's model
   * for its own mark; `true` is the AI's robot.
   */
  bot?: boolean | AiModel;
  /**
   * Nothing next to it says whose it is, so it announces the name itself.
   * Off by default: almost everywhere the name is printed beside it, and
   * reading it twice is noise.
   */
  standalone?: boolean;
  /** An existing look to wear (profile-avatar, chat-avatar, friend-avatar). */
  className?: string;
}

/**
 * A person's picture, or their initial when there is none — or when the
 * picture fails to load (deleted, offline, blocked), so a broken image is
 * never shown. Computer opponents get their own mark instead (see BotMark).
 *
 * Pictures load lazily and decode off the main thread: a rankings page of
 * fifty rows only fetches the ones scrolled into view.
 */
export function Avatar({ name, url, size = 32, bot = false, standalone = false, className }: AvatarProps) {
  // The address that failed, not a flag: a new address gets a fresh try.
  const [failed, setFailed] = useState<string | null>(null);
  const isBot = bot !== false;
  const showPicture = !isBot && Boolean(url) && url !== failed;

  const model: AiModel = bot === true || bot === false ? 'ai' : bot;
  const classes = ['avatar', isBot ? `bot bot-${model}` : '', showPicture ? 'has-picture' : '', className ?? '']
    .filter(Boolean)
    .join(' ');
  const style = { width: size, height: size, '--avatar-size': `${size}px` } as CSSProperties;
  const label = standalone ? (isBot ? `${name} (computer)` : name) : undefined;

  return (
    <span
      className={classes}
      style={style}
      role={standalone ? 'img' : undefined}
      aria-label={label}
      aria-hidden={standalone ? undefined : true}
    >
      {isBot ? (
        <BotMark model={model} />
      ) : showPicture ? (
        <img
          src={url!}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setFailed(url ?? null)}
        />
      ) : (
        initialOf(name)
      )}
    </span>
  );
}
