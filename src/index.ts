// Copyright:
// Original author: Janlay Wu https://github.com/janlay published under MIT License
// Modified by: Ronan LE MEILLAT

async function handleRequest(request: Request, env: Env): Promise<Response> {
  const { pathname } = new URL(request.url);
  const [_, token, next, ...params] = pathname.split("/");

  if (/^v\d+$/.test(token)) {
    return proxy(request, env);
  } else if (token === env.ACCESS_TOKEN) {
    console.log("Accessing master handler");
    let result: string | undefined;
    if (request.method === "DELETE") {
      await deleteUser(next, env);
      result = "ok";
    } else if (next === "addkey") {
      console.log(`Adding key ${params[1]} for host ${params[0]}`);
      await addkey(params[0], params[1], env);
      result = "ok";
    } else if (next === "register" || next === "reset") {
      result = await registerUser(params[0], env);
    }

    if (!result) throw "Invalid action";
    return new Response(`${result}\n`, {
      headers: { "Content-Type": "text/plain" },
    });
  }
  throw "Access forbidden";
}

async function proxy(request: Request, env: Env): Promise<Response> {
  const headers = new Headers(request.headers);
  const authKey = "Authorization";
  const token = headers.get(authKey)?.split(" ").pop();
  if (!token) throw "Auth required";

  // validate user
  const users: Record<string, { key: string }> =
    (await env.KV_AI_PROXY.get("users", { type: "json" })) || {};
  let name: string | undefined;
  for (let key in users) if (users[key].key === token) name = key;

  if (!name) throw "Invalid token";
  console.log(`User ${name} acepted.`);

  // proxy the request
  const url = new URL(request.url);
  // 1. Check if the request include the final host in the X-Host-Final header
  const host = headers.get("X-Host-Final");
  // 2. replace url.host whit the host from the X-Host-Final header or 'api.openai.com' if not present
  url.host = host || "api.openai.com";
  // 3. Check if an API ley is present in the KV for this host
  const apiKey = await env.KV_AI_PROXY.get(host || env.OPENAPI_API_KEY);

  console.log(`API key for host ${host} is ${apiKey}`);
  // 4. replace with the real API key
  headers.set(authKey, `Bearer ${apiKey}`);

  // Force to use https on port 443
  if (url.protocol !== "https:") {
    url.protocol = "https:";
  }

  if (url.port !== "443") {
    url.protocol = "https:";
    url.port = "";
  }

  console.log(`Proxying request to ${url.toString()} with key ${apiKey}`);
  // 5. issue the underlying request
  // Only pass body if request method is not 'GET'
  const requestBody =
    request.method !== "GET" ? JSON.stringify(await request.json()) : null;
  return fetch(url.toString(), {
    method: request.method,
    headers: { ...headers },
    body: requestBody,
  });
}

async function registerUser(
  user: string | undefined,
  env: Env
): Promise<string> {
  if (!user?.length) throw "Invalid username1";

  const users: Record<string, { key: string }> =
    (await env.KV_AI_PROXY.get("users", { type: "json" })) || {};
  const key = generateAPIKey();
  users[user] = { key };
  await env.KV_AI_PROXY.put("users", JSON.stringify(users));
  return key;
}

async function deleteUser(user: string | undefined, env: Env): Promise<void> {
  if (!user?.length) throw "Invalid username2";

  const users: Record<string, { key: string }> =
    (await env.KV_AI_PROXY.get("users", { type: "json" })) || {};
  if (!users[user]) throw "User not found";

  delete users[user];
  await env.KV_AI_PROXY.put("users", JSON.stringify(users));
}

async function addkey(host: string, key: string, env: Env): Promise<void> {
  if (!host || !key) throw "Invalid host or key";
  await env.KV_AI_PROXY.put(host, key);
}

function generateAPIKey(): string {
  const characters =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let apiKey = "sk-cfw";

  for (let i = 0; i < 45; i++) {
    const randomIndex = Math.floor(Math.random() * characters.length);
    apiKey += characters.charAt(randomIndex);
  }

  return apiKey;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env).catch(
      (err) => new Response(err || "Unknown reason", { status: 403 })
    );
  },
};
