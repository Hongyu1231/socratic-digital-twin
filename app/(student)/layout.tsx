import { guardPage } from "@/lib/page-guard";

export default async function StudentLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await guardPage("student");
  return children;
}
