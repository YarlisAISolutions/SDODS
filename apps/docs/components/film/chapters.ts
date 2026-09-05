/**
 * The film's chapters and its transcript.
 *
 * Both live here rather than being burned into the picture: Veo and every other generator
 * misrenders type, and a chapter title in the DOM is spelled correctly, translatable, selectable
 * and readable by a screen reader. The timings come from the cut — sixteen eight-second beats
 * overlapping by a six-tenths dissolve, so each beat begins 7.4 seconds after the one before it.
 */
export const BEAT = 7.4;

export interface Chapter {
  /** Seconds into the film. */
  at: number;
  title: string;
  blurb: string;
}

export const CHAPTERS: Chapter[] = [
  {
    at: 0,
    title: 'The claim nobody can back up',
    blurb: 'Friday night, a wall of red, and one person who remembers.',
  },
  {
    at: 4 * BEAT,
    title: 'One language',
    blurb: 'The browser, the interface behind it, and the two together.',
  },
  {
    at: 7 * BEAT,
    title: 'Evidence, attached',
    blurb: 'A failure that arrives with the picture either side of it.',
  },
  {
    at: 9 * BEAT,
    title: 'Agents propose, people decide',
    blurb: 'Nothing reaches your code until someone says yes.',
  },
  {
    at: 10 * BEAT,
    title: 'What it buys you',
    blurb: 'One history the team trusts, and a gate that reads the evidence.',
  },
  {
    at: 13 * BEAT,
    title: 'The road ahead',
    blurb: 'Evidence, shared truth, self-repair, governed.',
  },
];

/** The spoken line of every beat, in order, for the transcript under the player. */
export const TRANSCRIPT: string[] = [
  'Every team has one person who remembers why the build went red. On Friday night, they are the process.',
  'The rest of us get a list of names in red, and no idea what actually happened.',
  'So someone stays late, guessing. Was it the test, the data, the environment, or something genuinely broken.',
  'Nobody can say for certain. That hesitation, every release night, is the thing worth fixing.',
  'One command. One language for the browser, for the interface behind it, and for the two together.',
  'A scenario written the way a person describes the work, running exactly the way a person would.',
  'State prepared over the wire in a second, so the browser only does the part that matters.',
  'When something breaks, the failure arrives with the picture either side of it, and the exact request.',
  'When the app moves, the test finds it again, and writes down what it changed and why.',
  'Agents do the repetitive half, then wait. Nothing reaches your code until a person says yes.',
  'Now the wall is not a mood. It is evidence, and anyone on the team can read it.',
  'One history everybody trusts. The argument ends, because the answer is on the screen in front of you.',
  'The release stops being a leap. It becomes a gate that reads the evidence and opens.',
  'From evidence, to shared truth, to a suite that repairs itself, to releases that govern themselves.',
  'Five years of direction. Level one is delivered today, and every claim on the site is checkable.',
  'SDODS. Test automation you can defend.',
];

export const clock = (seconds: number): string => {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};
