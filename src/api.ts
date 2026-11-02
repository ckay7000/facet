export async function api<T = any>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/${path}`, { method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || 'Facet could not complete that request.');
  return value;
}
