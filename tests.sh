#!/bin/bash
PROXY=${PROXY:-"http://localhost:8787"}
LOCAL_ADMIN_KEY=${LOCAL_ADMIN_KEY:-"random_production_value"}
BASE_PATH=${BASE_PATH:-"/openai"}
NEW_HOST=${NEW_HOST:-"api.groq.com"}
NEW_HOST_KEY=${NEW_HOST_KEY:-"osk-fdwvR2IAwWX6hpygKNH3DvKuJZ92hBEuanZCGyxVI7X9zRez"}
echo "TEST: Create a user"
# Create a random user name with 12 characters
USERNAME=$(cat /dev/urandom | LC_ALL=C tr -dc 'a-zA-Z0-9' | fold -w 12 | head -n 1)
USERKEY=$(curl -H "Authorization: Bearer admin" -X POST $PROXY/$LOCAL_ADMIN_KEY/register/$USERNAME)
echo "Username: $USERNAME Key: $USERKEY"

echo "TEST: add an host key"
curl -H "Authorization: Bearer admin" -X POST $PROXY/$LOCAL_ADMIN_KEY/addkey/$NEW_HOST/$NEW_HOST_KEY

echo ""
echo "TEST: Try to retrieve models"
curl -H "Authorization: Bearer $USERKEY" -H "X-Host-Final: $NEW_HOST" $PROXY$BASE_PATH/v1/models -v --output - | brotli -d

echo ""
echo "TEST: Chat completion"
curl -v -H "Authorization: Bearer $USERKEY" \
     -H "X-Host-Final: $NEW_HOST" \
     -H "Content-Type: application/json" \
     -d '{
    "stream": false,
    "model": "llama-3.2-1b-preview",
    "messages": [
        {
            "role": "system",
            "content": "You are a helpful assistant"
        },
        {
            "role": "user",
            "content": "Hello"
        }
    ]
    }' \
     -X POST $PROXY$BASE_PATH/v1/chat/completions -v --output - | brotli -d

echo ""
echo "TEST: Manual test integration"
curl -H "Content-Type: application/json" \
  -H "Authorization: Bearer $USERKEY" \
  -H "X-Host-Final: $NEW_HOST" \
  -d '{
    "model": "llama-3.2-90b-text-preview",
    "messages": [{"role": "user", "content": "Say this is a test"}],
    "temperature": 0.7
  }' \
  -X POST $PROXY$BASE_PATH/v1/chat/completions -v --output - | brotli -d

echo ""
echo "TEST: Delete the user"
curl -H "Authorization: Bearer admin" -X DELETE $PROXY/$LOCAL_ADMIN_KEY/delete/$USERNAME

