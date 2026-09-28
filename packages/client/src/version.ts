/**
 * The release players see in the footer, and where its code lives.
 *
 * The single place to bump on a release. It follows the git tag, not
 * package.json, whose version fields were never kept in step.
 */
export const APP_VERSION = '2.0.0';

export const REPO_URL = 'https://github.com/TK-06/find-my-mines';

export const RELEASE_URL = `${REPO_URL}/releases/tag/v${APP_VERSION}`;
