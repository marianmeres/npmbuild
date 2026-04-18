import { assertEquals } from "@std/assert";
import { rewriteTsImports, versionizeDeps } from "./npm-build.ts";

Deno.test("rewriteTsImports: static named import", () => {
	assertEquals(
		rewriteTsImports(`import { foo } from "./foo.ts";`),
		`import { foo } from "./foo.js";`,
	);
});

Deno.test("rewriteTsImports: static default import", () => {
	assertEquals(
		rewriteTsImports(`import foo from "./foo.ts";`),
		`import foo from "./foo.js";`,
	);
});

Deno.test("rewriteTsImports: namespace import", () => {
	assertEquals(
		rewriteTsImports(`import * as foo from "./foo.ts";`),
		`import * as foo from "./foo.js";`,
	);
});

Deno.test("rewriteTsImports: type-only import", () => {
	assertEquals(
		rewriteTsImports(`import type { Foo } from "./types.ts";`),
		`import type { Foo } from "./types.js";`,
	);
});

Deno.test("rewriteTsImports: side-effect import — the bug fix", () => {
	assertEquals(
		rewriteTsImports(`import "./polyfills.ts";`),
		`import "./polyfills.js";`,
	);
});

Deno.test("rewriteTsImports: side-effect import without semicolon", () => {
	assertEquals(
		rewriteTsImports(`import "./polyfills.ts"\n`),
		`import "./polyfills.js"\n`,
	);
});

Deno.test("rewriteTsImports: dynamic import", () => {
	assertEquals(
		rewriteTsImports(`await import("./module.ts");`),
		`await import("./module.js");`,
	);
});

Deno.test("rewriteTsImports: dynamic import with surrounding whitespace preserved", () => {
	assertEquals(
		rewriteTsImports(`await import(  "./module.ts"  );`),
		`await import(  "./module.js"  );`,
	);
});

Deno.test("rewriteTsImports: export named from", () => {
	assertEquals(
		rewriteTsImports(`export { foo } from "./bar.ts";`),
		`export { foo } from "./bar.js";`,
	);
});

Deno.test("rewriteTsImports: export star from", () => {
	assertEquals(
		rewriteTsImports(`export * from "./bar.ts";`),
		`export * from "./bar.js";`,
	);
});

Deno.test("rewriteTsImports: single quotes preserved", () => {
	assertEquals(
		rewriteTsImports(`import { foo } from './foo.ts';`),
		`import { foo } from './foo.js';`,
	);
});

Deno.test("rewriteTsImports: does not touch non-ts specifiers", () => {
	const src = `import { foo } from "./foo.js";\nimport "./style.css";\n`;
	assertEquals(rewriteTsImports(src), src);
});

Deno.test("rewriteTsImports: rewrites multiple imports in one file", () => {
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
	assertEquals(rewriteTsImports(input), expected);
});

Deno.test("rewriteTsImports: nested relative paths preserved", () => {
	assertEquals(
		rewriteTsImports(`import { x } from "../../deep/nested/file.ts";`),
		`import { x } from "../../deep/nested/file.js";`,
	);
});

function withTempDenoJson(
	imports: Record<string, string>,
	fn: (path: string) => void,
): void {
	const path = Deno.makeTempFileSync({ suffix: ".json" });
	try {
		Deno.writeTextFileSync(path, JSON.stringify({ imports }));
		fn(path);
	} finally {
		Deno.removeSync(path);
	}
}

Deno.test("versionizeDeps: resolves bare scoped jsr import", () => {
	withTempDenoJson(
		{ "@marianmeres/clog": "jsr:@marianmeres/clog@^2" },
		(p) => {
			assertEquals(versionizeDeps(["@marianmeres/clog"], p), [
				"@marianmeres/clog@^2",
			]);
		},
	);
});

Deno.test("versionizeDeps: resolves bare unscoped npm import", () => {
	withTempDenoJson({ "pg": "npm:pg@^8.11.0" }, (p) => {
		assertEquals(versionizeDeps(["pg"], p), ["pg@^8.11.0"]);
	});
});

Deno.test("versionizeDeps: resolves scoped @types/* from npm", () => {
	withTempDenoJson({ "@types/pg": "npm:@types/pg@^8" }, (p) => {
		assertEquals(versionizeDeps(["@types/pg"], p), ["@types/pg@^8"]);
	});
});

Deno.test("versionizeDeps: already-versioned entry passes through", () => {
	withTempDenoJson({ "pg": "npm:pg@^8.11.0" }, (p) => {
		assertEquals(versionizeDeps(["pg@^4"], p), ["pg@^4"]);
	});
});

Deno.test("versionizeDeps: already-versioned scoped entry passes through", () => {
	withTempDenoJson({ "@types/pg": "npm:@types/pg@^8" }, (p) => {
		assertEquals(versionizeDeps(["@types/pg@^7"], p), ["@types/pg@^7"]);
	});
});

Deno.test("versionizeDeps: dep not in imports passes through", () => {
	withTempDenoJson({ "pg": "npm:pg@^8" }, (p) => {
		assertEquals(versionizeDeps(["missing-pkg"], p), ["missing-pkg"]);
	});
});

Deno.test("versionizeDeps: import entry without version passes through", () => {
	withTempDenoJson({ "@scope/name": "jsr:@scope/name" }, (p) => {
		assertEquals(versionizeDeps(["@scope/name"], p), ["@scope/name"]);
	});
});

Deno.test("versionizeDeps: URL import entry passes through", () => {
	withTempDenoJson(
		{ "something": "https://example.com/mod.ts" },
		(p) => {
			assertEquals(versionizeDeps(["something"], p), ["something"]);
		},
	);
});

Deno.test("versionizeDeps: mixed batch matches typical usage", () => {
	withTempDenoJson(
		{
			"@marianmeres/clog": "jsr:@marianmeres/clog@^2",
			"@marianmeres/modelize": "jsr:@marianmeres/modelize@^1.0.3",
			"pg": "npm:pg@^8.11.0",
			"@types/pg": "npm:@types/pg@^8",
		},
		(p) => {
			assertEquals(
				versionizeDeps(
					[
						"@marianmeres/clog",
						"@marianmeres/modelize",
						"pg@^4",
						"@types/pg",
					],
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

Deno.test("versionizeDeps: accepts pre-parsed deno.json object", () => {
	const denoJson = {
		imports: {
			"@marianmeres/clog": "jsr:@marianmeres/clog@^2",
			"pg": "npm:pg@^8.11.0",
		},
	};
	assertEquals(
		versionizeDeps(["@marianmeres/clog", "pg@^4", "missing"], denoJson),
		["@marianmeres/clog@^2", "pg@^4", "missing"],
	);
});

Deno.test("versionizeDeps: object without imports is tolerated", () => {
	assertEquals(versionizeDeps(["pg"], {}), ["pg"]);
});

Deno.test("versionizeDeps: missing deno.json throws", () => {
	let threw = false;
	try {
		versionizeDeps(["pg"], "/tmp/__definitely_missing_deno_json__.json");
	} catch {
		threw = true;
	}
	assertEquals(threw, true);
});
