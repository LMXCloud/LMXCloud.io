# Tools

Each tool is a workspace package that exports a Hono app (`./app`). The shared host in `apps/tools/host` mounts those apps under path prefixes and is what gets deployed.

## How to add tool #2

1. Copy `apps/tools/_template` to `apps/tools/<name>` and rename the package in `package.json`.
2. Build the tool logic in `src/app.ts` (keep routes relative — no mount prefix).
3. In `apps/tools/host`: add a dependency on the new package, then one import + one `.route()` line in `src/index.ts`. Update the host `/health` `tools` list.

That's it.
