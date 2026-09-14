export interface MailAddress {
  name: string;
  address: string;
}

/** One message as a search returns it: enough to pick which message to open, no body. */
export interface MailSummary {
  id: string;
  from: MailAddress;
  to: MailAddress[];
  subject: string;
  /** When the mail catcher received it, on the catcher's clock. */
  receivedAt: Date;
}

/** A whole message. `text` and `html` are empty strings when that part is absent. */
export interface MailMessage extends MailSummary {
  text: string;
  html: string;
}

export interface MailSearch {
  /** Exact recipient address, compared case-insensitively. */
  to: string;
  /** Case-sensitive substring of the subject. */
  subjectContains?: string;
  /** Only messages received at or after this instant. */
  since?: Date;
}

/**
 * A mail catcher the email steps read. Implementations return search results newest first and
 * match `to` EXACTLY: a catcher whose own `to:` filter is a substring search (Mailpit's is) must
 * narrow it client-side, or `a@x.test` would also match `ba@x.test`.
 */
export interface MailInbox {
  /** Delete every message addressed to `address`. */
  clear(address: string): Promise<void>;
  search(query: MailSearch): Promise<MailSummary[]>;
  get(id: string): Promise<MailMessage>;
}
