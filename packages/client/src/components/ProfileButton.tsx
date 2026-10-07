import { RouteLink, type Route } from '../router.js';
import { Avatar } from './Avatar.js';

/** Who the header's picture shows: the player this tab is signed in or playing as. */
export interface HeaderUser {
  name: string;
  /** Their profile picture, when their account has one; a guest has none. */
  avatarUrl: string | null;
}

/**
 * Your own picture at the header's far right, as on other sites: a round link to
 * your profile. A real link, so a middle click and "copy link" work, and a plain
 * click opens it without a page reload.
 *
 * It shows your picture, or your initial when there is none (a guest never has
 * one), and a generic person before you have a name at all. A ring in ink marks
 * it when the page on screen is your profile — the page itself, or your own
 * public page at /u/<you>, which sends you to it.
 */
export function ProfileButton({
  me,
  current,
  onNavigate,
}: {
  me: HeaderUser | null;
  /** The page on screen is your own profile. */
  current: boolean;
  onNavigate: (next: Route) => void;
}) {
  return (
    <RouteLink
      to="profile"
      current={current ? 'profile' : undefined}
      onNavigate={onNavigate}
      className={`profile-button${current ? ' active' : ''}`}
      label="Your profile"
      title="Your profile"
    >
      {me ? (
        <Avatar name={me.name} url={me.avatarUrl} size={32} />
      ) : (
        <span className="avatar profile-button-generic" aria-hidden="true">
          <PersonIcon />
        </span>
      )}
    </RouteLink>
  );
}

/** A head and shoulders: the stand-in until there is a name to take an initial from. */
function PersonIcon() {
  return (
    <svg
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </svg>
  );
}
