import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcrypt';
import { sha256 } from '../src/common/utils/crypto.util.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { Role } from '../src/generated/prisma/enums.js';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

async function main() {
  const email = required('PLATFORM_ADMIN_EMAIL').trim().toLowerCase();
  const name = required('PLATFORM_ADMIN_NAME');
  const password = required('PLATFORM_ADMIN_PASSWORD');

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: required('DATABASE_URL') }),
  });

  try {
    const existing = await prisma.user.findUnique({
      where: { email },
      include: { wallet: true },
    });

    // someone may have registered this email as a normal user:
    // never turn that account into the platform account
    if (existing && existing.role !== Role.ADMIN) {
      throw new Error(
        `The email ${email} already belongs to a non-admin user. Choose another PLATFORM_ADMIN_EMAIL.`,
      );
    }

    if (!existing) {
      // same hashing as AuthService, so the admin can log in
      const passwordHash = await bcrypt.hash(sha256(password, 'base64'), 12);
      await prisma.user.create({
        data: {
          name,
          email,
          passwordHash,
          role: Role.ADMIN,
          wallet: { create: {} },
        },
      });
      console.log(`Platform admin created: ${email}`);
    } else if (!existing.wallet) {
      await prisma.wallet.create({ data: { userId: existing.id } });
      console.log(`Wallet created for existing admin: ${email}`);
    } else {
      console.log(`Platform admin already exists: ${email}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});