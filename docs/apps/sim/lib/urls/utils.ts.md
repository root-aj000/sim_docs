```typescript
import { getEnv } from '@/lib/env'
import { isProd } from '@/lib/environment'

/**
 * Returns the base URL of the application from NEXT_PUBLIC_APP_URL
 * This ensures webhooks, callbacks, and other integrations always use the correct public URL
 * @returns The base URL string (e.g., 'http://localhost:3000' or 'https://example.com')
 * @throws Error if NEXT_PUBLIC_APP_URL is not configured
 */
export function getBaseUrl(): string {
  const baseUrl = getEnv('NEXT_PUBLIC_APP_URL')

  if (!baseUrl) {
    throw new Error(
      'NEXT_PUBLIC_APP_URL must be configured for webhooks and callbacks to work correctly'
    )
  }

  if (baseUrl.startsWith('http://') || baseUrl.startsWith('https://')) {
    return baseUrl
  }

  const protocol = isProd ? 'https://' : 'http://'
  return `${protocol}${baseUrl}`
}

/**
 * Returns just the domain and port part of the application URL
 * @returns The domain with port if applicable (e.g., 'localhost:3000' or 'sim.ai')
 */
export function getBaseDomain(): string {
  try {
    const url = new URL(getBaseUrl())
    return url.host // host includes port if specified
  } catch (_e) {
    const fallbackUrl = getEnv('NEXT_PUBLIC_APP_URL') || 'http://localhost:3000'
    try {
      return new URL(fallbackUrl).host
    } catch {
      return isProd ? 'sim.ai' : 'localhost:3000'
    }
  }
}

/**
 * Returns the domain for email addresses, stripping www subdomain for Resend compatibility
 * @returns The email domain (e.g., 'sim.ai' instead of 'www.sim.ai')
 */
export function getEmailDomain(): string {
  try {
    const baseDomain = getBaseDomain()
    return baseDomain.startsWith('www.') ? baseDomain.substring(4) : baseDomain
  } catch (_e) {
    return isProd ? 'sim.ai' : 'localhost:3000'
  }
}
```

## Explanation of the Code

This TypeScript file defines a set of utility functions to determine the application's base URL and domain.  These functions are crucial for applications that need to dynamically construct URLs for webhooks, API calls, email sending, and other integrations, especially when running in different environments (development vs. production).

**1. Imports:**

```typescript
import { getEnv } from '@/lib/env'
import { isProd } from '@/lib/environment'
```

-   `import { getEnv } from '@/lib/env'`: This line imports a function named `getEnv` from a module located at the path `@/lib/env`.  It's assumed that `getEnv` is responsible for retrieving environment variables.  The `@` alias typically points to the project's root directory.
-   `import { isProd } from '@/lib/environment'`: This line imports a function named `isProd` from the module located at `@/lib/environment`. The `isProd` function likely returns a boolean value indicating whether the application is running in a production environment.

**2. `getBaseUrl()` Function:**

```typescript
/**
 * Returns the base URL of the application from NEXT_PUBLIC_APP_URL
 * This ensures webhooks, callbacks, and other integrations always use the correct public URL
 * @returns The base URL string (e.g., 'http://localhost:3000' or 'https://example.com')
 * @throws Error if NEXT_PUBLIC_APP_URL is not configured
 */
export function getBaseUrl(): string {
  const baseUrl = getEnv('NEXT_PUBLIC_APP_URL')

  if (!baseUrl) {
    throw new Error(
      'NEXT_PUBLIC_APP_URL must be configured for webhooks and callbacks to work correctly'
    )
  }

  if (baseUrl.startsWith('http://') || baseUrl.startsWith('https://')) {
    return baseUrl
  }

  const protocol = isProd ? 'https://' : 'http://'
  return `${protocol}${baseUrl}`
}
```

-   **Purpose:** This function is the primary function for determining the base URL of the application. The base URL is the root URL where your application is accessible (e.g., `https://example.com` or `http://localhost:3000`). This is important for constructing complete URLs needed for redirects, API calls, and other interactions.

-   **Logic:**

    1.  `const baseUrl = getEnv('NEXT_PUBLIC_APP_URL')`:  This line retrieves the value of the environment variable `NEXT_PUBLIC_APP_URL` using the `getEnv` function.  Environment variables are often used to configure applications differently in various environments (development, staging, production).  The `NEXT_PUBLIC_` prefix suggests that this variable is intended to be exposed to the client-side code.

    2.  `if (!baseUrl)`:  This `if` statement checks if the `baseUrl` is empty or null.  If `NEXT_PUBLIC_APP_URL` is not defined, `getEnv` will likely return `null` or `undefined`, causing this condition to be true.

    3.  `throw new Error(...)`: If the `baseUrl` is missing, an error is thrown. This is critical because the application cannot function correctly without knowing its base URL.  The error message clearly explains the problem and its impact.

    4. `if (baseUrl.startsWith('http://') || baseUrl.startsWith('https://')) { return baseUrl }`: This conditional checks if the `baseUrl` already includes the protocol (http or https). If it does, it means the environment variable is fully qualified and can be used as is.

    5.  `const protocol = isProd ? 'https://' : 'http://'`: This line determines the appropriate protocol based on the environment.  If the application is running in production (`isProd` returns `true`), it uses `https://`; otherwise (in development), it uses `http://`.

    6.  `return `${protocol}${baseUrl}``:  Finally, it constructs the full base URL by combining the determined `protocol` with the `baseUrl` obtained from the environment variable and returns it.  This ensures that the base URL always has a protocol, even if it wasn't explicitly provided in the environment variable.

**3. `getBaseDomain()` Function:**

```typescript
/**
 * Returns just the domain and port part of the application URL
 * @returns The domain with port if applicable (e.g., 'localhost:3000' or 'sim.ai')
 */
export function getBaseDomain(): string {
  try {
    const url = new URL(getBaseUrl())
    return url.host // host includes port if specified
  } catch (_e) {
    const fallbackUrl = getEnv('NEXT_PUBLIC_APP_URL') || 'http://localhost:3000'
    try {
      return new URL(fallbackUrl).host
    } catch {
      return isProd ? 'sim.ai' : 'localhost:3000'
    }
  }
}
```

-   **Purpose:** This function extracts the domain (and port, if specified) from the base URL.  This is useful when you only need the domain part of the URL, for example, when setting cookies or creating links within the same domain.

-   **Logic:**

    1.  `try { ... } catch (_e) { ... }`:  This is a `try...catch` block to handle potential errors during URL parsing. This is important because the `getBaseUrl()` function might return an invalid URL, or the `NEXT_PUBLIC_APP_URL` environment variable could be malformed.

    2.  `const url = new URL(getBaseUrl())`:  This line attempts to create a `URL` object from the base URL obtained by calling `getBaseUrl()`.  The `URL` constructor parses the URL string into its components (protocol, host, path, etc.).

    3.  `return url.host`: If the `URL` is successfully created, this line returns the `host` property of the `URL` object.  The `host` property contains the domain name and the port number (if explicitly specified in the URL).

    4.  `const fallbackUrl = getEnv('NEXT_PUBLIC_APP_URL') || 'http://localhost:3000'`: Inside the `catch` block, this line defines a fallback URL. First, it attempts to retrieve the `NEXT_PUBLIC_APP_URL` environment variable. If this variable is not defined (or is empty), it defaults to `http://localhost:3000`.

    5.  `try { return new URL(fallbackUrl).host } catch { ... }`: Another `try...catch` block is used here. It attempts to create a `URL` object from the `fallbackUrl` and return its `host`. If even the `fallbackUrl` parsing fails (very unlikely, but possible if `localhost:3000` is somehow invalid), the inner `catch` block is executed.

    6.  `return isProd ? 'sim.ai' : 'localhost:3000'`: If both the original `getBaseUrl()` and the parsing of the `fallbackUrl` fail, this line provides a final fallback.  It returns `'sim.ai'` in production and `'localhost:3000'` in development.  This is a last-resort default, ensuring that the function always returns a value, even in the face of configuration errors.

**4. `getEmailDomain()` Function:**

```typescript
/**
 * Returns the domain for email addresses, stripping www subdomain for Resend compatibility
 * @returns The email domain (e.g., 'sim.ai' instead of 'www.sim.ai')
 */
export function getEmailDomain(): string {
  try {
    const baseDomain = getBaseDomain()
    return baseDomain.startsWith('www.') ? baseDomain.substring(4) : baseDomain
  } catch (_e) {
    return isProd ? 'sim.ai' : 'localhost:3000'
  }
}
```

-   **Purpose:** This function returns the domain name suitable for use in email addresses.  It specifically handles the common case where the domain might have a `www.` subdomain and removes it, as some email sending services (like Resend, according to the comment) might require the domain without the `www.` prefix.

-   **Logic:**

    1.  `try { ... } catch (_e) { ... }`: A `try...catch` block to handle potential errors when retrieving the base domain.

    2.  `const baseDomain = getBaseDomain()`:  This line calls `getBaseDomain()` to get the base domain (e.g., `example.com` or `www.example.com`).

    3.  `return baseDomain.startsWith('www.') ? baseDomain.substring(4) : baseDomain`:  This line checks if the `baseDomain` starts with `www.`.
        -   If it does, it uses the `substring(4)` method to extract the part of the string *after* the `www.` (removing the `www.` prefix).
        -   If it doesn't, it simply returns the original `baseDomain`. This uses a ternary operator for concise conditional logic.

    4.  `return isProd ? 'sim.ai' : 'localhost:3000'`: The `catch` block returns a default domain, similar to `getBaseDomain()`.  If an error occurs while getting the base domain (e.g., `getBaseDomain()` throws an error), it returns `'sim.ai'` in production and `'localhost:3000'` in development.  This ensures a fallback value is always provided, even if the configuration is invalid.

**Summary and Key Considerations:**

*   **Environment Variables:**  The code heavily relies on the `NEXT_PUBLIC_APP_URL` environment variable. Proper configuration of this variable is essential for the application to work correctly in different environments.

*   **Error Handling:**  The functions include robust error handling using `try...catch` blocks and meaningful error messages.  This makes the code more resilient to configuration issues.

*   **Production vs. Development:** The `isProd` function is used to differentiate between production and development environments, allowing the functions to return appropriate values for each environment (e.g., using `https` in production and `http` in development, or using different default domains).

*   **URL Parsing:** The `URL` object is used to parse and manipulate URLs, providing a convenient way to extract the domain and other components.

*   **Resend Compatibility:**  The `getEmailDomain` function specifically addresses a compatibility issue with the Resend email sending service, highlighting the importance of understanding the requirements of external services.

*   **Code Clarity:** The functions are well-documented with JSDoc comments, explaining their purpose, parameters, and return values.  This makes the code easier to understand and maintain.

This detailed explanation should provide a comprehensive understanding of the code's functionality and purpose.  It highlights the key concepts, logic, and error handling strategies used in the functions.
