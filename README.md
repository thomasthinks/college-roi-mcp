# college-roi-mcp

MCP server for U.S. college-ROI data: 30-year net present value (NPV) for **500 four-year colleges**, lifetime ROI for **19 major categories + 115 CIP subfields**, per-state **best-value rankings**, and the **out-of-state tuition penalty** ranking.

Wraps the free, keyless [LE TEEN College ROI API](https://le-teen.com/api) (static JSON, CC BY 4.0). No API key, no signup, no rate limits beyond CDN sanity. Data derives from FREOPP program-level ROI estimates, IPEDS institutional data, and BEA price deflators — methodology at [le-teen.com/methodology](https://le-teen.com/methodology). Dataset DOI: [10.5281/zenodo.21351602](https://doi.org/10.5281/zenodo.21351602).

## Install

Requires Node ≥ 18.

**Claude Desktop / Claude Code** (`claude_desktop_config.json` or `.mcp.json`):

```json
{
  "mcpServers": {
    "college-roi": {
      "command": "npx",
      "args": ["-y", "college-roi-mcp"]
    }
  }
}
```

**Claude Code CLI:**

```sh
claude mcp add college-roi -- npx -y college-roi-mcp
```

Any other MCP client: run `npx -y college-roi-mcp` over stdio.

## Tools

| Tool | What it returns |
|---|---|
| `list_majors` | Compact ROI rows for 19 categories / 115 subfields — median & mean lifetime ROI, % never break even, break-even age, AI-exposure band. Filter by kind/parent, sort, limit. |
| `get_major` | Full record for one major: ROI distribution (p25/median/mean/p75), completion-adjusted & dropout ROI, graduates/programs, AI-exposure detail. |
| `search_colleges` | Search the 500 positive-NPV-envelope colleges by name/state/control — resident & non-resident 30-yr NPV, cost of attendance, median earnings, break-even age. |
| `get_college` | Full record for one college, incl. IPEDS unitid and FREOPP coverage. |
| `best_value_colleges` | Each state's best-value four-years at resident pricing (top 15 per state), or a nationwide top-pick summary. |
| `out_of_state_penalty` | Public four-years ranked by how much 30-yr NPV a non-resident gives up vs a resident. |
| `get_api_info` | Metadata for the underlying API: endpoints, license, DOI, attribution. |

All dollar figures are lifetime/30-year totals in USD. List responses are compact projections with `limit` controls so they stay small in agent contexts; detail tools return the full upstream record.

Note the envelope: only colleges that clear a positive-NPV bar appear (500 of ~1,656 U.S. four-years). A school being *absent* is itself a signal.

## Example prompts

- "Is a nursing degree worth it compared to computer science?"
- "Best-value colleges in Michigan for a resident."
- "How much does going out-of-state to UVA cost me over 30 years?"
- "Which majors have the worst odds of ever breaking even?"

## Data freshness & caching

The upstream API is static JSON regenerated with the dataset; this server caches responses in-process for 24 h (matching the API's CDN cache). Nothing is written anywhere; the server is read-only.

## License & attribution

- **Code:** MIT.
- **Data:** CC BY 4.0 — free to use with attribution. Cite **LE TEEN, le-teen.com** (and FREOPP/IPEDS/BEA as upstream sources).
