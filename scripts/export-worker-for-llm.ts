/**
 * Copyright (c) 2026 Ronan LE MEILLAT - SCTG Development
 * License: AGPL-3.0-or-later
 *
 * export-code-for-llm.ts — Enhanced LLM context exporter for @sctg/sdk
 *
 * This script exports code and documentation from the SDK in a format optimized for LLM consumption.
 * It generates a comprehensive markdown file with structured information about the codebase,
 * making it easier for AI models to understand and work with the SDK.
 *
 * Improvements over v1:
 *  - Structured YAML front-matter for LLM system context
 *  - Architecture overview section (stack, conventions, key patterns)
 *  - Per-file metadata (exports, route bindings, DB tables, Stripe events)
 *  - Token budget awareness: configurable --max-tokens=N flag
 *  - --slim mode: strips comments and blank lines to reduce token count
 *  - Migration schema summary extracted from SQL files (shown before code)
 *  - Package.json trimmed to relevant keys only (no lockfile noise)
 *  - llm.txt companion file (ultra-compact index for Haiku/fast models)
 *  - --verbose flag to inspect per-section token costs
 */
// <reference lib="es2024" />

import fg from "fast-glob";
import fs from "node:fs/promises";
import path from "node:path";

// ─── CLI flags ────────────────────────────────────────────────────────────────
/**
 * Parse command line arguments to configure the export behavior.
 * Supports various options for customizing the output format and content.
 */
const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
    console.log(`USAGE: npx tsx scripts/export-code-for-llm.ts [options] [output-file]

Options:
  --help, -h              Show this help message
  --no-index              Skip llm.txt index generation
  --max-tokens=N          Limit total token count to N (default: unlimited)
  --slim                  Shrink output by stripping comments and blank lines
  --verbose               Show verbose output
`);
    process.exit(0);
}
const outFile       = args.find((a) => !a.startsWith("--")) ?? "llm.md";
const slim          = args.includes("--slim");
const maxTokensArg  = args.find((a) => a.startsWith("--max-tokens="));
const maxTokens     = maxTokensArg ? parseInt(maxTokensArg.split("=")[1]) : Infinity;
const withIndex     = !args.includes("--no-index");
const verbose       = args.includes("--verbose");

// ─── Helpers ──────────────────────────────────────────────────────────────────
/**
 * Map file extensions to language identifiers for markdown code blocks
 * @param ext - File extension (e.g., ".ts", ".js")
 * @returns Language identifier for markdown code blocks
 */
function languageForExt(ext: string): string {
    const map: Record<string, string> = {
        ".ts": "typescript", ".tsx": "typescript",
        ".js": "javascript", ".jsx": "javascript",
        ".json": "json",     ".css": "css",    ".sql": "sql",
    };
    return map[ext] ?? "";
}

/**
 * Estimate the number of tokens in a text string
 * Uses a rough heuristic of 1 token per 4 characters (GPT-4 approximation)
 * @param text - Text to estimate tokens for
 * @returns Estimated token count
 */
function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
}

/**
 * Remove comments and blank lines from source code to reduce token count
 * Used for the --slim mode to create more compact output
 * @param src - Source code content
 * @param ext - File extension
 * @returns Cleaned source code without comments and excessive whitespace
 */
function slimify(src: string, ext: string): string {
    if (ext === ".sql") return src;
    return src
        .replace(/\/\/.*$/gm, "")          // Remove single-line comments
        .replace(/\/\*[\s\S]*?\*\//g, "")  // Remove block comments
        .replace(/^\s*[\r\n]/gm, "");     // Remove blank lines
}

/**
 * Extract named exports from TypeScript/JavaScript files
 * Finds all export statements and returns the exported identifiers
 * @param src - Source code content
 * @returns Array of exported identifiers
 */
function extractExports(src: string): string[] {
    const re =
        /export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var|type|interface|enum)\s+(\w+)/g;
    const found: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) found.push(m[1]);
    return [...new Set(found)];
}

/**
 * Build an ASCII tree representation of the project structure
 * Creates a visual hierarchy of files and directories
 * @param paths - Array of file paths
 * @returns Array of strings representing the ASCII tree
 */
function buildTree(paths: string[]): string[] {
    const root = new Map<string, Map<string, any>>();
    for (const p of paths) {
        const parts = p.split("/");
        let node = root;
        for (const part of parts) {
            if (!node.has(part)) node.set(part, new Map());
            const next = node.get(part);
            if (next instanceof Map) {
                node = next;
            } else {
                break;
            }
        }
    }
    const lines: string[] = [];
    function walk(map: Map<string, any>, prefix: string) {
        const entries = Array.from(map.keys()).sort();
        entries.forEach((key, index) => {
            const last = index === entries.length - 1;
            lines.push(`${prefix}${last ? "└─ " : "├─ "}${key}`);
            const child = map.get(key);
            if (child?.size > 0) walk(child, prefix + (last ? "   " : "│  "));
        });
    }
    walk(root, "");
    return lines;
}

// ─── Architecture preamble ────────────────────────────────────────────────────
/**
 * Predefined architecture overview that gets included in the generated documentation
 * Provides context about the SDK's purpose, architecture, and key components
 */
const ARCHITECTURE_PREAMBLE = `
## Architecture overview

ai-proxy-cloudflare is a all-in-one AI proxy and vault manager for storing LLM API keys and record usage

### Stack

Cloudflare Worker+KV, TypeScript, Hono


`.trim();

// ─── Main ─────────────────────────────────────────────────────────────────────
/**
 * Main execution function that orchestrates the entire export process:
 * 1. Discovers and reads source files
 * 2. Processes and categorizes files (code vs config)
 * 3. Generates markdown documentation with metadata
 * 4. Writes output files
 * 5. Provides token usage statistics
 */
async function main() {
    const root = process.cwd();

    // Try to read README content for inclusion in output
    let readmeContent = "";
    try {
        readmeContent = await fs.readFile(path.join(root, "README.md"), "utf8");
    } catch {
        // ignore
    }

    // Define file patterns to include in the export
    const patterns = [
        "packages/**/*.{ts,tsx,js,jsx,json}",
    ];
    const ignore = [
        "package.json", "pnpm-lock.yaml", "yarn.lock", "lerna.json",
        "**/node_modules/**", "**/dist/**", "**/.next/**", "**/*.d.ts",
    ];

    // Find all matching files in the project
    const files = await fg(patterns, { cwd: root, absolute: true, onlyFiles: true, ignore });

    // Define types for different file categories
    type CodeFile = {
        rel: string;       // Relative path
        content: string;   // File content
        ext: string;       // File extension
        exports: string[]; // Exported identifiers
    };
    type ConfigFile = { rel: string; content: string };

    const codeFiles:   CodeFile[]   = [];
    const configFiles: ConfigFile[] = [];

    // Process each file and categorize it
    for (const abs of files) {
        const rel = path.relative(root, abs);
        const ext = path.extname(rel).toLowerCase();
        const raw = await fs.readFile(abs, "utf8");

        if (ext === ".json") {
            if (rel.endsWith("package.json")) {
                try {
                    // For package.json files, trim to essential fields only
                    const pkg = JSON.parse(raw);
                    const trimmed = {
                        name:            pkg.name,
                        version:         pkg.version,
                        type:            pkg.type,
                        dependencies:    pkg.dependencies    ?? {},
                        devDependencies: Object.fromEntries(
                            Object.entries(pkg.devDependencies ?? {}).slice(0, 30)
                        ),
                    };
                    configFiles.push({ rel, content: JSON.stringify(trimmed, null, 2) });
                } catch {
                    configFiles.push({ rel, content: raw });
                }
            } else {
                configFiles.push({ rel, content: raw });
            }
        } else {
            // For code files, apply slim mode if requested and extract exports
            const content = slim ? slimify(raw, ext) : raw;
            codeFiles.push({
                rel, content, ext,
                exports:      extractExports(raw),
            });
        }
    }

    // Sort files alphabetically for consistent output
    codeFiles.sort((a, b)   => a.rel.localeCompare(b.rel));
    configFiles.sort((a, b) => a.rel.localeCompare(b.rel));

    const allPaths = [
        ...codeFiles.map((f)   => f.rel),
        ...configFiles.map((f) => f.rel),
    ];

    const now = new Date().toISOString().slice(0, 10);
    let md = "";

    // Generate YAML front-matter with metadata about the export
    md += "---\n";
    md += `title: "ai-proxy-cloudflare AI Proxy"\n`;
    md += `description: "ai-proxy-cloudflare is a all-in-one AI proxy and vault manager for storing LLM API keys and record usage"\n`;
    md += `framework: typescript\n`;
    md += `stack: "ai-proxy-cloudflare"\n`;
    md += `generated: "${now}"\n`;
    md += `slim_mode: ${slim}\n`;
    md += `files_total: ${allPaths.length}\n`;
    md += "---\n\n";

    // Include README content if available
    if (readmeContent) {
        md += readmeContent.trim() + "\n\n---\n\n";
    }

    // Add architecture overview
    md += ARCHITECTURE_PREAMBLE + "\n\n---\n\n";

    // Generate and include project structure tree
    const treeLines = buildTree(allPaths);
    if (treeLines.length) {
        md += "## Project structure\n\n";
        md += "```\n" + treeLines.join("\n") + "\n```\n\n";
    }

    // Process and include source code files with metadata
    if (codeFiles.length) {
        md += "## Source code\n\n";
        let tokenCount = estimateTokens(md);

        for (const file of codeFiles) {
            const lang = languageForExt(file.ext);
            let section = `### \`${file.rel}\`\n\n`;

            // Add metadata about exports
            const metaParts: string[] = [];
            if (file.exports.length)
                metaParts.push(`**Exports:** ${file.exports.join(", ")}`);
            if (metaParts.length) section += metaParts.join("  \n") + "\n\n";

            // Add code block with proper language syntax highlighting
            section += "```" + lang + "\n" + file.content +
                (file.content.endsWith("\n") ? "" : "\n") + "```\n\n";

            // Check token budget and omit content if necessary
            const sectionTokens = estimateTokens(section);
            if (tokenCount + sectionTokens > maxTokens) {
                section = `### \`${file.rel}\`\n\n> _Omitted: token budget reached (--max-tokens=${maxTokens})._\n\n`;
            }
            tokenCount += sectionTokens;
            md += section;
        }
    }

    // Process and include configuration files
    if (configFiles.length) {
        md += "## Configuration\n\n";
        for (const f of configFiles) {
            md += `### \`${f.rel}\`\n\n`;
            md += "```json\n" + f.content + (f.content.endsWith("\n") ? "" : "\n") + "```\n\n";
        }
    }

    // Write the main markdown output file
    await fs.writeFile(outFile, md, "utf8");
    const totalTokens = estimateTokens(md);
    console.log(
        `Exported ${allPaths.length} files → ${outFile}  (~${totalTokens.toLocaleString()} tokens${slim ? ", slim mode" : ""})`
    );

    // Generate companion index file if requested
    if (withIndex) {
        const indexFile = path.join(path.dirname(outFile), "llm.txt");
        let idx = `@sctg/sdk — source index (${now})\n`;
        idx += `Stack: @sctg/sdk with name @sctg/cline-sdk\n\n`;
        idx += `FILES\n`;
        for (const p of allPaths) idx += `  ${p}\n`;

        await fs.writeFile(indexFile, idx, "utf8");
        console.log(`Index written → ${indexFile}`);
    }

    // Show detailed token breakdown if verbose mode is enabled
    if (verbose) {
        console.log(`\nToken breakdown:`);
        console.log(`  README:       ~${estimateTokens(readmeContent).toLocaleString()}`);
        console.log(`  Architecture: ~${estimateTokens(ARCHITECTURE_PREAMBLE).toLocaleString()}`);
        console.log(`  Source code:  ~${estimateTokens(codeFiles.map((f) => f.content).join("")).toLocaleString()}`);
        console.log(`  Config:       ~${estimateTokens(configFiles.map((f) => f.content).join("")).toLocaleString()}`);
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
