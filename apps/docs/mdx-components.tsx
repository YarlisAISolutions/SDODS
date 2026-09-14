import defaultMdxComponents from 'fumadocs-ui/mdx';
import type { MDXComponents } from 'mdx/types';
import { Callout } from 'fumadocs-ui/components/callout';
import { Card, Cards } from 'fumadocs-ui/components/card';
import { ImageZoom } from 'fumadocs-ui/components/image-zoom';
import { Step, Steps } from 'fumadocs-ui/components/steps';
import { Tab, Tabs } from 'fumadocs-ui/components/tabs';
import { TypeTable } from 'fumadocs-ui/components/type-table';
import { Mermaid } from '@/components/mermaid';
import { Planned } from '@/components/planned';
import { Learn } from '@/components/learn';
import { Screenshot } from '@/components/screenshot';
import { Art, ArtRow } from '@/components/art';
import { Playground } from '@/components/playground';
import { Roadmap, RoadmapChecklist, RoadmapVerification } from '@/components/roadmap';
import { RepoOnly } from '@/components/repo-only';
import { SdodsAgentInstall, SupportSdods } from '@/components/ai-tools';

/**
 * A markdown table that is wider than the column scrolls sideways, and the wrapper Fumadocs
 * gives it cannot be focused — so a keyboard has no way to scroll it. Same wrapper, reachable.
 */
function Table(props: React.HTMLAttributes<HTMLTableElement>) {
  return (
    <div
      tabIndex={0}
      role="region"
      aria-label="Table, scrolls sideways"
      className="prose-no-margin relative my-6 overflow-auto"
    >
      <table {...props} />
    </div>
  );
}

export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...defaultMdxComponents,
    table: Table,
    Callout,
    Card,
    Cards,
    ImageZoom,
    Step,
    Steps,
    Tab,
    Tabs,
    TypeTable,
    Mermaid,
    Planned,
    Learn,
    Screenshot,
    Art,
    ArtRow,
    Playground,
    Roadmap,
    RoadmapChecklist,
    RoadmapVerification,
    RepoOnly,
    AgentInstall: SdodsAgentInstall,
    SupportSdods,
    ...components,
  };
}
