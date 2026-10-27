// Reads `wrangler preview --json` output and prints the Preview URLs as GITHUB_OUTPUT lines.
// Wrangler logs asset-upload progress to stdout before the JSON, so parse from the first "{" line.
import { readFileSync } from "node:fs";

const text = readFileSync(process.argv[2], "utf8");
const start = text.search(/^\{/m);
if (start === -1) throw new Error("no JSON object in wrangler preview output");
const out = JSON.parse(text.slice(start));
console.log(`url=${out.preview.urls[0]}`);
console.log(`commit_url=${out.deployment.urls[0]}`);
