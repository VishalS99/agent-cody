# Build Tools

- [X] glob — file pattern matching tool
- [X] writefile — create/overwrite files
- [X] editFile — modify files in-place (line-level edits)
- [ ] filediff — show diffs between file versions (visual, for user)
- [X] bash — shell command execution
- [ ] websearch — search the web
- [ ] webfetch — fetch content from URLs
- [X] editFile: edit validation — detect file-hash change between read and edit time (snapshot tag mismatch) and cancel the edit

# Refactor / Project Structure

## Done

- [X] Phase 1 — extract `agent/guard`, `agent/clone`, `agent/mappers`; split prompt into `system`/`context`/`rubric`/`summarize`
- [X] Phase 2 — split `agent/db.ts` (457 LOC) into `agent/db/{connection,schema,session,messages,tool_actions,hydrate,index}`; add `docs/db_schema.md`
- [X] Phase 3 — decompose Agent god class (`agent/agent.ts` 510 → 291 LOC); extract `turn/`, `compaction/`, `context/` modules
- [X] Phase 4 — split `edit_file` monolith into `edit_file_tool/{schema,validate,apply,io,tool}`
- [X] Phase 5 — split `bash_exec` monolith into `bash_exec_tool/{schema,fs,sandbox,process,exec,tool}`; restore tool headers
- [X] Phase 6 — split `main.ts` and `loop.ts`; folderize remaining tools
- [X] Tools — all tools now `*_tool/` folders with separate `schema.ts` + `tool.ts`; index barrels removed; `discover.ts` imports each `tool.js` directly
- [X] Prompt — remove `prompt.ts` barrel; direct imports from `system.js`/`context.js`
- [X] db barrel — kept intentionally as `agent/db.ts` re-export shim (5 consumers)

## Pending

- [ ] Update README to reflect the current project structure and tooling
- [ ] Optionally remove remaining `agent/db.ts` shim — route consumers directly to `db/index.js`
