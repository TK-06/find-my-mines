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

/**
 * Optional password for the /admin console. Unset (LAN demo) means open, as
 * before. Set it on a public host so a stranger cannot hit Reset: the console
 * is then opened as /admin?token=<value>.
 */
export const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? '';
