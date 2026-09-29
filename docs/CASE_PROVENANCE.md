# Original teaching-case provenance

Verified 2026-09-12. Case lineage (`source_case_id` / `sourceCaseId`) is not a document-provenance field; a null value does not establish that a case lacks a source.

| Case | Source evidence | Decision |
| --- | --- | --- |
| Impacted Maxillary Canine (`33333333-3333-4333-8333-333333333333`) | `Socratic_script_impacted_canines (5Aug26).docx`, NUS Faculty of Dentistry, August 2026, **Clinical Case** section. The 12-year-old, unerupted upper-right permanent canine, retained primary canine, Class I relationship and mild upper crowding match the seeded narrative. | Keep unchanged. |
| Impacted Mandibular Second Molar (`33333333-3333-4333-8333-333333333337`) | `Socratic_script_impacted second molars (5Aug26).docx`, companion NUS script, **Clinical Case** section. The 14-year-old, lower-right second molar, approximately 40-degree mesial inclination, first-molar contact, three-quarters root development and developing third-molar bud match the seeded narrative. | Keep unchanged. |
| Acute Posterior Tooth Pain (`33333333-3333-4333-8333-333333333334`) | Introduced as an additional text-only teaching simulation in commit `cd25228` / migration `20260813131710_add_demo_clinical_cases.sql`. No corresponding source document or citation was identified in the supplied materials or original task records. | Archived from the teaching catalogue; retain existing case/session history. |

The original Word files were located in the local sibling `Socratic Tutors` materials directory (plural), not the `Socratic Tutor` repository. Earlier project task attachment records independently identify both filenames. The source files themselves are not copied into this public repository.

Source file SHA-256 checksums:

- Canine script: `f1e2367cd87e6efb805afc375483a978e7460e49961e2c4611c7c11c9da407b3`
- Second-molar script: `d9820798a3e652d0f601d93d95e54ecc439436650360ffca93c4d51b4ae2365c`

## Missing media is a separate issue

Both retained scripts are document-backed, but the active old case versions still have no attached radiographs. Their source provenance does not imply that the referenced images are available. Do not substitute images from imported Case 1–3 or another literature patient, and do not claim image-dependent teaching acceptance until matching media is attached.

## Retirement behaviour

The acute-tooth-pain case is archived, not hard-deleted. The existing archive transaction closes its open assignments and excludes it from student offerings while preserving historical sessions. The memory seed also marks its assignment closed, and `supabase/seed.sql` reapplies the retirement only to its exact id/title/slug during future seeding. The two documented scripts and the three recently imported canine cases are not changed by this retirement.
