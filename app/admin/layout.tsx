import { guardPage } from "@/lib/page-guard";

export default async function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await guardPage("admin");
  return children;
}
