import { defineConfig, defineDocs } from 'fumadocs-mdx/config';
import { remarkMdxMermaid } from 'fumadocs-core/mdx-plugins/remark-mdx-mermaid';

/**
 * Components that only make sense on screen (pictures, live widgets) or only while the repository is
 * public. They are left out of the Markdown export that /llms-full.txt and Maxi read.
 */
const SCREEN_ONLY = new Set([
  'AgentInstall',
  'Art',
  'ArtRow',
  'Mermaid',
  'Playground',
  'RepoOnly',
  'Roadmap',
  'RoadmapChecklist',
  'RoadmapVerification',
  'Screenshot',
  'SupportSdods',
]);

/** Wrappers whose text is worth keeping but whose tag adds nothing to read. */
const UNWRAP = new Set(['Learn', 'Step', 'Steps', 'Tab', 'Tabs']);

interface MdNode {
  type: string;
  name?: string | null;
  data?: Record<string, unknown>;
  children?: MdNode[];
}

/**
 * Marks screen-only components for the Markdown stringifier. Fumadocs' `remarkLLMs` replaces any
 * `filterElement` passed through `includeProcessedMarkdown`, but it honours `data._stringify` on a
 * node, so the choice is recorded on the tree before postprocessing runs. Rendering ignores it.
 */
function remarkMarkdownExport() {
  const mark = (node: MdNode) => {
    if ((node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') && node.name) {
      if (SCREEN_ONLY.has(node.name)) node.data = { ...node.data, _stringify: { text: '' } };
      else if (UNWRAP.has(node.name)) node.data = { ...node.data, _stringify: 'children-only' };
    }
    node.children?.forEach(mark);
  };
  return (tree: MdNode) => mark(tree);
}

export const docs = defineDocs({
  dir: 'content/docs',
  docs: { postprocess: { includeProcessedMarkdown: true } },
});

export default defineConfig({
  mdxOptions: {
    remarkPlugins: [remarkMdxMermaid, remarkMarkdownExport],
    // github-light puts its keyword red at 4.0:1 and its constant orange at 3.1:1 against the
    // code background. The high-contrast variant is the same theme with readable tokens.
    // Its comment grey is still short of AA; global.css lifts that one token.
    rehypeCodeOptions: {
      themes: { light: 'github-light-high-contrast', dark: 'github-dark' },
    },
  },
});
