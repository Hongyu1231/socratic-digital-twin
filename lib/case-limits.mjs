/**
 * Shared limits for authored cases and their media metadata.
 *
 * Keep this module dependency-free so both the TypeScript runtime and the
 * Node-based teaching-material publisher use exactly the same contract.
 */
export const CASE_TITLE_MAX_LENGTH = 160;
export const CASE_DESCRIPTION_MAX_LENGTH = 2000;
export const MEDIA_URL_MAX_LENGTH = 2048;

