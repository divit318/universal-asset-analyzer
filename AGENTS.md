# AGENTS.md: AI Coding Agent Rules for UAA

Quick reference for AI agents (Claude Code, standalone agents, etc.) working on Universal Asset Analyzer.

Read this before reading CLAUDE.md, ARCHITECTURE.md, or PROJECT_ROADMAP.md.

---

## Mandatory Rules

### 1. Use Serena for File Location
- **NEVER** grep/bash search for symbols
- Always: `/serena find_symbol "function_name"` to locate definitions
- Always: `/serena find_implementations "class_name"` to find variants
- Always: `/serena find_referencing_symbols "symbol"` to find usage
- Saves: 40% token usage (fewer files to read)

### 2. Use Graphify for Dependencies
- Before modifying a module: `/graphify "[module_name] dependencies"`
- Before adding a feature: `/graphify "[module_name] interactions"`
- Shows affected modules without reading 10+ files
- Saves: 50% token usage on feature work

### 3. Read Docs Before Code
- **ARCHITECTURE.md** → module interactions, inputs/outputs, caching strategy
- **PROJECT_ROADMAP.md** → what's complete, what's planned, priorities
- **CLAUDE.md** → development workflow, patterns, conventions
- Only then read source code (3-5 files max)
- Saves: 70% token usage on typical tasks

### 4. Reuse, Never Duplicate
- Scoring logic → `lib/composite.ts` only
- Signal detection → `lib/event-screener.ts` only
- Portfolio math → `lib/portfolio-analytics.ts` only
- DB operations → `lib/db.ts` CRUD functions only
- Format utilities → `lib/format.ts` only
- If logic exists, call it. Don't copy-paste.

### 5. Prefer Existing Over New
- Check `lib/` for similar engines before creating new modules
- Extend existing modules unless there's a distinct user workflow
- Ask: "Can I add this to an existing `lib/` file?" before creating a new one

### 6. Read Only Minimum Files
- Use Serena to find exact locations
- Read only the function/interface you need
- Don't read entire files; skim to target
- Typical task: 3-5 files, 10-15k tokens

---

## Architecture at a Glance

**Layers**:
- **Pages** (`app/*/page.tsx`) — Fetch data, render
- **API Routes** (`app/api/*/route.ts`) — Validate input, call domain logic
- **Domain Logic** (`lib/*.ts`) — Pure functions, testable, reusable
- **Components** (`app/_components/` or `app/[module]/_components/`) — UI, interactive
- **State** (`lib/db.ts`) — SQLite persistence, CRUD operations

**Key Files**:
- `lib/composite.ts` — Scoring (value/quality/momentum). Single source of truth.
- `lib/fundamental-screener.ts` — Filtering + caching. Use for screening workflows.
- `lib/event-screener.ts` — Signals. Use for event-driven workflows.
- `lib/thematic-engine.ts` — 10-stage thematic analysis framework.
- `lib/ic-agents.ts` — 9-domain multi-agent pipeline. Use for institutional research.
- `lib/db.ts` — All SQLite operations. All reads/writes go here.
- `lib/ollama.ts` — Local LLM inference. Never external APIs.

**Caching**:
- Fundamentals: 24h TTL in SQLite (refreshed on screener load)
- Prices: Always fresh (no cache)
- Filings: Cached by CIK internally
- Parquet: Daily output from quant engine (read-only)

**Error Handling**:
- API failures: Non-fatal. Return partial data + error message.
- EDGAR/news/analyst data: Optional. UI renders without them.
- Ollama offline: Fallback UI message, no crash.

---

## Before You Code

**Checklist**:
1. Read ARCHITECTURE.md section for your module
2. Run `/graphify "[module] dependencies"` to see what you'll affect
3. Use `/serena find_symbol "similar_function"` to find existing patterns
4. Check if similar logic already exists in `lib/`
5. Plan: 5 min docs + 5 min graphify = 30 min saved reading code

**Typical Workflows**:

**Add a metric to screener**:
1. Read: ARCHITECTURE.md "Composite Scorer" section
2. Graphify: `/graphify "composite dependencies"`
3. Serena: `/serena find_implementations "scoreAsset"`
4. Modify: `lib/composite.ts` (add formula)
5. Test: `tests/composite.test.ts` (add test case)

**Add an API endpoint**:
1. Read: ARCHITECTURE.md "API Routes" pattern
2. Graphify: `/graphify "[domain] interactions"`
3. Serena: `/serena find_implementations "POST route"`
4. Create: `app/api/[domain]/route.ts` (validate, call lib, return JSON)
5. No need to create new lib files; call existing functions

**Add a feature to existing module**:
1. Read: ARCHITECTURE.md section for the module
2. Serena: `/serena find_symbol "[module]Page"` to locate the page
3. Check: Does `lib/` already have the logic? If yes, call it. If no, add to existing lib file.
4. Implement: Add page component, subcomponent, update lib function
5. Graphify: Verify dependencies haven't exploded

**Create a new module**:
1. Read: ARCHITECTURE.md "Adding a New Feature" section
2. Graphify: `/graphify "[new module] impacts"` (to see what it depends on)
3. Ask: Is this a distinct user workflow? If no, extend existing module instead.
4. Plan: Domain logic → API route → page → components → tests
5. Update: ARCHITECTURE.md + PROJECT_ROADMAP.md when done

---

## Token Budgets

**Typical Tasks**:
- Bug fix: 5-10k tokens (Serena locate, fix, verify)
- Add metric: 8-15k tokens (modify lib, add test, update UI)
- Add API endpoint: 10-15k tokens (create route, call lib, test)
- New feature (small): 15-25k tokens (plan, implement, test)
- New module: 30-50k tokens (full workflow, docs)

**How to Save Tokens**:
- Serena locate: -20% (vs. bash grep)
- Graphify dependency check: -30% (vs. reading files)
- Read docs first: -50% (vs. source code)
- Reuse existing logic: -40% (vs. understanding + reimplementing)

---

## Code Patterns (Copy-Paste)

**API Route Template**:
```typescript
// app/api/[module]/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SYMBOL_RE = /^[A-Z0-9.\-]{1,12}$/;

export async function GET(request: Request) {
  const symbol = new URL(request.url).searchParams.get("symbol")?.trim().toUpperCase();
  if (!symbol || !SYMBOL_RE.test(symbol)) {
    return NextResponse.json({ error: "Invalid symbol" }, { status: 400 });
  }

  try {
    const data = await getDataFromLib(symbol);
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

**Parallel Fetching**:
```typescript
const [quote, history, filings, news] = await Promise.all([
  getQuote(symbol),
  getHistory(symbol, 1825),
  getRecentFilings(symbol),
  getCompanyNews(symbol, 8),
]);
```

**Domain Logic Pattern**:
```typescript
// lib/[module].ts — Pure, testable, no side effects
export function computeScore(data: InputType): OutputType {
  // No imports from pages or components
  // No database calls
  // No external API calls
  // Pure function: same input → same output
  return result;
}
```

**Component Pattern**:
```typescript
// app/[module]/_components/[name].tsx
'use client'; // only if interactive

export function MyComponent({ data, onSubmit }: Props) {
  const [state, setState] = useState(data);
  // Component is dumb: data in, callbacks out
  return <div>...</div>;
}
```

---

## Critical Mistakes

| Mistake | Why | Fix |
|---------|-----|-----|
| Direct DB calls in page | Multiple sources of truth | Use `lib/db.ts` CRUD |
| Import ExcelJS in client | Server-only package | Use `/api/export` route |
| Duplicate scoring logic | Maintenance nightmare | Call `lib/composite.ts` |
| Serial API calls | 3-4x slower | Use `Promise.all()` |
| No null checks | Crashes on missing data | Check before operations |
| Comments explaining code | Wastes tokens | Well-named functions instead |
| Creating new module for minor feature | Bloats codebase | Extend existing instead |
| Ignoring errors in streaming | Silent failures | Try/catch, enqueue error |
| Global imports of data sources | Tight coupling | Inject dependencies as args |

---

## When to Read What

| Goal | Read First | Then Read | Finally |
|------|-----------|-----------|---------|
| Fix a bug | CLAUDE.md workflow | ARCHITECTURE.md module section | Source files (Serena) |
| Add metric | ARCHITECTURE.md "Composite Scorer" | `lib/composite.ts` (Serena) | `tests/composite.test.ts` |
| Add API endpoint | ARCHITECTURE.md "API Routes" | Similar route (Serena) | Implementation |
| Understand interactions | PROJECT_ROADMAP.md | ARCHITECTURE.md "Interaction Map" | `/graphify [module]` |
| Plan new feature | PROJECT_ROADMAP.md priorities | ARCHITECTURE.md "Adding Feature" | Design doc (create) |
| Debug state issue | ARCHITECTURE.md "State Management" | `lib/db.ts` (Serena) | Source files |

---

## Tools You Have

| Tool | Use Case | Command |
|------|----------|---------|
| **Serena** | Locate symbol/function/file | `/serena find_symbol "name"` |
| **Graphify** | Understand dependencies | `/graphify "[module] dependencies"` |
| **Read** | Read entire file | Use when you know exact path |
| **Edit** | Modify file | Use after reading first |
| **Bash** | Run tests, git commands | `npm test`, `git log` |
| **Agent** | Delegate research/search | Rarely needed (Serena better) |

---

## Fast vs. Slow Agent Workflows

**Slow** (80-120k tokens):
1. Read all CLAUDE.md
2. Read all ARCHITECTURE.md
3. Grep for similar patterns
4. Read 10+ source files
5. Try, fail, re-read

**Fast** (15-30k tokens):
1. Read AGENTS.md (this file)
2. Run Serena to locate files
3. Run Graphify to check dependencies
4. Read ARCHITECTURE.md section
5. Read 3 files (Serena pointed out)
6. Implement confidently

**Difference**: Structured tool usage saves 70% tokens.

---

## Next Steps

- **First task?** Read CLAUDE.md "Development Workflow" section
- **New feature?** Read PROJECT_ROADMAP.md for context
- **Stuck?** Check ARCHITECTURE.md for the module you're working on
- **Implementing?** Use Serena + Graphify before reading code

---

## One More Thing

This is a single-user, self-hosted equity research platform. All data stays local. No cloud APIs, no subscriptions, no selling data. Code quality and architectural clarity matter because there's no DevOps team to fix problems.

Keep things simple. Prefer existing patterns. Document as you go (update ARCHITECTURE.md). Future agents will thank you.

Good luck.
