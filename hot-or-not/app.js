'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const storageKey = 'vrubel-hot-or-not-v1';
  const normalize = name => name.normalize('NFC').replace(/\s+/g,' ').trim();
  const pendingKey = name => storageKey + ':pending:' + normalize(name).toLocaleLowerCase('ru-RU');
  const safeStore = {get:k=>{try{return localStorage.getItem(k);}catch{return null;}},set:(k,v)=>{try{localStorage.setItem(k,v);}catch{}},remove:k=>{try{localStorage.removeItem(k);}catch{}}};
  let state=null, busy=false, imagesReady=false, bridgeWindow=null, bridgeOrigin='', channel=crypto.randomUUID(), readyResolve, readyReject;
  const pendingCalls=new Map();
  const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
  ready.catch(()=>{});
  function message(text,error=false){$('message').textContent=text;$('message').classList.toggle('error',error);}
  function setBusy(value){busy=value;document.body.classList.toggle('busy',value);document.querySelectorAll('.choose-button,.image-choice').forEach(b=>b.disabled=value||!imagesReady);$('start').disabled=value;$('change-name').disabled=value;}
  window.addEventListener('message',event=>{
    const m=event.data;
    if(!m||m.app!=='vrubel-pilot'||m.channel!==channel)return;
    if(!/^https:\/\/(?:[a-z0-9-]+[-.])?script\.googleusercontent\.com$/.test(event.origin)&&event.origin!=='https://script.google.com')return;
    if(m.type==='ready'){
      if(bridgeWindow&&bridgeWindow!==event.source)return;
      bridgeWindow=event.source;bridgeOrigin=event.origin;readyResolve();return;
    }
    if(event.source!==bridgeWindow||event.origin!==bridgeOrigin)return;
    if(m.type==='result'&&pendingCalls.has(m.id)){
      const call=pendingCalls.get(m.id);clearTimeout(call.timer);pendingCalls.delete(m.id);
      if(m.error)call.reject(new Error(m.error));else call.resolve(m.result);
    }
  });
  if(window.PILOT_CONFIG?.backendUrl){
    $('sheet-bridge').src=window.PILOT_CONFIG.backendUrl+'?origin='+encodeURIComponent(location.origin)+'&channel='+encodeURIComponent(channel);
    setTimeout(()=>{if(!bridgeWindow)readyReject(new Error('Не удалось подключиться к таблице. Обновите страницу и попробуйте ещё раз.'));},35000);
  }else readyReject(new Error('Обработчик таблицы ещё подключается. Попробуйте чуть позже.'));
  async function rpc(payload){
    await ready;const id=crypto.randomUUID();
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{pendingCalls.delete(id);reject(new Error('Не получили подтверждение от таблицы. Можно повторить: один выбор учтётся только один раз.'));},40000);
      pendingCalls.set(id,{resolve,reject,timer});
      bridgeWindow.postMessage({app:'vrubel-pilot',channel,type:'rpc',id,payload},bridgeOrigin);
    });
  }
  function fitImages(){
    if(!state?.pair)return;
    const space=document.querySelector('.image-space');
    const top=space.getBoundingClientRect().top;
    const width=space.clientWidth;
    const height=Math.floor(Math.max(60,Math.min(window.innerHeight-top-171, ...state.pair.map(a=>width/(a.width/a.height)))));
    document.documentElement.style.setProperty('--art-height',height+'px');
  }
  async function render(next){
    imagesReady=false;state=next;$('welcome').hidden=true;$('voting').hidden=false;
    $('viewer-label').textContent=next.name;
    $('progress-text').textContent='Сравнений: '+next.count+' из '+next.total;
    $('progress-fill').style.width=100*next.count/next.total+'%';
    $('comparison').hidden=!next.pair;$('finished').hidden=!!next.pair;
    document.querySelector('.voting-heading').hidden=!next.pair;
    $('decision-hint').hidden=!next.pair;
    $('keyboard-hint').hidden=!next.pair;
    if(!next.pair)return;
    const ids=['art-left','art-right'],numbers=['number-left','number-right'];
    await Promise.all(next.pair.map((art,i)=>new Promise((resolve,reject)=>{
      const img=$(ids[i]);img.onload=resolve;img.onerror=()=>reject(new Error('Картина не загрузилась. Обновите страницу — голос пока не отправлен.'));
      img.alt='Картина № '+art.id.slice(-2);img.src=art.image;
      $(numbers[i]).textContent='Работа № '+art.id.slice(-2);
      if(img.complete&&img.naturalWidth)resolve();
    })));
    fitImages();imagesReady=true;
  }
  async function enter(event){
    event?.preventDefault();if(busy)return;
    const name=normalize($('viewer-name').value);if(!name)return;
    setBusy(true);message('Подключаемся к голосованию…');$('retry').hidden=true;
    try{
      const stored=safeStore.get(pendingKey(name));
      const payload=stored?JSON.parse(stored):{action:'join',name};
      const next=await rpc(payload);
      if(stored)safeStore.remove(pendingKey(name));
      safeStore.set(storageKey,name);await render(next);message('');
    }catch(error){message(error.message,true);}finally{setBusy(false);}
  }
  async function choose(side){
    if(busy||!imagesReady||!state?.pair)return;
    setBusy(true);message('Сохраняем выбор…');$('retry').hidden=true;
    const key=pendingKey(state.name);
    let payload;
    try{
      const stored=safeStore.get(key);
      payload=stored?JSON.parse(stored):{action:'vote',name:state.name,left:state.pair[0].id,right:state.pair[1].id,winner:state.pair[side].id,ticket:state.ticket,requestId:crypto.randomUUID()};
      safeStore.set(key,JSON.stringify(payload));
      const next=await rpc(payload);safeStore.remove(key);await render(next);message('');
    }catch(error){message(error.message,true);$('retry').hidden=!safeStore.get(key);}finally{setBusy(false);}
  }
  function changeName(){
    if(busy)return;imagesReady=false;state=null;$('voting').hidden=true;$('welcome').hidden=false;$('retry').hidden=true;message('');$('viewer-name').value='';$('viewer-name').focus();
  }
  document.querySelectorAll('.choose-button').forEach(b=>b.addEventListener('click',()=>choose(Number(b.dataset.side))));
  document.querySelectorAll('.image-choice').forEach((b,i)=>b.addEventListener('click',()=>choose(i)));
  document.querySelectorAll('.zoom-button').forEach(b=>b.addEventListener('click',()=>{
    if(!state?.pair)return;
    const a=state.pair[Number(b.dataset.side)];$('zoom-image').src=a.image;$('zoom-image').alt='Картина № '+a.id.slice(-2);$('zoom-dialog').showModal();
  }));
  $('close-zoom').addEventListener('click',()=>$('zoom-dialog').close());
  $('zoom-dialog').addEventListener('click',event=>{if(event.target===$('zoom-dialog'))$('zoom-dialog').close();});
  document.addEventListener('keydown',event=>{
    if(busy||!imagesReady||!state?.pair||$('zoom-dialog').open||['INPUT','TEXTAREA'].includes(document.activeElement?.tagName))return;
    if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();choose(event.key==='ArrowLeft'?0:1);}
  });
  $('entry-form').addEventListener('submit',enter);
  $('change-name').addEventListener('click',changeName);
  $('retry').addEventListener('click',()=>choose(0));
  window.addEventListener('resize',fitImages);
  const previous=safeStore.get(storageKey);if(previous)$('viewer-name').value=previous;
})();
