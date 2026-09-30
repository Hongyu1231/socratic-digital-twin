import { z } from "zod";

const staffQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(25),
  cursor: z.string().min(1).max(400).optional(),
  classId: z.string().uuid().optional(),
  reviewFilter: z.enum(["all", "available", "mine", "claimed", "completed"]).default("all"),
});

export function staffQueryInput(request: Request) {
  const params = new URL(request.url).searchParams;
  return staffQuerySchema.safeParse(Object.fromEntries(
    ["limit", "cursor", "classId", "reviewFilter"].flatMap((name) => params.has(name) ? [[name, params.get(name)]] : []),
  ));
}
