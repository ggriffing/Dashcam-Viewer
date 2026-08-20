# Google Maps production validation

The browser Maps key is deliberately restricted to the published application host. Do not test the
real Google Maps JavaScript API from Replit Preview, localhost, automated tests, or any other
unlisted origin. The route viewer detects those load failures and shows **Map unavailable** instead.

## Production-only check

After a successful publish, use the current production URL shown in Replit Publishing. It must match
one of the browser referrers authorized for the Maps key:

1. Sign in to the published app with a normal viewer account.
2. Open a clip that has recorded GPS coordinates.
3. Confirm the route panel changes from **Loading route map** to the interactive map.
4. Scrub through the clip and confirm the red vehicle marker follows the recorded route.
5. In browser developer tools, confirm the Maps JavaScript request succeeds and that there are no
   `RefererNotAllowedMapError`, `InvalidKeyMapError`, or `gm_authFailure` messages.

If the key, referrer restriction, network, or Maps service rejects a request, the panel must change
from **Loading route map** to **Map unavailable** and provide the reason. This fallback is covered
with mocked browser tests; the production-only check is the only place to validate the live Google
service.