#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR=$(cd "$(dirname "$0")" && pwd)
DEV_VARS_FILE=${DEV_VARS_FILE:-"$ROOT_DIR/.dev.vars"}
PROXY=${PROXY:-"http://127.0.0.1:8787"}

if [[ ! -f "$DEV_VARS_FILE" ]]; then
  echo "ERROR: missing $DEV_VARS_FILE" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$DEV_VARS_FILE"
set +a

: "${TEST_KEY:?TEST_KEY must be defined in .dev.vars}"
: "${CLOUDFLARE_AIG_TOKEN:?CLOUDFLARE_AIG_TOKEN must be defined in .dev.vars}"
: "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID must be defined in .dev.vars}"

mask_secret() {
  local value=${1:-}
  local keep_start=${2:-4}
  local keep_end=${3:-4}
  local length=${#value}

  if (( length <= keep_start + keep_end )); then
    printf '%s\n' "$value"
    return
  fi

  local end_start=$((length - keep_end))
  printf '%s...%s\n' "${value:0:keep_start}" "${value:$end_start:$keep_end}"
}

echo "Smoke test against local worker: $PROXY"
echo "Using TEST_KEY=$(mask_secret "$TEST_KEY")"
echo "Using CLOUDFLARE_ACCOUNT_ID=$(mask_secret "$CLOUDFLARE_ACCOUNT_ID" 6 4)"
echo "Using CLOUDFLARE_AIG_TOKEN=$(mask_secret "$CLOUDFLARE_AIG_TOKEN")"

health_status=$(curl -sS -o /dev/null -w '%{http_code}' "$PROXY/")
if [[ "$health_status" != "200" ]]; then
  echo "ERROR: local worker is not reachable on $PROXY (HTTP $health_status)" >&2
  echo "Start it with: source .dev.vars && npm run dev" >&2
  exit 1
fi

matrix_file=$(mktemp)
response_file=$(mktemp)
trap 'rm -f "$matrix_file" "$response_file"' EXIT

node --input-type=module <<'NODE' > "$matrix_file"
import fs from 'node:fs';

const ai = JSON.parse(fs.readFileSync('./ai.json', 'utf8'));

for (const [providerKey, provider] of Object.entries(ai.providers)) {
  const hasValidKey = provider.keys.some((key) => key.type !== 'expired');
  if (!hasValidKey) continue;

  const chatModels = provider.models
    .filter((model) => model.usage === 'chat')
    .sort((left, right) => left.priority - right.priority);

  if (chatModels.length === 0) continue;

  const selected = chatModels[0];
  console.log([providerKey, selected.id, String(selected.priority)].join('\t'));
}
NODE

total_tests=$(wc -l < "$matrix_file" | tr -d '[:space:]')
if [[ "$total_tests" == "0" ]]; then
  echo "ERROR: no eligible provider/model pair found in ai.json" >&2
  exit 1
fi

echo "Found $total_tests provider/model pair(s) to test"

success_count=0
warning_count=0

while IFS=$'\t' read -r provider model priority; do
  [[ -n "$provider" ]] || continue

  payload=$(MODEL_ID="$model" node --input-type=module - <<'NODE'
const payload = {
  model: process.env.MODEL_ID,
  messages: [
    { role: 'system', content: 'Local smoke test through Cloudflare AI Gateway' },
    { role: 'user', content: 'Reply with the provider name and confirm the request worked.' },
  ],
  stream: false,
  temperature: 0,
};
process.stdout.write(JSON.stringify(payload));
NODE
)

  echo
  echo "[$((success_count + 1))/$total_tests] provider=$provider priority=$priority model=$model"

  http_status=$(curl -sS \
    -o "$response_file" \
    -w '%{http_code}' \
    -X POST "$PROXY/$provider/v1/chat/completions" \
    -H 'Content-Type: application/json' \
    -H "Authorization: Bearer $TEST_KEY" \
    --data "$payload")

  if [[ "$http_status" != "200" ]]; then
    if [[ "$http_status" == "429" ]]; then
      echo "WARN provider=$provider model=$model http_status=$http_status upstream rate limit"
      sed -n '1,120p' "$response_file"
      warning_count=$((warning_count + 1))
      continue
    fi

    echo "FAIL provider=$provider model=$model http_status=$http_status" >&2
    sed -n '1,120p' "$response_file" >&2
    exit 1
  fi

  RESPONSE_FILE="$response_file" PROVIDER="$provider" MODEL="$model" node --input-type=module <<'NODE'
import fs from 'node:fs';

const body = fs.readFileSync(process.env.RESPONSE_FILE, 'utf8');
let parsed;

function extractTextContent(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => extractTextContent(item))
      .filter(Boolean)
      .join(' ')
      .trim();
  }
  if (value && typeof value === 'object') {
    if (typeof value.text === 'string') return value.text;
    if ('content' in value) return extractTextContent(value.content);
    if ('thinking' in value) return extractTextContent(value.thinking);
  }
  return '';
}

try {
  parsed = JSON.parse(body);
} catch {
  console.error(`FAIL provider=${process.env.PROVIDER} model=${process.env.MODEL} invalid JSON response`);
  console.error(body.slice(0, 400));
  process.exit(1);
}

const content = extractTextContent(parsed?.choices?.[0]?.message?.content);
if (typeof content !== 'string' || content.length === 0) {
  console.error(`FAIL provider=${process.env.PROVIDER} model=${process.env.MODEL} missing assistant content`);
  console.error(body.slice(0, 400));
  process.exit(1);
}

const excerpt = content.replace(/\s+/g, ' ').slice(0, 140);
console.log(`OK provider=${process.env.PROVIDER} model=${process.env.MODEL} excerpt=${excerpt}`);
NODE

  success_count=$((success_count + 1))
done < "$matrix_file"

echo
echo "Smoke test completed: $success_count passed, $warning_count warning(s), $total_tests total"

