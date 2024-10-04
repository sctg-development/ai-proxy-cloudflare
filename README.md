# ai-proxy-cloudflare

An AI API proxy running with Cloudflare worker, supporting multiple AI providers.

## Features

- [x] Support APIs provided by OpenAI and other compatible providers
- [x] Fully compliant with the format requirements of OpenAI's API payload and key
- [x] Works with mainstream OpenAI/ChatGPT GUI apps
- [x] Streaming content
- [x] Unique key for users
- [x] Create / delete users
- [x] Reset user's key
- [x] Support for multiple AI providers (e.g., OpenAI, Groq, SambaNova)
- [x] Support for in brower fetch with CORS
- [ ] User can reset the key independently
- [ ] Time-limited
- [ ] Stats for usage

## TL;DR

1. Clone this repository to your local machine.
2. Install npm dependencies.
3. Deploy the worker script to Cloudflare. with `npm run deploy`.  

## SDK

This was designed to be used with the [AI SDK](https://github.com/sctg-development/ai-typescript) project.  
See https://github.com/sctg-development/groq-outlook for an example of how to use it. In particular, see the `src/aipane.ts` [file](https://github.com/sctg-development/groq-outlook/blob/main/src/aipane/aipane.ts).

## Setup

### 1. Prepare your domain name

- Please make sure that the nameservers of your domain is set to the nameservers provided by Cloudflare first. [Manual](https://developers.cloudflare.com/dns/zone-setups/full-setup/setup/)

### 2. Create a new service

1. Log in to your [Cloudflare Dashboard](https://dash.cloudflare.com/) and navigate to the Workers section.
2. Click on the "Create a Service" button.
3. Input the Service name.
4. Keep the "Select a starter" as "Default handler".
5. Click on the "Create" button

Now you have the new service created and it shows you the detail of the service.

### 3. Configure the newly created service - Trigger

1. Click "Triggers" on the tab bar.
2. Click "Add Custom Domain" button.
3. Input the domain you want to use, such as `gpt.mydomainname.com`. Don't worry, Cloudflare can automatically configure the proper DNS settings for this.
4. Click "Add Custom Domain" button to finish the Triggers setting.

Don't leave the detail page and go on.

### 4. Configure the newly created service - Environment Variables

1. Click "Settings" on the tab bar.
2. Click "Variables" from the right part.
3. In "Environment Variables", Click "Add Variable" button.
4. Input two important items. **Enable "Encrypt" because they are sensitive**.
   - Key: `OPENAPI_API_KEY`, value is your own OpenAPI key.
   - Key `ACCESS_TOKEN`, value is any random string like a password.
   Again, both of these pieces of information are very sensitive, so it is strongly recommended to turn on the "Encrypt" option. This way, after you save them, no one will be able to see their values again.

### 5. Configure the newly created service - KV_AI_PROXY Storage

1. Expand "Workers" in right sidebar.
2. Click "KV_AI_PROXY".
3. In "Workers KV_AI_PROXY", Click "Create a namespace" button.
4. Input new name for the namespace, such as `namespace_gpt`.
5. Click "Add" button.
6. Go back to the detail page of the new created service.
7. Go to step 3 of above section, enter "Environment Variables" and scroll down the page.
8. In "KV_AI_PROXY Namespace Bindings" section, Click "Add binding" button.
9. Input `KV_AI_PROXY` (UPPERCASE) in the left, and choose new KV_AI_PROXY namespace created in step 4.
10. Click "Save and deploy" button.

### 6. Configure the newly created service - Manual Deployment

1. Clone this repository to your local machine.

```bash
git clone https://github.com/sctg-development/ai-proxy-cloudflare.git
cd ai-proxy-cloudflare
```

2. Install npm dependencies.

```bash
npm install
```

3. Build the worker script.

```bash
npm run build
```

4. Open the code of the worker script in `dist/index.js` with a text editor.
5. Copy all of the code.
6. Go back to the detail page of the new created service.
7. Click "Quick edit" button at the top right.
8. Replace all code with content of pasteboard.
9. Click "Save and deploy".

Around one minute later, the new serivce should serve.

## Manage users

Here assume your domain name is `ai-proxy.example.com` and the Admin's password (`ACCESS_TOKEN`) is `Une9f2ijwe`

| Task  | Command |
| ------------- | ------------- |
| Create new user with name `janlay`  | `curl -X POST https://ai-proxy.example.com/Une9f2ijwe/register/janlay`  |
| Reset user `janlay`'s key  | `curl -X POST https://ai-proxy.example.com/Une9f2ijwe/reset/janlay`  |

Both of these commands output the user's Key. Please be aware that this key always starts with `sk-cfw` and may look like a valid OpenAI Key, but it can only be used for this service.

If you want to delete a user, try this:

```bash
curl -X DELETE https://ai-proxy.example.com/Une9f2ijwe/delete/janlay
```

It's ok if you see "OK".

## Manage host/key pairs for different providers

You can use the proxy for multiple AI providers that use an OpenAI-compatible API format. To add support for a new provider:

```bash
curl -X POST https://ai-proxy.example.com/Une9f2ijwe/addkey/host/key
```

For example, to add support for Groq:

```bash
curl -X POST https://ai-proxy.example.com/Une9f2ijwe/addkey/api.groq.com/gsk_your_groq_api_key_here
```

## Use the service

Here's how to use the service with different providers:

### OpenAI (default)

- URL: `https://ai-proxy.example.com/v1/chat/completions`
- Headers:
  - `Authorization: Bearer sk-cfw****` (your user key from registration)

### Groq

- URL: `https://ai-proxy.example.com/openai/v1/chat/completions`
- Headers:
  - `Authorization: Bearer sk-cfw****` (your user key from registration)
  - `X-Host-Final: api.groq.com`

### Using with other providers

To use with other OpenAI-compatible providers:

1. Add the provider's host and API key using the `addkey` command as shown above.
2. Use the same URL and `Authorization` header as above.
3. Add the `X-Host-Final` header with the provider's host (e.g., `X-Host-Final: api.someotherprovider.com`).

The proxy will route your request to the specified provider while using your account's API key for that provider.

## Example: Using with curl

Here's an example of how to use the proxy with curl for both OpenAI and Groq:

### OpenAI

```bash
curl https://ai-proxy.example.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-cfw****" \
  -d '{
    "model": "gpt-3.5-turbo",
    "messages": [{"role": "user", "content": "Say this is a test"}],
    "temperature": 0.7
  }'
```

### Groq

```bash
curl https://ai-proxy.example.com/openai/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-cfw****" \
  -H "X-Host-Final: api.groq.com" \
  -d '{
    "model": "mixtral-8x7b-32768",
    "messages": [{"role": "user", "content": "Say this is a test"}],
    "temperature": 0.7
  }'
```

Note: Make sure to replace `sk-cfw****` with your actual user key, and use the appropriate model for each provider.

## LICENSE

This project uses the MIT license. Please see [LICENSE](https://github.com/sctg-development/ai-proxy-cloudflare/blob/master/LICENSE) for more information.
