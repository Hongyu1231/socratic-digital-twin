import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { SessionBundle } from "@/lib/domain";
import type {
  ActiveTutorExperiment,
  ApprovalDecision,
  CandidatePrediction,
  EvalRun,
  ExperimentMode,
  FacultyApproval,
  FrozenDataset,
  FrozenTutorSample,
  HumanizationExperiment,
  HumanizationOverview,
  TutorCandidate,
  TutorRelease,
} from "@/lib/experiments/types";
import {
  buildFrozenSamples,
  canonicalHash,
  computeCandidateRun,
  deidentifiedDatasetName,
  deterministicExperimentArm,
} from "@/lib/experiments/core";

export interface HumanizationStore {
  overview(): Promise<HumanizationOverview>;
  createDataset(input: { name: string; actorId: string; sessions: SessionBundle[] }): Promise<FrozenDataset>;
  createCandidate(input: { name: string; provider: TutorCandidate["provider"]; model: string; promptVersion: string; instructions: string; actorId: string }): Promise<TutorCandidate>;
  runEvaluation(input: { datasetId: string; candidateId: string; actorId: string }): Promise<EvalRun>;
  createExperiment(input: { name: string; evalRunId: string; mode: ExperimentMode; trafficPercent: number; actorId: string }): Promise<HumanizationExperiment>;
  pauseExperiment(experimentId: string): Promise<HumanizationExperiment>;
  approvalReadyRunIds(): Promise<string[]>;
  approve(input: { evalRunId: string; professorId: string; decision: ApprovalDecision; notes: string; professorName?: string }): Promise<FacultyApproval>;
  release(input: { evalRunId: string; actorId: string; trafficPercent: number; releaseNotes: string }): Promise<TutorRelease>;
  rollback(input: { releaseId: string; actorId: string; reason: string }): Promise<TutorRelease>;
  activeExperiment(sessionId: string): Promise<(ActiveTutorExperiment & { arm: "baseline" | "candidate" }) | null>;
  saveShadowResult(input: { experimentId: string; turnKey: string; arm: "baseline" | "candidate"; baselineOutput: unknown; candidateOutput: unknown; safetyPassed: boolean }): Promise<void>;
}

type InternalDataset = FrozenDataset & { entries: FrozenTutorSample[] };
type InternalRun = EvalRun & { predictions: CandidatePrediction[] };

class MemoryHumanizationStore implements HumanizationStore {
  private datasets: InternalDataset[] = [];
  private candidates: TutorCandidate[] = [];
  private runs: InternalRun[] = [];
  private experiments: HumanizationExperiment[] = [];
  private approvals: FacultyApproval[] = [];
  private releases: TutorRelease[] = [];
  private shadowKeys = new Map<string, boolean>();
  private assignments = new Map<string, "baseline" | "candidate">();

  async overview(): Promise<HumanizationOverview> {
    return {
      datasets: this.datasets.map((dataset) => {
        const { entries: _unused, ...publicDataset } = dataset;
        void _unused;
        return publicDataset;
      }),
      candidates: [...this.candidates],
      runs: this.runs.map((run) => {
        const { predictions: _unused, ...publicRun } = run;
        void _unused;
        return publicRun;
      }),
      experiments: [...this.experiments], approvals: [...this.approvals], releases: [...this.releases],
    };
  }

  async createDataset({ name, actorId, sessions }: { name: string; actorId: string; sessions: SessionBundle[] }) {
    const entries = buildFrozenSamples(sessions, pseudonymSalt());
    if (!entries.length) throw new Error("No completed professor-labelled tutor turns are available to freeze.");
    const now = new Date().toISOString();
    const dataset: InternalDataset = {
      id: crypto.randomUUID(), name: deidentifiedDatasetName(name), status: "frozen",
      entryCount: entries.length, contentHash: canonicalHash(entries), deidentificationVersion: "deid-v1",
      sourceFrom: null, sourceTo: now, createdBy: actorId, createdAt: now, frozenAt: now, entries,
    };
    this.datasets.unshift(dataset);
    return dataset;
  }

  async createCandidate(input: { name: string; provider: TutorCandidate["provider"]; model: string; promptVersion: string; instructions: string; actorId: string }) {
    if (this.candidates.some((item) => item.promptVersion === input.promptVersion && item.model === input.model)) throw new Error("This candidate model and prompt version already exists.");
    const candidate: TutorCandidate = { id: crypto.randomUUID(), name: input.name, provider: input.provider, model: input.model, promptVersion: input.promptVersion, instructions: input.instructions, status: "draft", createdBy: input.actorId, createdAt: new Date().toISOString() };
    this.candidates.unshift(candidate); return candidate;
  }

  async runEvaluation({ datasetId, candidateId, actorId }: { datasetId: string; candidateId: string; actorId: string }) {
    const dataset = this.datasets.find((item) => item.id === datasetId);
    const candidate = this.candidates.find((item) => item.id === candidateId);
    if (!dataset || !candidate) throw new Error("Dataset or candidate not found.");
    const computed = await computeCandidateRun(dataset.entries, candidate);
    const now = new Date().toISOString();
    const run: InternalRun = { id: crypto.randomUUID(), datasetId, candidateId, status: "completed", ...computed, predictions: [], error: null, createdBy: actorId, createdAt: now, completedAt: now };
    this.runs.unshift(run); candidate.status = "evaluated"; return run;
  }

  async createExperiment(input: { name: string; evalRunId: string; mode: ExperimentMode; trafficPercent: number; actorId: string }) {
    const run = this.runs.find((item) => item.id === input.evalRunId);
    if (!run?.gate?.passed) throw new Error("Only a candidate that passed the frozen evaluation gate may enter shadow or A/B testing.");
    if (input.mode === "ab") {
      const shadow = this.experiments.find((item) => item.evalRunId === input.evalRunId && item.mode === "shadow" && ["paused", "completed"].includes(item.status));
      const shadowEvidence = [...this.shadowKeys.entries()].filter(([key]) => key.startsWith(`${shadow?.id}:`));
      if (!shadow || !shadowEvidence.length || shadowEvidence.some(([, safe]) => !safe)) throw new Error("A/B requires a paused, safety-clean shadow experiment with recorded results.");
    }
    const now = new Date().toISOString();
    const experiment: HumanizationExperiment = { id: crypto.randomUUID(), name: input.name, candidateId: run.candidateId, evalRunId: run.id, mode: input.mode, status: "running", trafficPercent: input.mode === "shadow" ? 0 : input.trafficPercent, createdBy: input.actorId, createdAt: now, startedAt: now, endedAt: null };
    this.experiments.unshift(experiment); return experiment;
  }
  async pauseExperiment(experimentId: string) { const experiment=this.experiments.find((item)=>item.id===experimentId); if(!experiment||experiment.status!=="running")throw new Error("Running experiment not found."); experiment.status="paused"; return experiment; }

  async approvalReadyRunIds() { return this.experiments.filter((item) => item.mode === "ab" && ["running", "paused", "completed"].includes(item.status) && [...this.shadowKeys.keys()].some((key) => key.startsWith(`${item.id}:`))).map((item) => item.evalRunId); }

  async approve(input: { evalRunId: string; professorId: string; decision: ApprovalDecision; notes: string; professorName?: string }) {
    if (!this.runs.some((item) => item.id === input.evalRunId)) throw new Error("Evaluation run not found.");
    if (!(await this.approvalReadyRunIds()).includes(input.evalRunId)) throw new Error("Faculty approval requires observed limited A/B evidence.");
    const existing = this.approvals.find((item) => item.evalRunId === input.evalRunId && item.professorId === input.professorId);
    const approval: FacultyApproval = { id: existing?.id ?? crypto.randomUUID(), evalRunId: input.evalRunId, professorId: input.professorId, professorName: input.professorName, decision: input.decision, notes: input.notes, createdAt: new Date().toISOString() };
    this.approvals = [approval, ...this.approvals.filter((item) => item.id !== approval.id)]; return approval;
  }

  async release(input: { evalRunId: string; actorId: string; trafficPercent: number; releaseNotes: string }) {
    const run = this.runs.find((item) => item.id === input.evalRunId);
    if (!run?.gate?.passed) throw new Error("The release gate has not passed.");
    const approvals = this.approvals.filter((item) => item.evalRunId === input.evalRunId);
    if (!approvals.some((item) => item.decision === "approved") || approvals.some((item) => item.decision === "rejected")) throw new Error("At least one faculty approval and no rejection are required before release.");
    const experiment = this.experiments.find((item) => item.evalRunId === input.evalRunId && item.mode === "ab" && item.status === "running");
    if (!experiment) throw new Error("A running shadow or A/B experiment is required before release.");
    const observed = [...this.shadowKeys.entries()].filter(([key]) => key.startsWith(`${experiment.id}:`));
    if (!observed.length || observed.some(([, safe]) => !safe)) throw new Error("Release requires safety-clean observed A/B evidence.");
    const release: TutorRelease = { id: crypto.randomUUID(), candidateId: run.candidateId, evalRunId: run.id, status: "active", trafficPercent: input.trafficPercent, releasedBy: input.actorId, releaseNotes: input.releaseNotes, createdAt: new Date().toISOString(), rolledBackAt: null, rollbackReason: null };
    this.releases.filter((item) => item.status === "active").forEach((item) => { item.status = "rolled_back"; item.rolledBackAt = release.createdAt; item.rollbackReason = "Superseded by approved release."; });
    this.releases.unshift(release); return release;
  }

  async rollback({ releaseId, actorId, reason }: { releaseId: string; actorId: string; reason: string }) {
    const release = this.releases.find((item) => item.id === releaseId);
    if (!release || release.status !== "active") throw new Error("Active release not found.");
    const experiment = this.experiments.find((item) => item.evalRunId === release.evalRunId && item.mode === "ab" && item.status === "running");
    if (experiment) experiment.status = "paused";
    release.status = "rolled_back";
    release.rolledBackAt = new Date().toISOString();
    release.rolledBackBy = actorId;
    release.rollbackReason = reason;
    return release;
  }

  async activeExperiment(sessionId: string) {
    const experiment = this.experiments.find((item) => item.status === "running");
    if (!experiment) return null;
    const candidate = this.candidates.find((item) => item.id === experiment.candidateId)!;
    const release = this.releases.find((item) => item.candidateId === candidate.id && item.status === "active");
    const trafficPercent = release?.trafficPercent ?? experiment.trafficPercent;
    const assignmentKey = `${experiment.id}:${pseudonymAssignmentKey(sessionId)}`;
    const arm = this.assignments.get(assignmentKey) ?? deterministicExperimentArm(sessionId, experiment.id, trafficPercent);
    this.assignments.set(assignmentKey, arm);
    return { experiment, candidate, arm };
  }

  async saveShadowResult(input: { experimentId: string; turnKey: string; safetyPassed: boolean }) {
    this.shadowKeys.set(`${input.experimentId}:${input.turnKey}`, input.safetyPassed);
  }
}

function mapDataset(row: Record<string, any>): FrozenDataset { return { id: row.id, name: row.name, status: row.status, entryCount: row.entry_count, contentHash: row.content_hash, deidentificationVersion: row.deidentification_version, sourceFrom: row.source_from, sourceTo: row.source_to, createdBy: row.created_by, createdAt: row.created_at, frozenAt: row.frozen_at }; }
function mapCandidate(row: Record<string, any>): TutorCandidate { return { id: row.id, name: row.name, provider: row.provider, model: row.model, promptVersion: row.prompt_version, instructions: row.instructions, status: row.status, createdBy: row.created_by, createdAt: row.created_at }; }
function mapRun(row: Record<string, any>): EvalRun { return { id: row.id, datasetId: row.dataset_id, candidateId: row.candidate_id, status: row.status, baselineMetrics: row.baseline_metrics, candidateMetrics: row.candidate_metrics, metricDeltas: row.metric_deltas ?? {}, gate: row.gate_result, error: row.error, createdBy: row.created_by, createdAt: row.created_at, completedAt: row.completed_at }; }
function mapExperiment(row: Record<string, any>): HumanizationExperiment { return { id: row.id, name: row.name, candidateId: row.candidate_id, evalRunId: row.eval_run_id, mode: row.mode, status: row.status, trafficPercent: row.traffic_percent, createdBy: row.created_by, createdAt: row.created_at, startedAt: row.started_at, endedAt: row.ended_at }; }
function mapApproval(row: Record<string, any>): FacultyApproval { return { id: row.id, evalRunId: row.eval_run_id, professorId: row.professor_id, decision: row.decision, notes: row.notes ?? "", createdAt: row.created_at }; }
function mapRelease(row: Record<string, any>): TutorRelease { return { id: row.id, candidateId: row.candidate_id, evalRunId: row.eval_run_id, status: row.status, trafficPercent: row.traffic_percent, releasedBy: row.released_by, releaseNotes: row.release_notes ?? "", createdAt: row.created_at, rolledBackAt: row.rolled_back_at, rolledBackBy: row.rolled_back_by, rollbackReason: row.rollback_reason }; }

class SupabaseHumanizationStore implements HumanizationStore {
  private client: SupabaseClient;
  constructor(url: string, key: string) { this.client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }); }
  private async rows(table: string) { const { data, error } = await this.client.from(table).select("*").order("created_at", { ascending: false }); if (error) throw new Error(`${table}: ${error.message}`); return data ?? []; }
  async overview(): Promise<HumanizationOverview> { const [datasets,candidates,runs,experiments,approvals,releases] = await Promise.all([this.rows("humanization_datasets"),this.rows("tutor_candidates"),this.rows("humanization_eval_runs"),this.rows("humanization_experiments"),this.rows("faculty_release_approvals"),this.rows("tutor_releases")]); return { datasets: datasets.map(mapDataset), candidates: candidates.map(mapCandidate), runs: runs.map(mapRun), experiments: experiments.map(mapExperiment), approvals: approvals.map(mapApproval), releases: releases.map(mapRelease) }; }
  async createDataset({ name, actorId, sessions }: { name: string; actorId: string; sessions: SessionBundle[] }) { const entries = buildFrozenSamples(sessions,pseudonymSalt()); if (!entries.length) throw new Error("No completed professor-labelled tutor turns are available to freeze."); const now = new Date().toISOString(); const contentHash = canonicalHash(entries); const { data:building, error } = await this.client.from("humanization_datasets").insert({ name: deidentifiedDatasetName(name), status: "building", deidentification_version: "deid-v1", source_to: now, entry_count: 0, created_by: actorId }).select("*").single(); if (error) throw new Error(`Build dataset: ${error.message}`); const payload = entries.map((sample: FrozenTutorSample) => ({ dataset_id: building.id, sample_key: sample.sampleKey, pseudonym: sample.sampleKey.split(":")[0], sample, sample_hash: canonicalHash(sample) })); const { error: entryError } = await this.client.from("humanization_dataset_entries").insert(payload); if (entryError) throw new Error(`Freeze entries: ${entryError.message}`); const {data,error:freezeError}=await this.client.from("humanization_datasets").update({status:"frozen",content_hash:contentHash,frozen_at:now}).eq("id",building.id).select("*").single(); if(freezeError)throw new Error(`Freeze dataset: ${freezeError.message}`); return mapDataset(data); }
  async createCandidate(input: { name: string; provider: TutorCandidate["provider"]; model: string; promptVersion: string; instructions: string; actorId: string }) { const { data,error } = await this.client.from("tutor_candidates").insert({ name: input.name, provider: input.provider, model: input.model, prompt_version: input.promptVersion, instructions: input.instructions, status: "draft", created_by: input.actorId }).select("*").single(); if(error) throw new Error(`Create candidate: ${error.message}`); return mapCandidate(data); }
  async runEvaluation(input: { datasetId: string; candidateId: string; actorId: string }) { const [{data:ds,error:de},{data:c,error:ce},{data:entries,error:ee}] = await Promise.all([this.client.from("humanization_datasets").select("*").eq("id",input.datasetId).single(),this.client.from("tutor_candidates").select("*").eq("id",input.candidateId).single(),this.client.from("humanization_dataset_entries").select("sample").eq("dataset_id",input.datasetId)]); if(de||ce||ee) throw new Error(de?.message??ce?.message??ee?.message); const {data:pending,error:pe}=await this.client.from("humanization_eval_runs").insert({dataset_id:ds.id,candidate_id:c.id,status:"pending",created_by:input.actorId}).select("*").single(); if(pe)throw new Error(`Create evaluation: ${pe.message}`); const {error:runningError}=await this.client.from("humanization_eval_runs").update({status:"running"}).eq("id",pending.id); if(runningError)throw new Error(`Start evaluation: ${runningError.message}`); const computed = await computeCandidateRun((entries??[]).map((r:any)=>r.sample),mapCandidate(c)); const now=new Date().toISOString(); const {data,error}=await this.client.from("humanization_eval_runs").update({status:"completed",baseline_metrics:computed.baselineMetrics,candidate_metrics:computed.candidateMetrics,metric_deltas:computed.metricDeltas,gate_result:computed.gate,completed_at:now}).eq("id",pending.id).select("*").single(); if(error) throw new Error(`Complete evaluation: ${error.message}`); await this.client.from("tutor_candidates").update({status:"evaluated"}).eq("id",c.id); return mapRun(data); }
  async createExperiment(input: {name:string;evalRunId:string;mode:ExperimentMode;trafficPercent:number;actorId:string}) { const {data:run,error:re}=await this.client.from("humanization_eval_runs").select("*").eq("id",input.evalRunId).single(); if(re||!run?.gate_result?.passed) throw new Error("Only a candidate that passed the frozen evaluation gate may enter shadow or A/B testing."); const now=new Date().toISOString(); const {data,error}=await this.client.from("humanization_experiments").insert({name:input.name,candidate_id:run.candidate_id,eval_run_id:run.id,mode:input.mode,status:"running",traffic_percent:input.mode==="shadow"?0:input.trafficPercent,created_by:input.actorId,started_at:now}).select("*").single(); if(error) throw new Error(`Create experiment: ${error.message}`); return mapExperiment(data); }
  async pauseExperiment(experimentId:string){const {data,error}=await this.client.from("humanization_experiments").update({status:"paused"}).eq("id",experimentId).eq("status","running").select("*").single();if(error)throw new Error(`Pause experiment: ${error.message}`);return mapExperiment(data);}
  async approvalReadyRunIds(){const {data:experiments,error}=await this.client.from("humanization_experiments").select("id,eval_run_id").eq("mode","ab").in("status",["running","paused","completed"]);if(error)throw new Error(error.message);if(!(experiments??[]).length)return[];const ids=(experiments??[]).map((item:any)=>item.id);const {data:results,error:resultError}=await this.client.from("humanization_shadow_results").select("experiment_id,safety_passed").in("experiment_id",ids);if(resultError)throw new Error(resultError.message);const byExperiment=new Map<string,boolean[]>();for(const result of results??[]){const values=byExperiment.get(result.experiment_id)??[];values.push(result.safety_passed);byExperiment.set(result.experiment_id,values);}return (experiments??[]).filter((item:any)=>{const evidence=byExperiment.get(item.id)??[];return evidence.length>0&&evidence.every(Boolean);}).map((item:any)=>item.eval_run_id);}
  async approve(input:{evalRunId:string;professorId:string;decision:ApprovalDecision;notes:string}) { if(!(await this.approvalReadyRunIds()).includes(input.evalRunId))throw new Error("Faculty approval requires observed limited A/B evidence.");const {data,error}=await this.client.from("faculty_release_approvals").insert({eval_run_id:input.evalRunId,professor_id:input.professorId,decision:input.decision,notes:input.notes}).select("*").single(); if(error) throw new Error(`Save approval: ${error.message}`); return mapApproval(data); }
  async release(input:{evalRunId:string;actorId:string;trafficPercent:number;releaseNotes:string}) { const [{data:run,error:re},{data:approvals,error:ae},{data:experiment,error:xe}]=await Promise.all([this.client.from("humanization_eval_runs").select("*").eq("id",input.evalRunId).single(),this.client.from("faculty_release_approvals").select("decision").eq("eval_run_id",input.evalRunId),this.client.from("humanization_experiments").select("id").eq("eval_run_id",input.evalRunId).eq("mode","ab").eq("status","running").maybeSingle()]); if(re||ae||xe||!run?.gate_result?.passed||!experiment||!(approvals??[]).some((x:any)=>x.decision==="approved")||(approvals??[]).some((x:any)=>x.decision==="rejected")) throw new Error("Release requires a passed gate, a running limited A/B experiment, faculty approval, and no rejection."); const {data,error}=await this.client.from("tutor_releases").insert({candidate_id:run.candidate_id,eval_run_id:run.id,status:"active",traffic_percent:input.trafficPercent,released_by:input.actorId,release_notes:input.releaseNotes}).select("*").single(); if(error) throw new Error(`Release candidate: ${error.message}`); return mapRelease(data); }
  async rollback(input:{releaseId:string;actorId:string;reason:string}) {
    const {data:activeRelease,error:findError}=await this.client.from("tutor_releases").select("eval_run_id").eq("id",input.releaseId).eq("status","active").single();
    if(findError) throw new Error(`Find active release: ${findError.message}`);
    // Stop candidate traffic before recording the rollback. This fail-safe order
    // prevents a partially failed rollback from leaving the A/B experiment live.
    const {error:pauseError}=await this.client.from("humanization_experiments").update({status:"paused"}).eq("eval_run_id",activeRelease.eval_run_id).eq("mode","ab").eq("status","running");
    if(pauseError) throw new Error(`Pause rolled-back experiment: ${pauseError.message}`);
    const now=new Date().toISOString();
    const {data,error}=await this.client.from("tutor_releases").update({status:"rolled_back",rolled_back_by:input.actorId,rolled_back_at:now,rollback_reason:input.reason}).eq("id",input.releaseId).eq("status","active").select("*").single();
    if(error) throw new Error(`Rollback release: ${error.message}`);
    return mapRelease(data);
  }
  async activeExperiment(sessionId:string) { const {data:e,error}=await this.client.from("humanization_experiments").select("*").eq("status","running").order("created_at",{ascending:false}).limit(1).maybeSingle(); if(error) throw new Error(error.message); if(!e)return null; const [{data:c,error:ce},{data:release,error:releaseError}]=await Promise.all([this.client.from("tutor_candidates").select("*").eq("id",e.candidate_id).single(),this.client.from("tutor_releases").select("traffic_percent").eq("candidate_id",e.candidate_id).eq("status","active").maybeSingle()]); if(ce||releaseError)throw new Error(ce?.message??releaseError?.message); const experiment=mapExperiment(e); const trafficPercent=release?.traffic_percent??experiment.trafficPercent; const assignmentKey=pseudonymAssignmentKey(sessionId);const {data:existing,error:existingError}=await this.client.from("humanization_experiment_assignments").select("arm").eq("experiment_id",experiment.id).eq("assignment_key",assignmentKey).maybeSingle();if(existingError)throw new Error(existingError.message);let arm=(existing?.arm as "baseline"|"candidate"|undefined)??deterministicExperimentArm(sessionId,experiment.id,trafficPercent);if(!existing){const assignmentHash=canonicalHash({experimentId:experiment.id,assignmentKey,arm});const {error:insertError}=await this.client.from("humanization_experiment_assignments").insert({experiment_id:experiment.id,assignment_key:assignmentKey,arm,assignment_hash:assignmentHash});if(insertError&&insertError.code!=="23505")throw new Error(insertError.message);if(insertError?.code==="23505"){const {data:won,error:wonError}=await this.client.from("humanization_experiment_assignments").select("arm").eq("experiment_id",experiment.id).eq("assignment_key",assignmentKey).single();if(wonError)throw new Error(wonError.message);arm=won.arm;}}return {experiment,candidate:mapCandidate(c),arm}; }
  async saveShadowResult(input:{experimentId:string;turnKey:string;arm:"baseline"|"candidate";baselineOutput:unknown;candidateOutput:unknown;safetyPassed:boolean}) { const {error}=await this.client.from("humanization_shadow_results").insert({experiment_id:input.experimentId,turn_key:input.turnKey,arm:input.arm,baseline_output:input.baselineOutput,candidate_output:input.candidateOutput,safety_passed:input.safetyPassed}); if(error&&error.code!=="23505") throw new Error(`Save shadow result: ${error.message}`); }
}

let singleton: HumanizationStore | undefined;
function pseudonymSalt(){const salt=process.env.EXPERIMENT_PSEUDONYM_SECRET?.trim()||process.env.DEMO_SESSION_SECRET?.trim();if(salt)return salt;if(process.env.NODE_ENV==="production")throw new Error("EXPERIMENT_PSEUDONYM_SECRET is required to freeze a dataset in production.");return "socratic-experiment-dev-v1";}
function pseudonymAssignmentKey(sessionId:string){return canonicalHash({scope:"experiment-assignment-v1",sessionId,salt:pseudonymSalt()});}
export function getHumanizationStore(): HumanizationStore { if(singleton)return singleton; const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY; singleton=url&&key&&process.env.FORCE_MEMORY_REPOSITORY!=="true"?new SupabaseHumanizationStore(url,key):new MemoryHumanizationStore(); return singleton; }
export function createMemoryHumanizationStoreForTests(): HumanizationStore { return new MemoryHumanizationStore(); }
export function resetHumanizationStoreForTests(next?:HumanizationStore){singleton=next;}
