const json = (data, status=200) => new Response(JSON.stringify(data), {status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const trackIds=['classic','long','arena','narrow','asymmetric'];
function database(env){if(!env.DB)throw new Error('Leaderboard database unavailable');return env.DB}
export async function handleScores(request, env){const url=new URL(request.url);
 try{
  const db=database(env);
  if(request.method==='GET'){
   const track=url.searchParams.get('track')||'classic';if(!trackIds.includes(track))return json({error:'Nieznany tor'},400);
   let sql='SELECT name, time_ms, level, players, track FROM race_scores WHERE rules = ? AND track = ?',args=[5,track];
   const level=url.searchParams.get('level'),players=url.searchParams.get('players');
   if(level&&['easy','normal','hard'].includes(level)){sql+=' AND level = ?';args.push(level)}
   if(players&&/^[1-4]$/.test(players)){sql+=' AND players = ?';args.push(Number(players))}
   sql+=' ORDER BY time_ms ASC, created_at ASC LIMIT 20';
   const {results}=await db.prepare(sql).bind(...args).all();return json({scores:results});
  }
  if(request.method==='POST'){
   const origin=request.headers.get('origin');if(origin&&origin!==url.origin)return json({error:'Niedozwolone źródło'},403);
   if(!(request.headers.get('content-type')||'').includes('application/json'))return json({error:'Nieprawidłowy format'},415);
   const raw=await request.text();if(raw.length>5000)return json({error:'Za dużo danych'},413);
   let body;try{body=JSON.parse(raw)}catch{return json({error:'Nieprawidłowe dane'},400)}
   if(!Array.isArray(body.scores)||body.scores.length<1||body.scores.length>4)return json({error:'Nieprawidłowe wyniki'},400);
   const entries=[];
   for(const s of body.scores){if(!s||typeof s.id!=='string'||!/^[a-zA-Z0-9-]{8,100}$/.test(s.id)||typeof s.name!=='string'||!s.name.trim()||s.name.trim().length>20||!Number.isInteger(s.time_ms)||s.time_ms<10000||s.time_ms>900000||!['easy','normal','hard'].includes(s.level)||!Number.isInteger(s.players)||s.players<1||s.players>4||!trackIds.includes(s.track??'classic'))return json({error:'Nieprawidłowy wynik'},400);
    entries.push(db.prepare('INSERT INTO race_scores (id, name, time_ms, level, players, track, rules, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING').bind(s.id,s.name.trim(),s.time_ms,s.level,s.players,s.track??'classic',5,new Date().toISOString()));
   }
   await db.batch(entries);return json({saved:true});
  }
  return json({error:'Niedozwolona metoda'},405);
 }catch(error){console.error('Scores unavailable',error.message);return json({error:'Tabela czasów chwilowo niedostępna'},503)}
}
