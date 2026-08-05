import { auth } from "../src/server/better-auth/config";
import { db } from "../src/server/db";
import fs from "fs";
import path from "path";

// Load .env manually if not already loaded (e.g. running outside of Next.js)
const envPath = path.resolve(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  const envFile = fs.readFileSync(envPath, "utf-8");
  envFile.split(/\r?\n/).forEach((line) => {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match) {
      const key = match[1];
      let value = match[2] || "";
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      } else if (value.startsWith("'") && value.endsWith("'")) {
        value = value.slice(1, -1);
      }
      if (key && !process.env[key]) {
        process.env[key] = value;
      }
    }
  });
}

const adminEmail = process.env.ADMIN_EMAIL;
const adminPassword = process.env.ADMIN_PASSWORD;

if (!adminEmail || !adminPassword) {
  console.error("ADMIN_EMAIL and ADMIN_PASSWORD must be set in environment variables or .env file.");
  process.exit(1);
}

// Since we checked above, we can assert these are non-null
const emailVal = adminEmail!;
const passwordVal = adminPassword!;

async function main() {
  console.log(`Checking if administrator already exists with email: ${emailVal}`);

  const existingUser = await db.user.findFirst({
    where: { email: emailVal },
  });

  if (existingUser) {
    console.log("Administrator already exists in database. Skipping seed.");
    return;
  }

  console.log("Seeding administrator...");
  try {
    // Step 1: Create user via Better Auth (core fields only for password hashing)
    const result = await auth.api.signUpEmail({
      body: {
        email: emailVal,
        password: passwordVal,
        name: "System Administrator",
      },
    });

    const newUserId = result?.user?.id;

    // Step 2: Set additional fields via Prisma
    if (newUserId) {
      await db.user.update({
        where: { id: newUserId },
        data: {
          role: "admin",
          status: "active",
          mustResetPassword: true,
        },
      });
    }

    console.log("Seeding completed successfully!");
    console.log("Created User ID:", newUserId);
  } catch (error) {
    console.error("Error seeding administrator:", error);
    process.exit(1);
  }
}

main()
  .then(async () => {
    await db.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await db.$disconnect();
    process.exit(1);
  });
