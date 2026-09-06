/**
 * The browser panel: a stand-in for the storefront under test.
 *
 * It keeps the ids and `data-test` attributes the real page objects target, so the locators the
 * docs show are the locators you see acting here. The amber ring marks the element the current
 * step is touching — the closest thing to watching a headed run.
 */
import { UI_BASE } from './sandbox';
import { PRODUCTS, sortedProducts, type AppState } from './shop';

function ring(app: AppState, selector: string): string {
  return app.highlight === selector
    ? ' outline-2 outline-offset-2 outline-amber-500 transition-all'
    : '';
}

function Chrome({ app, children }: { app: AppState; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-300 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-100 px-3 py-2">
        <span className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-rose-400" />
          <span className="size-2.5 rounded-full bg-amber-400" />
          <span className="size-2.5 rounded-full bg-emerald-400" />
        </span>
        <span className="ml-1 flex-1 truncate rounded bg-white px-2 py-1 font-mono text-[11px] text-slate-600">
          {UI_BASE}
          {app.path}
        </span>
        <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
          chromium
        </span>
      </div>
      {app.session ? (
        <div className="border-b border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[11px] text-emerald-800">
          {app.session}
        </div>
      ) : null}
      <div className="min-h-[260px] bg-white p-4 text-slate-800">{children}</div>
    </div>
  );
}

function StoreHeader({ app }: { app: AppState }) {
  return (
    <div className="mb-4 flex items-center justify-between border-b border-slate-200 pb-3">
      <span className="text-lg font-bold tracking-tight text-emerald-700">Swag Labs</span>
      <span className={`relative inline-flex${ring(app, '[data-test="shopping-cart-link"]')}`}>
        <svg viewBox="0 0 24 24" className="size-6 text-slate-500" aria-hidden fill="none">
          <path
            d="M3 4h2l2.4 11h10.2l2-8H6"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="9" cy="19" r="1.6" fill="currentColor" />
          <circle cx="17" cy="19" r="1.6" fill="currentColor" />
        </svg>
        {app.cart.length > 0 ? (
          <span
            className={`absolute -top-2 -right-2 flex size-5 items-center justify-center rounded-full bg-rose-500 text-[11px] font-bold text-white${ring(app, '[data-test="shopping-cart-badge"]')}`}
          >
            {app.cart.length}
          </span>
        ) : null}
      </span>
    </div>
  );
}

function LoginScreen({ app }: { app: AppState }) {
  return (
    <div className="mx-auto max-w-xs py-4 text-center">
      <p className="mb-5 text-xl font-bold tracking-tight text-emerald-700">Swag Labs</p>
      <input
        readOnly
        tabIndex={-1}
        id="user-name"
        placeholder="Username"
        value={app.fields.username}
        className={`mb-2 w-full rounded border border-slate-300 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400${ring(app, '#user-name')}`}
      />
      <input
        readOnly
        tabIndex={-1}
        id="password"
        type="password"
        placeholder="Password"
        value={app.fields.password}
        className={`mb-3 w-full rounded border border-slate-300 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400${ring(app, '#password')}`}
      />
      <span
        className={`block w-full rounded bg-emerald-700 py-2 text-sm font-semibold text-white${ring(app, '#login-button')}`}
      >
        Login
      </span>
      {app.error ? (
        <p
          className={`mt-3 rounded bg-rose-600 px-3 py-2 text-left text-xs font-medium text-white${ring(app, '[data-test="error"]')}`}
        >
          {app.error}
        </p>
      ) : (
        <p className="mt-4 text-[11px] leading-relaxed text-slate-500">
          Accepted usernames: standard_user, problem_user, performance_glitch_user, locked_out_user.
          Password: secret_sauce.
        </p>
      )}
    </div>
  );
}

function InventoryScreen({ app }: { app: AppState }) {
  return (
    <>
      <StoreHeader app={app} />
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-base font-bold text-slate-900">Products</h3>
        <span
          className={`rounded border border-slate-300 px-2 py-1 text-[11px] text-slate-600${ring(app, '[data-test="product-sort-container"]')}`}
        >
          {app.sort}
        </span>
      </div>
      <ul className="grid gap-2 sm:grid-cols-2">
        {sortedProducts(app.sort).map((product) => {
          const inCart = app.cart.includes(product.name);
          const selector = inCart
            ? `[data-test="remove-${product.slug}"]`
            : `[data-test="add-to-cart-${product.slug}"]`;
          return (
            <li
              key={product.slug}
              className="flex flex-col justify-between rounded border border-slate-200 p-2.5"
            >
              <p className="text-[13px] leading-snug font-semibold text-slate-900">
                {product.name}
              </p>
              <p className="mt-2 flex items-center justify-between">
                <span className="font-mono text-xs text-slate-600">
                  ${product.price.toFixed(2)}
                </span>
                <span
                  className={`rounded border px-2 py-1 text-[11px] font-semibold${
                    inCart
                      ? ' border-rose-400 text-rose-600'
                      : ' border-emerald-500 text-emerald-700'
                  }${ring(app, selector)}`}
                >
                  {inCart ? 'Remove' : 'Add to cart'}
                </span>
              </p>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function CartScreen({ app }: { app: AppState }) {
  return (
    <>
      <StoreHeader app={app} />
      <h3 className="mb-3 text-base font-bold text-slate-900">Your Cart</h3>
      {app.cart.length === 0 ? (
        <p className="text-sm text-slate-500">The cart is empty.</p>
      ) : (
        <ul className="divide-y divide-slate-200">
          {app.cart.map((item) => {
            const product = PRODUCTS.find((p) => p.name === item);
            return (
              <li key={item} className="flex items-center justify-between py-2 text-sm">
                <span className="font-semibold text-slate-900">{item}</span>
                <span className="font-mono text-xs text-slate-600">
                  ${product ? product.price.toFixed(2) : '—'}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function MockedScreen({ app }: { app: AppState }) {
  return (
    <>
      <div className="mb-3 inline-block rounded bg-indigo-100 px-2 py-1 font-mono text-[11px] text-indigo-700">
        answered by the mock {app.mocked?.source}
      </div>
      <p className="text-lg leading-snug font-bold text-slate-900">{app.mocked?.text}</p>
    </>
  );
}

export function BrowserPanel({ app }: { app: AppState }) {
  return (
    <Chrome app={app}>
      {app.mocked ? (
        <MockedScreen app={app} />
      ) : app.page === 'login' ? (
        <LoginScreen app={app} />
      ) : app.page === 'cart' ? (
        <CartScreen app={app} />
      ) : (
        <InventoryScreen app={app} />
      )}
    </Chrome>
  );
}
