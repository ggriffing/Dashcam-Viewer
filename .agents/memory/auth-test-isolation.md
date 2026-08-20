---
name: Authentication test isolation
description: How to distinguish account-level and origin-level behavior in local authentication rate-limit tests.
---

Authentication rate limits have two independent dimensions: the IP bucket is shared by requests from one origin, while the username bucket follows an account across origins. Tests that reuse a username can hit the account limit before they exercise IP-quota retention.

**Why:** A failed test initially looked like shared-IP state was being cleared incorrectly, but it was the intentional account bucket shared across the test's different IP addresses.

**How to apply:** Use a dedicated username when testing IP retention, and keep the origin fixed for the requests that prove the shared quota remains after a successful request.