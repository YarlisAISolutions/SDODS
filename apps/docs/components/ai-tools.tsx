import { AgentInstall, SupportProject } from '@sdods/site-kit';
import {
  AI_TOOLS_GUIDE_HREF,
  AI_TOOLS_GUIDE_PATH,
  SDODS_AGENT_PROJECT,
  SUPPORT_LINKS,
  SUPPORT_PROJECT,
} from '@/lib/ai-tools';

/** `<AgentInstall />` in MDX: the SDODS install widget, with the project filled in. */
export function SdodsAgentInstall({
  compact = false,
  learnMore = true,
}: {
  compact?: boolean;
  /** false on the AI tools guide itself, where the link would point at the page being read. */
  learnMore?: boolean;
}) {
  return (
    <div className="not-prose my-6">
      <AgentInstall
        project={SDODS_AGENT_PROJECT}
        variant={compact ? 'compact' : 'card'}
        learnMoreHref={learnMore ? AI_TOOLS_GUIDE_HREF : undefined}
        learnMoreLabel="Every tool, the MCP endpoint and skills"
      />
    </div>
  );
}

/** `<SupportSdods />` in MDX. Renders nothing until a sponsor link is configured. */
export function SupportSdods({ variant = 'card' }: { variant?: 'card' | 'inline' | 'footer' }) {
  return (
    <div className="not-prose my-6 empty:hidden">
      <SupportProject project={SUPPORT_PROJECT} links={SUPPORT_LINKS} variant={variant} />
    </div>
  );
}

/**
 * The footer every docs page ends with. The AI tools guide already opens with the full widget, so
 * it is not repeated there.
 */
export function DocsPageFooter({ url }: { url: string }) {
  const onGuide = `${url.replace(/\/$/, '')}/` === AI_TOOLS_GUIDE_PATH;
  return (
    <footer className="not-prose mt-10 grid gap-4">
      {!onGuide && (
        <AgentInstall
          project={SDODS_AGENT_PROJECT}
          variant="compact"
          learnMoreHref={AI_TOOLS_GUIDE_HREF}
          learnMoreLabel="Learn more about using SDODS with AI tools"
        />
      )}
      <SupportProject project={SUPPORT_PROJECT} links={SUPPORT_LINKS} variant="footer" />
    </footer>
  );
}
