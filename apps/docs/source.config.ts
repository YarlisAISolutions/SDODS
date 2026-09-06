import { defineConfig, defineDocs } from 'fumadocs-mdx/config';
import { remarkMdxMermaid } from 'fumadocs-core/mdx-plugins/remark-mdx-mermaid';

export const docs = defineDocs({ dir: 'content/docs' });

export default defineConfig({
  mdxOptions: {
    remarkPlugins: [remarkMdxMermaid],
    // github-light puts its keyword red at 4.0:1 and its constant orange at 3.1:1 against the
    // code background. The high-contrast variant is the same theme with readable tokens.
    // Its comment grey is still short of AA; global.css lifts that one token.
    rehypeCodeOptions: {
      themes: { light: 'github-light-high-contrast', dark: 'github-dark' },
    },
  },
});
