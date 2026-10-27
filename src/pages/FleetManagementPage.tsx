import { useCallback, useEffect, useState } from 'react';
import { adminHeaders } from '../lib/auth/admin-auth';
import { registry, type RegistryEntity, DEFAULT_ROUTE_ID } from '../lib/fleet/registry';
import './fleet-management.css';
type Row = Record<string, any>;
async function request(url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, headers: { 'Content-Type':'application/json', ...await adminHeaders() }, signal: AbortSignal.timeout(15000) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}
export function FleetManagementPage() {
  const [entity,setEntity] = useState<RegistryEntity>('vehicles');
  const [rows,setRows] = useState<Row[]>([]);
  const [total,setTotal] = useState(0); const [page,setPage] = useState(0);
  const [search,setSearch] = useState(''); const [archived,setArchived] = useState(false);
  const [editing,setEditing] = useState<Row|null>(null);
  const [references,setReferences] = useState<{drivers:Row[];routes:Row[]}>({drivers:[],routes:[]});
  const [busy,setBusy] = useState(false); const [loading,setLoading] = useState(true);
  const [error,setError] = useState(''); const [notice,setNotice] = useState('');
  const [refresh,setRefresh] = useState(0); const [archiveTarget,setArchiveTarget] = useState<Row|null>(null);
  const config = registry[entity];
  useEffect(() => {
    let cancelled=false; setLoading(true); setError('');
    const timer=setTimeout(()=>{ request(`/api/fleet-registry?entity=${entity}&page=${page}&search=${encodeURIComponent(search)}&archived=${archived}`)
      .then(data=>{if(!cancelled){setRows(data.records);setTotal(data.total);}})
      .catch(e=>{if(!cancelled){setError(e.message);setRows([]);}})
      .finally(()=>{if(!cancelled)setLoading(false);}); },250);
    return ()=>{cancelled=true;clearTimeout(timer);};
  },[entity,page,search,archived,refresh]);
  const openEditor = useCallback(async (row?: Row) => {
    setError('');setNotice('');setBusy(true);
    try {
      const refs={drivers:[] as Row[],routes:[] as Row[]};
      for(const kind of ['drivers','routes'] as const) {
        let offset=0; let result;
        do { result=await request(`/api/fleet-registry?entity=${kind}&page=${offset++}`); refs[kind].push(...result.records); } while(refs[kind].length<result.total);
      }
      setReferences(refs);
      setEditing(row ? {...row} : {capacity:20,availability:'active',route_id:DEFAULT_ROUTE_ID});
    } catch(e){setError((e as Error).message);} finally{setBusy(false);}
  },[]);
  async function save(event: React.FormEvent) {
    event.preventDefault(); if(!editing)return;
    setBusy(true);setError('');
    try { await request('/api/fleet-registry',{method:editing.id?'PATCH':'POST',body:JSON.stringify({entity,id:editing.id,record:editing})});
      setEditing(null);setNotice('Record saved.');setRefresh(v=>v+1);
    } catch(e){setError((e as Error).message);} finally{setBusy(false);}
  }
  async function archive() {
    if(!archiveTarget)return;setBusy(true);setError('');
    try {await request('/api/fleet-registry',{method:'PATCH',body:JSON.stringify({entity,id:archiveTarget.id,archived:!archived})});setArchiveTarget(null);setNotice(archived?'Record restored.':'Record archived.');setRefresh(v=>v+1);}
    catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  return <main className="fleet-management">
    <header><div><h1>Fleet management</h1><p>Manage vehicle assignments, drivers, routes and stations.</p></div><button disabled={busy} onClick={()=>void openEditor()}>Add record</button></header>
    <nav aria-label="Record types">{(Object.keys(registry) as RegistryEntity[]).map(key=><button key={key} aria-pressed={entity===key} disabled={busy||!!editing} onClick={()=>{setEntity(key);setPage(0);setSearch('');setNotice('');setArchived(false);}}>{registry[key].label}</button>)}</nav>
    <div className="fleet-filters"><label>Search {config.label.toLowerCase()}<input value={search} onChange={e=>{setSearch(e.target.value);setPage(0);}} /></label><label className="fleet-checkbox"><input type="checkbox" checked={archived} onChange={e=>{setArchived(e.target.checked);setPage(0);}}/>Show archived</label><button disabled={loading} onClick={()=>setRefresh(v=>v+1)}>Refresh</button></div>
    {error&&<p className="fleet-error" role="alert">{error}</p>}{notice&&<p className="fleet-notice" role="status">{notice}</p>}
    {entity==='routes'&&<p className="fleet-hint">The public tracker currently follows BAT-LIP-001. Other routes can be registered; their map geometry and public views need separate setup.</p>}
    {editing&&<section className="fleet-editor" aria-label="Record editor"><h2>{editing.id?'Edit':'Add'} {config.label.toLowerCase().replace(/s$/,'')}</h2><form onSubmit={save}>
      <div className="fleet-fields">{config.fields.map(field=><label key={field.key}>{field.label}{field.required?' *':''}
        {field.reference ? <select required={field.required} value={editing[field.key]??''} onChange={e=>setEditing({...editing,[field.key]:e.target.value})}><option value="">Unassigned</option>{references[field.reference].map(row=><option key={row.id} value={row.id}>{row.name}{row.code?` (${row.code})`:''}</option>)}</select>
        :field.options?<select required value={editing[field.key]??''} onChange={e=>setEditing({...editing,[field.key]:e.target.value})}><option value="" disabled>Select</option>{field.options.map(value=><option key={value}>{value}</option>)}</select>
        :<input required={field.required} maxLength={160} type={field.type==='number'?'number':'text'} min={field.min} max={field.max} step={['latitude','longitude'].includes(field.key)?'any':1} value={editing[field.key]??''} onChange={e=>setEditing({...editing,[field.key]:e.target.value})}/>}</label>)}</div>
      <div className="fleet-actions"><button disabled={busy}>{busy?'Saving…':'Save record'}</button><button type="button" disabled={busy} onClick={()=>setEditing(null)}>Cancel</button></div>
    </form></section>}
    {archiveTarget&&<div className="fleet-confirm" role="alertdialog" aria-label="Confirm record archive"><p>{archived?'Restore':'Archive'} {archiveTarget.plate_number||archiveTarget.name}? {archived?'':'This hides the record from active lists.'}</p><button disabled={busy} onClick={()=>void archive()}>Confirm {archived?'restore':'archive'}</button><button disabled={busy} onClick={()=>setArchiveTarget(null)}>Cancel</button></div>}
    <div className="fleet-table"><table><thead><tr><th>{entity==='vehicles'?'Plate number':'Name'}</th><th>Details</th><th>Updated</th><th>Actions</th></tr></thead><tbody>{rows.map(row=><tr key={row.id}><td>{row.plate_number||row.name}</td><td>{row.availability||row.code||row.location||row.phone||'—'}</td><td>{new Date(row.updated_at).toLocaleString()}</td><td><button disabled={busy||archived} onClick={()=>void openEditor(row)}>Edit</button><button disabled={busy} onClick={()=>setArchiveTarget(row)}>{archived?'Restore':'Archive'}</button></td></tr>)}</tbody></table></div>
    {loading?<p role="status">Loading records…</p>:rows.length===0&&!error?<p>No matching records. Add a record or change your search.</p>:null}
    <footer><span>{total} records · page {page+1}</span><button disabled={page===0||loading} onClick={()=>setPage(v=>v-1)}>Previous</button><button disabled={(page+1)*25>=total||loading} onClick={()=>setPage(v=>v+1)}>Next</button></footer>
  </main>;
}
