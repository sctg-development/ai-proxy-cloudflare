#!/usr/bin/env python3
# Copyright (c) 2024-2026 Ronan LE MEILLAT
# License: AGPL-3.0-or-later
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as
# published by the Free Software Foundation, either version 3 of the
# License, or (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
# GNU Affero General Public License for more details.
#
# You should have received a copy of the GNU Affero General Public License
# along with this program. If not, see <http://www.gnu.org/licenses/>.
#
"""Generate wrangler.jsonc from .env and existing base wrangler.jsonc.

Usage:
  python3 scripts/generate-wrangler-jsonc.py [--skip-routes] <env-file> <base-wrangler.jsonc> <output-wrangler.jsonc>
"""

import argparse
import json
import os
import re
import sys


def strip_jsonc_comments(text: str) -> str:
    """Remove // line comments and /* block comments */ from a JSONC string."""
    # Remove /* ... */ block comments (non-greedy, across newlines)
    text = re.sub(r'/\*.*?\*/', '', text, flags=re.DOTALL)
    # Remove // line comments (not inside strings)
    # This simple approach removes everything from // to end-of-line;
    # it is sufficient for wrangler.jsonc files which don't put // inside string values.
    text = re.sub(r'//[^\n]*', '', text)
    return text

# All .env variables will be treated as secrets in generated wrangler.jsonc.

def load_env(env_path):
    if not os.path.exists(env_path):
        raise FileNotFoundError(f"Env file not found: {env_path}")

    env = {}
    with open(env_path, "r", encoding="utf-8") as f:
        for raw in f:
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            key_value = re.split(r"=(.*)", line, maxsplit=1)
            if len(key_value) < 3:
                continue
            key, value = key_value[0].strip(), key_value[1].strip()
            # preserve quotes inside value and remove surrounding quotes for readability
            if len(value) >= 2 and ((value[0] == '"' and value[-1] == '"') or (value[0] == "'" and value[-1] == "'")):
                value = value[1:-1]
            env[key] = value
    return env


def main():
    parser = argparse.ArgumentParser(
        description="Generate a wrangler.jsonc from a .env file and a base wrangler.jsonc."
    )
    parser.add_argument("env_file", help="Path to the .env file")
    parser.add_argument("base_wrangler", help="Path to the base wrangler.jsonc")
    parser.add_argument("output_wrangler", help="Path for the generated wrangler.jsonc")
    parser.add_argument(
        "--skip-routes",
        action="store_true",
        default=False,
        help="Do not add or modify 'routes' (use for workers.dev deployments such as the MCP worker)",
    )
    args = parser.parse_args()

    env_path = args.env_file
    base_wrangler_path = args.base_wrangler
    output_path = args.output_wrangler

    env_vars = load_env(env_path)

    with open(base_wrangler_path, "r", encoding="utf-8") as f:
        base_config = json.loads(strip_jsonc_comments(f.read()))

    # Preserve existing config and avoid overriding unrelated keys.
    wrangler_config = dict(base_config)

    current_vars = dict(wrangler_config.get("vars", {}))

    # Treat all environment variables as secrets into required list for wrangler config.
    required_secrets = sorted(env_vars.keys())
    if required_secrets:
        wrangler_config["secrets"] = {"required": required_secrets}

    # Ensure kv_namespaces exist and set KV_CACHE id if available.
    kv_namespaces = wrangler_config.get("kv_namespaces", [])
    kv_cache_id = env_vars.get("KV_CACHE_ID", "")
    if kv_cache_id:
        for ns in kv_namespaces:
            if ns.get("binding") == "KV_CACHE":
                ns["id"] = kv_cache_id
        # if KV_CACHE binding is missing, append it
        if not any(ns.get("binding") == "KV_CACHE" for ns in kv_namespaces):
            kv_namespaces.append({"binding": "KV_CACHE", "id": kv_cache_id})
    wrangler_config["kv_namespaces"] = kv_namespaces

    # Set routes based on page-dev flag and domain name.
    # Skipped when --skip-routes is passed (e.g. for the MCP worker on workers.dev).
    if not args.skip_routes:
        use_page_dev = env_vars.get("CLOUDFLARE_USE_PAGE_DEV_DOMAIN", "").strip().lower()
        is_falsey = use_page_dev == "" or use_page_dev == "false" or use_page_dev == "0"
        if not is_falsey:
            # page dev active: keep routes untouched
            pass
        else:
            domain_name = env_vars.get("DOMAIN_NAME", "")
            if domain_name:
                wrangler_config["routes"] = [{"pattern": domain_name, "custom_domain": True}]

    # Keep existing vars configuration unchanged in generated file (optional values, not secret references).
    wrangler_config["vars"] = current_vars

    output_dir = os.path.dirname(output_path)
    if output_dir:
        os.makedirs(output_dir, exist_ok=True)

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(wrangler_config, f, indent=2, ensure_ascii=False)

    # Create secrets.json file for wrangler secret bulk command.
    secrets_json_path = os.path.join(os.path.dirname(output_path), "secrets.json")
    with open(secrets_json_path, "w", encoding="utf-8") as f:
        json.dump(env_vars, f, indent=2, ensure_ascii=False)

    print(f"Generated wrangler config at: {output_path}")
    print(f"Generated secrets bulk file at: {secrets_json_path}")


if __name__ == "__main__":
    main()
