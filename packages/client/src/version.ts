/**
 * The release players see in the footer, and where its code lives.
 *
 * The single place to bump on a release. It follows the git tag. The root
 * package.json carries the same number; the workspace packages' version fields
 * are not kept in step.
 */
export const APP_VERSION = '3.8.0';

export const REPO_URL = 'https://github.com/TK-06/find-my-mines';

export const RELEASE_URL = `${REPO_URL}/releases/tag/v${APP_VERSION}`;
