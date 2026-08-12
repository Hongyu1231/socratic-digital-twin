import { InMemoryTutorRepository } from "@/lib/repository/memory";
import { SupabaseTutorRepository } from "@/lib/repository/supabase";
import type { TutorRepository } from "@/lib/repository/types";

let repository: TutorRepository | undefined;

export function getRepository(): TutorRepository {
  if (repository) return repository;
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  repository = process.env.FORCE_MEMORY_REPOSITORY === "true"
    ? new InMemoryTutorRepository()
    : url && serviceRoleKey
    ? new SupabaseTutorRepository(url, serviceRoleKey)
    : new InMemoryTutorRepository();
  return repository;
}

export function resetRepositoryForTests(next?: TutorRepository) {
  repository = next;
}

export type { TutorRepository } from "@/lib/repository/types";
