// Stage18-1: dependency-free counterpart of shogi/{sfen,rules,persistence}.py.
export const INITIAL = 'lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1';
export const HAND = ['R','B','G','S','N','L','P'];
export const LABEL = {P:'歩',L:'香',N:'桂',S:'銀',G:'金',B:'角',R:'飛',K:'玉'};
export const PROMOTED = {P:'と',L:'杏',N:'圭',S:'全',B:'馬',R:'龍'};
export const FORMAT = 'banjo_lab_shogi_study';
export const copy = x => structuredClone(x);
export const other = s => s === 'sente' ? 'gote' : 'sente';
const assert = (ok, msg) => { if (!ok) throw new Error(msg); };
const inside = (r,c) => r>=0 && r<9 && c>=0 && c<9;
export const square = ([r,c]) => `${9-c}${'abcdefghi'[r]}`;
const unsquare = s => { assert(/^[1-9][a-i]$/.test(s),'USI座標が不正です'); return ['abcdefghi'.indexOf(s[1]),9-Number(s[0])]; };
const now = () => new Date().toISOString();
export function parseSFEN(sfen) {
  assert(typeof sfen==='string','SFENが文字列ではありません');
  const fields=sfen.trim().split(/\s+/); assert(fields.length===4,'SFENの項目数が不正です');
  const [layout,turn,hand,n]=fields;
  assert(['b','w'].includes(turn) && /^[1-9]\d*$/.test(n) && Number.isSafeInteger(Number(n)),'SFEN手番・手数が不正です');
  const rows=layout.split('/'); assert(rows.length===9,'SFENは9段必要です');
  const board=rows.map(line=>{
    const row=[]; let promoted=false;
    for(const ch of line){
      if(ch==='+'){ assert(!promoted,'SFENの成り記号が不正です'); promoted=true; continue; }
      if(/^[1-9]$/.test(ch)){ assert(!promoted,'SFENの空マスが不正です'); row.push(...Array(Number(ch)).fill(null)); }
      else { const kind=ch.toUpperCase(); assert(Object.hasOwn(LABEL,kind) && (!promoted || Object.hasOwn(PROMOTED,kind)),'SFENの駒が不正です'); row.push({kind,owner:ch===kind?'sente':'gote',promoted}); }
      promoted=false;
    }
    assert(row.length===9 && !promoted,'SFENの筋数が不正です'); return row;
  });
  const hands={sente:Object.fromEntries(HAND.map(k=>[k,0])),gote:Object.fromEntries(HAND.map(k=>[k,0]))};
  if(hand!=='-'){
    let count=''; const seen=new Set();
    for(const ch of hand){
      if(/\d/.test(ch)){count+=ch;continue;}
      const kind=ch.toUpperCase(),side=ch===kind?'sente':'gote';
      assert(HAND.includes(kind) && !seen.has(ch) && (!count || /^[1-9]\d*$/.test(count)),'SFENの持ち駒が不正です');
      const value=count?Number(count):1; assert(Number.isSafeInteger(value),'持ち駒数が不正です');
      hands[side][kind]=value;seen.add(ch);count='';
    }
    assert(!count,'SFENの持ち駒数が不正です');
  }
  return {board,hands,turn:turn==='b'?'sente':'gote',move_number:Number(n)};
}
export function toSFEN(p){
  const board=p.board.map(row=>{let text='',empty=0; for(const pc of row){if(!pc){empty++;continue;} if(empty){text+=empty;empty=0;} text+=(pc.promoted?'+':'')+(pc.owner==='sente'?pc.kind:pc.kind.toLowerCase());} return text+(empty||'');}).join('/');
  let hand=''; for(const side of ['sente','gote'])for(const k of HAND){const n=p.hands[side][k];if(n)hand+=(n===1?'':n)+(side==='sente'?k:k.toLowerCase());}
  return `${board} ${p.turn==='sente'?'b':'w'} ${hand||'-'} ${p.move_number}`;
}
export const key = p => toSFEN(p).split(' ').slice(0,3).join(' ');
export function pseudo(p,r,c){
  const pc=p.board[r][c];if(!pc)return [];
  const f=pc.owner==='sente'?-1:1, out=[];
  const step=d=>{for(const [dr,dc]of d){const rr=r+dr,cc=c+dc;if(inside(rr,cc)&&p.board[rr][cc]?.owner!==pc.owner)out.push([rr,cc]);}};
  const slide=d=>{for(const [dr,dc]of d){let rr=r+dr,cc=c+dc;while(inside(rr,cc)){const at=p.board[rr][cc];if(!at)out.push([rr,cc]);else{if(at.owner!==pc.owner)out.push([rr,cc]);break;}rr+=dr;cc+=dc;}}};
  const gold=[[f,-1],[f,0],[f,1],[0,-1],[0,1],[-f,0]], orth=[[-1,0],[1,0],[0,-1],[0,1]],diag=[[-1,-1],[-1,1],[1,-1],[1,1]];
  if(pc.promoted && 'PLNS'.includes(pc.kind)){step(gold);return out;}
  switch(pc.kind){case'P':step([[f,0]]);break;case'L':slide([[f,0]]);break;case'N':step([[2*f,-1],[2*f,1]]);break;case'S':step([[f,-1],[f,0],[f,1],[-f,-1],[-f,1]]);break;case'G':step(gold);break;case'K':step([...orth,...diag]);break;case'B':slide(diag);if(pc.promoted)step(orth);break;case'R':slide(orth);if(pc.promoted)step(diag);break;}
  return out;
}
export function inCheck(p,side){
  let king;for(let r=0;r<9;r++)for(let c=0;c<9;c++){const pc=p.board[r][c];if(pc?.kind==='K'&&pc.owner===side)king=[r,c];}
  if(!king)return true;
  for(let r=0;r<9;r++)for(let c=0;c<9;c++)if(p.board[r][c]?.owner===other(side)&&pseudo(p,r,c).some(([rr,cc])=>rr===king[0]&&cc===king[1]))return true;
  return false;
}
function unchecked(p,source,dest,promote=false,kind=null){
  const q=copy(p),[r,c]=dest;
  if(source){const [sr,sc]=source,pc=q.board[sr][sc],captured=q.board[r][c];assert(pc && captured?.kind!=='K','玉は取れません');if(captured)q.hands[pc.owner][captured.kind]++;q.board[sr][sc]=null;q.board[r][c]={...pc,promoted:pc.promoted||promote};}
  else {q.hands[p.turn][kind]--;q.board[r][c]={kind,owner:p.turn,promoted:false};}
  return q;
}
export function promotionOptions(pc,fromRow,toRow){
  if(pc.promoted)return [false];
  const last=pc.owner==='sente'?0:8;
  if(('PL'.includes(pc.kind)&&toRow===last)||(pc.kind==='N'&&(pc.owner==='sente'?toRow<=1:toRow>=7)))return [true];
  const zone=r=>pc.owner==='sente'?r<=2:r>=6;
  return Object.hasOwn(PROMOTED,pc.kind)&&(zone(fromRow)||zone(toRow))?[false,true]:[false];
}
export function legalTargets(p,source,kind=null){
  if(source){const [r,c]=source,pc=p.board[r][c];if(!pc||pc.owner!==p.turn)return [];
    return pseudo(p,r,c).filter(dest=>p.board[dest[0]][dest[1]]?.kind!=='K'&&!inCheck(unchecked(p,source,dest),p.turn));}
  if(!HAND.includes(kind)||p.hands[p.turn][kind]<=0)return [];
  const out=[];for(let r=0;r<9;r++)for(let c=0;c<9;c++){
    if(p.board[r][c])continue;
    if(promotionOptions({kind,owner:p.turn,promoted:false},r,r).length===1&&promotionOptions({kind,owner:p.turn,promoted:false},r,r)[0])continue;
    if(kind==='P'&&p.board.some(row=>row[c]?.owner===p.turn&&row[c].kind==='P'&&!row[c].promoted))continue;
    if(!inCheck(unchecked(p,null,[r,c],false,kind),p.turn))out.push([r,c]);
  }return out;
}
export function moveFromUSI(p,usi){
  assert(typeof usi==='string'&&/^(?:[PLNSGBR]\*[1-9][a-i]|[1-9][a-i][1-9][a-i]\+?)$/.test(usi),'USI指し手が不正です');
  const drop=usi[1]==='*',source=drop?null:unsquare(usi.slice(0,2)),destination=unsquare(usi.slice(2,4));
  const piece_kind=drop?usi[0]:p.board[source[0]][source[1]]?.kind;
  assert(piece_kind,'移動元の駒がありません');
  return {side:p.turn,piece_kind,source,destination,promote:usi.endsWith('+'),drop,usi};
}
export function applyMove(p,m){
  assert(m.side===p.turn && legalTargets(p,m.source,m.piece_kind).some(([r,c])=>r===m.destination[0]&&c===m.destination[1]),'その指し手は入力できません');
  if(m.source){const pc=p.board[m.source[0]][m.source[1]];assert(pc.kind===m.piece_kind && promotionOptions(pc,m.source[0],m.destination[0]).includes(m.promote),'成りの選択が不正です');}
  else assert(!m.promote&&m.drop,'駒打ち情報が不正です');
  const q=unchecked(p,m.source,m.destination,m.promote,m.piece_kind);q.turn=other(p.turn);q.move_number++;return q;
}
const mapOK=x=>x && typeof x==='object'&&!Array.isArray(x);
export function decodeDocument(raw){
  assert(mapOK(raw)&&raw.format===FORMAT&&[1,2,3].includes(raw.schema_version),'将棋定跡のスキーマ1〜3のJSONが必要です');
  const d=copy(raw); assert(mapOK(d.openings)&&mapOK(d.positions)&&mapOK(d.moves),'定跡データの構造が不正です');
  if(d.schema_version>1){
    for(const [id,v]of Object.entries(d.openings)){assert(Array.isArray(v)&&v.length===2,'定跡レコードが不正です');d.openings[id]={opening_id:id,name:v[0],start_position_id:v[1]};}
    for(const [id,v]of Object.entries(d.positions)){assert(Array.isArray(v)&&v.length>=2&&v.length<=4,'局面レコードが不正です');const p=parseSFEN(v[1]);d.positions[id]={position_id:id,opening_id:v[0],sfen:v[1],sfen_key:key(p),move_number:p.move_number,comment:v.length>2?v[2]:'',evaluation:v.length>3?v[3]:null};}
    for(const [id,v]of Object.entries(d.moves)){
      assert(Array.isArray(v)&&v.length>=3&&v.length<=5&&Object.hasOwn(d.positions,v[0]),'指し手レコードが不正です');
      const p=parseSFEN(d.positions[v[0]].sfen),m=moveFromUSI(p,v[2]);
      assert(v.length<5 || v[4]===1 || (v[4]===2&&d.schema_version===3),'指し手属性が不正です');
      const type=v.length===5?(v[4]===1?'bad':'main'):'normal';
      const record={move_id:id,opening_id:d.positions[v[0]].opening_id,from_position_id:v[0],to_position_id:v[1],move_type:type,...m};
      if(v.length>=4 && !(v[3]===null && type!=='normal'))record.display_order=v[3];d.moves[id]=record;
    }
  }
  d.schema_version=1;validateDocument(d);return d;
}
const fields=(v,allowed)=>assert(Object.keys(v).every(k=>allowed.includes(k)),'未対応の保存項目があります。元のJSONは変更されません');
export function validateDocument(d){
  assert(Object.keys(d.openings).length>0 && Object.hasOwn(d.openings,d.active_opening_id),'選択中の定跡がありません');
  assert(typeof d.created_at==='string' && typeof d.updated_at==='string' && Number.isFinite(Date.parse(d.created_at))&&Number.isFinite(Date.parse(d.updated_at))&&Date.parse(d.updated_at)>=Date.parse(d.created_at),'保存日時が不正です');
  const parsed=new Map(), signatures=new Set(), groups=new Map(),edges=new Set();
  for(const [id,o]of Object.entries(d.openings)){
    assert(/^opening_0*[1-9]\d*$/.test(id)&&o.opening_id===id&&typeof o.name==='string'&&o.name.trim(),'定跡ID・名称が不正です');
    fields(o,['opening_id','name','start_position_id']);
    // Legacy raw documents may omit the explicit root.
    o.start_position_id??=Object.keys(d.positions).filter(k=>d.positions[k].opening_id===id).sort()[0];
    assert(d.positions[o.start_position_id]?.opening_id===id,'定跡の開始局面がありません');
  }
  for(const [id,v]of Object.entries(d.positions)){
    assert(/^position_0*[1-9]\d*$/.test(id)&&v.position_id===id&&Object.hasOwn(d.openings,v.opening_id),'局面IDが不正です');
    fields(v,['position_id','opening_id','sfen','sfen_key','move_number','comment','evaluation']);
    const p=parseSFEN(v.sfen);assert(v.sfen_key===key(p)&&v.move_number===p.move_number&&typeof v.comment==='string'&&(v.evaluation===null||Number.isSafeInteger(v.evaluation)),'局面の保存内容が不正です');
    const sig=v.opening_id+'|'+key(p);assert(!signatures.has(sig),'同じ定跡内に重複局面があります');signatures.add(sig);parsed.set(id,p);
  }
  for(const [id,m]of Object.entries(d.moves)){
    assert(/^move_0*[1-9]\d*$/.test(id)&&m.move_id===id&&['normal','main','bad'].includes(m.move_type),'指し手ID・属性が不正です');
    fields(m,['move_id','opening_id','from_position_id','to_position_id','move_type','side','piece_kind','source','destination','promote','drop','usi','display_order']);
    const from=d.positions[m.from_position_id],to=d.positions[m.to_position_id];assert(from&&to&&from.opening_id===m.opening_id&&to.opening_id===m.opening_id,'指し手の参照が不正です');
    const expected=moveFromUSI(parsed.get(m.from_position_id),m.usi);
    for(const k of ['side','piece_kind','source','destination','promote','drop'])assert(JSON.stringify(expected[k])===JSON.stringify(m[k]),'USIと指し手情報が一致しません');
    assert(key(applyMove(parsed.get(m.from_position_id),m))===to.sfen_key,'指し手の結果と移動先が一致しません');
    const sig=m.from_position_id+'|'+m.usi;assert(!edges.has(sig),'同一指し手が重複しています');edges.add(sig);
    const group=groups.get(m.from_position_id)||[];group.push(m);groups.set(m.from_position_id,group);
  }
  for(const g of groups.values())if(g.some(m=>Object.hasOwn(m,'display_order'))){const orders=g.map(m=>m.display_order);assert(orders.every(n=>Number.isSafeInteger(n)&&n>=0)&&orders.sort((a,b)=>a-b).every((n,i)=>n===i),'候補手表示順が不正です');}
  return d;
}
export function encodeDocument(d){
  const out={format:FORMAT,schema_version:3,created_at:d.created_at,updated_at:d.updated_at,active_opening_id:d.active_opening_id,openings:{},positions:{},moves:{}};
  for(const [id,v]of Object.entries(d.openings))out.openings[id]=[v.name,v.start_position_id];
  for(const [id,v]of Object.entries(d.positions)){const row=[v.opening_id,v.sfen];if(v.evaluation!==null)row.push(v.comment,v.evaluation);else if(v.comment!=='')row.push(v.comment);out.positions[id]=row;}
  for(const [id,v]of Object.entries(d.moves)){const row=[v.from_position_id,v.to_position_id,v.usi];if(Object.hasOwn(v,'display_order'))row.push(v.display_order);else if(v.move_type!=='normal')row.push(null);if(v.move_type!=='normal')row.push(v.move_type==='bad'?1:2);out.moves[id]=row;}
  return out;
}
export function freshDocument(){const t=now(),p=parseSFEN(INITIAL);return {format:FORMAT,schema_version:1,created_at:t,updated_at:t,active_opening_id:'opening_1',openings:{opening_1:{opening_id:'opening_1',name:'無題の定跡',start_position_id:'position_000001'}},positions:{position_000001:{position_id:'position_000001',opening_id:'opening_1',sfen:INITIAL,sfen_key:key(p),move_number:1,comment:'',evaluation:null}},moves:{}};}
export function nextID(map,prefix){let max=0;for(const id of Object.keys(map))max=Math.max(max,Number(id.split('_')[1])||0);return prefix+'_'+(prefix==='opening'?String(max+1):String(max+1).padStart(6,'0'));}
export function candidates(d,pid){const list=Object.values(d.moves).filter(m=>m.from_position_id===pid),p=parseSFEN(d.positions[pid].sfen);const cmp=(a,b)=>a<b?-1:a>b?1:0;return list.sort((a,b)=>Object.hasOwn(a,'display_order')?a.display_order-b.display_order||cmp(a.move_id,b.move_id):cmp(moveLabel(a,p),moveLabel(b,p))||cmp(a.move_id,b.move_id));}
export function registerMove(d,pid,m){
  const from=d.positions[pid],p=parseSFEN(from.sfen),q=applyMove(p,m);const existing=candidates(d,pid).find(x=>x.usi===m.usi);if(existing)return {pid:existing.to_position_id,mid:existing.move_id,added:false};
  let to=Object.values(d.positions).find(x=>x.opening_id===from.opening_id&&x.sfen_key===key(q));
  if(!to){const id=nextID(d.positions,'position');to={position_id:id,opening_id:from.opening_id,sfen:toSFEN(q),sfen_key:key(q),move_number:q.move_number,comment:'',evaluation:null};d.positions[id]=to;}
  const list=candidates(d,pid),id=nextID(d.moves,'move'),v={move_id:id,opening_id:from.opening_id,from_position_id:pid,to_position_id:to.position_id,move_type:'normal',...m};
  if(list.some(x=>Object.hasOwn(x,'display_order')))v.display_order=list.length;
  d.moves[id]=v;return {pid:to.position_id,mid:id,added:true};
}
export function stableJSON(x){if(Array.isArray(x))return '['+x.map(stableJSON).join(',')+']';if(mapOK(x))return '{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+stableJSON(x[k])).join(',')+'}';return JSON.stringify(x);}
export function contentSignature(d){return stableJSON({openings:d.openings,positions:d.positions,moves:d.moves});}
export async function sha256(text){const data=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));return [...new Uint8Array(data)].map(x=>x.toString(16).padStart(2,'0')).join('');}
// Python's canonical checksum uses ensure_ascii=False and compact separators.
export async function importJSON(text){
  const raw=JSON.parse(text);
  if(raw?.format==='banjo_lab_shogi_backup'){
    assert(raw.schema_version===1&&['all_openings','single_opening'].includes(raw.backup_scope),'バックアップ形式が不正です');
    assert(await sha256(stableJSON(raw.study_data))===raw.payload_sha256,'バックアップのチェックサムが一致しません');return decodeDocument(raw.study_data);
  }
  if(raw?.format==='banjo_lab_shogi_offline_workspace'){
    assert(raw.workspace_version===1&&await sha256(stableJSON(raw.payload))===raw.payload_sha256,'端末バックアップのチェックサムが一致しません');return decodeDocument(raw.payload.document);
  }
  return decodeDocument(raw);
}
export function moveLabel(m,p){
  const pc=m.source?p.board[m.source[0]][m.source[1]]:null,origins=[];
  for(let r=0;r<9;r++)for(let c=0;c<9;c++){const at=p.board[r][c];if(at?.owner===m.side&&at.kind===m.piece_kind&&at.promoted===(pc?.promoted||false)&&legalTargets(p,[r,c]).some(([rr,cc])=>rr===m.destination[0]&&cc===m.destination[1]))origins.push([r,c]);}
  let direction='',ending='';
  if(m.drop)ending=origins.length?'打':'';
  else{
    ending=m.promote?'成':promotionOptions(pc,m.source[0],m.destination[0]).includes(true)?'不成':'';
    if(origins.length>1 && !(m.piece_kind==='P'||m.piece_kind==='L'||m.piece_kind==='K')){
      const vertical=r=>r===m.destination[0]?'side':(m.side==='sente'?r>m.destination[0]:r<m.destination[0])?'up':'back',horizontal=c=>c===m.destination[1]?'straight':(m.side==='sente'?c>m.destination[1]:c<m.destination[1])?'right':'left';
      const vn={up:'上',side:'寄',back:'引'},hn={straight:'直',right:'右',left:'左'},v=vertical(m.source[0]),h=horizontal(m.source[1]);
      const rightmost=[...origins].sort((a,b)=>m.side==='sente'?b[1]-a[1]:a[1]-b[1])[0],right=m.source[0]===rightmost[0]&&m.source[1]===rightmost[1];
      if(m.piece_kind==='N'&&!pc.promoted)direction=right?'右':'左';
      else if(origins.filter(([r])=>vertical(r)===v).length===1)direction=vn[v];
      else if('RB'.includes(m.piece_kind))direction=right?'右':'左';
      else if(origins.filter(([,c])=>horizontal(c)===h).length===1)direction=h==='straight'&&v!=='up'?vn[v]:hn[h];
      else direction=h==='straight'?vn[v]:hn[h]+vn[v];
    }
  }
  return (m.side==='sente'?'▲':'△')+(9-m.destination[1])+'一二三四五六七八九'[m.destination[0]]+(pc?.promoted?PROMOTED[m.piece_kind]:LABEL[m.piece_kind])+direction+ending;
}
