# Security policy

This project includes an optional local Flask model service for the Demo. It
binds to `127.0.0.1` and is not a hosted production API. The repository does
not ship credentials, an OSS integration, or a default remote provider.

Please do not report a vulnerability, secret, customer image, or other private
data in a public issue. Use [GitHub Private Vulnerability
Reporting](https://github.com/LaughingZhu/mockup/security/advisories/new) when
it is enabled. If that channel is unavailable, contact the maintainer through
the [LaughingZhu GitHub profile](https://github.com/LaughingZhu) and include
only a minimal reproduction.

Keep API keys on the server, validate provider payloads, restrict image origins,
and do not persist signed URLs or raw image pixels in mockup state. Do not expose
the local model service beyond localhost without adding authentication, request
limits, and an explicit deployment review.
