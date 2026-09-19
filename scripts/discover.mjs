import { SERVERS } from '../src/config.mjs';
import { discoverServer } from '../src/runner.mjs';
for (const id of process.argv[2] ? [process.argv[2]] : Object.keys(SERVERS)) {
  try { const data = await discoverServer(id); console.log(id + ': ' + data.tools.map(t => t.name).join(', ')); }
  catch(e) { console.error(id + ': discovery failed; check configuration and credentials.'); process.exitCode = 1; }
}
