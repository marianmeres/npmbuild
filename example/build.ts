import { npmBuild } from "../npm-build.ts";

await npmBuild({
	name: "@example/my-package",
	version: "1.0.0",
	repository: "example/my-package",
});
