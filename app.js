import {INITIAL,HAND,LABEL,PROMOTED,copy,parseSFEN,toSFEN,key,legalTargets,promotionOptions,moveFromUSI,applyMove,square,freshDocument,decodeDocument,encodeDocument,validateDocument,nextID,candidates,registerMove,importJSON,contentSignature,stableJSON,sha256,moveLabel,inCheck} from './core.js';
import {LocalStore} from './storage.js';
import {destinationKey,readRemote,saveRemote,validateConfig} from './github.js';
const $=id=>document.getElementById(id), svgNS='http://www.w3.org/2000/svg';
const store=new LocalStore();let data,view,sync={},selection=null,ready=false,busy=false,storageError=false,saveNumber=0,dialogKind='',pendingImport=null,remoteCopy=null;
function el(tag,text,cls){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;}
function button(text,fn,cls){const b=el('button',text,cls);b.onclick=()=>action(fn);return b;}
function notice(msg){$('notice').textContent=msg;$('notice').hidden=!msg;}
function action(fn){try{const result=fn();if(result?.catch)result.catch(error=>notice(error.message));}catch(error){notice(error.message);}}
function editable(){if(storageError)throw new Error('保存が停止しています。保存・設定からJSONを退避して、再読み込みしてください');if(busy)throw new Error('保存・読込の完了を待ってください');}
function current(){return data.positions[currentID()];}
function currentID(){return session().positions[session().cursor];}
function session(){return view.sessions[data.active_opening_id];}
function resetView(d){return {sessions:Object.fromEntries(Object.values(d.openings).map(o=>[o.opening_id,{positions:[o.start_position_id],moves:[],cursor:0}])),flip:false,boardStyle:'text',draft:null};}
function normalizeView(d,v){
  const out=resetView(d);out.flip=!!v?.flip;out.boardStyle=v?.boardStyle==='pieces'?'pieces':'text';
  for(const [oid,o]of Object.entries(d.openings)){
    const s=v?.sessions?.[oid];if(!s||!Array.isArray(s.positions)||!Array.isArray(s.moves)||s.positions.length!==s.moves.length+1||!Number.isInteger(s.cursor)||s.cursor<0||s.cursor>=s.positions.length)continue;
    if(d.positions[s.positions[0]]?.opening_id!==oid)continue;
    let length=1;
    for(let i=0;i<s.moves.length;i++){const m=d.moves[s.moves[i]];if(d.positions[s.positions[i+1]]?.opening_id!==oid||m?.from_position_id!==s.positions[i]||m?.to_position_id!==s.positions[i+1])break;length++;}
    out.sessions[oid]={positions:s.positions.slice(0,length),moves:s.moves.slice(0,length-1),cursor:Math.min(s.cursor,length-1)};
  }
  if(v?.draft&&d.positions[v.draft.pid]&&['comment','evaluation'].includes(v.draft.kind)&&typeof v.draft.text==='string')out.draft=copy(v.draft);
  return out;
}
function snapshot(){return {document:encodeDocument(data),view:copy(view),sync:copy(sync)};}
function journal(){return store.checkpoint(view,{documentCreatedAt:data.created_at,documentUpdatedAt:data.updated_at,activeOpeningId:data.active_opening_id});}
function persist({changed=false,backup=false}={}){
  if(changed)data.updated_at=new Date(Math.max(Date.now(),Date.parse(data.created_at))).toISOString();
  const checkpoint=journal(),n=++saveNumber;$('saved').textContent='端末に保存中…';
  const task=store.save(snapshot(),backup);
  task.then(()=>{if(n===saveNumber)$('saved').textContent=checkpoint?'端末に保存済み':'端末保存済み（復元補助なし）';}).catch(e=>{storageError=true;$('saved').textContent='端末保存に失敗';notice(e.message+'\n保存・設定からJSONを退避できます。');});return task;
}
function navigate(pid,mid){const s=session();s.positions=s.positions.slice(0,s.cursor+1);s.moves=s.moves.slice(0,s.cursor);s.positions.push(pid);s.moves.push(mid);s.cursor++;selection=null;persist();render();}
function boardPosition(){return parseSFEN(current().sfen);}
function render(){
  if(!ready)return;
  const select=$('opening');select.replaceChildren();for(const o of Object.values(data.openings)){const option=el('option',o.name);option.value=o.opening_id;select.append(option);}select.value=data.active_opening_id;select.disabled=busy||storageError;
  const p=boardPosition(),pid=currentID(),s=session(),list=candidates(data,pid);
  $('playArea').dataset.boardStyle=view.boardStyle;$('boardStyle').textContent=view.boardStyle==='pieces'?'文字表示へ':'駒表示へ';$('boardStyle').setAttribute('aria-pressed',String(view.boardStyle==='pieces'));$('boardStyle').disabled=busy||storageError;
  $('turn').textContent=(p.turn==='sente'?'▲ 先手':'△ 後手')+'番 · '+s.cursor+'手の閲覧履歴'+(inCheck(p,p.turn)?' · 王手':'');
  $('back').disabled=s.cursor===0||busy;$('forward').disabled=s.cursor===s.positions.length-1||busy;
  $('files').replaceChildren(...Array.from({length:9},(_,i)=>el('span',view.flip?i+1:9-i)));
  const targets=selection?legalTargets(p,selection.source,selection.kind):[];
  const last=s.cursor?data.moves[s.moves[s.cursor-1]]:null;
  const board=$('board');board.replaceChildren();
  for(let i=0;i<81;i++){
    const rr=Math.floor(i/9),cc=i%9,r=view.flip?8-rr:rr,c=view.flip?8-cc:cc,pc=p.board[r][c];
    const b=button('',()=>tapSquare(r,c));b.dataset.square=square([r,c]);b.setAttribute('aria-label',`${9-c}${'一二三四五六七八九'[r]} ${pc?(pc.owner==='sente'?'先手':'後手')+(pc.promoted?PROMOTED[pc.kind]:LABEL[pc.kind]):'空'}`);
    if(pc){const node=el('span',pc.promoted?PROMOTED[pc.kind]:LABEL[pc.kind],'piece'+(pc.promoted?' promoted':'')+(pc.owner===(view.flip?'sente':'gote')?' gote':''));b.append(node);}
    if(selection?.source?.[0]===r&&selection.source[1]===c)b.classList.add('selected');
    if(targets.some(([tr,tc])=>tr===r&&tc===c))b.classList.add('target');
    const lastFrom=last?.source?.[0]===r&&last.source[1]===c,lastTo=last?.destination[0]===r&&last.destination[1]===c;
    if(lastFrom||lastTo){b.classList.add('last');b.setAttribute('aria-label',b.getAttribute('aria-label')+(lastFrom?'（直前の移動元）':'（直前の移動先）'));}
    board.append(b);
  }
  renderHand('topHand',view.flip?'sente':'gote',p);renderHand('bottomHand',view.flip?'gote':'sente',p);
  $('candidates').replaceChildren();
  for(const m of list){const b=button(moveLabel(m,p),()=>{editable();navigate(m.to_position_id,m.move_id);},m.move_type);b.dataset.move=m.move_id;if(m.move_type!=='normal')b.append(el('span',m.move_type==='main'?'本線':'悪手','badge'));$('candidates').append(b);}
  if(!list.length)$('candidates').append(el('span','登録手はありません。盤面から入力できます。','muted'));
  const comment=current().comment||'（コメントなし）',commentChanged=$('comment').dataset.position!==pid||$('commentText').textContent!==comment;
  $('commentText').textContent=comment;if(commentChanged)$('comment').scrollTop=0;$('comment').dataset.position=pid;
  const evaluation=current().evaluation;$('eval').textContent=evaluation===null?'未設定':(evaluation>0?'+':'')+evaluation;
  renderArrows(list);
}
function renderHand(id,side,p){
  const wrap=$(id);wrap.replaceChildren(el('b',side==='sente'?'先手':'後手'));let count=0;
  for(const kind of HAND){const n=p.hands[side][kind];if(!n)continue;count++;
    const b=button('',()=>{editable();selection={source:null,kind};render();});b.append(el('span',LABEL[kind],'hand-piece'));if(n>1)b.append(el('span',String(n),'hand-count'));b.setAttribute('aria-label',(side==='sente'?'先手':'後手')+'の持ち駒 '+LABEL[kind]+n+'枚');b.disabled=p.turn!==side||busy||storageError;if(selection?.source===null&&selection.kind===kind&&p.turn===side)b.classList.add('active');b.dataset.hand=kind;wrap.append(b);
  }if(!count)wrap.append(el('span','持ち駒なし','empty'));
}
function renderArrows(list){
  const g=$('arrowLines');g.replaceChildren();
  // One overlay spans both hands and the board. Actual element rectangles keep
  // drop arrows aligned even when hand buttons wrap or the board is flipped.
  const area=$('playArea').getBoundingClientRect(),board=$('board').getBoundingClientRect();
  if(!area.width||!area.height||!board.width||!board.height)return;
  $('arrows').setAttribute('viewBox',`0 0 ${area.width} ${area.height}`);
  const xy=([r,c])=>[board.left-area.left+((view.flip?8-c:c)+.5)*board.width/9,board.top-area.top+((view.flip?8-r:r)+.5)*board.height/9];
  const priority={main:2,normal:1,bad:0},paths=new Map();
  for(const m of list){
    const path=(m.source?m.source.join(','):m.piece_kind+'*')+'>'+m.destination.join(',');
    if(!paths.has(path)||priority[m.move_type]>priority[paths.get(path).move_type])paths.set(path,m);
  }
  const node=(tag,attrs)=>{const n=document.createElementNS(svgNS,tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,v);return n;};
  // Pixel dimensions, colors and opacities match Stage17-4I's CSS polygons.
  const shape=(length,height,head,low,high)=>`0,${height*low} ${length-head},${height*low} ${length-head},0 ${length},${height/2} ${length-head},${height} ${length-head},${height*high} 0,${height*high}`;
  for(const m of paths.values()){
    let origin;
    if(m.source)origin=xy(m.source);
    else{
      const hand=$((m.side===(view.flip?'gote':'sente'))?'bottomHand':'topHand');
      const button=Array.from(hand.children).find(n=>n.dataset.hand===m.piece_kind);if(!button)continue;
      const rect=button.getBoundingClientRect();origin=[rect.left-area.left+rect.width/2,rect.top-area.top+rect.height/2];
    }
    const [x1,y1]=origin,[x2,y2]=xy(m.destination),length=Math.hypot(x2-x1,y2-y1);if(length<18)continue;
    const main=m.move_type==='main',bad=m.move_type==='bad',height=main?30:22,innerHeight=main?22:16;
    const group=node('g',{'class':'candidate-arrow '+m.move_type,'data-origin':m.source?square(m.source):m.piece_kind+'*','data-destination':square(m.destination),transform:`translate(${x1} ${y1}) rotate(${Math.atan2(y2-y1,x2-x1)*180/Math.PI}) translate(0 ${-height/2})`});
    group.append(node('polygon',{'class':'arrow-outline',points:shape(length,height,14,.36,.64),fill:main?'rgba(45,30,20,0.48)':'rgba(45,30,20,0.38)'}));
    group.append(node('polygon',{'class':'arrow-color',points:shape(length-4,innerHeight,11,.35,.65),transform:`translate(2 ${main?4:3})`,fill:bad?'url(#bad-arrow-stripes)':main?'rgba(230,55,55,0.48)':'rgba(230,55,55,0.30)'}));
    if(bad){
      const mark=node('g',{'class':'arrow-bad-mark',transform:`translate(${length-19.5} ${height/2})`});
      mark.append(node('circle',{r:7,fill:'rgba(25,55,120,0.92)',stroke:'rgba(255,255,255,0.82)','stroke-width':1}));
      const cross=node('text',{x:0,y:0,'text-anchor':'middle','dominant-baseline':'central',fill:'white','font-family':'sans-serif','font-size':12,'font-weight':900});cross.textContent='×';mark.append(cross);group.append(mark);
    }
    g.append(group);
  }
}
function redrawArrows(){if(ready)renderArrows(candidates(data,currentID()));}
window.addEventListener('resize',redrawArrows);
if(typeof ResizeObserver!=='undefined'){const observer=new ResizeObserver(redrawArrows);observer.observe($('playArea'));}
function tapSquare(r,c){
  editable();const p=boardPosition();
  if(selection&&legalTargets(p,selection.source,selection.kind).some(([rr,cc])=>rr===r&&cc===c)){
    const usi=(selection.source?square(selection.source):selection.kind+'*')+square([r,c]),m=moveFromUSI(p,usi);
    const options=m.source?promotionOptions(p.board[m.source[0]][m.source[1]],m.source[0],r):[false];
    if(options.length===2){openDialog('成りを選択','promotion');const actions=el('div',undefined,'actions');for(const promote of options)actions.append(button(promote?'成る':'成らない',()=>{closeDialog();enterMove({...m,promote,usi:usi+(promote?'+':'')});},promote?'primary':null));$('dialogBody').append(actions);}
    else enterMove({...m,promote:options[0],usi:usi+(options[0]?'+':'')});return;
  }
  const pc=p.board[r][c];if(pc?.owner===p.turn){selection=selection?.source?.[0]===r&&selection.source[1]===c?null:{source:[r,c],kind:pc.kind};render();}else{selection=null;render();}
}
function enterMove(m){editable();const result=registerMove(data,currentID(),m);if(result.added)data.updated_at=new Date().toISOString();navigate(result.pid,result.mid);}
function openDialog(title,kind=''){dialogKind=kind;$('dialogBody').replaceChildren(el('h2',title));if(!$('dialog').open)$('dialog').showModal();}
function closeDialog(){$('dialog').close();$('dialogBody').replaceChildren();dialogKind='';}
$('closeDialog').onclick=closeDialog;
$('dialog').addEventListener('close',()=>{const token=$('ghToken');if(token)token.value='';});
$('dialog').addEventListener('cancel',()=>{if(busy)return;closeDialog();});
function editPosition(kind){
  editable();const pid=currentID(),record=current(),draft=view.draft?.pid===pid&&view.draft.kind===kind?view.draft:null;
  openDialog(kind==='comment'?'局面コメント':'局面評価値','editor');
  const input=el(kind==='comment'?'textarea':'input');input.id='editor';if(kind==='evaluation'){input.type='text';input.inputMode='numeric';}
  input.value=draft?draft.text:kind==='comment'?record.comment:record.evaluation??'';$('dialogBody').append(input);
  input.oninput=()=>{view.draft={pid,kind,text:input.value};persist();};
  const actions=el('div',undefined,'actions');actions.append(button('確定',()=>{editable();if(kind==='evaluation'&&input.value.trim()&&!/^-?\d+$/.test(input.value.trim()))throw new Error('評価値は整数または空欄で入力してください');const v=kind==='comment'?input.value:input.value.trim()?Number(input.value):null;if(kind==='evaluation'&&v!==null&&!Number.isSafeInteger(v))throw new Error('評価値が大きすぎます');record[kind]=v;view.draft=null;persist({changed:true});closeDialog();render();},'primary'),button('入力を破棄',()=>{view.draft=null;persist();closeDialog();}));$('dialogBody').append(actions);input.focus();
}
function attributes(){
  editable();const pid=currentID(),p=boardPosition(),list=candidates(data,pid);openDialog('指し手属性・候補順','attributes');
  if(!list.length){$('dialogBody').append(el('p','現在局面に登録手がありません。'));return;}
  list.forEach((m,i)=>{
    const row=el('div',undefined,'attribute-row'),select=el('select');for(const [v,t]of [['main','本線'],['normal','通常手'],['bad','悪手']]){const o=el('option',t);o.value=v;select.append(o);}select.value=m.move_type;select.setAttribute('aria-label',moveLabel(m,p)+'の属性');
    select.onchange=()=>action(()=>{editable();m.move_type=select.value;persist({changed:true});render();});
    const reorder=(delta)=>{editable();const ordered=list.map(m=>m.move_id);[ordered[i],ordered[i+delta]]=[ordered[i+delta],ordered[i]];ordered.forEach((id,n)=>data.moves[id].display_order=n);persist({changed:true});render();attributes();};
    const up=button('↑',()=>reorder(-1)),down=button('↓',()=>reorder(1));up.disabled=i===0;down.disabled=i===list.length-1;row.append(el('span',moveLabel(m,p)),select,up,down);$('dialogBody').append(row);
  });
  $('dialogBody').append(el('p','属性は選択時に端末保存します。↑↓で候補手の表示順を変更できます。'));
  for(const m of list)$('dialogBody').append(button(moveLabel(m,p)+'を削除',()=>confirmDelete(m),'danger'));
}
function confirmDelete(m){openDialog('登録手を削除');$('dialogBody').append(el('p','この辺を削除します。合流先の局面やコメントは保持します。候補順を再採番し、この辺を含む閲覧履歴を短縮します。'));
  $('dialogBody').append(button('この登録手を削除',()=>{editable();delete data.moves[m.move_id];const list=candidates(data,m.from_position_id);if(list.some(x=>Object.hasOwn(x,'display_order')))list.forEach((x,i)=>x.display_order=i);view=normalizeView(data,view);persist({changed:true,backup:true});closeDialog();render();},'danger'));}
function goRoot(){editable();view.sessions[data.active_opening_id]={positions:[data.openings[data.active_opening_id].start_position_id],moves:[],cursor:0};selection=null;persist();render();}
function graph(){
  openDialog('定跡全体図','graph');const oid=data.active_opening_id,root=data.openings[oid].start_position_id;
  const depth=new Map([[root,0]]),parents=new Map(),queue=[root];let index=0;
  // BFS visits each position once, so transpositions and cycles stay finite.
  const adjacency=new Map();for(const m of Object.values(data.moves).filter(m=>m.opening_id===oid)){const a=adjacency.get(m.from_position_id)||[];a.push(m);adjacency.set(m.from_position_id,a);}
  while(index<queue.length){const id=queue[index++];for(const m of adjacency.get(id)||[])if(!depth.has(m.to_position_id)){depth.set(m.to_position_id,depth.get(id)+1);parents.set(m.to_position_id,m);queue.push(m.to_position_id);}}
  const all=Object.values(data.positions).filter(v=>v.opening_id===oid);for(const v of all)if(!depth.has(v.position_id))depth.set(v.position_id,0);
  const layers=new Map();for(const v of all){const n=depth.get(v.position_id),a=layers.get(n)||[];a.push(v);layers.set(n,a);}
  const coordinates=new Map();for(const [n,a]of layers)a.forEach((v,i)=>coordinates.set(v.position_id,[20+i*155,20+n*105]));
  const width=Math.max(310,...[...layers.values()].map(a=>a.length*155+30)),height=(Math.max(...layers.keys())+1)*105+30;
  const wrap=el('div',undefined,'graph-wrap'),svg=document.createElementNS(svgNS,'svg');svg.setAttribute('width',width);svg.setAttribute('height',height);
  for(const m of Object.values(data.moves).filter(m=>m.opening_id===oid)){
    const [x1,y1]=coordinates.get(m.from_position_id),[x2,y2]=coordinates.get(m.to_position_id),line=document.createElementNS(svgNS,'path');line.setAttribute('d',`M${x1+65},${y1+52} C${x1+65},${y1+77} ${x2+65},${y2-25} ${x2+65},${y2}`);line.setAttribute('class','edge '+m.move_type);svg.append(line);
    const text=document.createElementNS(svgNS,'text');text.setAttribute('x',(x1+x2)/2+70);text.setAttribute('y',(y1+y2)/2+42);text.textContent=m.usi;svg.append(text);
  }
  for(const v of all){const [x,y]=coordinates.get(v.position_id),g=document.createElementNS(svgNS,'g');g.setAttribute('class','node'+(v.position_id===currentID()?' current':''));g.setAttribute('tabindex','0');g.setAttribute('role','button');g.setAttribute('aria-label','局面 '+v.position_id);const rect=document.createElementNS(svgNS,'rect');for(const [k,n]of Object.entries({x,y,width:130,height:52,rx:7}))rect.setAttribute(k,n);g.append(rect);
    const text=document.createElementNS(svgNS,'text');text.setAttribute('x',x+9);text.setAttribute('y',y+21);text.textContent=v.position_id.replace('position_','#');g.append(text);const sub=document.createElementNS(svgNS,'text');sub.setAttribute('x',x+9);sub.setAttribute('y',y+40);sub.textContent=(v.evaluation===null?'評価未設定':`評価 ${v.evaluation}`)+(v.comment?' · コメント':'');g.append(sub);
    const jump=()=>action(()=>{editable();const path=[v.position_id],moves=[];let cursor=v.position_id;while(parents.has(cursor)){const m=parents.get(cursor);moves.unshift(m.move_id);path.unshift(m.from_position_id);cursor=m.from_position_id;}view.sessions[oid]={positions:path,moves,cursor:path.length-1};selection=null;persist();closeDialog();render();});g.onclick=jump;g.onkeydown=e=>{if(e.key==='Enter')jump();};svg.append(g);
  }
  wrap.append(svg);$('dialogBody').append(el('p',`${all.length}局面 · ${Object.values(data.moves).filter(m=>m.opening_id===oid).length}指し手。線は同一局面の合流も表示します。局面をタップして移動できます。`),wrap);
}
function download(name,obj){const a=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify(obj,null,2)],{type:'application/json'}));a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
const stamp=()=>new Date().toISOString().replace(/[:.]/g,'-');
function exportJSON(){validateDocument(data);download('shogi_stage18_1_'+stamp()+'.json',encodeDocument(data));}
async function exportWorkspace(){const payload={document:encodeDocument(data),view:copy(view)};download('shogi_workspace_stage18_1_'+stamp()+'.json',{format:'banjo_lab_shogi_offline_workspace',workspace_version:1,payload_sha256:await sha256(stableJSON(payload)),payload});}
function menu(){
  openDialog('保存・設定','menu');
  $('dialogBody').append(el('p','端末には入力ごとに自動保存します。GitHubへの保存はオンライン時に操作してください。'));
  const actions=el('div',undefined,'actions');actions.append(button('JSON書き出し（スキーマ3）',exportJSON,'primary'),button('端末バックアップ（履歴込み）',exportWorkspace),button('JSON取り込み',()=>{editable();$('importFile').click();}),button('GitHub読込・保存',githubPanel),button('新しい定跡',newOpening),button('定跡名を変更',renameOpening),button('置換前のデータを復元',restoreBeforeReplace),button('端末の保存保持を要求',requestPersistence));$('dialogBody').append(actions);
  const status=sync.baselines?.[sync.config?destinationKey(sync.config):''];$('dialogBody').append(el('p',status?'GitHub保存: '+(status.signature===contentSignature(data)?'同期済み':'端末に未送信の変更があります'):'GitHub保存の基準は未設定です。'));
  $('dialogBody').append(el('p','iPhoneはSafariでHTTPSのページを開き、共有メニューからホーム画面に追加します。追加したアイコンから起動して「オフライン準備完了」を確認し、その画面でJSONを取り込んでください。'));
  if(view.draft)$('dialogBody').append(button('途中の編集を再開',()=>{const draft=view.draft;data.active_opening_id=data.positions[draft.pid].opening_id;const s=session();const i=s.positions.indexOf(draft.pid);if(i>=0)s.cursor=i;else view.sessions[data.active_opening_id]={positions:[draft.pid],moves:[],cursor:0};persist();render();editPosition(draft.kind);},'primary'));
}
function newOpening(){editable();openDialog('新しい定跡');const input=el('input');input.id='openingName';input.placeholder='定跡名';$('dialogBody').append(input,button('作成',()=>{editable();const name=input.value.trim();if(!name)throw new Error('定跡名を入力してください');const oid=nextID(data.openings,'opening'),pid=nextID(data.positions,'position'),p=parseSFEN(INITIAL);data.openings[oid]={opening_id:oid,name,start_position_id:pid};data.positions[pid]={position_id:pid,opening_id:oid,sfen:INITIAL,sfen_key:key(p),move_number:1,comment:'',evaluation:null};data.active_opening_id=oid;view.sessions[oid]={positions:[pid],moves:[],cursor:0};persist({changed:true});closeDialog();render();},'primary'));}
function renameOpening(){editable();openDialog('定跡名を変更');const input=el('input');input.value=data.openings[data.active_opening_id].name;$('dialogBody').append(input,button('変更',()=>{editable();const name=input.value.trim();if(!name)throw new Error('定跡名を入力してください');data.openings[data.active_opening_id].name=name;persist({changed:true});closeDialog();render();},'primary'));}
async function requestPersistence(){const granted=await navigator.storage?.persist?.();notice(granted?'端末の保存保持が許可されました。JSONバックアップも保存してください。':'保存保持の許可は得られませんでした。自動保存は動作します。JSONバックアップも保存してください。');}
async function restoreBeforeReplace(){editable();const old=await store.read('before-replace');if(!old)throw new Error('置換前のデータはありません');const d=decodeDocument(old.document);confirmImport({d,v:old.view,label:'置換前の端末データ'});}
$('importFile').onchange=()=>action(async()=>{
  const file=$('importFile').files[0];$('importFile').value='';if(!file)return;editable();const text=await file.text(),raw=JSON.parse(text),d=await importJSON(text);
  const v=raw.format==='banjo_lab_shogi_offline_workspace'?raw.payload.view:null;confirmImport({d,v,label:file.name});
});
function confirmImport({d,v,label,baseline=null}){
  pendingImport={d,v,baseline};openDialog('取り込み内容を確認');$('dialogBody').append(el('p',label),el('p',`${Object.keys(d.openings).length}定跡・${Object.keys(d.positions).length}局面・${Object.keys(d.moves).length}指し手。端末の全定跡を置き換えます。置換前のデータは端末に1世代保持します。`));
  $('dialogBody').append(button('現在のJSONを先に書き出す',exportJSON),button('この内容で取り込む',async()=>{editable();const item=pendingImport;pendingImport=null;data=item.d;view=normalizeView(data,item.v);selection=null;if(item.baseline){sync.baselines??={};sync.baselines[destinationKey(sync.config)]=item.baseline;}else sync.baselines={};await persist({backup:true});closeDialog();notice('JSONを取り込み、端末に保存しました。');render();},'primary'));
}
function labelInput(parent,label,id,value,type='text'){const l=el('label',label),input=el('input');input.id=id;input.type=type;input.value=value||'';input.autocapitalize='off';input.autocomplete='off';input.spellcheck=false;l.append(input);parent.append(l);return input;}
function githubPanel(){
  openDialog('GitHub読込・保存','github');const body=$('dialogBody'),c=sync.config||{};
  labelInput(body,'所有者','ghOwner',c.owner);labelInput(body,'リポジトリ','ghRepo',c.repo);labelInput(body,'ブランチ','ghBranch',c.branch||'main');labelInput(body,'JSONパス','ghPath',c.path||'shogi_study_data.json');labelInput(body,'今回の操作用トークン（保存しません）','ghToken','', 'password');
  body.append(el('p','対象リポジトリだけにContents権限を付けたトークンを使用します。トークンは操作終了・画面を閉じる・最小化時に消去します。機内モード中は端末保存とJSON書き出しを使用してください。'));
  const actions=el('div',undefined,'actions');actions.append(button('GitHub JSONを退避',()=>githubOperation('download')),button('GitHubから取り込む',()=>githubOperation('load')),button('接続・基準を確認',()=>githubOperation('connect')),button('GitHubへ保存',()=>githubOperation('save'),'primary'),button('新規JSONパスへ保存',()=>githubOperation('create')));body.append(actions);
  body.append(el('p','競合時には自動合流・強制上書きを行いません。端末JSONとGitHub JSONを退避し、採用する内容を取り込んでから保存してください。新規JSONはオンライン版の外部保存設定で同じパスを指定して利用できます。'));
}
async function githubOperation(operation){
  editable();const c=validateConfig({owner:$('ghOwner').value.trim(),repo:$('ghRepo').value.trim(),branch:$('ghBranch').value.trim(),path:$('ghPath').value.trim()}),token=$('ghToken').value.trim();
  busy=true;render();
  try{
    sync.config=c;await persist();const baseline=sync.baselines?.[destinationKey(c)];$('saved').textContent='GitHubと通信中…';
    if(operation==='save'||operation==='create'){
      const result=await saveRemote(c,token,data,baseline,{create:operation==='create'});sync.baselines??={};sync.baselines[destinationKey(c)]=result;await persist();notice('GitHub保存と読み戻し確認が完了しました。');
    }else{
      const remote=await readRemote(c,token);remoteCopy=remote;
      if(operation==='download'){download('shogi_github_'+stamp()+'.json',encodeDocument(remote.document));notice('GitHubのJSONを書き出しました。');}
      else if(operation==='connect'){
        if(contentSignature(remote.document)!==contentSignature(data))throw new Error('GitHubと端末の内容が異なります。双方のJSONを退避し、取り込む内容を選んでください。端末データは変更していません');
        sync.baselines??={};sync.baselines[destinationKey(c)]={sha:remote.sha,signature:contentSignature(remote.document),at:Date.now()};await persist();notice('GitHubの現在内容を保存の基準に設定しました。');
      }else confirmImport({d:remote.document,v:null,label:'GitHub: '+c.path,baseline:{sha:remote.sha,signature:contentSignature(remote.document),at:Date.now()}});
    }
  }finally{const input=$('ghToken');if(input)input.value='';busy=false;render();}
}
$('menu').onclick=()=>action(menu);$('comment').onclick=()=>action(()=>editPosition('comment'));$('editEval').onclick=()=>action(()=>editPosition('evaluation'));$('attributes').onclick=()=>action(attributes);$('graph').onclick=()=>action(graph);
$('back').onclick=()=>action(()=>{editable();session().cursor--;selection=null;persist();render();});$('forward').onclick=()=>action(()=>{editable();session().cursor++;selection=null;persist();render();});$('root').onclick=()=>action(goRoot);$('flip').onclick=()=>action(()=>{editable();view.flip=!view.flip;persist();render();});
$('boardStyle').onclick=()=>action(()=>{editable();view.boardStyle=view.boardStyle==='pieces'?'text':'pieces';persist();render();});
$('opening').onchange=()=>action(()=>{editable();data.active_opening_id=$('opening').value;selection=null;persist();render();});
function onHide(){const input=$('ghToken');if(input)input.value='';if(ready&&!storageError)journal();}
document.addEventListener('visibilitychange',()=>{if(document.hidden)onHide();});window.addEventListener('pagehide',onHide);window.addEventListener('pageshow',()=>{if(ready)render();});
function networkLabel(){if(!navigator.onLine)$('offline').textContent=$('offline').dataset.ready==='yes'?'オフライン動作中':'通信なし · 準備未確認';else if($('offline').dataset.ready==='yes')$('offline').textContent='オフライン準備完了';}
window.addEventListener('online',networkLabel);window.addEventListener('offline',networkLabel);
async function setupOffline(){
  try{
    if(!window.isSecureContext||!('serviceWorker'in navigator))throw new Error('HTTPSで開いてください');
    await navigator.serviceWorker.register('./sw.js',{scope:'./'});const registration=await navigator.serviceWorker.ready;
    const channel=new MessageChannel();const checked=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('準備の確認がタイムアウトしました')),10000);channel.port1.onmessage=e=>{clearTimeout(timer);resolve(e.data);};registration.active.postMessage('CHECK_SHELL',[channel.port2]);});
    if(!checked.ready)throw new Error('必要ファイルの保存が未完了です');$('offline').dataset.ready='yes';networkLabel();
    registration.addEventListener('updatefound',()=>{const worker=registration.installing;worker?.addEventListener('statechange',()=>{if(worker.state==='installed'&&navigator.serviceWorker.controller)notice('新しい版が準備されました。端末バックアップを書き出し、すべての画面を閉じて開き直すと更新できます。');});});
  }catch(e){$('offline').textContent='オフライン準備未完了';notice('オフライン準備: '+e.message+'。オンラインで開き直し、準備完了を確認してください。');}
}
async function boot(){
  try{
    const state=await store.open();data=state?decodeDocument(state.document):freshDocument();view=normalizeView(data,state?.view);sync=state?.sync||{};
    const emergency=store.emergency();if(state&&emergency?.documentCreatedAt===data.created_at&&emergency.documentUpdatedAt===data.updated_at&&emergency.at>state.savedAt){
      // A stale tab must never replay over a newer committed revision.
      if(emergency.revision>=state.revision-1){view=normalizeView(data,emergency.view);if(Object.hasOwn(data.openings,emergency.activeOpeningId))data.active_opening_id=emergency.activeOpeningId;}
    }
    ready=true;render();await persist();
    if(view.draft){notice('確定前の編集内容を復元しました。保存・設定から編集を再開できます。');}
    await setupOffline();
  }catch(e){$('saved').textContent='起動・保存を停止';notice('保存データを安全に開けませんでした。初期化はしていません。'+e.message);$('menu').onclick=()=>{openDialog('保存データの退避');$('dialogBody').append(button('保存内容をそのまま書き出す',async()=>{const raw=await store.read('current');download('shogi_recovery_'+stamp()+'.json',raw);}),button('置換前の内容を書き出す',async()=>{const raw=await store.read('before-replace');download('shogi_before_replace_'+stamp()+'.json',raw);}));};}
}
boot();
