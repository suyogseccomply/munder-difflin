# Teams relay

Passes encrypted messages and files between Munder Difflin offices. It has no accounts and holds no keys, so its disk only ever contains ciphertext.

## Run it

```sh
# Local, for trying it on one machine
node server/main.mjs

# Hosted
docker build -t teams-relay server
docker run -d -p 8787:8787 -v teams-relay:/data teams-relay
```

Put a hosted relay behind HTTPS, then enter its URL in the app under Team. The app accepts `https://` addresses, or `http://` for this machine only.

## Limits

| What | Limit |
| --- | --- |
| Message | 64 KB |
| Waiting messages per office | 1,000, kept 14 days |
| File | 25 MB, one download, kept 7 days |
| All stored files | 1 GB |
| Invite | One use, kept 24 hours |
| Requests | 240 per minute per IP |

Behind a reverse proxy, every client shares the proxy's IP, so raise `requestsPerMinute` or rate limit at the proxy instead.

## What the relay can see

The relay sees which office ids exchange messages, when, the message sizes and client IP addresses. It can't read messages or files. It could delete or withhold them, so a missing message isn't proof nobody sent it.
