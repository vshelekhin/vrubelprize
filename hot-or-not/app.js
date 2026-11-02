'use strict';
(() => {
  const $=id=>document.getElementById(id),storageKey='vrubel-hot-or-not-v1';
  const normalize=name=>String(name).normalize('NFC').replace(/\s+/g,' ').trim();
  const userPart=name=>encodeURIComponent(normalize(name).toLocaleLowerCase('ru-RU'));
  const queuePrefix=name=>storageKey+':outbox:'+userPart(name)+':';
  const snapshotKey=name=>storageKey+':confirmed:'+userPart(name);
  const oldPendingKey=name=>storageKey+':pending:'+normalize(name).toLocaleLowerCase('ru-RU');
  const safeGet=key=>{try{return localStorage.getItem(key);}catch(_){return null;}};
  const safeSet=(key,value)=>{try{localStorage.setItem(key,value);}catch(_){}};
  // Separate durable keys prevent another tab from overwriting a new vote.
  function pending(name){
    const prefix=queuePrefix(name),items=[];
    for(let i=0;i<localStorage.length;i++){
      const key=localStorage.key(i);if(!key?.startsWith(prefix))continue;
      const vote=JSON.parse(localStorage.getItem(key));
      if(!vote?.requestId)throw new Error('Не удалось прочитать сохранённый выбор. Обновите страницу.');
      items.push(vote);
    }
    return items.sort((a,b)=>(a.order||0)-(b.order||0)||a.requestId.localeCompare(b.requestId));
  }
  function remember(name,vote){
    try{localStorage.setItem(queuePrefix(name)+vote.requestId,JSON.stringify(vote));}
    catch(_){throw new Error('Браузер не смог сохранить выбор. Освободите место или разрешите хранение данных для этой страницы.');}
  }
  function acknowledge(name,ids){ids.forEach(id=>localStorage.removeItem(queuePrefix(name)+id));}
  let state=null,current=null,entering=false,imagesReady=false,syncing=false,syncError='',renderId=0;
  let syncTimer=null,retryCount=0,enableTimer=null,nextChoiceAt=0;
  let bridgeWindow=null,bridgeOrigin='',channel=crypto.randomUUID(),readyResolve,readyReject;
  const calls=new Map(),imageCache=new Map();
  const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});ready.catch(()=>{});
  function message(text,error=false){$('message').textContent=text;$('message').classList.toggle('error',error);}
  function controls(){
    const blocked=entering||!imagesReady||performance.now()<nextChoiceAt;
    document.body.classList.toggle('busy',blocked);
    document.querySelectorAll('.choose-button,.image-choice').forEach(b=>b.disabled=blocked);
    $('start').disabled=entering;
    $('change-name').disabled=entering||syncing||!!(state&&pending(state.name).length);
  }
  window.addEventListener('message',event=>{
    const m=event.data;if(!m||m.app!=='vrubel-pilot'||m.channel!==channel)return;
    if(!/^https:\/\/(?:[a-z0-9-]+[-.])?script\.googleusercontent\.com$/.test(event.origin)&&event.origin!=='https://script.google.com')return;
    if(m.type==='ready'){
      if(bridgeWindow&&bridgeWindow!==event.source)return;
      bridgeWindow=event.source;bridgeOrigin=event.origin;readyResolve();return;
    }
    if(event.source!==bridgeWindow||event.origin!==bridgeOrigin)return;
    if(m.type==='result'&&calls.has(m.id)){
      const call=calls.get(m.id);clearTimeout(call.timer);calls.delete(m.id);
      if(m.error)call.reject(new Error(m.error));else call.resolve(m.result);
    }
  });
  if(window.PILOT_CONFIG?.backendUrl){
    $('sheet-bridge').src=window.PILOT_CONFIG.backendUrl+'?origin='+encodeURIComponent(location.origin)+'&channel='+encodeURIComponent(channel);
    setTimeout(()=>{if(!bridgeWindow)readyReject(new Error('Не удалось подключиться к голосованию. Обновите страницу и попробуйте ещё раз.'));},35000);
  }else readyReject(new Error('Обработчик голосования ещё подключается. Попробуйте чуть позже.'));
  async function rpc(payload){
    await ready;const id=crypto.randomUUID();
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{calls.delete(id);reject(new Error('Пока не получили подтверждение сохранения. Ваши выборы остались в этом браузере; отправку можно повторить.'));},40000);
      calls.set(id,{resolve,reject,timer});
      bridgeWindow.postMessage({app:'vrubel-pilot',channel,type:'rpc',id,payload},bridgeOrigin);
    });
  }
  function view(){
    const queue=pending(state.name),tickets=new Set(queue.map(v=>v.ticket));
    const ballot=state.ballot.filter(t=>!tickets.has(t.ticket));
    const count=Math.min(state.total,state.count+state.ballot.filter(t=>tickets.has(t.ticket)).length);
    return {queue,ballot,count};
  }
  function preload(art){
    const url=new URL(art.image,document.baseURI).href;
    if(imageCache.has(url))return imageCache.get(url);
    const promise=new Promise((resolve,reject)=>{
      const img=new Image();
      img.onload=async()=>{try{if(img.decode)await img.decode();}catch(_){}resolve(url);};
      img.onerror=()=>{imageCache.delete(url);reject(new Error('Картина не загрузилась. Проверьте соединение и обновите страницу — ваши выборы сохранены в браузере.'));};
      img.src=url;
    });imageCache.set(url,promise);return promise;
  }
  function preloadAhead(ballot){
    const byId=new Map(state.artworks.map(a=>[a.id,a]));
    ballot.slice(0,5).forEach(t=>[t.left,t.right].forEach(id=>{const a=byId.get(id);if(a)preload(a).catch(()=>{});}));
  }
  function fitImages(){
    if(!current)return;
    const space=document.querySelector('.image-space'),top=space.getBoundingClientRect().top,width=space.clientWidth;
    const height=Math.floor(Math.max(60,Math.min(window.innerHeight-top-171,...current.pair.map(a=>width/(a.width/a.height)))));
    document.documentElement.style.setProperty('--art-height',height+'px');
  }
  async function render(){
    if(!state)return;const token=++renderId,v=view(),byId=new Map(state.artworks.map(a=>[a.id,a]));
    const task=v.ballot[0];current=task?{...task,pair:[byId.get(task.left),byId.get(task.right)]}:null;
    imagesReady=false;$('welcome').hidden=true;$('voting').hidden=false;
    $('viewer-label').textContent=state.name;
    $('progress-text').textContent='Сравнений: '+v.count+' из '+state.total;
    $('progress-fill').style.width=100*v.count/state.total+'%';
    $('saved-text').textContent=v.queue.length?'Сохранено: '+state.count+' из '+v.count:'';$('saved-text').hidden=!v.queue.length;
    $('comparison').hidden=!current;$('finished').hidden=!!current;document.querySelector('.voting-heading').hidden=!current;
    $('decision-hint').hidden=!current;$('keyboard-hint').hidden=!current;
    $('retry').hidden=!syncError||!v.queue.length;message(syncError,!!syncError);controls();
    if(!current){
      const done=state.count>=state.total&&!v.queue.length;
      $('finish-eyebrow').textContent=done?'ГОЛОСОВАНИЕ ЗАВЕРШЕНО':'ПОЧТИ ГОТОВО';
      $('finish-title').textContent=done?'Спасибо за участие!':'Сохраняем ваши голоса…';
      $('finish-description').textContent=done?'Все ваши голоса сохранены. Голосование завершено.':'Пожалуйста, дождитесь подтверждения. Все ваши выборы сохранены в этом браузере.';
      return;
    }
    preloadAhead(v.ballot);
    try{
      const pair=current.pair,urls=await Promise.all(pair.map(preload));if(token!==renderId)return;
      ['art-left','art-right'].forEach((id,i)=>{const img=$(id);img.src=urls[i];img.alt='Картина № '+pair[i].id.slice(-2);});
      $('number-left').textContent='Работа № '+pair[0].id.slice(-2);$('number-right').textContent='Работа № '+pair[1].id.slice(-2);
      fitImages();imagesReady=true;controls();
    }catch(error){if(token===renderId)message(error.message,true);}
  }
  function publish(next){
    if(!Array.isArray(next.ballot)||!Array.isArray(next.artworks))throw new Error('Обновите страницу: версия голосования изменилась.');
    state=next;safeSet(snapshotKey(next.name),JSON.stringify(next));
  }
  function scheduleSync(delay=1200){
    if(syncTimer!==null||syncing||entering||!state||!pending(state.name).length)return;
    syncTimer=setTimeout(()=>{syncTimer=null;flush();},delay);
  }
  async function flush(){
    if(syncing||entering||!state)return;
    const name=state.name,batch=pending(name).slice(0,20);if(!batch.length)return;
    if(syncTimer!==null){clearTimeout(syncTimer);syncTimer=null;}
    syncing=true;controls();let success=false;
    try{
      const next=await rpc({action:'sync',name,votes:batch});
      if(!Array.isArray(next.accepted))throw new Error('Не удалось подтвердить сохранение. Повторите отправку.');
      publish(next);acknowledge(name,next.accepted);syncError='';retryCount=0;success=true;
    }catch(error){syncError=error.message;retryCount++;}
    finally{
      syncing=false;await render();controls();
      if(pending(name).length){
        if(success)scheduleSync(view().count>=state.total?0:600);
        else if(retryCount<=3)scheduleSync([2000,5000,10000][retryCount-1]);
      }
    }
  }
  async function enter(event){
    event?.preventDefault();if(entering)return;
    const name=normalize($('viewer-name').value);if(!name)return;
    entering=true;imagesReady=false;controls();message('Подключаемся к голосованию…');$('retry').hidden=true;
    try{
      const legacy=safeGet(oldPendingKey(name));
      if(legacy){const vote=JSON.parse(legacy);remember(name,{...vote,order:-1});localStorage.removeItem(oldPendingKey(name));}
      const queue=pending(name),next=await rpc(queue.length?{action:'sync',name,votes:queue}:{action:'join',name});
      publish(next);acknowledge(name,next.accepted||[]);safeSet(storageKey,name);syncError='';retryCount=0;await render();
    }catch(error){message(error.message,true);}
    finally{entering=false;controls();if(state)scheduleSync();}
  }
  async function choose(side){
    if(entering||!imagesReady||!current||performance.now()<nextChoiceAt)return;
    const started=performance.now(),task=current,v=view();
    try{
      remember(state.name,{left:task.left,right:task.right,winner:task.pair[side].id,ticket:task.ticket,requestId:crypto.randomUUID(),order:v.count});
      nextChoiceAt=started+200;imagesReady=false;controls();
      if(enableTimer!==null)clearTimeout(enableTimer);enableTimer=setTimeout(()=>{enableTimer=null;controls();},200);
      scheduleSync();if(pending(state.name).length>=4||v.count+1>=state.total)flush();
      await render();document.body.dataset.lastTransitionMs=String(Math.round(performance.now()-started));
    }catch(error){message(error.message,true);}
  }
  function changeName(){
    if(entering||syncing||state&&pending(state.name).length)return;
    renderId++;imagesReady=false;state=null;current=null;$('voting').hidden=true;$('welcome').hidden=false;$('retry').hidden=true;message('');$('viewer-name').value='';$('viewer-name').focus();
  }
  document.querySelectorAll('.choose-button').forEach(b=>b.addEventListener('click',()=>choose(Number(b.dataset.side))));
  document.querySelectorAll('.image-choice').forEach((b,i)=>b.addEventListener('click',()=>choose(i)));
  document.querySelectorAll('.zoom-button').forEach(b=>b.addEventListener('click',()=>{
    if(!current)return;const a=current.pair[Number(b.dataset.side)];$('zoom-image').src=a.image;$('zoom-image').alt='Картина № '+a.id.slice(-2);$('zoom-dialog').showModal();
  }));
  $('close-zoom').addEventListener('click',()=>$('zoom-dialog').close());
  $('zoom-dialog').addEventListener('click',event=>{if(event.target===$('zoom-dialog'))$('zoom-dialog').close();});
  document.addEventListener('keydown',event=>{
    if(event.repeat||entering||!imagesReady||!current||$('zoom-dialog').open||['INPUT','TEXTAREA'].includes(document.activeElement?.tagName))return;
    if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();choose(event.key==='ArrowLeft'?0:1);}
  });
  $('entry-form').addEventListener('submit',enter);$('change-name').addEventListener('click',changeName);
  $('retry').addEventListener('click',()=>{retryCount=0;syncError='';flush();});
  window.addEventListener('resize',fitImages);window.addEventListener('online',()=>{retryCount=0;flush();});
  window.addEventListener('beforeunload',event=>{if(state&&pending(state.name).length){event.preventDefault();event.returnValue='';}});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')flush();});
  window.addEventListener('storage',event=>{
    if(!state||entering)return;
    if(event.key===snapshotKey(state.name)&&event.newValue){try{const next=JSON.parse(event.newValue);if(next.count>=state.count)state=next;}catch(_){}}
    else if(!event.key?.startsWith(queuePrefix(state.name)))return;
    render();scheduleSync();
  });
  const previous=safeGet(storageKey);if(previous)$('viewer-name').value=previous;
})();
