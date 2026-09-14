import type { MailConfig } from '@sdods/contracts';
import { MailpitInbox } from './mailpit.js';
import type { MailInbox } from './types.js';

export type { MailAddress, MailInbox, MailMessage, MailSearch, MailSummary } from './types.js';
export { MailpitInbox, type MailpitOptions } from './mailpit.js';
export {
  decodeEntities,
  extractLinks,
  findCode,
  findLinkMatching,
  findLinkNamed,
  htmlToText,
  readableText,
  type MailLink,
} from './extract.js';

/** The inbox adapter for an environment's `mail` block. */
export function createMailInbox(config: Pick<MailConfig, 'provider' | 'url' | 'auth'>): MailInbox {
  switch (config.provider ?? 'mailpit') {
    case 'mailpit':
      return new MailpitInbox({ url: config.url, auth: config.auth });
  }
}
