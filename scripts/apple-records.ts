// Parses the synthetic Apple Health export into fixtures/data/apple-health/records.json,
// the records the Workers tests upload (the browser parser's output). Part of `npm run fixtures`.
import parseFixture from "../test/global-apple-records";

await parseFixture();
