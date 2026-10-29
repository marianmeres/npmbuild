/**
 * @module
 *
 * Builds an npm-publishable ESM package (`dist/` JS + `.d.ts`, `package.json`) from a
 * Deno-style TypeScript source tree: `.ts` import specifiers, versions in `deno.json`.
 *
 * Written against `node:*` only, so the same file runs on Node (the npm package) and on
 * Deno (the JSR package, through Deno's Node compatibility).
 */

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import process from "node:process";

/** Extensions treated as TypeScript source: rewritten, and never passed through as assets. */
const TS_EXTS = [".ts", ".tsx", ".mts", ".cts"];

const isTs = (path: string): boolean => TS_EXTS.some((ext) => path.endsWith(ext));

/**
 * Regex matching TypeScript relative-import forms this tool rewrites to `.js`.
 * Each match covers only the prefix + string literal (not any trailing `;` or
 * `)`), so arbitrary surrounding syntax is preserved untouched:
 *
 * - `from "./x.ts"` — static `import … from` and `export … from`
 * - `import "./x.ts"` — bare side-effect imports
 * - `import("./x.ts"` — dynamic imports (handles surrounding whitespace)
 *
 * Exported for unit testing; callers should prefer {@link rewriteTsImports}.
 */
export const TS_IMPORT_REWRITE_REGEX =
	/(from\s+|import\s+|import\s*\(\s*)(['"])([^'"]+)\.ts(['"])/g;

/**
 * Rewrites `.ts` specifiers in ES-module import/export statements to `.js`,
 * which is what `tsc` requires in its emitted output.
 *
 * Does not attempt to parse TypeScript — string matches inside comments or
 * string literals can be rewritten too. In practice this is harmless for
 * comments and rare enough in string content to be an acceptable trade-off
 * for the simplicity of a regex approach.
 */
export function rewriteTsImports(source: string): string {
	return source.replace(
		TS_IMPORT_REWRITE_REGEX,
		(_match, prefix: string, q1: string, path: string, q2: string) =>
			`${prefix}${q1}${path}.js${q2}`,
	);
}

/**
 * Extracts the version specifier out of a `deno.json` imports-map value.
 *
 * Accepts forms like `jsr:@scope/name@^1.2`, `npm:pg@^8`, or `npm:@types/pg@^8`
 * and returns the version fragment after the last `@` (excluding the scope
 * prefix `@`). Returns `null` for URL/path entries or registry entries without
 * a version.
 */
function extractImportVersion(importValue: string): string | null {
	const stripped = importValue.replace(/^(jsr:|npm:)/, "");
	if (stripped === importValue) return null;
	const atIndex = stripped.lastIndexOf("@");
	if (atIndex <= 0) return null;
	return stripped.slice(atIndex + 1);
}

/**
 * Appends versions to bare dependency names by looking them up in the
 * `imports` map of a `deno.json` file. Entries that already carry a version
 * (e.g. `"pg@^4"`) or are not present in `imports` are returned unchanged.
 *
 * The result is suitable to pass directly as {@link NpmBuildOptions.dependencies}:
 *
 * ```ts
 * await npmBuild({
 *   // ...
 *   dependencies: versionizeDeps(
 *     ["@marianmeres/clog", "pg@^4", "@types/pg"],
 *     "../deno.json",
 *   ),
 * });
 * ```
 *
 * If you already have `deno.json` loaded (e.g. to read `name`/`version`),
 * pass the parsed object directly to avoid re-reading the file:
 *
 * ```ts
 * const denoJson = JSON.parse(readFileSync("deno.json", "utf8"));
 * await npmBuild({
 *   name: denoJson.name,
 *   version: denoJson.version,
 *   dependencies: versionizeDeps(["@marianmeres/clog", "pg@^4"], denoJson),
 * });
 * ```
 *
 * @param deps - Dependency names, with or without a version specifier.
 * @param denoJsonOrPath - Either a path to `deno.json` (resolved against
 *   the process cwd) or an already-parsed `deno.json` object. Defaults to
 *   `"../deno.json"`, matching the common "build script lives in a
 *   subdirectory" layout.
 */
export function versionizeDeps(
	deps: string[],
	denoJsonOrPath: string | Record<string, unknown> = "../deno.json",
): string[] {
	const denoJson =
		typeof denoJsonOrPath === "string"
			? JSON.parse(readFileSync(denoJsonOrPath, "utf8"))
			: denoJsonOrPath;
	const imports: Record<string, string> =
		(denoJson.imports as Record<string, string>) ?? {};

	return deps.map((dep) => {
		if (dep.lastIndexOf("@") > 0) return dep;
		const entry = imports[dep];
		if (!entry) return dep;
		const version = extractImportVersion(entry);
		return version ? `${dep}@${version}` : dep;
	});
}

/**
 * Configuration for building an npm package from Deno source
 */
export interface NpmBuildOptions {
	/** Source directory containing TypeScript files (default: "src") */
	srcDir?: string;
	/** Output directory for npm package (default: ".npm-dist") */
	outDir?: string;
	/** Package name (required) */
	name: string;
	/** Package version (required) */
	version: string;
	/** Package author (default: "Marian Meres") */
	author?: string;
	/** Package license (default: "MIT") */
	license?: string;
	/** GitHub repository name, e.g. "marianmeres/name" (optional, for repo/bugs URLs) */
	repository?: string;
	/** Source files to copy (default: all files from srcDir, recursively) */
	sourceFiles?: string[];
	/** Root files or directories to copy to package (default: ["LICENSE", "README.md", "API.md", "AGENTS.md", "CLAUDE.md", "docs"]) */
	rootFiles?: string[];
	/**
	 * npm dependencies. Accepts either:
	 *
	 * - `string[]` — installed via `npm install <dep>` during the build; the
	 *   caret range of the installed version is written into `package.json`.
	 *   Any entry in `packageJsonOverrides.dependencies` with the same name
	 *   is overwritten by the install.
	 * - `Record<string, string>` — declared verbatim in `package.json`; no
	 *   install is performed and no `node_modules` is created in `outDir`.
	 *
	 * Default: `[]` (no dependencies).
	 */
	dependencies?: string[] | Record<string, string>;
	/**
	 * npm peerDependencies. Always declared in `package.json` as a peer dep.
	 * Accepts:
	 *
	 * - `string[]` — entries in `name@version` form (use {@link versionizeDeps}
	 *   to derive these from `deno.json`). Installed locally with
	 *   `npm install --no-save` so `tsc` can resolve their types during the
	 *   build, but they do not appear in `dependencies` of the published
	 *   `package.json`. Bare names without `@version` are emitted with `"*"`
	 *   as the range.
	 * - `Record<string, string>` — declared verbatim; no install is performed
	 *   (caller is responsible for any local availability needed by `tsc`).
	 *
	 * Default: none (no `peerDependencies` field emitted).
	 */
	peerDependencies?: string[] | Record<string, string>;
	/**
	 * `peerDependenciesMeta` block, emitted verbatim. Typical use to mark a
	 * peer dependency as optional:
	 *
	 * ```ts
	 * peerDependenciesMeta: { "@scope/pkg": { optional: true } }
	 * ```
	 *
	 * Default: none (no `peerDependenciesMeta` field emitted).
	 */
	peerDependenciesMeta?: Record<string, unknown>;
	/** JSR dependencies to install via 'npx jsr add' (default: none) */
	jsrDependencies?: string[];
	/** tsconfig overrides (deep merged), e.g. { compilerOptions: { strict: true }, include: [...] } */
	tsconfig?: Record<string, unknown>;
	/** Entry point names without extension (default: ["mod"])
	 *  Each entry expects a corresponding src/{name}.ts file
	 *  and generates exports for "./{name}" (or "." for "mod")
	 */
	entryPoints?: string[];
	/** Arbitrary package.json overrides (deep merged with generated values) */
	packageJsonOverrides?: Record<string, unknown>;
	/** Suppress decorative console output. Also auto-stripped when NO_COLOR env var is set. (default: false) */
	quiet?: boolean;
	/** Include dotfiles (e.g. .DS_Store, .gitkeep) when copying srcDir. (default: false) */
	includeHidden?: boolean;
}

/** Return value of {@link npmBuild}. */
export interface NpmBuildResult {
	/** Directory containing the built package. */
	outDir: string;
	/** Entry point names (without extension) exposed in `package.json` exports. */
	entryPoints: string[];
	/** The generated `package.json` (before `npm install` post-processing). */
	packageJson: Record<string, unknown>;
}

function hasHiddenSegment(relPath: string): boolean {
	for (const segment of relPath.split(/[/\\]/)) {
		if (segment.startsWith(".")) return true;
	}
	return false;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return (
		value !== null &&
		typeof value === "object" &&
		Object.getPrototypeOf(value) === Object.prototype
	);
}

/**
 * Deep-merges `other` into a copy of `record` with the semantics of `deepMerge` from
 * `@std/collections` (which it replaces, so the npm package needs no JSR registry):
 * plain objects merge key by key, arrays concatenate, and any other value in `other`
 * replaces the one in `record` — an explicit `undefined` included, which is how an
 * override removes a generated field.
 */
function deepMerge(
	record: Record<string, unknown>,
	other: Record<string, unknown>,
): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	for (const key of new Set([...Object.keys(record), ...Object.keys(other)])) {
		if (key === "__proto__") continue;
		const a = record[key];
		if (!Object.hasOwn(other, key)) {
			result[key] = a;
			continue;
		}
		const b = other[key];
		if (isPlainObject(a) && isPlainObject(b)) result[key] = deepMerge(a, b);
		else if (Array.isArray(a) && Array.isArray(b)) result[key] = [...a, ...b];
		else result[key] = b;
	}
	return result;
}

/** Every non-directory entry under `dir`, recursively. Symlinks are listed, not followed. */
async function listFiles(dir: string): Promise<string[]> {
	const files: string[] = [];
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) files.push(...(await listFiles(path)));
		else files.push(path);
	}
	return files;
}

/**
 * Copies a file or a directory tree, overwriting what is there. Symlinks are copied as
 * symlinks with their target unchanged: resolving a relative target (Node's default)
 * would point a link in `outDir` back at the source tree, and the import rewrite writes
 * through links.
 */
function copy(src: string, dest: string): Promise<void> {
	return cp(src, dest, { recursive: true, force: true, verbatimSymlinks: true });
}

/** Makes sure `dir` exists and is empty. The directory itself is kept. */
async function emptyDir(dir: string): Promise<void> {
	await mkdir(dir, { recursive: true });
	for (const name of await readdir(dir)) {
		await rm(join(dir, name), { recursive: true, force: true });
	}
}

/**
 * Builds an npm package from Deno TypeScript source.
 *
 * - Copies source files and rewrites `.ts` imports to `.js`
 * - Generates `tsconfig.json` and `package.json`
 * - Runs `tsc` (via `npx`, picking up a local or global install) to compile
 * - Passes non-TS source assets through to `dist/` so `import … from "./data.json"`
 *   and similar continue to work in the published package
 * - Cleans up intermediate files
 */
export async function npmBuild(options: NpmBuildOptions): Promise<NpmBuildResult> {
	const {
		srcDir = "src",
		outDir = ".npm-dist",
		name,
		version,
		author = "Marian Meres",
		license = "MIT",
		repository,
		sourceFiles,
		rootFiles = ["LICENSE", "README.md", "API.md", "AGENTS.md", "CLAUDE.md", "docs"],
		dependencies = [],
		peerDependencies = [],
		peerDependenciesMeta,
		jsrDependencies = [],
		tsconfig: tsconfigOverrides = {},
		entryPoints = ["mod"],
		packageJsonOverrides = {},
		quiet = false,
		includeHidden = false,
	} = options;

	if (!name) throw new Error("npmBuild: `name` is required");
	if (!version) throw new Error("npmBuild: `version` is required");
	if (entryPoints.length === 0) {
		throw new Error("npmBuild: `entryPoints` must not be empty");
	}

	const useColor = !process.env.NO_COLOR;
	const sgr =
		(code: string) =>
		(s: string): string =>
			useColor ? `\x1b[${code}m${s}\x1b[0m` : s;
	const gray = sgr("90");
	const green = sgr("32");
	const yellow = sgr("33");
	const boldGreen = sgr("1;32");
	const boldCyan = sgr("1;36");
	const log = (msg: string): void => {
		if (!quiet) console.log(msg);
	};
	const warn = (msg: string): void => {
		if (!quiet) console.warn(msg);
	};

	const outDirSrc = join(outDir, "src");
	const outDirDist = join(outDir, "dist");

	log(gray("Building npm package: ") + boldCyan(`${name}@${version}`));
	log(
		gray("{ srcDir: ") +
			yellow(srcDir) +
			gray(", outDir: ") +
			yellow(outDir) +
			gray(" }"),
	);

	await emptyDir(outDir);

	// copy source files (all files from srcDir by default, or explicit list if provided)
	if (sourceFiles) {
		for (const file of sourceFiles) {
			log(gray(`    --> ${file}`));
			await copy(join(srcDir, file), join(outDirSrc, file));
		}
	} else {
		for (const path of await listFiles(srcDir)) {
			const rel = relative(srcDir, path);
			if (!includeHidden && hasHiddenSegment(rel)) continue;
			log(gray("    --> ") + green(rel));
			await copy(path, join(outDirSrc, rel));
		}
	}

	// copy root files and directories (skip missing)
	const copiedRootFiles: string[] = [];
	for (const asset of rootFiles) {
		try {
			await copy(asset, join(outDir, asset));
			copiedRootFiles.push(asset);
		} catch (e) {
			if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
			warn(yellow(`    --> ${asset} not found, skipping`));
		}
	}

	// rewrite .ts imports to .js (tsc requires this)
	for (const path of await listFiles(outDirSrc)) {
		if (!isTs(path)) continue;
		const contents = await readFile(path, "utf8");
		const replaced = rewriteTsImports(contents);
		if (replaced !== contents) {
			await writeFile(path, replaced);
		}
	}

	// create tsconfig.json
	const tsconfigJson = deepMerge(
		{
			compilerOptions: {
				target: "esnext",
				module: "esnext",
				strict: false,
				declaration: true,
				forceConsistentCasingInFileNames: true,
				skipLibCheck: true,
				rootDir: "src",
				outDir: "dist",
				moduleResolution: "bundler",
			},
			include: ["src/**/*"],
		},
		tsconfigOverrides,
	);
	await writeFile(
		join(outDir, "tsconfig.json"),
		JSON.stringify(tsconfigJson, null, "\t"),
	);

	// create package.json with dynamic exports from entryPoints
	const exportsMap: Record<string, { types: string; import: string }> = {};
	for (const entry of entryPoints) {
		const key = entry === "mod" ? "." : `./${entry}`;
		exportsMap[key] = {
			types: `./dist/${entry}.d.ts`,
			import: `./dist/${entry}.js`,
		};
	}

	const mainEntry = entryPoints[0];
	const declaredDeps: Record<string, string> = Array.isArray(dependencies)
		? {}
		: { ...dependencies };

	const declaredPeerDeps: Record<string, string> = Array.isArray(peerDependencies)
		? Object.fromEntries(
				peerDependencies.map((entry) => {
					const at = entry.lastIndexOf("@");
					return at > 0
						? [entry.slice(0, at), entry.slice(at + 1)]
						: [entry, "*"];
				}),
			)
		: { ...peerDependencies };

	const basePackageJson: Record<string, unknown> = {
		name,
		version,
		type: "module",
		main: `dist/${mainEntry}.js`,
		types: `dist/${mainEntry}.d.ts`,
		exports: exportsMap,
		files: ["dist", ...copiedRootFiles],
		author,
		license,
		dependencies: declaredDeps,
	};
	if (Object.keys(declaredPeerDeps).length > 0) {
		basePackageJson.peerDependencies = declaredPeerDeps;
	}
	if (peerDependenciesMeta && Object.keys(peerDependenciesMeta).length > 0) {
		basePackageJson.peerDependenciesMeta = peerDependenciesMeta;
	}

	const packageJson = deepMerge(basePackageJson, packageJsonOverrides);

	if (repository) {
		packageJson.repository = {
			type: "git",
			url: `git+https://github.com/${repository}.git`,
		};
		packageJson.bugs = {
			url: `https://github.com/${repository}/issues`,
		};
	}

	await writeFile(
		join(outDir, "package.json"),
		JSON.stringify(packageJson, null, "\t"),
	);

	const runCommand = async (cmd: string, args: string[]): Promise<void> => {
		const command = `${cmd} ${args.join(" ")}`;
		log(gray("--> Executing: ") + green(command));
		// stdin is closed, as with `Deno.Command#output()` before: npx then installs
		// what it needs without prompting
		const { code, signal, stdout, stderr } = await new Promise<{
			code: number | null;
			signal: NodeJS.Signals | null;
			stdout: string;
			stderr: string;
		}>((resolve, reject) => {
			const child = spawn(cmd, args, {
				cwd: outDir,
				stdio: quiet
					? ["ignore", "pipe", "pipe"]
					: ["ignore", "inherit", "inherit"],
			});
			let stdout = "";
			let stderr = "";
			child.stdout?.setEncoding("utf8").on("data", (s: string) => {
				stdout += s;
			});
			child.stderr?.setEncoding("utf8").on("data", (s: string) => {
				stderr += s;
			});
			child.on("error", reject);
			child.on("close", (code, signal) =>
				resolve({ code, signal, stdout, stderr }),
			);
		});
		if (code !== 0) {
			const status = code === null ? `signal ${signal}` : `exit code ${code}`;
			const tail = quiet ? `\n${stdout}\n${stderr}` : "";
			throw new Error(`\`${command}\` failed (${status})${tail}`);
		}
	};

	// install dependencies if any (string[] form only — Record<string,string> is declared, not installed)
	if (Array.isArray(dependencies) && dependencies.length > 0) {
		await runCommand("npm", ["install", ...dependencies]);
	}

	// install peerDependencies with --no-save (string[] form only) so tsc can
	// resolve their types during compile. They stay only in peerDependencies
	// in the published package.json — node_modules and package-lock are not
	// part of the npm publish output anyway.
	if (Array.isArray(peerDependencies) && peerDependencies.length > 0) {
		await runCommand("npm", ["install", "--no-save", ...peerDependencies]);
	}

	// install JSR dependencies if any
	if (jsrDependencies.length > 0) {
		await runCommand("npx", ["jsr", "add", ...jsrDependencies]);
	}

	// compile — prefer project-local tsc via npx, fall back to global / auto-install
	await runCommand("npx", ["tsc", "-p", "tsconfig.json"]);

	// pass non-TS assets (e.g. `.json`, `.css`, `.sql`) through to dist/ before
	// the src tree is deleted — tsc does not emit non-TS files and users may
	// import them from their TypeScript sources.
	for (const path of await listFiles(outDirSrc)) {
		if (isTs(path)) continue;
		await copy(path, join(outDirDist, relative(outDirSrc, path)));
	}

	// cleanup
	await rm(join(outDir, "tsconfig.json"));
	await rm(outDirSrc, { recursive: true });

	log(boldGreen("Done!"));

	return { outDir, entryPoints, packageJson };
}
