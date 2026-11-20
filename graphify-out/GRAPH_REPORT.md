# Graph Report - laneway  (2026-11-20)

## Corpus Check
- 22 files · ~8,647 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 3 file(s) not represented in the graph (top: (none) 2, .lock 1)

## Summary
- 222 nodes · 399 edges · 10 communities
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 4 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `d0aff0cb`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- hosts.ts
- compilerOptions
- package.json
- scripts
- with
- index.cjs
- Laneway
- index.tsx
- uninstall.cjs
- dns.ts

## God Nodes (most connected - your core abstractions)
1. `compilerOptions` - 20 edges
2. `App()` - 16 edges
3. `with` - 13 edges
4. `scripts` - 13 edges
5. `sanitizeText()` - 11 edges
6. `react` - 9 edges
7. `validateHostEntry()` - 9 edges
8. `importFromConf()` - 8 edges
9. `HostLine` - 8 edges
10. `parseDomainList()` - 8 edges

## Surprising Connections (you probably didn't know these)
- `App()` --calls--> `DomainForm`  [EXTRACTED]
  src/index.tsx → src/components/DomainForm.tsx
- `App()` --calls--> `importFromConf()`  [EXTRACTED]
  src/index.tsx → src/lib/config.ts
- `App()` --calls--> `flushDns()`  [EXTRACTED]
  src/index.tsx → src/lib/dns.ts
- `App()` --calls--> `loadSystemHosts()`  [EXTRACTED]
  src/index.tsx → src/lib/hosts.ts
- `App()` --calls--> `nextHostLineId()`  [EXTRACTED]
  src/index.tsx → src/lib/hosts.ts

## Import Cycles
- None detected.

## Communities (10 total, 0 thin omitted)

### Community 0 - "hosts.ts"
Cohesion: 0.17
Nodes (19): DomainForm, DomainFormProps, importFromConf(), xmlBuilder, xmlParser, getHostsFilePath(), HostLine, isAsciiWhitespace() (+11 more)

### Community 1 - "compilerOptions"
Cohesion: 0.10
Nodes (20): compilerOptions, allowImportingTsExtensions, allowJs, jsx, jsxImportSource, lib, module, moduleDetection (+12 more)

### Community 2 - "package.json"
Cohesion: 0.06
Nodes (41): bin, laneway, dependencies, fast-xml-parser@^5.12.0, @opentui/core@^0.5.1, @opentui/react@^0.5.1, react@^19.2.6, devDependencies (+33 more)

### Community 3 - "scripts"
Cohesion: 0.15
Nodes (13): scripts, build, build:darwin:arm64, build:darwin:x64, build:linux:arm64, build:linux:x64, build:windows:arm64, build:windows:x64 (+5 more)

### Community 4 - "with"
Cohesion: 0.06
Nodes (41): needs, runs-on, steps, GITHUB_TOKEN, NPM_CONFIG_PROVENANCE, jobs, build, release (+33 more)

### Community 5 - "index.cjs"
Cohesion: 0.17
Nodes (19): ALLOWED_HOSTS, assertSafePath(), crypto, downloadBinary(), extractDigestFromAsset(), fs, getLatestRelease(), https (+11 more)

### Community 6 - "Laneway"
Cohesion: 0.17
Nodes (11): Development, Features, Installation, Key Bindings, Laneway, License, Option 1: NPM (Recommended), Option 2: From Source (+3 more)

### Community 7 - "index.tsx"
Cohesion: 0.16
Nodes (18): react, ActionPanelProps, DomainInfo, DomainInfoProps, DomainList, DomainListProps, DomainRow, DomainRowProps (+10 more)

### Community 8 - "uninstall.cjs"
Cohesion: 0.40
Nodes (4): fs, lanewayDir, os, path

### Community 9 - "dns.ts"
Cohesion: 0.43
Nodes (4): execFileAsync, flushDns(), resolveTrustedBinary(), runSystemBinary()

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `react` connect `index.tsx` to `hosts.ts`, `package.json`?**
  _High betweenness centrality (0.105) - this node is a cross-community bridge._
- **Should `compilerOptions` be split into smaller, more focused modules?**
  _Cohesion score 0.09523809523809523 - nodes in this community are weakly interconnected._
- **Why does `scripts` connect `scripts` to `package.json`?**
  _High betweenness centrality (0.069) - this node is a cross-community bridge._
- **Should `package.json` be split into smaller, more focused modules?**
  _Cohesion score 0.06155632984901278 - nodes in this community are weakly interconnected._
- **Why does `fast-xml-parser` connect `package.json` to `hosts.ts`?**
  _High betweenness centrality (0.046) - this node is a cross-community bridge._
- **Should `with` be split into smaller, more focused modules?**
  _Cohesion score 0.05807200929152149 - nodes in this community are weakly interconnected._