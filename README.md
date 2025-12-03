# @marianmeres/npmbuild

A quick-and-dirty DRY script for internal needs. Builds an npm-publishable package
from Deno TypeScript source.

## Installation

```ts
import { npmBuild } from "jsr:@marianmeres/npmbuild";
```

## Usage

Create a build script (e.g., `scripts/build-npm.ts`):

```ts
import { npmBuild } from "jsr:@marianmeres/npmbuild";

const denoJson = JSON.parse(Deno.readTextFileSync("deno.json"));

await npmBuild({
	name: denoJson.name,
	version: denoJson.version,
	repository: "your-username/your-repo", // optional
	sourceFiles: ["mod.ts"],               // files from srcDir to include
	rootFiles: ["LICENSE", "README.md"],   // files from project root to include
});
```

Run:

```bash
deno run -A scripts/build-npm.ts
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
| `sourceFiles` | `["mod.ts"]` | Source files to copy from srcDir |
| `rootFiles` | `["LICENSE", "README.md"]` | Root files to copy to package |
| `dependencies` | `[]` | npm dependencies to install during build |
| `tsconfig` | `{}` | Additional tsconfig compilerOptions overrides |
