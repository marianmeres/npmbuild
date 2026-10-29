// Child-process fixture for npm-build.e2e.test.ts: runs npmBuild in the cwd with the
// options given as JSON in argv[2], then prints the result as JSON on the last line.

import process from "node:process";
import { npmBuild } from "../src/npm-build.ts";

const result = await npmBuild(JSON.parse(process.argv[2] ?? "{}"));
console.log(JSON.stringify(result));
