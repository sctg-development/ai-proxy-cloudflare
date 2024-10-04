#!/bin/bash
LOCAL_ADMIN_KEY="random_production_value"
NEW_HOST=${NEW_HOST:-"api.openai.com"}
NEW_HOST_KEY=${NEW_HOST_KEY:-"osk-fdwvR2IAwWX6hpygKNH3DvKuJZ92hBEuanZCGyxVI7X9zRez"}
# TEST: Create a user
# Create a random user name with 12 characters
USERNAME=$(cat /dev/urandom | LC_ALL=C tr -dc 'a-zA-Z0-9' | fold -w 12 | head -n 1)
USERKEY=$(curl -X POST http://localhost:8787/$LOCAL_ADMIN_KEY/register/$USERNAME)
echo "Username: $USERNAME Key: $USERKEY"

# TEST: add an host key
curl -X POST http://localhost:8787/$LOCAL_ADMIN_KEY/addkey/$NEW_HOST/$NEW_HOST_KEY

# TEST: Try to retrieve models
curl -H "Authorization: Bearer $USERKEY" -H "X-Host-Final: $NEW_HOST" http://localhost:8787/openai/v1/models

# Delete the user
curl -X DELETE http://localhost:8787/$LOCAL_ADMIN_KEY/$USERNAME

