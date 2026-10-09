import {decodeDocument,encodeDocument,contentSignature,copy} from './core.js';
export function destinationKey(c){return [c.owner,c.repo,c.branch,c.path].join('|');}
export function validateConfig(c){
  if(!/^[A-Za-z0-9-]+$/.test(c.owner)||!/^[A-Za-z0-9_.-]+$/.test(c.repo)||!c.branch||!c.path||c.path.startsWith('/')||c.path.split('/').some(x=>!x||x==='.'||x==='..')||!c.path.endsWith('.json'))throw new Error('GitHubの所有者・リポジトリ・ブランチ・JSONパスを確認してください');
  return c;
}
const baseURL=c=>`https://api.github.com/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/contents/${c.path.split('/').map(encodeURIComponent).join('/')}`;
function fromBase64(s){return new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(atob(s.replace(/\s/g,'')),c=>c.charCodeAt(0)));}
function toBase64(s){const bytes=new TextEncoder().encode(s);let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(binary);}
async function request(url,token,options={}){
  const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),25000);
  try{const r=await fetch(url,{...options,signal:abort.signal,cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer',headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',...(token?{Authorization:`Bearer ${token}`}:{ }),...options.headers}});return r;}
  catch{throw new Error('GitHubへの通信を確認できませんでした。端末の編集内容は保持されています。保存操作後ならGitHubの内容を確認してから再試行してください');}
  finally{clearTimeout(timer);}
}
export async function readRemote(config,token){
  const c=validateConfig(config),url=baseURL(c)+'?ref='+encodeURIComponent(c.branch),r=await request(url,token);
  if(r.status===404)throw new Error('GitHubで保存先を確認できません（未作成・認証・権限・ブランチを確認）。新規保存は専用ボタンを使用してください');
  if(!r.ok)throw new Error(`GitHub読込失敗 (${r.status})`);
  const file=await r.json();if(file.type!=='file'||typeof file.sha!=='string')throw new Error('保存先がJSONファイルではありません');
  let text;
  if(file.encoding==='base64'&&file.content)text=fromBase64(file.content);
  else {const raw=await request(url,token,{headers:{Accept:'application/vnd.github.raw+json'}});if(!raw.ok)throw new Error('大きいJSONの読込に失敗しました');text=await raw.text();}
  return {sha:file.sha,document:decodeDocument(JSON.parse(text))};
}
export function checkBaseline(remote,local,baseline){
  if(!baseline){if(contentSignature(remote.document)!==contentSignature(local))throw new Error('保存の基準がありません。GitHubの内容を取り込むか、別の新規JSONパスへ保存してください。既存ファイルは上書きしません');}
  else if(remote.sha!==baseline.sha)throw new Error('GitHubが別の操作で更新されています。競合のため保存を停止しました。端末JSONとGitHub JSONを退避してから内容を選んでください');
}
export async function saveRemote(config,token,local,baseline,{create=false}={}){
  validateConfig(config);if(!token)throw new Error('この操作用のGitHubトークンを入力してください');
  const snapshot=copy(local),url=baseURL(config);let sha;
  if(!create){const remote=await readRemote(config,token);checkBaseline(remote,snapshot,baseline);sha=remote.sha;}
  // For create, PUT has no SHA and GitHub rejects existing files, even when a
  // preceding GET would incorrectly appear to be 404 due to permissions.
  const body={message:'将棋定跡研究室 Stage18-1 保存',branch:config.branch,content:toBase64(JSON.stringify(encodeDocument(snapshot)))};if(sha)body.sha=sha;
  const r=await request(url,token,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  if(!r.ok)throw new Error([409,422].includes(r.status)?`競合または既存ファイルのため保存を停止しました (${r.status})。自動上書きは行いません`:`GitHub保存失敗 (${r.status})。端末の編集内容は保持されています`);
  const result=await r.json(),verified=await readRemote(config,token);
  if(verified.sha!==result.content?.sha||contentSignature(verified.document)!==contentSignature(snapshot))throw new Error('保存後の確認が一致しません。端末の内容を保持しています。GitHub JSONを確認してください');
  return {sha:verified.sha,signature:contentSignature(snapshot),at:Date.now()};
}
