'use strict';
(() => {
  const $ = id => document.getElementById(id);
  // Эти 20 изображений уже опубликованы в прежнем пилоте из тестовой папки.
  const first = Array.from({length:15}, (_,i) => i+1);
  const second = Array.from({length:5}, (_,i) => i+16);
  const url = n => '../images/'+String(n).padStart(2,'0')+'.jpg';
  const cache = new Map();
  let pairs = [], next = null, ready = false, generation = 0;
  function shuffle(items) {
    for (let i=items.length-1; i>0; i--) {
      const j=Math.floor(Math.random()*(i+1)); [items[i],items[j]]=[items[j],items[i]];
    }
    return items;
  }
  function takePair() {
    if (!pairs.length) pairs=shuffle(first.flatMap(a=>second.map(b=>[a,b])));
    const p=pairs.pop(); return Math.random()<.5?p:[p[1],p[0]];
  }
  function load(n) {
    if (cache.has(n)) return cache.get(n);
    const img=new Image();
    const promise=new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{cache.delete(n);reject(new Error('Время загрузки истекло'));},30000);
      img.onload=()=>{clearTimeout(timer);resolve(img.src);};
      img.onerror=()=>{clearTimeout(timer);cache.delete(n);reject(new Error('Не удалось загрузить картину'));};
      img.src=url(n);
    });
    cache.set(n,promise); return promise;
  }
  function setReady(value) {
    ready=value;
    document.querySelectorAll('.image-choice,.choose-button,.zoom-button').forEach(button=>{button.disabled=!value;});
  }
  async function show(pair) {
    const token=++generation;
    setReady(false); $('comparison').classList.add('images-loading'); $('comparison').classList.remove('images-error');
    $('load-status').textContent='Загружаем обе картины…'; $('load-status').hidden=false; $('retry-images').hidden=true;
    $('left').removeAttribute('src'); $('right').removeAttribute('src');
    $('left-num').textContent='Работа № '+String(pair[0]).padStart(2,'0');
    $('right-num').textContent='Работа № '+String(pair[1]).padStart(2,'0');
    next=takePair(); next.forEach(n=>load(n).catch(()=>{}));
    try {
      const urls=await Promise.all(pair.map(load)); if(token!==generation)return;
      const images=[$('left'),$('right')]; images.forEach((img,i)=>{img.src=urls[i];});
      await Promise.all(images.map(img=>typeof img.decode==='function'?img.decode():Promise.resolve()));
      if(token!==generation)return;
      if(images.some(img=>!img.naturalWidth))throw new Error('Не удалось загрузить картину');
      $('comparison').classList.remove('images-loading'); $('load-status').hidden=true; setReady(true);
    } catch (_) {
      if(token!==generation)return;
      $('comparison').classList.add('images-error'); $('load-status').textContent='Не удалось загрузить обе картины.'; $('retry-images').hidden=false;
      $('retry-images').onclick=()=>show(pair);
    }
  }
  function choose() { if(ready && !$('zoom-dialog').open) show(next); }
  document.querySelectorAll('.image-choice,.choose-button').forEach(button=>button.addEventListener('click',choose));
  document.querySelectorAll('.zoom-button').forEach(button=>button.addEventListener('click',()=>{
    if(!ready)return; $('zoom-image').src=$(button.dataset.side).src; $('zoom-dialog').showModal();
  }));
  $('zoom-close').addEventListener('click',()=>$('zoom-dialog').close());
  $('zoom-dialog').addEventListener('click',event=>{if(event.target===$('zoom-dialog'))$('zoom-dialog').close();});
  document.addEventListener('keydown',event=>{
    if(event.repeat || $('zoom-dialog').open || !ready)return;
    if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();choose();}
  });
  show(takePair());
})();
