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
async function handleAdminAction(
  action: string,
  params: string[],
  method: string,
  env: Env
): Promise<Response> {
  let result: string;
  switch (action) {
    case "delete":
      if (method !== "DELETE") throw new Error("Method not allowed");
      await deleteUser(params[0], env);
      result = "User deleted successfully";
      break;
    case "addkey":
      if (method !== "POST") throw new Error("Method not allowed");
      // params[0] is the host, params[1] is the key
      await addkey(params[0], params[1], env);
      result = "API key added successfully";
      break;
    case "register":
    case "reset":
      if (method !== "POST") throw new Error("Method not allowed");
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

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: getCorsHeaders(request.headers.get("Origin")),
    });
  }

  // Validate the request headers
  if (!request.headers.get("Authorization")) {
    console.log("Error: Authorization header is missing");
    throw new Error("Authorization header is missing");
  }

  // Validate the API key
  const apiKey = request.headers.get("Authorization");
  if (!validateBearerAPIKey(apiKey || "")) {
    // Note '' is not a valid API key
    console.log(`Error: Invalid API key: ${apiKey}`);
    throw new Error(`Invalid API key: ${apiKey}`);
  }

  // Validate the request method
  if (request.method !== "POST" && request.method !== "GET") {
    console.log("Error: Invalid request method");
    throw new Error("Invalid request method");
  }

  if (
    token === "openai" ||
    (/^v\d+$/.test(token) && token !== env.ACCESS_TOKEN)
  ) {
    //Openai API path starts with v1, v2, etc.
    const host = request.headers.get("X-Host-Final");
    if (!host) {
      console.log("Error: X-Host-Final header is missing");
      throw new Error("X-Host-Final header is missing");
    }
    return proxy(request, env);
  } else if (token === env.ACCESS_TOKEN) {
    console.log("Accessing master handler");
    return await handleAdminAction(action, params, request.method, env);
  }
  console.log("Error: Access forbidden");
  throw new Error("Access forbidden");
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
  const apiKey = await getAPIKey(host || "api.openai.com", env);

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

  const response = await fetch(url.toString(), {
    method: request.method,
    headers: headers,
    body: requestBody,
  });
  let corsHeaders = getCorsHeaders(
    request.headers.get("Origin") || env.ORIGIN_URL
  );
  response.headers.forEach((value, key) => corsHeaders.set(key, value));
  return new Response(await response.text(), { headers: corsHeaders });
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
 * 1- retrieve the existing keys
 * 2- if the key already exists it can be a simple string or a json string representing an array of keys
 * 3- if the key is a string, convert it to a json string representing an array of keys
 * 4- add the new key to the array only if it does not already exist
 * @param host - The host to associate with the API key.
 * @param key - The API key to add.
 * @param env - The environment object containing the KV namespace.
 * @returns A Promise that resolves when the key is added.
 */
async function addkey(host: string, key: string, env: Env): Promise<void> {
  if (!host || !key) throw "Invalid host or key";
  {
    let keys: string[] = [];
    const existingKeys = await env.KV_AI_PROXY.get(host);
    if (existingKeys) {
      keys = JSON.parse(existingKeys);
      if (!Array.isArray(keys)) keys = [keys];
    }
    if (keys.includes(key)) throw "Key already exists";
    keys.push(key);
    await env.KV_AI_PROXY.put(host, JSON.stringify(keys));
  }
}

/**
 * Retrieves a random API key for a specific host.
 * @param host - The host to retrieve the API key for.
 * @param env - The environment object containing the KV namespace.
 * @returns A Promise that resolves to the API key.
 */
async function getAPIKey(host: string, env: Env): Promise<string> {
  if (!host) throw "Invalid host";
  const keys = await env.KV_AI_PROXY.get(host);
  if (!keys) throw `No API key found for host ${host}`;
  const keyArray = JSON.parse(keys);
  return keyArray[Math.floor(Math.random() * keyArray.length)];
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

/**
 * Define a function to validate the username
 * @param username - The username to validate
 * @returns true if the username is valid
 */
function validateUsername(username: string) {
  const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/;
  if (!usernameRegex.test(username)) {
    throw new Error("Invalid username");
  }
  return true;
}

/**
 * Define a function to validate the Bearer header containing the API key
 * @param bearerToken the API key to validate (with the Bearer prefix)
 * @returns true if the API key is valid
 */
function validateBearerAPIKey(bearerToken: string) {
  const apiKeyRegex = /^Bearer [a-zA-Z0-9_-]{3,100}$/;
  if (!apiKeyRegex.test(bearerToken)) {
    throw new Error(`Invalid API key format: ${bearerToken}`);
  }
  return true;
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
    console.log(`request: ${JSON.stringify(request.headers, null, 2)}`);
    const { success } = await env.PROXY_RATE_LIMITER.limit({ key: "aipane" }); // key can be any string of your choosing
    if (!success) {
      return new Response(`429 Failure – rate limit exceeded for aipane`, {
        status: 429,
      });
    }

    return handleRequest(request, env).catch(
      (err) =>
        new Response(err || "Unknown reason", {
          status: 403,
          headers: { "X-Error": `${err || "Unknown reason"}` },
        })
    );
  },
};

/**
 * Cosntruct a minimal set of CORS headers
 * @param origin CORS origin
 * @returns a set of required
 */
export const getCorsHeaders = (origin: string | null): Headers => {
  const returnHeaders = new Headers();
  returnHeaders.set("Access-Control-Allow-Origin", origin || "*");
  returnHeaders.set("Access-Control-Allow-Credentials", "true");
  returnHeaders.set(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Content-Encoding, Accept, Authorization, X-Host-Final, x-stainless-arch, x-stainless-lang, x-stainless-os, x-stainless-package-version, x-stainless-runtime, x-stainless-runtime-version, User-Agent"
  );
  returnHeaders.set(
    "Access-Control-Allow-Methods",
    "OPTIONS, GET, POST, PATCH, PUT, DELETE"
  );
  returnHeaders.set("Via", `ai-proxy-cloudflare`);
  return returnHeaders;
};
