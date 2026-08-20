import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "~/env";
import { PrismaClient } from "../../generated/prisma";

const pool = new Pool({
  connectionString: env.DATABASE_URL,
  ssl: env.DATABASE_URL.includes("sslmode=") || env.DATABASE_URL.includes("neon.tech")
    ? { rejectUnauthorized: false }
    : undefined,
});

const adapter = new PrismaPg(pool);

const createPrismaClient = () =>
  new PrismaClient({
    adapter,
    log:
      env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });

const globalForPrisma = globalThis as unknown as {
  prisma: ReturnType<typeof createPrismaClient> | undefined;
};

export const db = globalForPrisma.prisma ?? createPrismaClient();

if (env.NODE_ENV !== "production") globalForPrisma.prisma = db;

