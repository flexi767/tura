# Relocate installed workspace state

## Problem

Installed desktop sessions write `.tura` and session-log files into the repository being opened. This dirties unrelated repositories and mixes application state with source code.

## Work

- When `TURA_HOME` is explicitly configured, store each workspace's config, session log, and change tracker under `TURA_HOME/workspaces/<stable-workspace-key>/.tura`.
- Preserve `<workspace>/.tura` for source/development runs without an explicit home.
- Define a stable, portable workspace key and collision behavior.
- Document and implement migration of existing state.

## Acceptance

- Opening and chatting in a repository creates no Tura-owned files there when `TURA_HOME` is set.
- Config, session history, and change tracking resolve to the same relocated workspace directory.
- Two workspaces with the same basename remain isolated.
- Tests cover configured and unconfigured homes, normalization, collisions, and migration.

