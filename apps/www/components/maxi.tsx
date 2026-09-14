import { MaxiChat } from '@sdods/site-kit';

/**
 * Maxi, the SDODS tutor, as a chat in the corner of every page. The service URL is baked in at
 * build time from NEXT_PUBLIC_MAXI_URL; without it the widget renders nothing.
 */
export function Maxi() {
  return (
    <MaxiChat
      endpoint={process.env.NEXT_PUBLIC_MAXI_URL}
      name="Maxi"
      tagline="The SDODS tutor · answers from the docs"
      greeting="Hi, I'm Maxi. Ask me what SDODS does, how to install it, or how to write your first test, and I'll point you to the docs as we go."
      starters={[
        'What is SDODS good for?',
        'How do I install SDODS?',
        'Write a login test for demo-shop',
      ]}
      toolLabels={{
        find_steps: 'Looking up existing steps…',
        validate_feature: 'Checking the feature file…',
      }}
      placeholder="Ask Maxi about SDODS"
      disclaimer="Maxi can get things wrong, so check the linked docs. Questions are saved anonymously to improve the docs."
      storageKey="sdods-maxi"
    />
  );
}
