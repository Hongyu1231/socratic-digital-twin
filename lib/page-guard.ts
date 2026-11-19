import { redirect } from "next/navigation";

import { getIdentity, type DemoIdentity } from "@/lib/auth";
import { pageGuardRedirect, type PageArea } from "@/lib/sign-in";

/** Server-side page guard for layouts: redirects anyone who may not see this area. */
export async function guardPage(area: PageArea): Promise<DemoIdentity> {
  let identity: DemoIdentity | null = null;
  try {
    identity = await getIdentity();
  } catch {
    identity = null;
  }
  const target = pageGuardRedirect(area, identity?.role);
  if (target || !identity) redirect(target ?? "/login");
  return identity;
}
