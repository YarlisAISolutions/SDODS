/**
 * The UI side of the playground: a small stand-in for the SauceDemo storefront the demo-shop
 * project tests, with the same ids, `data-test` attributes, users, products and error messages.
 *
 * It is a state machine, not a screenshot. Steps change this state and the browser panel renders
 * it, so the same feature file you would run with `sdods run -l ui` moves this page around.
 */

export type PageName = 'login' | 'inventory' | 'cart' | 'mocked';

export interface Product {
  name: string;
  slug: string;
  price: number;
  blurb: string;
}

export const PRODUCTS: Product[] = [
  {
    name: 'Sauce Labs Backpack',
    slug: 'sauce-labs-backpack',
    price: 29.99,
    blurb: 'Carry all the things with the sleek, streamlined Sly Pack.',
  },
  {
    name: 'Sauce Labs Bike Light',
    slug: 'sauce-labs-bike-light',
    price: 9.99,
    blurb: 'A red light isn’t the desired state in testing but it sure helps when riding.',
  },
  {
    name: 'Sauce Labs Bolt T-Shirt',
    slug: 'sauce-labs-bolt-t-shirt',
    price: 15.99,
    blurb: 'Get your testing superhero on with the Sauce Labs bolt T-shirt.',
  },
  {
    name: 'Sauce Labs Fleece Jacket',
    slug: 'sauce-labs-fleece-jacket',
    price: 49.99,
    blurb: 'It’s not every day that you come across a midweight quarter-zip fleece jacket.',
  },
  {
    name: 'Sauce Labs Onesie',
    slug: 'sauce-labs-onesie',
    price: 7.99,
    blurb: 'Rib snap infant onesie for the junior automation engineer in development.',
  },
  {
    name: 'Test.allTheThings() T-Shirt (Red)',
    slug: 'test-allthethings-t-shirt-red',
    price: 15.99,
    blurb: 'This classic Sauce Labs t-shirt is perfect to wear when cozying up.',
  },
];

export const USERS: Record<string, { password: string; locked?: boolean; label: string }> = {
  standard_user: { password: 'secret_sauce', label: 'the everyday shopper' },
  locked_out_user: { password: 'secret_sauce', locked: true, label: 'a suspended account' },
  problem_user: { password: 'secret_sauce', label: 'an account with broken images' },
  performance_glitch_user: { password: 'secret_sauce', label: 'an account that loads slowly' },
};

export const LOCKED_MESSAGE = 'Epic sadface: Sorry, this user has been locked out.';
export const MISMATCH_MESSAGE =
  'Epic sadface: Username and password do not match any user in this service';

/** The failure a run reports when a scenario names a product the storefront does not sell. */
export const MISSING_PRODUCT = (name: string): string =>
  `The storefront does not sell "${name}". It lists: ${PRODUCTS.map((p) => p.name).join(', ')}.`;

export const ROUTES: Record<string, string> = {
  login: '/',
  inventory: '/inventory.html',
  cart: '/cart.html',
  checkout: '/checkout-step-one.html',
};

export type SortKey =
  'Name (A to Z)' | 'Name (Z to A)' | 'Price (low to high)' | 'Price (high to low)';

export interface AppState {
  page: PageName;
  path: string;
  fields: { username: string; password: string };
  error: string | null;
  loggedInAs: string | null;
  cart: string[];
  sort: SortKey;
  /** Set when a mocked route answered the navigation instead of the real page. */
  mocked: { text: string; source: string } | null;
  /** The selector the step being executed is acting on; the panel rings it. */
  highlight: string | null;
  /** Shown in the panel chrome when a pooled user's storage state was applied. */
  session: string | null;
}

export function initialApp(): AppState {
  return {
    page: 'login',
    path: '/',
    fields: { username: '', password: '' },
    error: null,
    loggedInAs: null,
    cart: [],
    sort: 'Name (A to Z)',
    mocked: null,
    highlight: null,
    session: null,
  };
}

export function slugOf(product: string): string {
  return product
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function findProduct(name: string): Product | undefined {
  const slug = slugOf(name);
  return PRODUCTS.find((p) => p.slug === slug || p.name.toLowerCase() === name.toLowerCase());
}

export function sortedProducts(sort: SortKey): Product[] {
  const list = [...PRODUCTS];
  switch (sort) {
    case 'Name (Z to A)':
      return list.sort((a, b) => b.name.localeCompare(a.name));
    case 'Price (low to high)':
      return list.sort((a, b) => a.price - b.price);
    case 'Price (high to low)':
      return list.sort((a, b) => b.price - a.price);
    default:
      return list.sort((a, b) => a.name.localeCompare(b.name));
  }
}

/** The text a reader would see on the current page — what the assertion steps read. */
export function visibleText(app: AppState): string {
  if (app.mocked) return app.mocked.text;
  if (app.page === 'login')
    return ['Swag Labs', 'Username', 'Password', 'Login', app.error ?? ''].join(' ');
  if (app.page === 'inventory')
    return [
      'Swag Labs',
      'Products',
      ...PRODUCTS.map((p) => `${p.name} $${p.price.toFixed(2)}`),
    ].join(' ');
  return ['Swag Labs', 'Your Cart', ...app.cart].join(' ');
}

/** Strips tags from a mocked HTML body so the panel can render it without injecting markup. */
export function textFromHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
