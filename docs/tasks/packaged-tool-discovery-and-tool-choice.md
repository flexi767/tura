# Packaged tool discovery and tool-choice enforcement

## Problem

Installed Tura builds can open a repository but fail to expose or execute tools. Tool schemas are resolved relative to the opened repository even though packaged schemas live beside the installed runtime. The runtime also hardcodes `auto`, ignoring the agent's configured tool-choice policy.

## Work

- Resolve packaged tool assets from `TURA_PROJECT_ROOT`, the installed executable hierarchy, and source checkouts.
- Recover from routed agent capability directories that do not contain the command-run schema.
- Include externally installed commands in the generated command catalog.
- Map `Auto`, `Strict`, and `Disable` to provider values `auto`, `required`, and `none`.
- Preserve a genuinely tool-free direct-text agent.

## Acceptance

- Tools work when Tura is launched outside its own source repository.
- An external command with a manifest, prompt, and schema appears in the catalog.
- Each configured tool-choice mode reaches the provider unchanged in meaning.
- Unit tests cover packaged lookup, empty routed capabilities, external commands, and all tool-choice modes.

