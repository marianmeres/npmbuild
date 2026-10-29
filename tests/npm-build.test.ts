import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { rewriteTsImports, versionizeDeps } from "../src/npm-build.ts";

test("rewriteTsImports: static named import", () => {
	assert.deepEqual(
		rewriteTsImports(`import { foo } from "./foo.ts";`),
		`import { foo } from "./foo.js";`,
	);
});

test("rewriteTsImports: static default import", () => {
	assert.deepEqual(
		rewriteTsImports(`import foo from "./foo.ts";`),
		`import foo from "./foo.js";`,
	);
});

test("rewriteTsImports: namespace import", () => {
	assert.deepEqual(
		rewriteTsImports(`import * as foo from "./foo.ts";`),
		`import * as foo from "./foo.js";`,
	);
});

test("rewriteTsImports: type-only import", () => {
	assert.deepEqual(
		rewriteTsImports(`import type { Foo } from "./types.ts";`),
		`import type { Foo } from "./types.js";`,
	);
});

test("rewriteTsImports: side-effect import — the bug fix", () => {
	assert.deepEqual(
		rewriteTsImports(`import "./polyfills.ts";`),
		`import "./polyfills.js";`,
	);
});

test("rewriteTsImports: side-effect import without semicolon", () => {
	assert.deepEqual(
		rewriteTsImports(`import "./polyfills.ts"\n`),
		`import "./polyfills.js"\n`,
	);
});

test("rewriteTsImports: dynamic import", () => {
	assert.deepEqual(
		rewriteTsImports(`await import("./module.ts");`),
		`await import("./module.js");`,
	);
});

test("rewriteTsImports: dynamic import with surrounding whitespace preserved", () => {
	assert.deepEqual(
		rewriteTsImports(`await import(  "./module.ts"  );`),
		`await import(  "./module.js"  );`,
	);
});

test("rewriteTsImports: export named from", () => {
	assert.deepEqual(
		rewriteTsImports(`export { foo } from "./bar.ts";`),
		`export { foo } from "./bar.js";`,
	);
});

test("rewriteTsImports: export star from", () => {
	assert.deepEqual(
		rewriteTsImports(`export * from "./bar.ts";`),
		`export * from "./bar.js";`,
	);
});

test("rewriteTsImports: single quotes preserved", () => {
	assert.deepEqual(
		rewriteTsImports(`import { foo } from './foo.ts';`),
		`import { foo } from './foo.js';`,
	);
});

test("rewriteTsImports: does not touch non-ts specifiers", () => {
	const src = `import { foo } from "./foo.js";\nimport "./style.css";\n`;
	assert.deepEqual(rewriteTsImports(src), src);
});

test("rewriteTsImports: rewrites multiple imports in one file", () => {
	const input = [
		`import { a } from "./a.ts";`,
		`import "./side.ts";`,
		`export { b } from "./b.ts";`,
		`const mod = await import("./c.ts");`,
	].join("\n");
	const expected = [
		`import { a } from "./a.js";`,
		`import "./side.js";`,
		`export { b } from "./b.js";`,
		`const mod = await import("./c.js");`,
	].join("\n");
	assert.deepEqual(rewriteTsImports(input), expected);
});

test("rewriteTsImports: nested relative paths preserved", () => {
	assert.deepEqual(
		rewriteTsImports(`import { x } from "../../deep/nested/file.ts";`),
		`import { x } from "../../deep/nested/file.js";`,
	);
});

function withTempDenoJson(
	imports: Record<string, string>,
	fn: (path: string) => void,
): void {
	const dir = mkdtempSync(join(tmpdir(), "npmbuild-test-"));
	try {
		const path = join(dir, "deno.json");
		writeFileSync(path, JSON.stringify({ imports }));
		fn(path);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

test("versionizeDeps: resolves bare scoped jsr import", () => {
	withTempDenoJson({ "@marianmeres/clog": "jsr:@marianmeres/clog@^2" }, (p) => {
		assert.deepEqual(versionizeDeps(["@marianmeres/clog"], p), [
			"@marianmeres/clog@^2",
		]);
	});
});

test("versionizeDeps: resolves bare unscoped npm import", () => {
	withTempDenoJson({ pg: "npm:pg@^8.11.0" }, (p) => {
		assert.deepEqual(versionizeDeps(["pg"], p), ["pg@^8.11.0"]);
	});
});

test("versionizeDeps: resolves scoped @types/* from npm", () => {
	withTempDenoJson({ "@types/pg": "npm:@types/pg@^8" }, (p) => {
		assert.deepEqual(versionizeDeps(["@types/pg"], p), ["@types/pg@^8"]);
	});
});

test("versionizeDeps: already-versioned entry passes through", () => {
	withTempDenoJson({ pg: "npm:pg@^8.11.0" }, (p) => {
		assert.deepEqual(versionizeDeps(["pg@^4"], p), ["pg@^4"]);
	});
});

test("versionizeDeps: already-versioned scoped entry passes through", () => {
	withTempDenoJson({ "@types/pg": "npm:@types/pg@^8" }, (p) => {
		assert.deepEqual(versionizeDeps(["@types/pg@^7"], p), ["@types/pg@^7"]);
	});
});

test("versionizeDeps: dep not in imports passes through", () => {
	withTempDenoJson({ pg: "npm:pg@^8" }, (p) => {
		assert.deepEqual(versionizeDeps(["missing-pkg"], p), ["missing-pkg"]);
	});
});

test("versionizeDeps: import entry without version passes through", () => {
	withTempDenoJson({ "@scope/name": "jsr:@scope/name" }, (p) => {
		assert.deepEqual(versionizeDeps(["@scope/name"], p), ["@scope/name"]);
	});
});

test("versionizeDeps: URL import entry passes through", () => {
	withTempDenoJson({ something: "https://example.com/mod.ts" }, (p) => {
		assert.deepEqual(versionizeDeps(["something"], p), ["something"]);
	});
});

test("versionizeDeps: mixed batch matches typical usage", () => {
	withTempDenoJson(
		{
			"@marianmeres/clog": "jsr:@marianmeres/clog@^2",
			"@marianmeres/modelize": "jsr:@marianmeres/modelize@^1.0.3",
			pg: "npm:pg@^8.11.0",
			"@types/pg": "npm:@types/pg@^8",
		},
		(p) => {
			assert.deepEqual(
				versionizeDeps(
					["@marianmeres/clog", "@marianmeres/modelize", "pg@^4", "@types/pg"],
					p,
				),
				[
					"@marianmeres/clog@^2",
					"@marianmeres/modelize@^1.0.3",
					"pg@^4",
					"@types/pg@^8",
				],
			);
		},
	);
});

test("versionizeDeps: accepts pre-parsed deno.json object", () => {
	const denoJson = {
		imports: {
			"@marianmeres/clog": "jsr:@marianmeres/clog@^2",
			pg: "npm:pg@^8.11.0",
		},
	};
	assert.deepEqual(
		versionizeDeps(["@marianmeres/clog", "pg@^4", "missing"], denoJson),
		["@marianmeres/clog@^2", "pg@^4", "missing"],
	);
});

test("versionizeDeps: object without imports is tolerated", () => {
	assert.deepEqual(versionizeDeps(["pg"], {}), ["pg"]);
});

test("versionizeDeps: missing deno.json throws", () => {
	assert.throws(
		() =>
			versionizeDeps(
				["pg"],
				join(tmpdir(), "__definitely_missing_deno_json__.json"),
			),
		{ code: "ENOENT" },
	);
});

test("versionizeDeps: invalid deno.json throws", () => {
	const dir = mkdtempSync(join(tmpdir(), "npmbuild-test-"));
	try {
		const path = join(dir, "deno.json");
		writeFileSync(path, "{ not json");
		assert.throws(() => versionizeDeps(["pg"], path), SyntaxError);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
