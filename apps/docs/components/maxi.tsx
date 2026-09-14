import { MaxiChat } from '@sdods/site-kit';

/**
 * Maxi, the tutor from the getting-started pages, as a chat on every docs page. It knows which page
 * the reader is on, so "explain this page" works. The service URL is baked in at build time from
 * NEXT_PUBLIC_MAXI_URL; without it the widget renders nothing.
 */
export function Maxi() {
  return (
    <MaxiChat
      endpoint={process.env.NEXT_PUBLIC_MAXI_URL}
      name="Maxi"
      tagline="The SDODS tutor · answers from these docs"
      greeting="Hi, I'm Maxi. Ask me about this page, anything in the docs, or to write a scenario for you."
      starters={[
        'Explain this page',
        'How do I run only the smoke tests?',
        'Write an API test for demo-shop',
      ]}
      toolLabels={{
        find_steps: 'Looking up existing steps…',
        validate_feature: 'Checking the feature file…',
      }}
      placeholder="Ask Maxi about SDODS"
      disclaimer="Maxi can get things wrong, so check the linked pages. Questions are saved anonymously to improve the docs."
      storageKey="sdods-maxi"
    />
  );
}
