#!/usr/bin/env node
// Behavioral guidance for Julie code intelligence tools.
// Injected at session start, context clear, and context compaction
// to compensate for the 2k MCP tool description character limit.

const guidance = `You have Julie, a code intelligence MCP server. Follow these rules:

1. **Search before coding**: Always fast_search before writing new code.
   - For exact symbols: fast_search(query="SymbolName", search_target="definitions")
   - For concepts: fast_search(query="error handling retry logic", search_target="definitions") uses semantic search.
2. **Structure before reading**: Always get_symbols before Read (70-90% token savings).
3. **References before changes**: Always fast_refs before modifying any symbol.
4. **Deep dive for understanding**: Use deep_dive when you need to understand a symbol's full context (callers, callees, types) before modifying it.
5. **Trust results**: Pre-indexed and accurate. Never verify with grep/find/Read.

**Editing workflow**: edit_file and edit_symbol are the DEFAULT for all file modifications. They edit without reading the file first.
- Code symbols: deep_dive > edit_symbol (dry_run=true first)
- Any text: edit_file(old_text=..., new_text=..., dry_run=true)
- Read + Edit is the FALLBACK, not the default. Use only when Julie tools genuinely cannot handle the edit.

**Edit antipatterns -- if you catch yourself doing these, STOP:**
- Reading a file just to edit it -> use edit_file directly
- Using Read to find exact text for Edit -> use get_symbols or deep_dive, then edit_symbol
- "It's just a quick change" -> quick changes are edit_file's sweet spot
- Falling back to Read + Edit "because it's easier" -> it's 3-5x more tokens. It's not easier.

Do not use grep/find when Julie tools are available.
Do not read files without get_symbols first.
Do not chain multiple tools when deep_dive does it in one call.`;

const output = process.env.CURSOR_PLUGIN_ROOT
  ? { additional_context: guidance }
  : process.env.CLAUDE_PLUGIN_ROOT
    ? { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: guidance } }
    : { additional_context: guidance };

process.stdout.write(JSON.stringify(output, null, 2) + '\n');
