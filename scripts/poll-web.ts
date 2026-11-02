import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { bridgeRequest, closeBridge } from './tool-bridge';
const auth = process.env.VERCEL_TOKEN ? { token: process.env.VERCEL_TOKEN } : JSON.parse(await readFile('/root/.local/share/com.vercel.cli/auth.json','utf8'));
const web = JSON.parse(await readFile('deployments/web.json','utf8'));
await mkdir('.local/bridge',{recursive:true,mode:0o700});const headerFile=path.resolve('.local/bridge/vercel.headers');
await writeFile(headerFile,`Authorization: Bearer ${auth.token}\nContent-Type: application/json\n`,{mode:0o600});
try { const r=await bridgeRequest(`https://api.vercel.com/v13/deployments/${web.deployment_id}?teamId=team_osASFxy0lZFhvkPehOUzYAXS`,'GET',undefined,headerFile); web.state=r.readyState; await writeFile('deployments/web.json',JSON.stringify(web,null,2)); console.log('Deployment:',r.readyState,r.url); if(r.readyState==='ERROR'){ const events=await bridgeRequest(`https://api.vercel.com/v3/deployments/${web.deployment_id}/events?teamId=team_osASFxy0lZFhvkPehOUzYAXS`,'GET',undefined,headerFile); console.log(events.map((e:any)=>e.text).filter((s:string)=>s.includes('error')||s.includes('Error')).slice(0,35).join('\n')); } } finally {await rm(headerFile,{force:true});closeBridge();}
