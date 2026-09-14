---
'@sdods/core': patch
---

`ApiContext.headers` is now case-insensitive, as HTTP header names are. It is a `HeaderMap` (exported from `@sdods/core`), a `Map` whose `set`, `get`, `has` and `delete` lower-case the name, so `delete('x-api-key')` removes a header set as `X-API-Key` and `get('cookie')` finds one set as `Cookie`. Names are stored lower-cased, and when a scenario sets the same header under two casings the last `set` wins. What goes on the wire is unchanged: the client already lower-cased names when building a request. Project workarounds that installed their own case-insensitive map over the `apiContext` fixture can be removed.
