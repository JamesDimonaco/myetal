/**
 * Re-export the existing public scanner as a tab. The scanner itself has no
 * authed/anon distinction — both kinds of user just want to land on
 * `/c/{code}` after a scan — so we share the implementation.
 */
export { default } from '../scan';
