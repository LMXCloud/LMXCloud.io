import { createClerkClient, verifyToken } from "@clerk/backend";

export interface ClerkUserInfo {
  userId: string;
  email: string;
}

export async function resolveClerkUser(
  secretKey: string,
  token: string,
): Promise<ClerkUserInfo> {
  const payload = await verifyToken(token, { secretKey });
  if (!payload?.sub) {
    throw new Error("Invalid Clerk token");
  }

  const clerk = createClerkClient({ secretKey });
  const user = await clerk.users.getUser(payload.sub);
  const email =
    user.primaryEmailAddress?.emailAddress ??
    user.emailAddresses[0]?.emailAddress;

  if (!email) {
    throw new Error("Clerk user has no email address");
  }

  return { userId: payload.sub, email };
}
