import { guardPage } from "@/lib/page-guard";

export default async function ProfessorLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await guardPage("professor");
  return children;
}
