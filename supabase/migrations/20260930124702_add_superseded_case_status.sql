-- Add the terminal-but-readable state used when a published case version is
-- replaced by a newer version.  Keep this migration separate from functions
-- and constraints that reference the new enum value: PostgreSQL does not
-- allow a newly-added enum value to be used until the ALTER TYPE transaction
-- commits.
alter type public.case_status add value if not exists 'superseded';
