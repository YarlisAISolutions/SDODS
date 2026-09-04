import { defineFactories } from '@sdods/core/data';

export default defineFactories({
  user: (f) => ({
    email: f.internet.email(),
    firstName: f.person.firstName(),
    lastName: f.person.lastName(),
  }),
});
