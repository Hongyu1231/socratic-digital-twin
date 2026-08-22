# ADR-001: Lock the POC Tutor Provider and Model

- Status: Accepted
- Date: 2026-08-18

## Context

The original implementation preferred OpenAI whenever an OpenAI key/model pair was present, then selected Claude when OpenAI was absent. That ordering was deliberate in code, but the repository contained no decision record explaining a clinical, evaluation, or budget rationale. It therefore did not document the POC agreement to evaluate one fixed model, and a deployment could change provider merely by changing which credentials were present.

Prof. Lek has also mentioned an available Claude budget. The exact provider and model ID still require the project owner's deployment decision; this ADR does not invent that choice.

## Decision

Every POC deployment must set exactly one `TUTOR_PROVIDER`: `openai`, `claude`, or `deterministic`. A network provider also requires its matching key and exact model environment variable. Tutor evaluation and session-summary generation use the same locked provider. They never switch from OpenAI to Claude, or from Claude to OpenAI, during a session.

If one live request fails, the deterministic safety tutor handles that turn. The evaluation records `fallbackFrom`, and the student sees a disclosure that the live provider was unavailable. This safety fallback is not treated as evidence from the locked model and must be separated in evaluation analysis.

The deployment owner must record the selected provider, exact model ID, prompt version and effective date in deployment configuration/change control before the POC evaluation begins. If Prof. Lek's Claude budget is the deciding constraint, set `TUTOR_PROVIDER=claude` and record the approved `CLAUDE_MODEL`; otherwise document the approved OpenAI model in the same way.

## Consequences

- Results are attributable to one provider/model instead of an implicit preference chain.
- Changing the provider or model is an explicit POC configuration change.
- Credential mistakes fail clearly at startup/request selection instead of silently activating another live provider.
- Deterministic fallback remains available but is visible and auditable per turn.
