const fail=(text,status=400)=>Object.assign(Error(text),{status});
const id=value=>typeof value==='string'&&/^[a-zA-Z0-9-]{8,100}$/.test(value);
export function validateCampaign(s,revision){if(!s||s.version!==1||!id(s.id)||typeof s.name!=='string'||s.name.length<1||s.name.length>20||!['easy','normal','hard'].includes(s.level)||!Number.isInteger(s.roundIndex)||s.roundIndex<0||s.roundIndex>4||!['meeting','round-complete','runoff','season-complete'].includes(s.phase)||!Array.isArray(s.roster)||s.roster.length!==16||new Set(s.roster.map(r=>r?.id)).size!==16||s.roster.some(r=>!r||!Number.isInteger(r.id)||r.id<0||r.id>15||typeof r.name!=='string'||r.name.length>20||!Number.isInteger(r.total)||r.total<0||r.total>100)||!Array.isArray(s.history)||s.history.length>5||!Number.isInteger(revision)||revision<0)throw fail('Nieprawidłowy zapis kampanii.');}
export async function api(req,owner,body,repo,trackIds){const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/api/campaign'){
  if(req.method==='GET'){const key=url.searchParams.get('id');if(key&&!id(key))throw fail('Nieprawidłowa kampania.');return repo.campaign(owner,key)}
  if(req.method!=='POST')throw fail('Niedozwolona metoda.',405);validateCampaign(body.campaign,body.revision);return {revision:await repo.saveCampaign(owner,body.campaign,body.revision)};
 }
 if(url.pathname==='/api/scores'){
  if(req.method==='GET'){const track=url.searchParams.get('track')||'classic',level=url.searchParams.get('level'),players=url.searchParams.get('players');if(!trackIds.includes(track)||level&&!['easy','normal','hard'].includes(level)||players&&!/^[1-4]$/.test(players))throw fail('Nieprawidłowy filtr.');return {scores:await repo.scores({track,level,players:players?Number(players):null})}}
  if(req.method!=='POST')throw fail('Niedozwolona metoda.',405);if(!Array.isArray(body.scores)||!body.scores.length||body.scores.length>4)throw fail('Nieprawidłowe wyniki.');
  const entries=body.scores.map(s=>{if(!s||!id(s.id)||typeof s.name!=='string'||!s.name.trim()||s.name.trim().length>20||!Number.isInteger(s.time_ms)||s.time_ms<10000||s.time_ms>900000||!['easy','normal','hard'].includes(s.level)||!Number.isInteger(s.players)||s.players<1||s.players>4||!trackIds.includes(s.track??'classic'))throw fail('Nieprawidłowy wynik.');return {...s,name:s.name.trim(),track:s.track??'classic'}});await repo.saveScores(owner,entries);return {saved:true};
 }
 throw fail('Nieznana trasa.',404);
}
