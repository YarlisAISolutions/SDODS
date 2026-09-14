import {
  resolveSupportLinks,
  supportMessage,
  type SupportLinks,
  type SupportMessageInput,
  type SupportProviderId,
} from './providers';

export interface SupportProjectProps {
  project: SupportMessageInput;
  links: SupportLinks;
  /**
   * `card`: a titled block with message and buttons. `banner`: the same, wider, for a home page.
   * `inline`: one sentence with buttons. `footer`: a single line with one link, for every page.
   */
  variant?: 'card' | 'banner' | 'inline' | 'footer';
  title?: string;
  message?: string;
  className?: string;
}

function Heart() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
      <path
        d="M12 20.5s-7.5-4.6-9.3-9.2C1.4 8 3.6 4.5 7.1 4.5c2 0 3.5 1.1 4.9 2.9 1.4-1.8 2.9-2.9 4.9-2.9 3.5 0 5.7 3.5 4.4 6.8-1.8 4.6-9.3 9.2-9.3 9.2z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const PRIMARY: SupportProviderId[] = ['sponsor-page', 'stripe', 'github-sponsors'];

/**
 * A support prompt for a free project. Renders nothing when no link is valid, so it can be placed
 * everywhere before the accounts behind it exist.
 */
export function SupportProject({
  project,
  links,
  variant = 'card',
  title,
  message,
  className,
}: SupportProjectProps) {
  const resolved = resolveSupportLinks(links);
  if (resolved.length === 0) return null;
  const text = message ?? supportMessage(project);
  const classes = ['sk-support', `sk-support--${variant}`, className].filter(Boolean).join(' ');
  const primary = resolved.find((l) => PRIMARY.includes(l.provider.id)) ?? resolved[0]!;

  if (variant === 'footer') {
    return (
      <p className={classes}>
        <Heart />
        <span>
          {project.name} is free.{' '}
          <a className="sk-support-link" href={primary.href} rel="noopener">
            Support {project.name}
          </a>
        </span>
      </p>
    );
  }

  const buttons = (
    <div className="sk-support-actions">
      {resolved.map((l) => (
        <a
          key={l.provider.id}
          className={`sk-support-button${l === primary ? ' sk-support-button--primary' : ''}`}
          href={l.href}
          rel="noopener"
        >
          {l === primary && <Heart />}
          {l.provider.id === 'sponsor-page' ? `Sponsor ${project.name}` : l.provider.label}
        </a>
      ))}
    </div>
  );

  if (variant === 'inline') {
    return (
      <div className={classes}>
        <p className="sk-support-message">{text}</p>
        {buttons}
      </div>
    );
  }

  return (
    <section className={classes} aria-label={title ?? `Support ${project.name}`}>
      <p className="sk-support-title">
        <Heart />
        <span>{title ?? `Support ${project.name}`}</span>
      </p>
      <p className="sk-support-message">{text}</p>
      {buttons}
    </section>
  );
}
