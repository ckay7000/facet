import { readFile, writeFile, mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { bridgeRequest, closeBridge } from './tool-bridge';
const name = 'facet-near'; const team = 'team_osASFxy0lZFhvkPehOUzYAXS';
const auth = process.env.VERCEL_TOKEN ? { token: process.env.VERCEL_TOKEN } : JSON.parse(await readFile('/root/.local/share/com.vercel.cli/auth.json', 'utf8'));
if (typeof auth.token !== 'string' || !auth.token) throw new Error('The existing Vercel connection is unavailable.');
await mkdir('.local/bridge', { recursive: true, mode: 0o700 }); const headerFile = path.resolve('.local/bridge/vercel.headers');
await writeFile(headerFile, `Authorization: Bearer ${auth.token}\nContent-Type: application/json\n`, { mode: 0o600 });
const api = (route: string, method = 'GET', body?: unknown) => bridgeRequest(`https://api.vercel.com${route}${route.includes('?') ? '&' : '?'}teamId=${team}`, method, body, headerFile);
try {
  const list = await api('/v9/projects?limit=100'); let project = list.projects.find((p: any) => p.name === name);
  if (!project) project = await api('/v11/projects', 'POST', { name, framework: 'vite', buildCommand: 'npm run build', installCommand: 'npm ci', outputDirectory: 'dist' });
  if (project.name !== name) throw new Error('Unexpected Vercel project.');
  await mkdir('.vercel', { recursive: true }); await writeFile('.vercel/project.json', JSON.stringify({ projectId: project.id, orgId: team, projectName: name }));
  await api(`/v9/projects/${project.id}`, 'PATCH', { nodeVersion: '24.x' });
  console.log('Dedicated Vercel project:', name, project.id);
  const environment = Object.fromEntries((await readFile('.env.local', 'utf8')).trim().split('\n').map(line => { const i=line.indexOf('='); return [line.slice(0,i), line.slice(i+1)]; }));
  const current = await api(`/v10/projects/${project.id}/env`);
  if (process.argv.includes('--final')) {
    for (const entry of current.envs.filter((e: any) => e.key === 'FACET_VERIFY_SECRET')) {
      await api(`/v10/projects/${project.id}/env/${entry.id}`, 'DELETE');
      console.log('Removed temporary browser verification credential.');
    }
  }
  for (const [key,value] of Object.entries(environment)) { if (!key.startsWith('FACET_')) throw new Error('Unexpected environment variable.'); const existing = current.envs.find((e: any) => e.key === key && e.target?.includes('production')); const route = `/v10/projects/${project.id}/env${existing ? `/${existing.id}` : ''}`; await api(route, existing ? 'PATCH' : 'POST', { key, value, type: 'encrypted', target: ['production','preview'] }); console.log('Configured:', key); }
  const files: { file: string; data: string; encoding: 'base64' }[] = [];
  async function addFile(file: string) { const data=await readFile(file); files.push({ file, data: data.toString('base64'), encoding: 'base64' }); }
  async function walk(directory: string) { for(const entry of await readdir(directory,{withFileTypes:true})) { const file=`${directory}/${entry.name}`; if(entry.isDirectory()) await walk(file); else await addFile(file); } }
  for(const file of ['package.json','package-lock.json','tsconfig.json','vite.config.ts','vercel.json','index.html']) await addFile(file);
  for(const dir of ['src','shared','server','api','public','deployments','scripts']) await walk(dir);
  const deployment = await api('/v13/deployments', 'POST', { name, project: project.id, target: 'production', files, projectSettings: { framework: 'vite', nodeVersion: '24.x', buildCommand: 'npm run build', installCommand: 'npm ci', outputDirectory: 'dist' } });
  await writeFile('deployments/web.json', JSON.stringify({ project_id: project.id, deployment_id: deployment.id, url: `https://${deployment.url}`, alias: `https://${name}.vercel.app`, state: deployment.readyState, created_at: new Date().toISOString() }, null, 2));
  console.log('Deployment queued:', deployment.id, `https://${deployment.url}`);
} finally { await rm(headerFile,{force:true}); closeBridge(); }
