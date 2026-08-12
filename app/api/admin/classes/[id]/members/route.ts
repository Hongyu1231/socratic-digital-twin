import { requireAdmin } from "@/lib/auth";
import { errorResponse } from "@/lib/http";
import { getRepository } from "@/lib/repository";
import { classMembersSchema } from "@/lib/schemas";

export const runtime = "nodejs";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const body = await request.json() as { members?: Array<{ userId?: string; isLead?: boolean }>; userIds?: string[]; leadProfessorId?: string };
    const users = await getRepository().listUsers();
    const ids = body.userIds ?? body.members?.map((item) => item.userId).filter((id): id is string => Boolean(id)) ?? [];
    const professors = ids.filter((id) => users.find((user) => user.id === id)?.role === "professor");
    const students = ids.filter((id) => users.find((user) => user.id === id)?.role === "student");
    const leadProfessorId = body.leadProfessorId ?? body.members?.find((item) => item.isLead)?.userId;
    const parsed = classMembersSchema.safeParse({ studentIds: students, professorIds: professors, leadProfessorId });
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid memberships." }, { status: 400 });
    const { id } = await params;
    const members = [...students.map((userId) => ({ classId: id, userId, role: "student" as const, isLead: false })), ...professors.map((userId) => ({ classId: id, userId, role: "professor" as const, isLead: userId === parsed.data.leadProfessorId }))];
    return Response.json({ teachingClass: await getRepository().setClassMembers(id, members) });
  } catch (error) { return errorResponse(error); }
}
