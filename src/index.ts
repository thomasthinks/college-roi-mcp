#!/usr/bin/env node
/**
 * college-roi-mcp — MCP server over the LE TEEN College ROI API (le-teen.com/api).
 *
 * Wraps the free, keyless, CC BY 4.0 static-JSON API: 30-year NPV for 500 U.S.
 * four-year colleges, lifetime ROI for 19 major categories + 115 CIP subfields,
 * and the standing rankings. Read-only; no auth; data fetched live and cached
 * in-process for 24h (matching the API's CDN cache).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const API_BASE = "https://le-teen.com/api/v1";
const ATTRIBUTION =
  "Data: LE TEEN College ROI API (le-teen.com/api), CC BY 4.0. Upstream sources: FREOPP, IPEDS, BEA. DOI: 10.5281/zenodo.21351602";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Fetch + cache
// ---------------------------------------------------------------------------

const cache = new Map<string, { at: number; data: unknown }>();

async function apiGet(path: string): Promise<any> {
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "user-agent": "college-roi-mcp/1.0 (+https://github.com/thomasthinks/college-roi-mcp)" },
  });
  if (res.status === 404) {
    throw new NotFoundError(path);
  }
  if (!res.ok) {
    throw new Error(`API request failed: ${res.status} ${res.statusText} for ${path}`);
  }
  const data = await res.json();
  cache.set(path, { at: Date.now(), data });
  return data;
}

class NotFoundError extends Error {
  constructor(path: string) {
    super(`Not found: ${path}`);
  }
}

function ok(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 1) }] };
}

function err(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = new McpServer(
  { name: "college-roi-mcp", version: "1.0.0" },
  {
    instructions:
      "Query U.S. college-ROI data: 30-year net present value (NPV) for 500 four-year colleges, " +
      "lifetime ROI for 19 bachelor's-degree major categories and 115 CIP subfields, per-state " +
      "best-value rankings, and the out-of-state tuition penalty ranking. All dollar figures are " +
      "lifetime/30-year totals in USD. Start with list_majors or search_colleges to find slugs, " +
      `then get_major / get_college for full detail. ${ATTRIBUTION}`,
  }
);

// --- get_api_info -----------------------------------------------------------

server.registerTool(
  "get_api_info",
  {
    title: "About the College ROI API",
    description:
      "Metadata for the underlying LE TEEN College ROI API: description, license, attribution, DOI, docs URL, and the list of raw endpoints.",
    inputSchema: {},
  },
  async () => {
    const idx = await apiGet("/index.json");
    return ok(idx);
  }
);

// --- list_majors -------------------------------------------------------------

server.registerTool(
  "list_majors",
  {
    title: "List majors by lifetime ROI",
    description:
      "List bachelor's-degree majors (19 broad categories and/or 115 CIP subfields) with lifetime-ROI stats: " +
      "median/mean lifetime ROI (USD), % of programs that never break even, median break-even age, and AI-exposure band. " +
      "Returns compact rows sorted by the chosen field. Use the returned slug with get_major for full detail.",
    inputSchema: {
      kind: z.enum(["category", "subfield", "all"]).default("all")
        .describe("Filter to broad categories (19), CIP subfields (115), or all 134."),
      parent: z.string().optional()
        .describe("Only subfields of this category slug, e.g. 'engineering'."),
      sort_by: z
        .enum(["median_lifetime_roi_usd", "mean_lifetime_roi_usd", "pct_never_breakeven", "graduates", "name"])
        .default("median_lifetime_roi_usd")
        .describe("Sort field. ROI sorts are descending; name ascending."),
      limit: z.number().int().min(1).max(150).default(50).describe("Max rows returned."),
    },
  },
  async ({ kind, parent, sort_by, limit }) => {
    const data = await apiGet("/majors.json");
    let rows: any[] = data.majors;
    if (kind !== "all") rows = rows.filter((m) => m.kind === kind);
    if (parent) {
      const p = slugify(parent);
      rows = rows.filter((m) => m.parent?.slug === p);
    }
    rows = [...rows].sort((a, b) =>
      sort_by === "name" ? String(a.name).localeCompare(String(b.name)) : (b[sort_by] ?? -Infinity) - (a[sort_by] ?? -Infinity)
    );
    const total = rows.length;
    const majors = rows.slice(0, limit).map((m) => ({
      slug: m.slug,
      kind: m.kind,
      name: m.name,
      parent: m.parent?.slug ?? null,
      median_lifetime_roi_usd: m.median_lifetime_roi_usd,
      mean_lifetime_roi_usd: m.mean_lifetime_roi_usd,
      pct_never_breakeven: m.pct_never_breakeven,
      median_breakeven_age: m.median_breakeven_age,
      graduates: m.graduates,
      ai_exposure_band: m.ai_exposure?.band ?? null,
    }));
    return ok({ total_matching: total, returned: majors.length, majors, attribution: ATTRIBUTION });
  }
);

// --- get_major ----------------------------------------------------------------

server.registerTool(
  "get_major",
  {
    title: "Get one major's full ROI detail",
    description:
      "Full lifetime-ROI record for one major category or CIP subfield by slug (e.g. 'nursing', 'computer-science', " +
      "'philosophy-and-religious-studies'): ROI distribution (p25/median/mean/p75), never-break-even %, break-even age, " +
      "completion-adjusted and dropout ROI, graduates/programs counts, and AI-exposure detail. " +
      "Accepts a plain name and will slugify it; use list_majors to discover exact slugs.",
    inputSchema: {
      slug: z.string().describe("Major slug or name, e.g. 'computer-science' or 'Computer Science'."),
    },
  },
  async ({ slug }) => {
    const s = slugify(slug);
    try {
      return ok({ ...(await apiGet(`/majors/${s}.json`)), attribution: ATTRIBUTION });
    } catch (e) {
      if (e instanceof NotFoundError) {
        const data = await apiGet("/majors.json");
        const near = data.majors
          .filter((m: any) => m.slug.includes(s) || s.includes(m.slug) || m.name.toLowerCase().includes(slug.toLowerCase()))
          .slice(0, 8)
          .map((m: any) => m.slug);
        return err(`No major with slug '${s}'.${near.length ? ` Did you mean: ${near.join(", ")}` : " Use list_majors to browse slugs."}`);
      }
      throw e;
    }
  }
);

// --- search_colleges -----------------------------------------------------------

server.registerTool(
  "search_colleges",
  {
    title: "Search colleges by name/state",
    description:
      "Search the 500 largest-coverage U.S. four-year colleges that clear the positive-NPV envelope. " +
      "Each row: 30-year NPV at resident and non-resident pricing, total cost of attendance, median earnings 10 years " +
      "after entry, and break-even age. Filter by name substring, state, and control; sorted by resident NPV descending " +
      "unless overridden. Use the returned slug with get_college.",
    inputSchema: {
      query: z.string().optional().describe("Case-insensitive substring of the college name."),
      state: z.string().length(2).optional().describe("Two-letter state code, e.g. 'MI'."),
      control: z.enum(["public", "private-nonprofit", "private-forprofit"]).optional(),
      sort_by: z
        .enum(["npv_30yr_resident_usd", "npv_30yr_nonresident_usd", "median_earnings_10yr_usd", "total_cost_of_attendance_usd", "name"])
        .default("npv_30yr_resident_usd"),
      limit: z.number().int().min(1).max(100).default(25).describe("Max rows returned."),
    },
  },
  async ({ query, state, control, sort_by, limit }) => {
    const data = await apiGet("/colleges.json");
    let rows: any[] = data.colleges;
    if (query) {
      // Token-AND matching so partial names work ("cal poly" matches
      // "California Polytechnic State University-San Luis Obispo").
      const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
      rows = rows.filter((c) => {
        const hay = `${c.name} ${c.city ?? ""}`.toLowerCase();
        return tokens.every((t) => hay.includes(t));
      });
    }
    if (state) rows = rows.filter((c) => c.state === state.toUpperCase());
    if (control) rows = rows.filter((c) => c.control === control);
    rows = [...rows].sort((a, b) =>
      sort_by === "name" ? String(a.name).localeCompare(String(b.name)) : (b[sort_by] ?? -Infinity) - (a[sort_by] ?? -Infinity)
    );
    const total = rows.length;
    const colleges = rows.slice(0, limit);
    return ok({
      total_matching: total,
      returned: colleges.length,
      note: "Only colleges clearing the positive-NPV envelope are listed (500 of ~1,656 four-years). Absence from this list is itself a signal.",
      colleges,
      attribution: ATTRIBUTION,
    });
  }
);

// --- get_college -----------------------------------------------------------------

server.registerTool(
  "get_college",
  {
    title: "Get one college's full record",
    description:
      "Full record for one college by slug (e.g. 'university-of-michigan-ann-arbor'): 30-year NPV at resident and " +
      "non-resident pricing, total cost of attendance both ways, median earnings 10 years after entry, break-even age, " +
      "IPEDS unitid, and FREOPP program coverage. Accepts a plain name and will slugify it; use search_colleges to discover slugs.",
    inputSchema: {
      slug: z.string().describe("College slug or name, e.g. 'university-of-michigan-ann-arbor'."),
    },
  },
  async ({ slug }) => {
    const s = slugify(slug);
    try {
      return ok({ ...(await apiGet(`/colleges/${s}.json`)), attribution: ATTRIBUTION });
    } catch (e) {
      if (e instanceof NotFoundError) {
        const data = await apiGet("/colleges.json");
        const q = slug.toLowerCase();
        const near = data.colleges
          .filter((c: any) => c.slug.includes(s) || c.name.toLowerCase().includes(q))
          .slice(0, 8)
          .map((c: any) => c.slug);
        return err(
          `No college with slug '${s}'.${near.length ? ` Did you mean: ${near.join(", ")}` : " Note: only the 500 positive-NPV-envelope colleges are covered; use search_colleges to browse."}`
        );
      }
      throw e;
    }
  }
);

// --- best_value_colleges -----------------------------------------------------------

server.registerTool(
  "best_value_colleges",
  {
    title: "Best-value colleges by state",
    description:
      "Each U.S. state's best-value four-year colleges at resident pricing, ranked by 30-year NPV (top 15 per state). " +
      "Pass a state for its full list; omit it for a nationwide summary (every state's top pick).",
    inputSchema: {
      state: z.string().length(2).optional().describe("Two-letter state code, e.g. 'CA'. Omit for all states' #1."),
    },
  },
  async ({ state }) => {
    const data = await apiGet("/rankings/best-value.json");
    if (state) {
      const st = data.states.find((s: any) => s.state === state.toUpperCase());
      if (!st) return err(`No ranking for state '${state}'. Use a two-letter USPS code.`);
      return ok({ ...st, attribution: ATTRIBUTION });
    }
    const summary = data.states.map((s: any) => ({
      state: s.state,
      state_name: s.state_name,
      top_college: s.colleges[0],
    }));
    return ok({ title: data.title, states: summary, note: "Pass state for the full top-15 list.", attribution: ATTRIBUTION });
  }
);

// --- out_of_state_penalty ------------------------------------------------------------

server.registerTool(
  "out_of_state_penalty",
  {
    title: "Out-of-state tuition penalty ranking",
    description:
      "U.S. public four-year colleges ranked by the out-of-state penalty: how much 30-year NPV a non-resident gives up " +
      "versus a resident at the same school. Includes both NPVs and both tuition figures per row.",
    inputSchema: {
      limit: z.number().int().min(1).max(100).default(25).describe("Max rows returned (77 total)."),
      state: z.string().length(2).optional().describe("Filter to one state's public colleges."),
    },
  },
  async ({ limit, state }) => {
    const data = await apiGet("/rankings/out-of-state-penalty.json");
    let rows: any[] = data.rankings;
    if (state) rows = rows.filter((r) => r.state === state.toUpperCase());
    return ok({
      title: data.title,
      total_matching: rows.length,
      returned: Math.min(rows.length, limit),
      rankings: rows.slice(0, limit),
      attribution: ATTRIBUTION,
    });
  }
);

// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("college-roi-mcp running on stdio");
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
