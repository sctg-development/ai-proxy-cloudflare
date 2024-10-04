#!/bin/bash
PROXY=${PROXY:-"http://localhost:8787"}
LOCAL_ADMIN_KEY=${LOCAL_ADMIN_KEY:-"random_production_value"}
NEW_HOST=${NEW_HOST:-"api.openai.com"}
NEW_HOST_KEY=${NEW_HOST_KEY:-"osk-fdwvR2IAwWX6hpygKNH3DvKuJZ92hBEuanZCGyxVI7X9zRez"}
echo "TEST: Create a user"
# Create a random user name with 12 characters
USERNAME=$(cat /dev/urandom | LC_ALL=C tr -dc 'a-zA-Z0-9' | fold -w 12 | head -n 1)
USERKEY=$(curl -X POST $PROXY/$LOCAL_ADMIN_KEY/register/$USERNAME)
echo "Username: $USERNAME Key: $USERKEY"

echo "TEST: add an host key"
curl -X POST $PROXY/$LOCAL_ADMIN_KEY/addkey/$NEW_HOST/$NEW_HOST_KEY

echo ""
echo "TEST: Try to retrieve models"
curl -H "Authorization: Bearer $USERKEY" -H "X-Host-Final: $NEW_HOST" $PROXY/v1/models

echo ""
echo "TEST: Chat completion"
curl -v -H "Authorization: Bearer $USERKEY" \
     -H "X-Host-Final: $NEW_HOST" \
     -H "Content-Type: application/json" \
     -d '{
    "stream": true,
    "model": "Meta-Llama-3.1-8B-Instruct",
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
     -X POST $PROXY/v1/chat/completions

echo ""
echo "TEST: Delete the user"
curl -X DELETE $PROXY/$LOCAL_ADMIN_KEY/delete/$USERNAME

