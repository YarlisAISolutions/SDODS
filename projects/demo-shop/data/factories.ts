import { defineFactories } from '@automax/core/data';

/** Faker factories, seeded per scenario fingerprint so retries regenerate identical data. */
export default defineFactories({
  user: (f) => ({
    email: f.internet.email(),
    firstName: f.person.firstName(),
    lastName: f.person.lastName(),
    zip: f.location.zipCode('#####'),
  }),
  post: (f) => ({
    title: `AutoMax ${f.lorem.words(3)}`,
    body: f.lorem.sentence(),
    userId: f.number.int({ min: 1, max: 10 }),
  }),
});
