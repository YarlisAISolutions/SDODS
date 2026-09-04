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
import { RepoOnly } from '@/components/repo-only';

export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...defaultMdxComponents,
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
    RepoOnly,
    ...components,
  };
}
