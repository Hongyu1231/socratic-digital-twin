import { guardPage } from "@/lib/page-guard";

export default async function SessionLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await guardPage("student");
  return children;
}
