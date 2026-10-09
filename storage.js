// All document and view writes share one atomic IndexedDB transaction.
export const DB_NAME='banjo-shogi-offline-stage18';
const RECOVERY='banjo-shogi-emergency-view-v1';
export class LocalStore {
  constructor(){this.db=null;this.revision=0;this.tail=Promise.resolve();this.failed=false;}
  async open(){
    this.db=await new Promise((resolve,reject)=>{const req=indexedDB.open(DB_NAME,1);req.onupgradeneeded=()=>req.result.createObjectStore('state');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);req.onblocked=()=>reject(new Error('別の画面を閉じて再読み込みしてください'));});
    this.db.onversionchange=()=>{this.db.close();this.failed=true;};
    const state=await this.read('current');this.revision=state?.revision||0;return state;
  }
  read(key){return new Promise((resolve,reject)=>{const req=this.db.transaction('state').objectStore('state').get(key);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
  checkpoint(view,identity){
    // A small synchronous journal covers dismissal during a pending IDB write.
    try{localStorage.setItem(RECOVERY,JSON.stringify({view,...identity,at:Date.now(),revision:this.revision}));return true;}catch{return false;}
  }
  emergency(){try{return JSON.parse(localStorage.getItem(RECOVERY)||'null');}catch{return null;}}
  save(snapshot,backup=false){
    const data=structuredClone(snapshot);
    const write=async()=>{
      if(this.failed)throw new Error('端末保存が停止しています。JSONを書き出してから再読み込みしてください');
      const revision=this.revision;
      await new Promise((resolve,reject)=>{
        const tx=this.db.transaction('state','readwrite'),store=tx.objectStore('state'),req=store.get('current');
        let conflict=false;
        req.onsuccess=()=>{const old=req.result;if((old?.revision||0)!==revision){conflict=true;tx.abort();return;}
          if(backup&&old)store.put(old,'before-replace');
          store.put({...data,revision:revision+1,savedAt:Date.now()},'current');
        };
        tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error||new Error('端末保存に失敗しました'));
        tx.onabort=()=>reject(conflict?new Error('別の画面でデータが更新されました。現在の内容をJSONで退避してから再読み込みしてください'):tx.error||new Error('端末保存が中断されました'));
      });this.revision=revision+1;
    };
    const promise=this.tail.then(write);this.tail=promise.catch(e=>{this.failed=true;throw e;});this.tail.catch(()=>{});return promise;
  }
}
