import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {TutorEvaluationResult} from '@/lib/domain';
import {impactedCanineCase} from '@/lib/seed';

const mocks=vi.hoisted(()=>({active:vi.fn(),evaluate:vi.fn(),save:vi.fn()}));
vi.mock('@/lib/experiments/store',()=>({getHumanizationStore:()=>({activeExperiment:mocks.active,saveShadowResult:mocks.save})}));
vi.mock('@/lib/tutor/openai',()=>({OpenAITutor:class {evaluate=mocks.evaluate;}}));
vi.mock('@/lib/tutor/claude',()=>({ClaudeTutor:class {evaluate=mocks.evaluate;}}));
import {applyHumanizationExperiment} from '@/lib/experiments/shadow';

const baseline:TutorEvaluationResult={classification:'partial',confidence:0.8,misconceptionKey:null,reasoningGap:'Needs evidence',strategy:'probe',feedback:'Link the finding',nextQuestion:'Which record supports your conclusion?',source:'openai',memoryPatch:{addErrors:[],addStrengths:[],addWeaknesses:[],masteryDelta:0}};
const input={sessionId:'local',turnKey:'turn1',phase:impactedCanineCase.phases[0],answer:'The tooth is unerupted.',attempt:1,baseline,state:{sessionId:'local',currentGoal:'goal',previousErrors:[],strengths:[],weaknesses:[],nextStrategy:'probe' as const,phaseAttempts:{'1':1},mastery:{'1':0},version:1,updatedAt:'2026-10-09T00:00:00Z'}};

describe('candidate shares the learner request budget',()=>{
  beforeEach(()=>{
    vi.stubEnv('OPENAI_API_KEY','test-key');
    mocks.active.mockReset().mockResolvedValue({experiment:{id:'experiment1'},candidate:{provider:'openai',model:'test-model',instructions:'test',promptVersion:'test'},arm:'baseline'});
    mocks.evaluate.mockReset().mockResolvedValue(baseline);
    mocks.save.mockReset().mockResolvedValue(undefined);
  });
  afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks();});
  it('does not start another model call with less than a second left',async()=>{
    vi.spyOn(Date,'now').mockReturnValue(19_100);
    const result=await applyHumanizationExperiment({...input,timeoutMs:25_000,deadlineMs:20_000});
    expect(result.studentResult).toBe(baseline);
    expect(mocks.evaluate).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it('recomputes the remaining timeout after experiment lookup',async()=>{
    vi.spyOn(Date,'now').mockReturnValue(14_000);
    await applyHumanizationExperiment({...input,timeoutMs:25_000,deadlineMs:20_000});
    expect(mocks.evaluate).toHaveBeenCalledWith(expect.objectContaining({timeoutMs:6_000}));
  });
});
