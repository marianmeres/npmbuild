// End-to-end tests: build a small fixture project with npmBuild in a child process,
// inspect the output directory, and import the built package.
//
// The build runs on Node from source. `BUILD_RUNTIME=deno` runs it on Deno instead
// (`pnpm run test:deno`), which is how the JSR consumers execute it.
//
// Fixtures live under the repo's tmp/, not the OS temp dir: `npx tsc` walks up from
// the output directory looking for node_modules/.bin/tsc, and must find this repo's
// TypeScript there rather than a global install or a download.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import process from "node:process";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { npmBuild } from "../src/npm-build.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const BUILD = join(ROOT, "tests", "_build.ts");
const TMP = join(ROOT, "tmp");

/** How the build is started: Node by default, Deno under `BUILD_RUNTIME=deno`. */
const BUILD_ARGV: [string, ...string[]] =
	process.env.BUILD_RUNTIME === "deno"
		? ["deno", "run", "-A", "--no-lock", BUILD]
		: [process.execPath, BUILD];

const fixtures: string[] = [];
after(async () => {
	for (const dir of fixtures) await rm(dir, { recursive: true, force: true });
});

/** Create a fixture project under tmp/ seeded with `files` (paths may be nested). */
async function makeProject(files: Record<string, string>): Promise<string> {
	const dir = await mkdtemp(join(TMP, "e2e-"));
	fixtures.push(dir);
	for (const [name, content] of Object.entries(files)) {
		await mkdir(dirname(join(dir, name)), { recursive: true });
		await writeFile(join(dir, name), content);
	}
	return dir;
}

/** Spawn `file args` in `cwd`; resolves with the exit code and captured output. */
function exec(
	cwd: string,
	file: string,
	args: string[],
	env: Record<string, string | undefined> = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
	return new Promise((resolve, reject) => {
		const child = spawn(file, args, {
			cwd,
			env: { ...process.env, ...env },
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout.setEncoding("utf8").on("data", (s: string) => {
			stdout += s;
		});
		child.stderr.setEncoding("utf8").on("data", (s: string) => {
			stderr += s;
		});
		child.on("error", reject);
		child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
	});
}

/** Run npmBuild with `options` in `cwd` (NO_COLOR unset unless `env` sets it). */
function build(
	cwd: string,
	options: Record<string, unknown>,
	env: Record<string, string | undefined> = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
	const [file, ...pre] = BUILD_ARGV;
	return exec(cwd, file, [...pre, JSON.stringify(options)], {
		NO_COLOR: undefined,
		...env,
	});
}

/** Run npmBuild and return its parsed result; fails the test on a non-zero exit. */
async function buildOk(
	cwd: string,
	options: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	const { code, stdout, stderr } = await build(cwd, options);
	assert.equal(code, 0, `build failed:\n${stdout}\n${stderr}`);
	return JSON.parse(stdout.trim().split("\n").at(-1) ?? "");
}

const readJson = async (path: string): Promise<Record<string, unknown>> =>
	JSON.parse(await readFile(path, "utf8"));

const FIXTURE = {
	LICENSE: "MIT\n",
	"README.md": "# fixture\n",
	"docs/guide.md": "# guide\n",
	"src/mod.ts": [
		`import "./side.ts";`,
		`import data from "./data.json" with { type: "json" };`,
		`export { add } from "./utils/math.ts";`,
		`export type { Pair } from "./types.ts";`,
		`export const answer: number = data.answer;`,
		`export async function lazy(): Promise<number> {`,
		`\tconst { add } = await import("./utils/math.ts");`,
		`\treturn add(1, 2);`,
		`}`,
	].join("\n"),
	"src/side.ts": `(globalThis as Record<string, unknown>).__sideEffect = "ran";\n`,
	"src/types.ts": "export type Pair = [number, number];\n",
	"src/utils/math.ts": "export const add = (a: number, b: number): number => a + b;\n",
	"src/extra.ts": `export { add as plus } from "./utils/math.ts";\n`,
	"src/data.json": `{ "answer": 42 }\n`,
	"src/assets/style.css": "body { color: red; }\n",
	"src/.hidden": "skipped by default\n",
};

test("builds a package: package.json, dist, assets, root files, cleanup", async () => {
	const dir = await makeProject(FIXTURE);
	const outDir = join(dir, ".npm-dist");
	// emptyDir: whatever was in outDir before is gone
	await mkdir(outDir);
	await writeFile(join(outDir, "stale.txt"), "stale");

	const result = await buildOk(dir, {
		name: "@fixture/pkg",
		version: "1.2.3",
		repository: "fixture/pkg",
		entryPoints: ["mod", "extra"],
		rootFiles: ["LICENSE", "README.md", "docs", "MISSING.md"],
		// the Record forms are declared, not installed: no network, no node_modules
		dependencies: { "left-pad": "^1.3.0" },
		peerDependencies: { "right-pad": "^1" },
		peerDependenciesMeta: { "right-pad": { optional: true } },
		packageJsonOverrides: {
			description: "fixture",
			files: ["extra-file"],
			exports: { "./package.json": "./package.json" },
		},
		quiet: true,
	});

	const expected = {
		name: "@fixture/pkg",
		version: "1.2.3",
		type: "module",
		main: "dist/mod.js",
		types: "dist/mod.d.ts",
		exports: {
			".": { types: "./dist/mod.d.ts", import: "./dist/mod.js" },
			"./extra": { types: "./dist/extra.d.ts", import: "./dist/extra.js" },
			"./package.json": "./package.json",
		},
		// arrays in overrides are appended, not replaced; MISSING.md is not listed
		files: ["dist", "LICENSE", "README.md", "docs", "extra-file"],
		author: "Marian Meres",
		license: "MIT",
		dependencies: { "left-pad": "^1.3.0" },
		peerDependencies: { "right-pad": "^1" },
		peerDependenciesMeta: { "right-pad": { optional: true } },
		description: "fixture",
		repository: { type: "git", url: "git+https://github.com/fixture/pkg.git" },
		bugs: { url: "https://github.com/fixture/pkg/issues" },
	};
	assert.deepEqual(await readJson(join(outDir, "package.json")), expected);
	assert.deepEqual(result, {
		outDir: ".npm-dist",
		entryPoints: ["mod", "extra"],
		packageJson: expected,
	});

	for (const path of [
		"LICENSE",
		"README.md",
		"docs/guide.md",
		"dist/mod.js",
		"dist/mod.d.ts",
		"dist/extra.js",
		"dist/side.js",
		"dist/utils/math.js",
		"dist/utils/math.d.ts",
		"dist/data.json",
		"dist/assets/style.css",
	]) {
		assert.ok(existsSync(join(outDir, path)), `missing ${path}`);
	}
	for (const path of [
		"stale.txt",
		"MISSING.md",
		"src",
		"tsconfig.json",
		"node_modules",
		"dist/.hidden",
		"dist/mod.ts",
	]) {
		assert.ok(!existsSync(join(outDir, path)), `unexpected ${path}`);
	}

	const modJs = await readFile(join(outDir, "dist/mod.js"), "utf8");
	assert.match(modJs, /import "\.\/side\.js"/);
	assert.match(modJs, /import\("\.\/utils\/math\.js"\)/);
	assert.doesNotMatch(modJs, /\.ts["']/);

	// the built package runs: every rewritten import resolves
	const { code, stdout, stderr } = await exec(outDir, process.execPath, [
		"--input-type=module",
		"-e",
		[
			`const m = await import("./dist/mod.js");`,
			`const x = await import("./dist/extra.js");`,
			`console.log(JSON.stringify([m.add(2, 3), m.answer, await m.lazy(), x.plus(1, 1), globalThis.__sideEffect]));`,
		].join("\n"),
	]);
	assert.equal(code, 0, stderr);
	assert.deepEqual(JSON.parse(stdout), [5, 42, 3, 2, "ran"]);
});

test("an undefined override removes a generated field (in process)", async () => {
	// options reach the child as JSON, which cannot carry `undefined`
	const dir = await makeProject({ "src/mod.ts": "export {};\n" });
	const outDir = join(dir, ".npm-dist");
	const { packageJson } = await npmBuild({
		name: "a",
		version: "1.0.0",
		srcDir: join(dir, "src"),
		outDir,
		rootFiles: [],
		packageJsonOverrides: { types: undefined, main: undefined },
		quiet: true,
	});
	const written = await readJson(join(outDir, "package.json"));
	assert.ok(!("types" in written) && !("main" in written), JSON.stringify(written));
	assert.equal(packageJson.types, undefined);
});

test("a symlink in srcDir is copied as a link: the rewrite never edits the source", async () => {
	const real = `export { add } from "./utils/math.ts";\n`;
	const dir = await makeProject({
		"src/mod.ts": `export * from "./link.ts";\n`,
		"src/real.ts": real,
		"src/utils/math.ts": FIXTURE["src/utils/math.ts"],
	});
	await symlink("real.ts", join(dir, "src/link.ts"));

	await buildOk(dir, { name: "a", version: "1.0.0", quiet: true });
	assert.equal(await readFile(join(dir, "src/real.ts"), "utf8"), real);
	assert.ok(existsSync(join(dir, ".npm-dist/dist/link.js")));
});

test("sourceFiles (nested) and includeHidden", async () => {
	const dir = await makeProject({
		"src/mod.ts": `export { add } from "./utils/math.ts";\n`,
		"src/utils/math.ts": FIXTURE["src/utils/math.ts"],
		"src/unused.ts": "export const unused = 1;\n",
		"src/.hidden": "kept\n",
		"src/.config/settings.json": "{}\n",
	});

	await buildOk(dir, {
		name: "a",
		version: "1.0.0",
		sourceFiles: ["mod.ts", "utils/math.ts"],
		quiet: true,
	});
	assert.ok(existsSync(join(dir, ".npm-dist/dist/utils/math.js")));
	assert.ok(!existsSync(join(dir, ".npm-dist/dist/unused.js")));
	assert.ok(!existsSync(join(dir, ".npm-dist/dist/.hidden")));

	await buildOk(dir, { name: "a", version: "1.0.0", includeHidden: true, quiet: true });
	assert.ok(existsSync(join(dir, ".npm-dist/dist/unused.js")));
	assert.ok(existsSync(join(dir, ".npm-dist/dist/.hidden")));
	assert.ok(existsSync(join(dir, ".npm-dist/dist/.config/settings.json")));
});

test("console output: progress lines, missing-file warning, NO_COLOR", async () => {
	const dir = await makeProject({ "src/mod.ts": FIXTURE["src/utils/math.ts"] });
	const options = { name: "a", version: "1.0.0", rootFiles: ["MISSING.md"] };

	const plain = await build(dir, options, { NO_COLOR: "1" });
	assert.equal(plain.code, 0, plain.stderr);
	assert.ok(plain.stdout.includes("Building npm package: a@1.0.0"), plain.stdout);
	assert.ok(plain.stdout.includes("{ srcDir: src, outDir: .npm-dist }"), plain.stdout);
	assert.ok(plain.stdout.includes("    --> mod.ts"), plain.stdout);
	assert.ok(plain.stdout.includes("--> Executing: npx tsc -p tsconfig.json"));
	assert.ok(plain.stdout.includes("Done!"));
	assert.ok(plain.stderr.includes("    --> MISSING.md not found, skipping"));
	assert.ok(!`${plain.stdout}${plain.stderr}`.includes("\x1b["), "no escape codes");

	const colored = await build(dir, options);
	assert.equal(colored.code, 0, colored.stderr);
	assert.ok(colored.stdout.includes("\x1b[32mmod.ts\x1b[0m"), colored.stdout);

	const quiet = await build(dir, { ...options, quiet: true });
	assert.equal(quiet.code, 0, quiet.stderr);
	assert.equal(quiet.stdout.trim().split("\n").length, 1, "only the result line");
	assert.equal(quiet.stderr, "");
});

test("a failing command rejects with its exit code (and output, when quiet)", async () => {
	const dir = await makeProject({
		"src/mod.ts": `export const n: number = "not a number";\n`,
	});
	const { code, stderr } = await build(dir, {
		name: "a",
		version: "1.0.0",
		quiet: true,
	});
	assert.notEqual(code, 0);
	assert.match(stderr, /`npx tsc -p tsconfig\.json` failed \(exit code \d+\)/);
	assert.match(stderr, /TS2322/);
});

test("invalid options throw before touching the disk", async () => {
	const dir = await makeProject({ "src/mod.ts": "export {};\n" });
	for (const [options, message] of [
		[{ version: "1.0.0" }, "`name` is required"],
		[{ name: "a" }, "`version` is required"],
		[
			{ name: "a", version: "1.0.0", entryPoints: [] },
			"`entryPoints` must not be empty",
		],
	] as const) {
		const { code, stderr } = await build(dir, options);
		assert.notEqual(code, 0);
		assert.ok(stderr.includes(message), stderr);
		assert.ok(!existsSync(join(dir, ".npm-dist")));
	}
});
