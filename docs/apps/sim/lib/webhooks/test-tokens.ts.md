## Detailed Explanation of the TypeScript Code for JWT Management

This file provides utility functions for creating and verifying JSON Web Tokens (JWTs) specifically designed for testing webhooks. These tokens are used to authenticate and authorize requests to test webhook endpoints, ensuring that the requests are legitimate and originate from a trusted source within the system. Let's break down the code line by line:

**1. Imports:**

```typescript
import { jwtVerify, SignJWT } from 'jose'
import { env } from '@/lib/env'
```

*   `import { jwtVerify, SignJWT } from 'jose'`: This line imports two key functions from the `jose` library, which is a popular JavaScript library for working with JWTs and other cryptographic standards.
    *   `SignJWT`:  A class used to construct and sign JWTs.
    *   `jwtVerify`:  A function used to verify the signature and claims of a JWT.
*   `import { env } from '@/lib/env'`:  This imports the `env` object from a module located at `'@/lib/env'`.  This module is assumed to contain environment variables used by the application.  Critically, it's expected to hold a secret key for signing and verifying the JWTs.

**2. Defining the Payload Type:**

```typescript
type TestTokenPayload = {
  typ: 'webhook_test'
  wid: string
}
```

*   `type TestTokenPayload = { ... }`:  This defines a TypeScript type alias named `TestTokenPayload`. This type describes the structure of the payload that will be embedded within the JWT.  Using a type ensures that the token contains the expected data.
*   `typ: 'webhook_test'`:  This field, named `typ`, represents the "type" of the token.  It's set to the string literal `'webhook_test'`, indicating that this token is specifically for webhook testing purposes.  This allows for easy identification and differentiation from other types of JWTs that might be used in the application.
*   `wid: string`: This field, named `wid`, represents the "webhook ID". It's a string that uniquely identifies the webhook being tested.  This ID is used to ensure that the token is valid for the intended webhook.

**3.  `getSecretKey` Function:**

```typescript
const getSecretKey = () => new TextEncoder().encode(env.INTERNAL_API_SECRET)
```

*   `const getSecretKey = () => ...`: This defines a function named `getSecretKey`. This function is responsible for retrieving and encoding the secret key used to sign and verify the JWTs.
*   `new TextEncoder().encode(env.INTERNAL_API_SECRET)`:  This part performs two key operations:
    *   `env.INTERNAL_API_SECRET`: It accesses the `INTERNAL_API_SECRET` property from the `env` object (imported earlier). This environment variable should hold a strong, randomly generated secret key.  **Important**: This secret key should be securely stored and never exposed in client-side code or committed to version control.
    *   `new TextEncoder().encode(...)`: It uses the `TextEncoder` API to convert the secret key string into a `Uint8Array`, which is the format required by the `jose` library for cryptographic operations. Encoding the secret ensures that it is handled correctly as a sequence of bytes.

**4. `signTestWebhookToken` Function:**

```typescript
export async function signTestWebhookToken(webhookId: string, ttlSeconds: number): Promise<string> {
  const secret = getSecretKey()
  const payload: TestTokenPayload = { typ: 'webhook_test', wid: webhookId }

  const token = await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .setIssuer('sim-webhooks')
    .setAudience('sim-test')
    .sign(secret)

  return token
}
```

*   `export async function signTestWebhookToken(webhookId: string, ttlSeconds: number): Promise<string> { ... }`: This defines an asynchronous function named `signTestWebhookToken`. This function is responsible for creating and signing a JWT for a specific webhook. It takes two arguments:
    *   `webhookId: string`: The ID of the webhook for which the token is being generated.
    *   `ttlSeconds: number`: The time-to-live (TTL) of the token, in seconds. This determines how long the token will be valid.
    *   `Promise<string>`: The function returns a Promise that resolves to a string, which is the signed JWT.

*   `const secret = getSecretKey()`: It calls the `getSecretKey` function to retrieve the secret key.

*   `const payload: TestTokenPayload = { typ: 'webhook_test', wid: webhookId }`: It creates the payload object, setting the `typ` to `'webhook_test'` and the `wid` to the provided `webhookId`.  This payload will be included in the JWT.

*   `const token = await new SignJWT(payload) ... .sign(secret)`: This is the core JWT creation logic.  It uses the `SignJWT` class from the `jose` library to construct the token.  The method chaining allows for setting various claims and headers:
    *   `new SignJWT(payload)`: Creates a new `SignJWT` instance with the specified payload.
    *   `.setProtectedHeader({ alg: 'HS256' })`: Sets the protected header of the JWT.  The `alg` property specifies the signing algorithm, in this case, `HS256` (HMAC SHA-256). This is a symmetric algorithm, meaning the same secret key is used for signing and verification.
    *   `.setIssuedAt()`: Sets the `iat` (issued at) claim, indicating the time at which the token was issued.
    *   `.setExpirationTime(\`${ttlSeconds}s\`)`: Sets the `exp` (expiration time) claim, indicating when the token will expire.  The value is calculated by adding the `ttlSeconds` to the current time.  The `jose` library expects a string with a unit (e.g., '30s', '1h', '1d').
    *   `.setIssuer('sim-webhooks')`: Sets the `iss` (issuer) claim, identifying the entity that issued the token.  In this case, it's set to `'sim-webhooks'`.
    *   `.setAudience('sim-test')`: Sets the `aud` (audience) claim, identifying the intended recipient(s) of the token.  In this case, it's set to `'sim-test'`.
    *   `.sign(secret)`: Signs the JWT using the provided `secret` key.  This creates the signature that ensures the integrity and authenticity of the token.

*   `return token`:  The function returns the fully constructed and signed JWT as a string.

**5. `verifyTestWebhookToken` Function:**

```typescript
export async function verifyTestWebhookToken(
  token: string,
  expectedWebhookId: string
): Promise<boolean> {
  try {
    const secret = getSecretKey()
    const { payload } = await jwtVerify(token, secret, {
      issuer: 'sim-webhooks',
      audience: 'sim-test',
    })

    if (
      payload &&
      (payload as any).typ === 'webhook_test' &&
      (payload as any).wid === expectedWebhookId
    ) {
      return true
    }
    return false
  } catch (_e) {
    return false
  }
}
```

*   `export async function verifyTestWebhookToken(token: string, expectedWebhookId: string): Promise<boolean> { ... }`: This defines an asynchronous function named `verifyTestWebhookToken`. This function is responsible for verifying a JWT and ensuring that it's valid for a specific webhook. It takes two arguments:
    *   `token: string`: The JWT string to be verified.
    *   `expectedWebhookId: string`: The expected webhook ID that the token should be associated with.
    *   `Promise<boolean>`: The function returns a Promise that resolves to a boolean, indicating whether the token is valid (true) or invalid (false).

*   `try { ... } catch (_e) { ... }`: This `try...catch` block handles potential errors during the verification process. If any error occurs (e.g., invalid signature, expired token), the `catch` block will be executed, and the function will return `false`.

*   `const secret = getSecretKey()`: It retrieves the secret key using the `getSecretKey` function.

*   `const { payload } = await jwtVerify(token, secret, { issuer: 'sim-webhooks', audience: 'sim-test' })`:  This is the core JWT verification logic. It uses the `jwtVerify` function from the `jose` library to verify the token:
    *   `jwtVerify(token, secret, { issuer: 'sim-webhooks', audience: 'sim-test' })`: It calls `jwtVerify` with the `token`, `secret`, and an options object.
        *   `token`: The JWT string to verify.
        *   `secret`: The secret key used to sign the token.
        *   `{ issuer: 'sim-webhooks', audience: 'sim-test' }`: An options object that specifies the expected `issuer` and `audience` claims.  This ensures that the token was issued by the expected entity and is intended for the correct recipient.  The `jwtVerify` function will automatically verify the signature and these claims.  If any of these checks fail, it will throw an error.
    *   `const { payload } = await ...`: It destructures the result of `jwtVerify` to extract the `payload` from the verified token.

*   `if (payload && (payload as any).typ === 'webhook_test' && (payload as any).wid === expectedWebhookId) { return true }`: This `if` statement performs additional checks on the payload to ensure that it's a valid test webhook token and that it's associated with the correct webhook ID:
    *   `payload`: Checks if the payload exists.
    *   `(payload as any).typ === 'webhook_test'`: Checks if the `typ` claim in the payload is equal to `'webhook_test'`. The `as any` is used because TypeScript might not be able to infer the type of the payload directly. However, consider using a type assertion to `TestTokenPayload` to ensure type safety.
    *   `(payload as any).wid === expectedWebhookId`: Checks if the `wid` claim in the payload is equal to the `expectedWebhookId`.  Again, `as any` is used for type assertion.
    *   If all of these conditions are true, the function returns `true`, indicating that the token is valid.

*   `return false`: If any of the checks in the `if` statement fail, or if an error occurs during verification, the function returns `false`, indicating that the token is invalid.

*   `catch (_e) { return false }`: If any error occurs during the token verification process, this catch block will execute and return false. This handles cases where the token is malformed, expired, or has an invalid signature.

### Summary

This code provides a secure and robust way to generate and verify JWTs for testing webhooks. It leverages the `jose` library for cryptographic operations, uses environment variables for secure key management, and includes thorough checks to ensure that tokens are valid and intended for the correct webhook.  The explicit type definitions and error handling contribute to the reliability and maintainability of the code.
