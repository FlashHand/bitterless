# Maestro composer slash commands

Status: implemented; owner testing pending (2026-09-08, task169). Ral requested the Cowork screenshot's `/clear` and
`/view_context` menu in Bitterless. Cowork is reference-only in this change.

## UI and keyboard

```text
┌ /clear         Start a fresh chat; keep this conversation ┐
│ /view_context  Copy model context and pending input       │
└───────────────────────────────────────────────────────────┘
[ /vie|                                                ]
[ workspace ] [attach]             [model] [voice] [send]
```

Use the existing BL font, Royal Blue selection, white surface, muted hint and compact rounded
border. A single flat list opens above the composer; names are monospace, descriptions truncate.
No extra commands, categories, snippets or unrelated layout changes. State belongs to a local
reactive shortcut store with sibling types; the component displays it and preserves textarea focus.
Fit the current 380–480px chat width, using the input's full width rather than a fixed popup width.
Reuse canvas `#f8fafc`, surface `#ffffff`, ink `#465467`, muted `#6f7487`, accent `#4e5882` and
soft selection `#eceef7`. Empty matches hide the list; a pending command disables repeat execution
without freezing text editing. Expose selected option and expanded state to assistive technologies.

- Only a slash word at the start of the current line before the caret opens the menu; paths,
  dates and slashes in prose must not trigger it. Derive query/filtering without rewriting input.
- Filter name/description case-insensitively and sort names by ASCII; select first match on change.
- Up/Down wrap selection; Enter or click executes, never sends the command to the model. Tab
  completes the selected name; Escape closes without altering input. IME and repeat-key guards
  remain. Commands must not run twice while pending.
- Dispose menu state when switching/unmounting chat. A late async result must not erase newly
  typed text or a different session's draft. Failures are visible and retain retryable input.

## Commands

`/clear` calls the same BL New chat action as its button/shortcut. It does not delete conversation
history or reset the current model runtime in-place. Preserve BL's existing workspace inheritance,
archived/turn-lock restrictions and storage behavior; a refused action must show a reason.

`/view_context` uses a typed Coach XPC request and Main clipboard write. Export current model-side
history (including tool calls/results), system/preamble context and pending draft/workspace/attachment
references. Use the actual runtime context, not renderer transcript text masquerading as model history.
Reuse existing send prompt builders and BL's first-turn memory/preamble semantics; do not change the
prompt actually sent. Remove only the slash token when deriving the pending draft. Pending references
are included without reading/uploading attachments or executing tools. Clearly distinguish any
not-yet-resolved media or first-turn runtime state from the available context snapshot; do not label
an incomplete snapshot an exact future provider wire request.

No existing runtime means explicitly report no model-side history yet. Existing runtime with no
supported read surface is an explicit error, not a false empty-history success. Reading context must
not create/reset a runtime, send a model request, trigger compaction, mutate attachments or workspace,
replay a skill, or persist chat contents to logs/files. Text goes only to the user-requested clipboard;
return bounded metadata/status to renderer, not full contents. No new JSONL audit subsystem.
Represent inline binary media as labeled metadata, not megabytes of base64 in the clipboard.
An export exceeding its 8MiB text budget must fail visibly without replacing the clipboard;
do not silently truncate text/tool history or allocate an unbounded serialized copy on Main.

## Verification and handoff

Unit/source tests cover triggers and non-triggers, filtering/order, keyboard/click/IME behavior,
single execution, async draft/session fencing, `/clear` delegation/refusal, and truthful context
export through the runtime/API boundary including missing history and failures. Compile affected
Vue/Less/TypeScript and run focused existing composer/runtime regressions. No Electron/E2E, live
app, packaging, installation, independent review or Git sync; Ral tests the loaded new code.

Completed: 32/32 focused tests across composer/history, workspace UI and context export passed.
ChatPanel/SlashMenu script/template/Less compilation, 15 related TypeScript transforms and the
AI-CRMS runtime guard passed. Scoped diff checks passed. Scoped lint retains two pre-existing
unused `AgentConversationContext` imports in controller/handler and existing formatting warnings.
The old agent-runtime guard still fails its outdated steering prompt string assertion at line151;
it was not changed as part of this task. No Electron/E2E, full build, installation or sync was run.
