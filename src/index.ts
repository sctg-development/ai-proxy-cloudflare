// Copyright:
// Original author: Janlay Wu https://github.com/janlay published under MIT License
// Modified by: Ronan LE MEILLAT

/**
 * Handles administrative actions such as deleting users, adding API keys, and registering users.
 * @param action - The action to perform.
 * @param params - The parameters for the action.
 * @param method - The HTTP method of the request.
 * @param env - The environment object containing configuration and KV namespace.
 * @returns - A Promise that resolves to a Response object.
 */
async function handleAdminAction(action: string, params: string[], method: string, env: Env): Promise<Response> {
  let result: string;
  switch (action) {
    case 'delete':
      if (method !== 'DELETE') throw new Error("Method not allowed");
      await deleteUser(params[0], env);
      result = "User deleted successfully";
      break;
    case 'addkey':
      if (method !== 'POST') throw new Error("Method not allowed");
      await addkey(params[0], params[1], env);
      result = "API key added successfully";
      break;
    case 'register':
    case 'reset':
      if (method !== 'POST') throw new Error("Method not allowed");
      result = await registerUser(params[0], env);
      break;
    default:
      throw new Error("Invalid action");
  }
  return new Response(result, { headers: { "Content-Type": "text/plain" } });
}

/**
 * Handles incoming requests and routes them to appropriate handlers based on the URL path.
 * @param request - The incoming request object.
 * @param env - The environment object containing configuration and KV namespace.
 * @returns A Promise that resolves to a Response object.
 */
async function handleRequest(request: Request, env: Env): Promise<Response> {
  const { pathname } = new URL(request.url);
  const [_, token, action, ...params] = pathname.split("/");

  if ( token === "openai" || (/^v\d+$/.test(token)) && token !== env.ACCESS_TOKEN) { //Openai API path starts with v1, v2, etc.
    return proxy(request, env);
  } else if (token === env.ACCESS_TOKEN) {
    console.log("Accessing master handler");
    return await handleAdminAction(action, params, request.method, env);
  }
  throw "Access forbidden";
}

/**
 * Proxies the incoming request to the appropriate API endpoint.
 * @param request - The incoming request object.
 * @param env - The environment object containing configuration and KV namespace.
 * @returns A Promise that resolves to a Response object from the proxied request.
 */
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

  // 5. Delete the X-Host-Final header
  headers.delete("X-Host-Final");

  // Force to use https on port 443
  if (url.protocol !== "https:") {
    url.protocol = "https:";
  }

  if (url.port !== "443") {
    url.protocol = "https:";
    url.port = "";
  }

  console.log(`Proxying request to ${url.toString()} with key ${apiKey}`);

  // 6. issue the underlying request
  // Only pass body if request method is not 'GET'
  const requestBody =
    request.method !== "GET" ? JSON.stringify(await request.json()) : null;

  return fetch(url.toString(), {
    method: request.method,
    headers: headers,
    body: requestBody,
  });
}

/**
 * Registers a new user or resets an existing user's API key.
 * @param user - The username to register or reset.
 * @param env - The environment object containing the KV namespace.
 * @returns A Promise that resolves to the new API key.
 */
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

/**
 * Deletes a user from the system.
 * @param user - The username to delete.
 * @param env - The environment object containing the KV namespace.
 * @returns A Promise that resolves when the user is deleted.
 */
async function deleteUser(user: string | undefined, env: Env): Promise<void> {
  if (!user?.length) throw "Invalid username2";

  const users: Record<string, { key: string }> =
    (await env.KV_AI_PROXY.get("users", { type: "json" })) || {};
  if (!users[user]) throw "User not found";

  delete users[user];
  await env.KV_AI_PROXY.put("users", JSON.stringify(users));
}

/**
 * Adds an API key for a specific host.
 * @param host - The host to associate with the API key.
 * @param key - The API key to add.
 * @param env - The environment object containing the KV namespace.
 * @returns A Promise that resolves when the key is added.
 */
async function addkey(host: string, key: string, env: Env): Promise<void> {
  if (!host || !key) throw "Invalid host or key";
  await env.KV_AI_PROXY.put(host, key);
}

/**
 * Generates a random API key.
 * @returns A string representing the generated API key.
 */
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
  /**
   * The main entry point for handling requests.
   * @param request - The incoming request object.
   * @param env - The environment object containing configuration and KV namespace.
   * @param _ctx - The context object (unused in this implementation).
   * @returns A Promise that resolves to a Response object.
   */
  async fetch(request: Request, env: Env, _ctx: any): Promise<Response> {
    console.log(`request: ${request.headers}`);
    return handleRequest(request, env).catch(
      (err) => new Response(err || "Unknown reason", { status: 403 })
    );
  },
};