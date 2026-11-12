import { readFileSync } from 'node:fs';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { WALL_ID, faces, HEIGHT, WIDTH, normalFor, surfacePoint, pointToSurface, workingArea, workingToSurface } from '../../../../packages/config/tianyu-floor-wall';
import { generateRouteCandidates } from './route-candidates';

const holds = JSON.parse(readFileSync('../web/public/data/holds.json', 'utf8')).holds;
const config = { DEROUTER_API_KEY: undefined, DEROUTER_OPENAI_BASE: 'https://example.test/v1', DEROUTER_ANTHROPIC_BASE: 'https://example.test' };
// Real-catalog solver checks generate three candidates; shared CI runners can
// exceed Vitest's 5s default. These check constraints, not a latency target.
const solverTestTimeoutMs = 15_000;
afterEach(()=>vi.restoreAllMocks());
describe('天宇一楼几何与米制定线',()=>{
  it('保留六段底宽、顶宽、倾角与五个连接面；表面正反变换一致',()=>{
    expect(WIDTH).toBeCloseTo(24.533); expect(faces).toHaveLength(11);
    const mains=faces.filter(f=>f.kind==='main'); expect(mains.map(f=>f.angle)).toEqual([-3,9,20,25,15,3]);
    for(const f of faces) {
      const p=surfacePoint(f.id,37,61),uv=pointToSurface(f.id,p);
      expect(uv.x).toBeCloseTo(37); expect(uv.y).toBeCloseTo(61);
      const n=normalFor(f.id); expect(Math.hypot(...n)).toBeCloseTo(1); expect(n[2]).toBeGreaterThan(0);
      expect(f.vertices.every(v=>Math.abs(v.reduce((s,x,k)=>s+(x-f.vertices[0][k])*n[k],0))<1e-8)).toBe(true);
    }
    for(const f of mains) expect(Math.atan2(f.vertices[3][2],HEIGHT)*180/Math.PI).toBeCloseTo(f.angle!);
  });
  it('AI 作业区转换后，三维距离保持真实米制，不按四米墙缩放',()=>{
    for(const f of faces.filter(f=>f.kind==='main')){
      const area=workingArea(f.id), a=workingToSurface(f.id,20,80),b=workingToSurface(f.id,70,25);
      const p=surfacePoint(f.id,a.x,a.y),q=surfacePoint(f.id,b.x,b.y);
      expect(Math.hypot(...p.map((x,i)=>x-q[i]))).toBeCloseTo(Math.hypot(.5*area.widthM,.55*area.heightM));
      expect(a.x).toBeGreaterThan(0);expect(b.x).toBeLessThan(100);
    }
  });
  it.each(['F1','F2','F3','F4','F5','F6'])('%s 本地后备生成保持所选墙段、点数与起步约束',async faceId=>{
    const response=await generateRouteCandidates({prompt:'V4，4点起步，最多12个点，动作流畅',model:'gpt-6-astra',mode:'free',holds,wall:{id:WALL_ID,faceId}},config);
    const body=await response.json(); expect(response.status,JSON.stringify(body)).toBe(200);
    expect(body.candidates).toHaveLength(3);expect(body.constraints.wallAngleDegrees).toBe(workingArea(faceId).angle);
    for(const c of body.candidates){expect(c.placements.length).toBeLessThanOrEqual(12);expect(c.metrics.passed).toBe(true);expect(c.metrics.startFootCount).toBe(2);
      expect(c.placements.every((p:{surfaceId:string;x:number;y:number})=>p.surfaceId===faceId&&p.x>0&&p.x<100&&p.y>0&&p.y<100)).toBe(true);
    }
  }, solverTestTimeoutMs);
  it('拒绝不存在的墙面与固定板混用墙面配置',async()=>{
    for(const patch of [{mode:'free',wall:{id:WALL_ID,faceId:'J1'}},{mode:'fixed',wall:{id:WALL_ID,faceId:'F2'}}]){
      const response=await generateRouteCandidates({prompt:'V4 技术型',model:'gpt-6-astra',holds,...patch},config);expect(response.status).toBe(400);
    }
  });
  it('上游提示词带真实尺寸与仰角；故障后备也保留几何',async()=>{
    const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response('{}',{status:401}));
    const response=await generateRouteCandidates({prompt:'V4，最多12个点',model:'gpt-6-astra',mode:'free',holds,wall:{id:WALL_ID,faceId:'F4'}},{...config,DEROUTER_API_KEY:'test-only'});
    const request=JSON.parse(String(fetch.mock.calls[0][1]?.body));const message=JSON.parse(request.messages[1].content);
    expect(message.wall.angleDegreesFromVertical).toBe(25);expect(message.wall.widthM).toBeCloseTo(workingArea('F4').widthM);
    expect(response.status).toBe(200);expect((await response.json()).candidates[0].placements[0].surfaceId).toBe('F4');
  }, solverTestTimeoutMs);
});
