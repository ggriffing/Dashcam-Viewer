---
name: Authentication abuse limits
description: Rules for preserving account and IP rate limits on local authentication routes.
---

Rate limiters for local credentials should track both a shared IP bucket and, where applicable, a username bucket. A successful sign-in may clear only that username's bucket; a successful sign-up must not clear the IP bucket.

**Why:** Clearing the shared quota after any successful request lets an attacker use accounts they control to bypass the limit and repeatedly trigger password-hashing work or create unbounded accounts.

**How to apply:** When adjusting local authentication or recovery flows, retain shared origin-level attempt counters until their window expires and only reset a narrowly scoped account counter after verified authentication.