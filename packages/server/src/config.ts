import { SERVER_HOST, SERVER_PORT } from '@fmm/shared';

/**
 * The port and host come from the shared source-code constants (the assignment
 * requires them to be set in source, not entered by users). Environment
 * variables exist only so the Docker image and EC2 can override them without
 * a rebuild — they are not part of the normal workflow.
 */
export const PORT = Number(process.env.PORT ?? SERVER_PORT);
export const HOST = process.env.HOST ?? '0.0.0.0';

/** Advertised address, used for the startup banner only. */
export const ADVERTISED_HOST = process.env.ADVERTISED_HOST ?? SERVER_HOST;

/**
 * In dev the Vite client runs on its own port and needs CORS. When hosted, set
 * this to the Vercel address(es), comma-separated, e.g.
 * CORS_ORIGIN=https://find-my-mines.vercel.app,https://find-my-mines-git-main-you.vercel.app
 */
const corsList = (process.env.CORS_ORIGIN ?? '*')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
export const CORS_ORIGIN: string | string[] =
  corsList.length === 1 ? corsList[0]! : corsList;

/** Where the game lives when PUBLIC_URL does not say otherwise. */
const DEFAULT_PUBLIC_URL = 'https://findmymines.app';

/**
 * The address to put in a link preview, from a PUBLIC_URL value: an http(s)
 * address with its trailing slash dropped, or the default for anything else —
 * unset, blank, not a URL, or another scheme (javascript:, ftp:). Any query,
 * fragment or login in it is dropped too.
 */
export function publicUrlFrom(raw: string | undefined): string {
  try {
    const url = new URL((raw ?? '').trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return DEFAULT_PUBLIC_URL;
    return url.origin + url.pathname.replace(/\/+$/, '');
  } catch {
    return DEFAULT_PUBLIC_URL;
  }
}

/**
 * Optional. The public address of the game, used for the og:url of the link
 * previews that chat apps unfurl from a /join/CODE or /u/NAME link (see
 * preview.ts), e.g. PUBLIC_URL=https://findmymines.app. It is set here, never
 * built from the request's Host header, which a visitor controls.
 */
export const PUBLIC_URL = publicUrlFrom(process.env.PUBLIC_URL);

/**
 * Optional password for the /admin console: a third way in, beside the server
 * machine and an admin account. Set it on a public host (behind a proxy the
 * server-machine route never applies) and open the console as
 * /admin?token=<value>. Unset means this route is closed — never that the
 * console is open to everyone.
 */
export const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? '';

/**
 * Play vs AI. The computer opponent always plays on the solver; with a Groq
 * key it also asks a language model to choose among the solver's candidates
 * and to say something in the room chat. No key means no model — never a
 * broken game.
 *
 * The key is a SECRET: server-only, never logged, never sent to a client, and
 * never given a VITE_ prefix (Vite would bundle it into the browser).
 */
export const GROQ_API_KEY = process.env.GROQ_API_KEY ?? '';

/** Which Groq model advises the bot. See `npm run ai:eval` for how they compare. */
export const AI_MODEL = process.env.AI_MODEL?.trim() || 'openai/gpt-oss-20b';

/**
 * Play vs JEV, TypeSafe AI's model. It chooses among the solver's candidates
 * (see ai/jev.ts). Only with a key can JEV be played at all: without one the
 * server refuses it and the lobby shows it as unavailable.
 *
 * A SECRET like GROQ_API_KEY: server-only, never logged, never sent to a
 * client, never given a VITE_ prefix.
 */
export const JEV_API_KEY = process.env.JEV_API_KEY ?? '';

/** Which JEV model to ask. */
export const JEV_MODEL = process.env.JEV_MODEL?.trim() || 'jev-latest';
