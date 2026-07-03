#!/usr/bin/env python3
# converti un fichier JSON de KV clouflare obtenu avec:
# ```bash
# CLOUDFLARE_ACCOUNT_ID=2e4ae…3f0d1c4 bunx wrangler kv key list --remote --binding KV_AI_PROXY > kv_export.json
# CLOUDFLARE_ACCOUNT_ID=2e4ae…3f0d1c4 bunx wrangler kv bulk get --remote --binding KV_AI_PROXY kv_export.json > kv.json
# ```
# le fichier converti peut être utilisé pour l'importer dans un autre compte Cloudflare avec:
# ```bash
# CLOUDFLARE_ACCOUNT_ID=2e4ae…3f0d1 bunx wrangler kv bulk --binding KV_AI_PROXY put kv_converted.json
# ```
import json

# Chemin vers le fichier kv.json
input_file = '/Users/rlemeill/Development/ai-proxy-cloudflare/kv.json'
output_file = '/Users/rlemeill/Development/ai-proxy-cloudflare/kv_converted.json'

# Lire le fichier JSON
def read_json_file(file_path):
    with open(file_path, 'r') as file:
        data = json.load(file)
    return data

# Convertir le dictionnaire en liste de dictionnaires
def convert_to_list_of_dicts(data):
    result = []
    for key, value in data.items():
        result.append({"key": key, "value": value})
    return result

# Écrire le résultat dans un fichier JSON
def write_json_file(file_path, data):
    with open(file_path, 'w') as file:
        json.dump(data, file, indent=2)

# Exécuter la conversion
def main():
    # Lire le fichier JSON
    data = read_json_file(input_file)
    
    # Convertir les données
    converted_data = convert_to_list_of_dicts(data)
    
    # Écrire le résultat dans un fichier
    write_json_file(output_file, converted_data)
    
    print(f"Conversion terminée. Le résultat a été enregistré dans {output_file}")

if __name__ == "__main__":
    main()