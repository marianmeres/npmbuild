# @marianmeres/npmbuild

A quick-and-dirty DRY script for internal needs. Builds an npm-publishable package
from Deno TypeScript source.

## Installation

```ts
import { npmBuild } from "jsr:@marianmeres/npmbuild";
```

## Usage

Create a build script (e.g., `scripts/npm-build.ts`):

```ts
import { npmBuild } from "jsr:@marianmeres/npmbuild";

const denoJson = JSON.parse(Deno.readTextFileSync("deno.json"));

await npmBuild({
	name: denoJson.name,
	version: denoJson.version,
	repository: denoJson.name.replace(/^@/, ''), // conventional mm usage
});
```

Run:

```bash
deno run -A scripts/npm-build.ts
```

Publish:

```bash
cd .npm-dist && npm publish
```

## Options

| Option | Default | Description |
|--------|---------|-------------|
| `name` | required | Package name |
| `version` | required | Package version |
| `srcDir` | `"src"` | Source directory containing TypeScript files |
| `outDir` | `".npm-dist"` | Output directory for npm package |
| `author` | `"Marian Meres"` | Package author |
| `license` | `"MIT"` | Package license |
| `repository` | - | GitHub repo (e.g., `"user/repo"`) for package.json URLs |
| `sourceFiles` | all files from srcDir | Source files to copy from srcDir |
| `rootFiles` | `["LICENSE", "README.md", "llm.txt", "CLAUDE.md", "API.md"]` | Root files to copy to package (missing files are skipped) |
| `dependencies` | `[]` | npm dependencies to install during build |
| `tsconfig` | `{}` | Additional tsconfig compilerOptions overrides |

## Why not dnt?

Deno's official [dnt](https://github.com/denoland/dnt) is a powerful tool, but it's designed for a different use case. It handles remote dependencies, generates CommonJS alongside ESM, provides shims for `Deno.*` APIs, and runs tests through Node.js.

This package takes the opposite approach: simplicity over features.

- **No `Deno.*` APIs** - The packages I publish to npm are pure TypeScript with no Deno-specific code, so I don't need shims or polyfills.
- **ESM only** - Modern Node.js (14+) supports ESM natively. CommonJS output is unnecessary overhead.
- **Local files only** - I don't use remote imports in code destined for npm. A simple file copy and import rewrite is sufficient.
- **~100 lines of code** - Easy to understand, debug, and modify. No abstraction layers, no magic.

If you need dnt's features, use dnt. If you just want to run `tsc` on some local TypeScript files and produce a publishable npm package, this might be enough.

## Example

```bash
cd example && deno run -A build.ts
```