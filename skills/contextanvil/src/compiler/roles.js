/**
 * Semantic roles inferred from conventional project structure, plus the words
 * a task uses to talk about each role. Both tables are plain data so a
 * reader can see exactly why "page" points at view templates.
 *
 * A role is only a *hint* worth +1.5 points; it never outweighs a file-name
 * match. Paths are matched, not directory names alone: the pattern must match a
 * whole path segment (or a distinctive extension such as .blade.php).
 */

export const ROLE_PATHS = [
  ['view', /(^|\/)(resources\/views|views|templates)\/|\.blade\.php$|\.(vue|svelte)$|(^|\/)page\.(jsx?|tsx?)$|(^|\/)pages\//i],
  ['endpoint', /(^|\/)(controllers?|routes?|api|endpoints|handlers)\/|(^|\/)route\.(js|ts)$/i],
  ['model', /(^|\/)(models?|entities|entity)\//i],
  ['migration', /(^|\/)(migrations?)\//i],
  ['auth', /(^|\/)(policies|middleware|auth|guards)\//i],
  ['mail', /(^|\/)(mail|mails|emails?|notifications?)\//i],
  ['job', /(^|\/)(jobs?|console|commands?|queues?|workers?)\//i],
  ['validation', /(^|\/)(requests?|validators?|validation)\//i],
  ['config', /(^|\/)(config|configs|settings)\//i],
];

export const ROLE_WORDS = {
  view: ['page', 'screen', 'view', 'template', 'layout', 'html', 'markup', 'list', 'listing'],
  endpoint: ['endpoint', 'api', 'route', 'request', 'response', 'http', 'controller', 'handler', 'webhook', 'rest'],
  model: ['model', 'entity', 'column', 'field', 'attribute', 'database', 'table', 'record', 'persist'],
  migration: ['migration', 'database', 'column', 'table', 'schema'],
  auth: ['permission', 'authorize', 'authorization', 'allowed', 'forbid', 'role', 'admin', 'access', 'policy', 'guard', 'authenticate', 'login', 'session'],
  mail: ['email', 'mail', 'notification', 'notify', 'message', 'subject'],
  job: ['job', 'queue', 'cron', 'schedule', 'background', 'cleanup', 'prune', 'batch', 'command'],
  validation: ['validate', 'validation', 'rule', 'constraint', 'limit', 'required', 'sanitize'],
  config: ['config', 'configuration', 'setting', 'default', 'option', 'environment', 'flag'],
};

/** Roles a repository-relative path plays, from the conventions above. */
export function rolesOf(rel) {
  return ROLE_PATHS.filter(([, re]) => re.test(rel)).map(([role]) => role);
}
