# Archived one-off authoring scripts

Not part of the app and not shipped. These were used while building the 3D pieces
and are kept only as a record of how the shapes were derived.

Some of them reference exports that were since renamed or removed (for example the
knight's intermediate `KNIGHT_PROFILE`), so they will not all run as-is. The
shipped source has no such dangling references — `tools/check-imports.mjs`
verifies that.

Scripts kept in `tools/` (the parent directory) and still current:

| Script | Purpose |
| --- | --- |
| `serve.mjs` | local static server |
| `check-imports.mjs` | asserts every import in `src/` resolves |
| `knight_render.mjs` | renders the built knight mesh as ASCII side elevation |
| `shading_audit.mjs` | measures smooth-vs-flat shading on every piece |
| `mesh_audit.mjs` | signed volume and edge topology per piece |
