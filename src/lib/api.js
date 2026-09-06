/**
 * Where the app sends Messages API requests.
 *
 * Calls go to a same-origin proxy (server/anthropic-proxy.js) rather than
 * straight to api.anthropic.com: the browser has no API key, and the Anthropic
 * API does not allow direct cross-origin calls from a page.
 */
export const ANTHROPIC_ENDPOINT = '/api/anthropic/v1/messages';

/** Model used for every assistant feature. */
export const MODEL = 'claude-sonnet-4-6';
