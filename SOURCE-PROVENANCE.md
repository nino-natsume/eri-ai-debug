# Source provenance and verification limits

This 0.0.2 project bundle is an incremental implementation based on the source files supplied earlier in this conversation and the assembled prior source tree. This revision sets the test repository identity to `eri-ai-debug` and version `0.0.2` as requested. It is not a fresh clone or an unmodified copy of the current upstream GitHub `main` branch. Network access to clone that repository was unavailable in this environment.

The TUI interaction design takes high-level inspiration from the navigation approach documented by SHORiN-KiWATA/miyu-agent; the main screen is branded “Eri” and presents a grouped menu. No Miyu source code was copied into Eri.

The default model ID is `opencode/big-pickle`, based on the OpenCode model documentation checked on 2026-10-27. The official documentation states that Big Pickle is free for a limited time and that data collected during its free period may be used to improve the model. Do not submit secrets or confidential material.

## Tested here

- `npm run check`
- `npm test` (21 tests)
- `bash -n install-eri.sh`
- `bash -n PKGBUILD`
- CLI help, version, config show and tools list
- Pseudo-terminal smoke test: open menu, enter unified tool picker, cancel with `q`, return to main menu, exit with `q` (exit code 0)
- `npm pack --dry-run` and actual npm tarball contents
- Static consistency checks for PKGBUILD / .SRCINFO and package file list

## Not tested / required before release

- Live OpenCode authentication or model inference; this requires an installed OpenCode CLI and user authorization.
- A real Arch Linux `makepkg` build/install. The AUR recipe now fetches `https://github.com/nino-natsume/eri-ai-debug.git#tag=v0.0.2`; this exact tag must be committed and pushed before AUR users can build it. The tag was not published by this environment.
- Real Windows PowerShell 5.1/7 installation, upgrade, rollback and uninstall.
- Full upstream integration against a fresh clone. Review/merge the patch into the actual upstream tree before release.

- Repository and package identity are unified as `eri-ai-debug`; GitHub metadata now points to `nino-natsume/eri-ai-debug`. The remote repository must be renamed or created under that slug before publishing links/tags. The README license badge links to `./LICENSE`, and the root `LICENSE` contains the full GNU AGPL v3 text.
