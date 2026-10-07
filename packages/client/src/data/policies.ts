import { APP_VERSION, REPO_URL } from '../version.js';

/**
 * The privacy, security and terms pages, as data.
 *
 * Every claim here was checked against the code: the migrations for what the
 * database keeps, the match recorder for what a finished match writes, the
 * server for what it holds in memory, and the client for what the browser
 * stores. Change the code, change this — a policy that is wrong is worse than
 * none.
 *
 * Text is plain strings so anyone in the group can edit it. `[text](href)`
 * makes a link; an href starting with "/" moves within the app.
 */

/** The one address people should write to (the owner asked for just this one). */
export const CONTACT_EMAIL = 'Palangtaj@gmail.com';

export const POLICY_UPDATED = '5 October 2026';

/** A `mailto:` link to the contact address with the subject already filled in. */
export function contactMailto(topic: string): string {
  return `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(`Find My Mines: ${topic}`)}`;
}

export interface InlinePart {
  text: string;
  href?: string;
}

const LINK = /\[([^\]]+)\]\(([^)\s]+)\)/g;

/** Splits "see [this](/x)" into text and link parts. */
export function inlineParts(text: string): InlinePart[] {
  const parts: InlinePart[] = [];
  let last = 0;
  for (const match of text.matchAll(LINK)) {
    const at = match.index ?? 0;
    if (at > last) parts.push({ text: text.slice(last, at) });
    parts.push({ text: match[1]!, href: match[2]! });
    last = at + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

export type PolicyId = 'privacy' | 'security' | 'terms';

/** A paragraph, or a bulleted list. */
export type PolicyBlock = string | readonly string[];

export interface PolicySection {
  /** The #anchor. Unique on its page. */
  id: string;
  title: string;
  blocks: readonly PolicyBlock[];
}

export interface Policy {
  id: PolicyId;
  /** The big page title. */
  title: string;
  /** The label in the tab row. */
  tab: string;
  intro: string;
  sections: readonly PolicySection[];
}

export const POLICY_ORDER: readonly PolicyId[] = ['privacy', 'security', 'terms'];

export function isPolicy(route: string): route is PolicyId {
  return (POLICY_ORDER as readonly string[]).includes(route);
}

const EMAIL = `[${CONTACT_EMAIL}](mailto:${CONTACT_EMAIL})`;

const contactSection: PolicySection = {
  id: 'contact',
  title: 'Contact',
  blocks: [`Email ${EMAIL}. The same address is behind the contact link at the bottom of every page.`],
};

const privacy: Policy = {
  id: 'privacy',
  title: 'Privacy policy',
  tab: 'Privacy',
  intro:
    'Find My Mines keeps as little about you as the game needs. This page says what is kept, where it is kept, and who can see it.',
  sections: [
    {
      id: 'who-we-are',
      title: 'Who runs this',
      blocks: [
        'Find My Mines is a student project for the Net-Centric course at Chulalongkorn University. It is run by Taj Kongsaeree.',
        `Questions about your data go to ${EMAIL}.`,
      ],
    },
    {
      id: 'accounts',
      title: 'If you make an account',
      blocks: [
        'Accounts are optional. If you make one, Supabase, the service that runs our database and sign-in, stores:',
        [
          'your email address;',
          'your password, stored only as a hash by Supabase Auth, so nobody on the project can read it;',
          'your username;',
          'your profile picture, if you add one (see below);',
          'your rating and record: games played, wins, losses and draws;',
          'the matches you play (see below).',
        ],
        'If no username is given when the account is made, your first one is taken from your email address — the part before the @. You can change it on your profile page.',
        'If you sign in with Google or GitHub, where that option is offered, that service shares your email address and basic profile details, such as your name, with Supabase so it can sign you in.',
      ],
    },
    {
      id: 'guests',
      title: 'If you play as a guest',
      blocks: [
        'Guests have no account and no profile. To the game server a guest is always a fixed 800 and never changes. The name you pick is kept in your browser tab, and by the game server while you are connected.',
        'Your browser also keeps a small cookie called fmm_guest, so the game can greet you again and show you an unofficial rating. It holds your name, that unofficial rating, how many ranked games you have won, lost and drawn, and a random id made by your browser. The rating is worked out by your browser alone; the game server never reads it, never trusts it, and never saves it. It is not a real rating and does not count on the rankings.',
        'The random id is sent to the game server when you pick your name. The server keeps it in memory while you are connected and uses it for one thing only: if you report someone, or someone reports you, the report says which browser it came from (see “Reports”). It is not linked to anything else and is never used for ads or analytics.',
        'The cookie stays for 30 days from the last time you played as that guest, then goes by itself. It is sent only to this site, and goes nowhere else. To remove it sooner, use “Forget me on this browser” on your profile page, or “Not you?” on the name screen — either clears it, and the list of matches your browser keeps, at once — or clear this site’s data in your browser.',
        'Matches you finish as a guest are still saved to the match records, under the name you played with.',
      ],
    },
    {
      id: 'matches',
      title: 'Match records',
      blocks: [
        'When a match ends, the game server saves a record of it:',
        [
          'the room code, the board settings, whether it was casual or ranked, who won, and when it was saved;',
          'for each player: the name they played under, whether they were a guest, their score, their finishing place, win, loss or draw, and their rating before and after;',
          'the order the slots were opened in, by which player, and where every mine was. This is what lets a finished game be played back and reviewed. It is public, like the scores, and says nothing about the players beyond the names they played under.',
        ],
        'Casual and ranked matches are both saved, and so are guests. A record keeps the name each player used at the time, even if they change it later. Match records are public — anyone can read them, and a player’s profile lists their recent matches.',
      ],
    },
    {
      id: 'profile-picture',
      title: 'Profile pictures',
      blocks: [
        'A profile picture is optional and needs an account. Your browser crops the picture you choose to a small square and saves it again before uploading it, so the original file — and anything hidden inside it, such as where a photo was taken — never leaves your device.',
        'The square is stored in Supabase Storage and is public. It is shown next to your name around the game — for example in the rankings, friends lists, match scoreboards and chat — and anyone who has its address can open it.',
        'You can change or remove it at any time on your profile page. Changing it deletes the old picture, and removing it deletes the file. Copies that other people’s browsers have already downloaded can stay in their cache for a while.',
      ],
    },
    {
      id: 'friends',
      title: 'Friends',
      blocks: [
        'Friends need an account. If you add friends, we store who your friends are, when each request was sent and accepted, and any requests still waiting for an answer. Only the two people involved can see them. Declining a request or removing a friend deletes it.',
        'Your friends can see whether you are online and where you are in the game. They can also invite you to their room; the game server passes invites along and does not save them.',
      ],
    },
    {
      id: 'reports',
      title: 'Reports',
      blocks: [
        'Anyone in the game, guests included, can report another player from the online list. When a report is sent, the game server saves it with what the server itself knows about both of you:',
        [
          'the reason picked and any details written;',
          'each person’s name at the time, and their account id if they have an account;',
          'for guests, the random id from the fmm_guest cookie;',
          'the id of each browser tab, and each person’s IP address;',
          'the room either of you was in, and the time.',
        ],
        'Only the server’s admins can see reports, on the server console. The person reported is not told who reported them. Reports are kept for 90 days and then deleted.',
      ],
    },
    {
      id: 'who-can-see',
      title: 'What other people can see',
      blocks: [
        'Anyone, signed in or not, can see:',
        [
          'your username, rating and record, and the date your profile was made;',
          'your profile picture, if you add one;',
          'your match history.',
        ],
        'Everyone connected to the game sees the online list: each player’s name, whether they are a guest, and where they are in the game — in the lobby, in a room, playing or watching — with the room code.',
        'Players in the same room see each other’s names, scores and ratings.',
        'Other players never see your email address.',
      ],
    },
    {
      id: 'your-browser',
      title: 'What your browser keeps',
      blocks: [
        'The game uses your browser’s local storage and session storage, and sets one cookie, only for guests (the last item). It keeps:',
        [
          'your theme, light or dark;',
          'whether game sounds and vibration are on or off, set with the speaker button at the top of every page (both start on);',
          'in Puzzle mode, your fastest time on each level and, for the Daily puzzle, how your first try of each day went (won or lost, the time and the hints used, for about the last 13 months), your streak, your best Daily time, how many Dailies you have played, and — until you finish it — the Daily game you have started, so a refresh does not lose it. It stays in your browser and is never sent to the game server;',
          'your sign-in session, if you sign in, so you stay signed in (managed by Supabase);',
          'as a guest, the name you chose — for this tab only, so a refresh does not sign you out;',
          'a random id for this tab, so if your connection drops the server can give your seat back within 30 seconds;',
          'as a guest, the ids of up to 50 matches you played in the last 30 days, with the name you used and when, so this browser can tell which saved matches were yours;',
          'as a guest, a cookie called fmm_guest: your name, an unofficial rating your browser works out, your ranked wins, losses and draws, and a random id. It lasts 30 days from the last time you played as that guest, is sent only to this site, and is described under “If you play as a guest”.',
        ],
        'The tab-only items go when you close the tab. You can clear the rest in your browser settings at any time.',
      ],
    },
    {
      id: 'game-server',
      title: 'What the game server sees',
      blocks: [
        'While you are connected, the game server holds your IP address in memory. Whoever runs the server can see it, next to your name and where you are, on the server console and in the server’s log output. It is saved to our database only as part of a report (see “Reports”).',
        'The server also keeps a short activity log in memory — who connected, what happened in rooms, and recent game moves — so the operator can see what is going on. A restart clears it. The server’s log output may be kept for a while by the machine or hosting service that runs it.',
        'Rooms, matches in progress and the online list exist only in the server’s memory.',
      ],
    },
    {
      id: 'what-we-dont-do',
      title: 'What we don’t do',
      blocks: [
        [
          'No ads.',
          'No analytics or tracking.',
          'No tracking cookies. The one cookie is the guest cookie described above.',
          'We don’t sell your data or give it to anyone for marketing.',
        ],
      ],
    },
    {
      id: 'services',
      title: 'Services we use',
      blocks: [
        'Supabase runs our database and sign-in, stores profile pictures, and sends the email that confirms a new account. Your account data is stored with Supabase, which keeps its own technical logs as part of running the service.',
        'The website and the game server run on hosting services, which see ordinary network traffic, such as your IP address, when you connect.',
        'In games against the computer, the game server asks AI services for help: Groq (for the AI opponent’s moves and chat lines, and the wording of a hint’s “Why?”) and TypeSafe AI (for the JEV opponent’s moves). The server sends them only what is on the board — the board size, the open cells and their numbers, the scores, and the cells it is choosing between, or for a “Why?” a short description of the numbers around the hinted cell. Nothing you typed (your name or chat messages), and nothing that identifies you, is sent. Puzzle mode sends nothing at all.',
        'When you review a finished game, you can ask its coach questions. A question you type is sent to Groq along with the facts of that game — the moves, the odds of each move, and the players’ names as shown in the game — so it can answer from them. Questions are limited (ten per game, and one every few seconds), and neither your questions nor the answers are saved by the game server; they disappear when you leave the page.',
      ],
    },
    {
      id: 'how-long',
      title: 'How long we keep it',
      blocks: [
        'Accounts and match records stay until you ask us to delete them, or until we wipe the database.',
        'Reports are deleted 90 days after they are sent.',
        'What the server holds in memory goes when you disconnect, or, for the activity log, when the server restarts.',
        'On your own device, the guest cookie and the guest match list go 30 days after you last played as that guest.',
      ],
    },
    {
      id: 'your-choices',
      title: 'Your choices',
      blocks: [
        [
          'Play as a guest. There is no account, and nothing is kept about you beyond match records under the name you chose, and the cookie in your own browser.',
          'Forget a guest on this browser: use “Forget me on this browser” on your profile page, or “Not you?” on the name screen.',
          'Change your username yourself, on your profile page.',
          'Add, change or remove your profile picture yourself, on your profile page.',
          `Delete your account: email ${EMAIL} from the address you signed up with and we will remove it, along with your profile and profile picture. Past match records stay in the public log under the name you played with, no longer linked to an account; say so in the same email if you want your name taken off them too.`,
          'Clear your browser’s storage for this site to remove everything the game keeps on your device.',
        ],
      ],
    },
    {
      id: 'changes',
      title: 'Changes to this policy',
      blocks: ['If we change how we handle data, we will update this page and the date at the top.'],
    },
    contactSection,
  ],
};

const security: Policy = {
  id: 'security',
  title: 'Security policy',
  tab: 'Security',
  intro:
    'Find My Mines is a student project, but security reports are taken seriously — thank you for looking. If you find a problem, please tell us privately first.',
  sections: [
    {
      id: 'report',
      title: 'How to report a problem',
      blocks: [
        'Please don’t open a public issue, pull request or discussion about a security problem. Report it privately instead:',
        [
          `on GitHub: open the repository’s [Security tab](${REPO_URL}/security) and choose “Report a vulnerability” — only the maintainers can see it;`,
          `or by email: ${EMAIL}.`,
        ],
        'Tell us what you found, how to reproduce it, and what an attacker could do with it.',
      ],
    },
    {
      id: 'what-happens-next',
      title: 'What happens next',
      blocks: [
        'This is a student project, so replies are best-effort. We aim to answer within about a week. Once we understand the problem we will fix it, or explain why we won’t.',
        'We will credit you in the advisory unless you would rather we didn’t.',
      ],
    },
    {
      id: 'in-scope',
      title: 'In scope',
      blocks: [
        [
          'The game server: its Socket.IO events, room and match state, and the server console and its access checks.',
          'The website, including anything that shows a player data they should not see — for example, where the mines are.',
          'The database rules: row-level security, and the rule that stops players setting their own rating.',
          'A secret committed to the repository, above all the Supabase service-role key. Please report that straight away.',
        ],
      ],
    },
    {
      id: 'out-of-scope',
      title: 'Out of scope',
      blocks: [
        [
          'Denial of service by flooding or overloading the service.',
          'Problems in the services we build on, such as Supabase. Please report those to the provider.',
          'Anything that needs physical access to the server machine. That machine can open the server console by design, so the course demo works without a database.',
        ],
      ],
    },
    {
      id: 'ground-rules',
      title: 'Ground rules',
      blocks: [
        [
          'Test with your own accounts and your own rooms.',
          'Don’t attack other players, and don’t read, change or delete anyone else’s data.',
          'Don’t overload the service or disrupt other people’s games.',
          'If you reach someone else’s data by accident, stop, don’t keep it, and tell us.',
          'Give us a fair chance to fix a problem before you talk about it publicly.',
        ],
      ],
    },
    {
      id: 'no-bounty',
      title: 'No bug bounty',
      blocks: ['We can’t pay for reports. We can say thank you, and credit you.'],
    },
    {
      id: 'versions',
      title: 'Supported versions',
      blocks: [`Only the latest release gets fixes — currently v${APP_VERSION}. Older versions don’t.`],
    },
    {
      id: 'protections',
      title: 'How the game protects players',
      blocks: [
        [
          'The server decides every move and every score. Your browser only shows what the server tells it.',
          'Mine positions stay on the server. They are never sent to players or spectators.',
          'Only the game server writes ratings. A database rule blocks everyone else — including you, on your own profile.',
          'Each account can store profile pictures only in its own folder, and only as small WebP, PNG or JPEG images — never SVG, which can carry script.',
          'Passwords are handled by Supabase Auth and stored only as a hash.',
          'The server console opens only on the server machine, for listed admin accounts, or with the operator’s access token.',
        ],
      ],
    },
    contactSection,
  ],
};

const terms: Policy = {
  id: 'terms',
  title: 'Terms of service',
  tab: 'Terms of service',
  intro: 'These terms cover playing Find My Mines. They are short. By using the game, you agree to them.',
  sections: [
    {
      id: 'about',
      title: 'About the game',
      blocks: [
        'Find My Mines is a free student project for the Net-Centric course at Chulalongkorn University, run by Taj Kongsaeree.',
      ],
    },
    {
      id: 'as-is',
      title: 'Provided as is',
      blocks: [
        'The game is provided as is, with no warranty of any kind. It may have bugs. It may go offline at any time — for a restart, an update, or for good.',
        'Rooms and matches in progress live in the server’s memory, so a restart ends them.',
      ],
    },
    {
      id: 'accounts',
      title: 'Accounts and usernames',
      blocks: [
        'You can play as a guest or make an account. Keep your password to yourself; you are responsible for what happens on your account.',
        'Pick a username that is not offensive and does not pretend to be someone else.',
      ],
    },
    {
      id: 'fair-play',
      title: 'Fair play',
      blocks: [
        'Please don’t:',
        [
          'cheat, or play with bots, scripts or any other automation;',
          'exploit bugs — report them instead (see the [security policy](/security));',
          'harass, threaten or abuse other players;',
          'use an offensive username, or one that pretends to be someone else;',
          'attack or overload the service, try to break into it, or try to get at other people’s data.',
        ],
      ],
    },
    {
      id: 'moderation',
      title: 'Moderation',
      blocks: [
        'The host of a casual Custom room can kick or ban players from that room. Server admins can kick or ban players from the server and end any game.',
        'Anyone can report a player from the online list. Reports go to the server admins, who decide what, if anything, to do. Please report honestly — reporting someone just to get them removed is itself against these terms.',
        'We may rename offensive usernames, reset ratings, or wipe data — for example to fix a bug or to start fresh. Ratings and records have no value outside the game.',
      ],
    },
    {
      id: 'source-code',
      title: 'Source code',
      blocks: [`The source code is public on [GitHub](${REPO_URL}). You are welcome to read it and to report problems there.`],
    },
    {
      id: 'liability',
      title: 'Limitation of liability',
      blocks: [
        'As far as the law allows, the people behind Find My Mines are not liable for any loss or damage from using the game, or from not being able to use it — including lost matches, ratings or data.',
      ],
    },
    {
      id: 'your-data',
      title: 'Your data',
      blocks: ['What we keep about you, and who can see it, is in the [privacy policy](/privacy).'],
    },
    {
      id: 'changes',
      title: 'Changes to these terms',
      blocks: [
        'We may update these terms. The date at the top shows when they last changed. If you keep playing after a change, you accept the new terms.',
      ],
    },
    contactSection,
  ],
};

export const POLICIES: Readonly<Record<PolicyId, Policy>> = { privacy, security, terms };
