import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  /**
   * Specify your server-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars.
   */
  server: {
    BETTER_AUTH_SECRET:
      process.env.NODE_ENV === "production"
        ? z.string()
        : z.string().optional(),
    WS_JWT_SECRET:
      process.env.NODE_ENV === "production"
        ? z.string().min(32, "WS_JWT_SECRET must be at least 32 characters")
        : z.string().optional(),
    // Required in production: this app's own public origin. It's the base
    // for Better Auth's baseURL/trustedOrigins and for the CORS allow-list
    // (buildAllowedOrigins) -- if unset, both silently fall back to
    // http://localhost:3000 in server/better-auth/config.ts, so a request
    // from the real production origin fails CORS/CSRF with an origin
    // mismatch instead of the app just refusing to boot.
    BETTER_AUTH_URL:
      process.env.NODE_ENV === "production"
        ? z.string().url()
        : z.string().url().optional(),
    // Required in production: podium's public origin. Without it, the CORS
    // allow-list and Better Auth's trustedOrigins drop podium entirely once
    // NODE_ENV=production (the local-dev-origins fallback that covers it
    // in development no longer applies), so every cross-origin call podium
    // makes to this app (uploads, /api/ws/token, /api/live-sessions,
    // checkin) fails CORS/CSRF.
    PODIUM_APP_URL:
      process.env.NODE_ENV === "production"
        ? z.string().url()
        : z.string().url().optional(),
    DATABASE_URL: z.string().url(),
    // Required in production: without these two, isS3Configured() is false
    // and every upload/download route silently 501s -- fail at boot, not
    // on the first real request. Credential vars stay optional below --
    // there are multiple legitimate ways to supply them (static keys,
    // S3_ALLOW_ANONYMOUS_PUT, or the AWS SDK's default credential chain
    // via an IAM role), so requiring one specific mode here would be wrong.
    S3_ENDPOINT:
      process.env.NODE_ENV === "production"
        ? z.string().url()
        : z.string().url().optional(),
    S3_REGION: z.string().optional(),
    S3_BUCKET:
      process.env.NODE_ENV === "production"
        ? z.string().min(1)
        : z.string().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    S3_FORCE_PATH_STYLE: z.enum(["true", "false"]).optional(),
    S3_PUBLIC_BASE_URL: z.string().url().optional(),
    S3_ALLOW_ANONYMOUS_PUT: z.enum(["true", "false"]).optional(),
    // Number of trusted reverse proxies (nginx, ALB, Cloudflare, ...) sitting
    // in front of this process. X-Forwarded-For is otherwise a plain client-
    // supplied header that anyone can forge to spoof the audit trail or
    // bypass the checkin-upload rate limiter, so extractIp() only trusts it
    // up to this many hops. Set to 0 if the app is ever exposed directly.
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(1),
    // Comma-separated list of allowed origins (e.g. "https://conference.devorbit.cloud,http://localhost:3000,http://localhost:5173")
    ALLOWED_ORIGINS: z.string().optional(),
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
  },

  /**
   * Specify your client-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars. To expose them to the client, prefix them with
   * `NEXT_PUBLIC_`.
   */
  client: {
    NEXT_PUBLIC_WS_URL: z.string().optional(),
  },

  /**
   * You can't destruct `process.env` as a regular object in the Next.js edge runtimes (e.g.
   * middlewares) or client-side so we need to destruct manually.
   */
  runtimeEnv: {
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    WS_JWT_SECRET: process.env.WS_JWT_SECRET,
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    PODIUM_APP_URL: process.env.PODIUM_APP_URL,
    DATABASE_URL: process.env.DATABASE_URL,
    S3_ENDPOINT: process.env.S3_ENDPOINT,
    S3_REGION: process.env.S3_REGION,
    S3_BUCKET: process.env.S3_BUCKET,
    S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY,
    S3_FORCE_PATH_STYLE: process.env.S3_FORCE_PATH_STYLE,
    S3_PUBLIC_BASE_URL: process.env.S3_PUBLIC_BASE_URL,
    S3_ALLOW_ANONYMOUS_PUT: process.env.S3_ALLOW_ANONYMOUS_PUT,
    TRUST_PROXY_HOPS: process.env.TRUST_PROXY_HOPS,
    ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS,
    NODE_ENV: process.env.NODE_ENV,
    NEXT_PUBLIC_WS_URL: process.env.NEXT_PUBLIC_WS_URL,
  },
  /**
   * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially
   * useful for Docker builds.
   */
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  /**
   * Makes it so that empty strings are treated as undefined. `SOME_VAR: z.string()` and
   * `SOME_VAR=''` will throw an error.
   */
  emptyStringAsUndefined: true,
});
