import { createRelay } from './relay.mjs';

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? '127.0.0.1';
const { server } = createRelay({ dir: process.env.RELAY_DATA ?? './relay-data' });
server.listen(port, host, () => console.log(`teams relay listening on http://${host}:${port}`));
