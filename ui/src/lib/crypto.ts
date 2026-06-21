// MIT License
// Copyright (c) 2024-2026 Ronan Le Meillat - SCTG Development
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
/**
 * @file Encryption/Decryption utilities compatible with OpenSSL -aes-256-cbc.
 * Matches the logic in src/lib/ai-enc.ts.
 */

/**
 * Encrypts a string using PBKDF2 and AES-256-CBC, compatible with OpenSSL "Salted__" format.
 *
 * @param plaintext The string to encrypt.
 * @param password The password for derivation.
 * @returns Base64 encoded ciphertext with "Salted__" header.
 */
export async function encryptVault(plaintext: string, password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(plaintext);
  const passwordBytes = encoder.encode(password);

  // Generate a random 8-byte salt
  const salt = crypto.getRandomValues(new Uint8Array(8));

  // PBKDF2 derivation
  const baseKey = await crypto.subtle.importKey(
    'raw',
    passwordBytes,
    'PBKDF2',
    false,
    ['deriveBits']
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: salt,
      iterations: 100_000
    },
    baseKey,
    384 // 256 for key + 128 for IV
  );

  const keyBytes = derivedBits.slice(0, 32);
  const ivBytes = derivedBits.slice(32, 48);

  const aesKey = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    'AES-CBC',
    false,
    ['encrypt']
  );

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-CBC', iv: ivBytes },
    aesKey,
    data
  );

  // Construct OpenSSL format: "Salted__" + salt + ciphertext
  const saltedHeader = encoder.encode('Salted__');
  const result = new Uint8Array(saltedHeader.length + salt.length + encrypted.byteLength);
  result.set(saltedHeader, 0);
  result.set(salt, saltedHeader.length);
  result.set(new Uint8Array(encrypted), saltedHeader.length + salt.length);

  // Convert to Base64
  return btoa(String.fromCharCode(...result));
}

/**
 * Decrypts ai.json.enc encrypted with OpenSSL aes-256-cbc format.
 * Matches the logic in src/lib/ai-enc.ts decryptAiConfig function.
 *
 * @param base64Ciphertext Base64 encoded ciphertext with "Salted__" header.
 * @param password The password for decryption.
 * @returns Decrypted string.
 * @throws Error if decryption fails or format is invalid.
 */
export async function decryptAiConfig(
  base64Ciphertext: string,
  password: string,
): Promise<string> {
  const raw = Uint8Array.from(atob(base64Ciphertext.trim()), c => c.charCodeAt(0));

  if (new TextDecoder().decode(raw.slice(0, 8)) !== 'Salted__') {
    throw new Error(
      'ai.json.enc: invalid format — expected OpenSSL "Salted__" header. ' +
      'Ensure file was encrypted with -a flag.',
    );
  }

  const salt = raw.slice(8, 16);
  const ciphertext = raw.slice(16);

  const pwBytes = new TextEncoder().encode(password);
  const baseKey = await crypto.subtle.importKey('raw', pwBytes, 'PBKDF2', false, ['deriveBits']);
  const derived = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100_000 },
      baseKey,
      384,
    ),
  );

  const aesKey = await crypto.subtle.importKey(
    'raw',
    derived.slice(0, 32),
    'AES-CBC',
    false,
    ['decrypt'],
  );

  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-CBC', iv: derived.slice(32, 48) },
    aesKey,
    ciphertext,
  );

  return new TextDecoder().decode(plaintext);
}

