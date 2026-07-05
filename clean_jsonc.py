#!/usr/bin/env python3
"""
Script to clean a JSONC file by removing invalid control characters.
"""
import re

def clean_jsonc_file(input_file, output_file):
    """Read the input file, remove invalid control characters, and write to output file."""
    with open(input_file, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Remove invalid control characters (except newline, tab, etc.)
    # This regex removes characters with Unicode category 'Cc' (control characters)
    cleaned_content = re.sub(r'[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]', '', content)
    
    with open(output_file, 'w', encoding='utf-8') as f:
        f.write(cleaned_content)

if __name__ == "__main__":
    input_file = "/Users/rlemeill/Development/ai-proxy-cloudflare/wrangler.jsonc"
    output_file = "/Users/rlemeill/Development/ai-proxy-cloudflare/wrangler.jsonc.cleaned"
    clean_jsonc_file(input_file, output_file)
    print(f"Cleaned file written to {output_file}")