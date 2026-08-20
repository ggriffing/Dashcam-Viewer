---
name: Sign-out during session-store outages
description: Logout behavior when the PostgreSQL-backed local session store is temporarily unavailable.
---

Sign-out must clear the browser session identifier and permit social-provider logout even if the local session store cannot be reached. Handle an unavailable store both before the route handler (session middleware lookup) and while destroying a local session.

**Why:** A transient database DNS outage otherwise turns logout into a 500 response and blocks Clerk sign-out. Expiring the browser-held identifier prevents the unreachable server-side session from being reused; normal store destruction remains in place when the database is healthy.

**How to apply:** Keep the sign-out-specific middleware fallback narrowly limited to the sign-out route. Do not extend this error suppression to authenticated application routes, which should continue reporting session-store failures normally.