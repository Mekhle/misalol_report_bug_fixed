/** LRCLIB's legacy syncedLyrics format: milliseconds, offsets and repeated stamps. */
export function parseLrc(body = '') {
  const offset = Number(/\[offset:([+-]?\d+)\]/i.exec(body)?.[1] || 0) / 1000;
  const rows = [];
  for (const raw of body.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d+):([0-5]\d)(?:[.:](\d{1,3}))?\]/g)];
    const text = raw.replace(/\[[^\]]*\]/g, '').trim();
    if (stamps.length) for (const m of stamps) rows.push({ t: Math.max(0, +m[1] * 60 + +m[2] + +(m[3] || '0').padEnd(3, '0') / 1000 - offset), text });
    else if (text && !/^\[[a-z]+:/i.test(raw)) rows.push({ t: null, text });
  }
  return rows.some(r => r.t !== null) ? rows.filter(r => r.t !== null).sort((a,b) => a.t-b.t).slice(0,1000) : rows.slice(0,1000);
}
export function activeLyric(rows, time) {
  let index = -1;
  for (let i=0;i<rows.length;i++) { if (rows[i].t !== null && rows[i].t <= time) index=i; }
  return index >= 0 && rows[index].end != null && time >= rows[index].end ? -1 : index;
}
const lookups = new Map();
export async function getRecording(id, signal) {
  signal.throwIfAborted();
  const key=String(id);
  // Coalesce concurrent sections; HTTP caching follows the provider's response headers.
  if(!lookups.has(key)) {
    const pending=fetch(`/dashboard/lyrics/recording/${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(15000), headers: { 'Lrclib-Client': 'Misa.lol (https://misa.lol)' } }).then(response=>{
      if(response.status===404)return null;
      if(!response.ok)throw new Error('Lyrics temporarily unavailable');
      return response.json();
    }).finally(()=>lookups.delete(key));
    lookups.set(key,pending);
  }
  const data=await lookups.get(key);
  signal.throwIfAborted();
  return data;
}

const icons = {
  play: '<svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M6 3v18l15-9z"/></svg>',
  pause: '<svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="3" width="5" height="18" rx="2"/><rect x="14" y="3" width="5" height="18" rx="2"/></svg>',
  previous: '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M5 5h3v14H5zm14 0L9 12l10 7z"/></svg>',
  next: '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M16 5h3v14h-3zM5 5v14l10-7z"/></svg>'
};
const fmt = value => Number.isFinite(value) ? `${Math.floor(value/60)}:${String(Math.floor(value%60)).padStart(2,'0')}` : '0:00';
/** Both React and canonical HTML use this view. It never creates an audio element. */
export function mountLyrics(host, root) {
  host.classList.add('synced-player');
  host.innerHTML = `<header class="synced-header"><div class="synced-art" aria-hidden="true">♫</div><div class="synced-track"><strong></strong><div class="synced-progress"><time>0:00</time><input type="range" aria-label="Seek track" min="0" max="1" step="0.01" value="0"><time>0:00</time></div></div><div class="synced-controls"><button type="button" aria-label="Previous track">${icons.previous}</button><button type="button" aria-label="Play" class="synced-play">${icons.play}</button><button type="button" aria-label="Next track">${icons.next}</button></div></header><p class="synced-status" role="status"></p><div class="synced-viewport" tabindex="0" aria-label="Song lyrics"><div class="synced-lines"></div></div><footer><button type="button" class="synced-follow" hidden>Return to current line</button></footer>`;
  const viewport=host.querySelector('.synced-viewport'), list=host.querySelector('.synced-lines'), status=host.querySelector('.synced-status'), seek=host.querySelector('input'), title=host.querySelector('strong'), art=host.querySelector('.synced-art'), times=host.querySelectorAll('time'), buttons=host.querySelectorAll('.synced-controls button'), follow=host.querySelector('.synced-follow');
  let audio=null, trackKey='', rows=[], active=-2, manual=false, disposed=false, request=null, serial=0, timer=0, animation=0, info={};
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const stopAnimation=()=>{ cancelAnimationFrame(animation); animation=0; };
  function focusRow(immediate=false) {
    const row=list.children[active]; if (!row || manual) return;
    const top=viewport.scrollTop+row.getBoundingClientRect().top-viewport.getBoundingClientRect().top-(viewport.clientHeight-row.clientHeight)/2;
    const target=Math.max(0,Math.min(top,viewport.scrollHeight-viewport.clientHeight));
    stopAnimation();
    if (immediate || reduced.matches) { viewport.scrollTop=target; return; }
    const start=viewport.scrollTop, at=performance.now();
    const frame=now=>{ const t=Math.min(1,(now-at)/320); viewport.scrollTop=start+(target-start)*(1-Math.pow(1-t,3)); if(t<1) animation=requestAnimationFrame(frame); };
    animation=requestAnimationFrame(frame);
  }
  function paint(immediate=false) {
    if (!audio) return;
    times[0].textContent=fmt(audio.currentTime); times[1].textContent=fmt(audio.duration);
    seek.max=Number.isFinite(audio.duration)?audio.duration:1; seek.value=audio.currentTime; seek.disabled=!Number.isFinite(audio.duration);
    seek.style.setProperty('--played',`${Number.isFinite(audio.duration)?audio.currentTime/audio.duration*100:0}%`);
    const playing=String(!audio.paused);if(buttons[1].dataset.playing!==playing){buttons[1].dataset.playing=playing;buttons[1].innerHTML=audio.paused?icons.play:icons.pause;buttons[1].setAttribute('aria-label',audio.paused?'Play':'Pause');}
    const next=activeLyric(rows,audio.currentTime);
    if(next!==active){ active=next;[...list.children].forEach((row,i)=>{const distance=active<0?3:Math.abs(i-active);row.classList.toggle('is-active',i===active);row.style.opacity=String(distance===0?1:Math.max(.15,.65-distance*.12));row.style.filter=`blur(${Math.min(3,Math.max(0,distance-1)*.8)}px)`;if(i===active)row.setAttribute('aria-current','true');else row.removeAttribute('aria-current');});focusRow(immediate); }
    else if(immediate)focusRow(true);
  }
  function display(body, message, synced, timedRows) {
    rows=timedRows || parseLrc(body); if(!synced)rows=rows.map(r=>({...r,t:null}));active=-2;manual=false;follow.hidden=true;
    list.replaceChildren(...rows.map(row=>{const p=document.createElement('p');p.textContent=row.text || '♪';p.dir='auto';return p;}));
    host.dataset.lyricsState=synced?'synced':rows.length?'plain':'unavailable';status.textContent=message;viewport.scrollTop=0;paint(true);
  }
  async function load() {
    const version=++serial;request?.abort();request=new AbortController();
    const meta=info.recording;
    display('',meta?.id?'Loading lyrics…':'Confirm this recording in Audio Manager to find lyrics.',false);
    if(!meta?.id){ const body=host.dataset.lyricsBody || ''; if(body && (!host.dataset.lyricsTrack || host.dataset.lyricsTrack===info.id)) display(body,'User-provided lyrics',parseLrc(body).some(r=>r.t!==null)); return; }
    if(!Number.isFinite(audio?.duration)||audio.readyState<1){status.textContent='Waiting for track metadata…';return;}
    try { const data=await getRecording(meta.id,request.signal); if(disposed||version!==serial)return;
      if(!data){display('','No lyrics found for this recording.',false);return;}
      if(data.instrumental){display('','Instrumental — no lyrics.',false);host.dataset.lyricsState='instrumental';return;}
      const same=Number.isFinite(audio?.duration)&&Math.abs(audio.duration-Number(data.duration))<=2;
      if(!same){display(data.plainLyrics||data.syncedLyrics||'','Recording duration differs — lyrics are not synchronized.',false);host.dataset.lyricsState='mismatch';return;}
      display(data.syncedLyrics||data.plainLyrics||'',data.timingWarning || (data.rows?.length || data.syncedLyrics ? '' : data.plainLyrics?'Plain lyrics — timing unavailable.':'No lyrics available.'),Boolean(data.rows?.length || data.syncedLyrics),data.rows);
    } catch(error){if(disposed||version!==serial||error.name==='AbortError')return;display('','Lyrics temporarily unavailable. Music can still play.',false);host.dataset.lyricsState='error';}
  }
  function bind() {
    const next=root.querySelector('audio[data-track-info]');
    if(next!==audio){if(audio)events.forEach(e=>audio.removeEventListener(e,event));audio=next;if(audio)events.forEach(e=>audio.addEventListener(e,event));trackKey='';}
    if(!audio){buttons.forEach(b=>b.disabled=true);status.textContent='Choose uploaded audio to use this player.';return;}
    try{info=JSON.parse(audio.dataset.trackInfo||'{}');}catch{info={};}
    buttons.forEach((b,i)=>b.disabled=i!==1&&!(info.count>1));title.textContent=info.title||'Profile audio';
    const key=JSON.stringify([info.id,info.src,info.recording,host.dataset.lyricsBody]);
    if(key!==trackKey){trackKey=key;art.replaceChildren();if(info.artwork){const image=document.createElement('img');image.src=info.artwork;image.alt='';image.onerror=()=>{art.textContent='♫';};art.append(image);}else art.textContent='♫';void load();}
    paint();
  }
  const event=e=>{if(e.type==='loadedmetadata')void load();paint(e.type==='seeking'||e.type==='seeked'||e.type==='loadedmetadata');};
  const events=['timeupdate','play','pause','seeking','seeked','loadedmetadata','durationchange','waiting','stalled','ratechange','ended'];
  buttons[1].onclick=()=>{if(audio){if(audio.paused)void audio.play().catch(()=>{status.textContent='Playback could not start. Try Play again.';});else audio.pause();}};
  buttons[0].onclick=()=>root.querySelector('[data-player-prev],#audio-prev')?.click();buttons[2].onclick=()=>root.querySelector('[data-player-next],#audio-next')?.click();
  seek.oninput=()=>{if(audio&&Number.isFinite(audio.duration)){audio.currentTime=Number(seek.value);paint(true);}};
  const suspend=()=>{manual=true;stopAnimation();follow.hidden=false;};
  viewport.addEventListener('wheel',suspend,{passive:true});viewport.addEventListener('touchstart',suspend,{passive:true});viewport.addEventListener('pointerdown',suspend);viewport.addEventListener('keydown',suspend);
  follow.onclick=()=>{manual=false;follow.hidden=true;focusRow();};
  const observer=new MutationObserver(records=>{if(records.some(r=>r.target===audio||[...r.addedNodes,...r.removedNodes].some(n=>n.nodeType===1&&(n.matches?.('audio')||n.querySelector?.('audio')))))bind();});
  observer.observe(root,{childList:true,subtree:true,attributes:true,attributeFilter:['data-track-info']});
  const resize=new ResizeObserver(()=>{list.style.setProperty("--lyric-focus-padding",`${viewport.clientHeight/2}px`);focusRow(true);});resize.observe(viewport);resize.observe(list);
  const recover=()=>paint(true);document.addEventListener('visibilitychange',recover);
  // No synthetic clock: this samples only actual currentTime, including stalls and rate changes.
  timer=setInterval(()=>{if(audio&&!audio.paused&&!document.hidden)paint();},100);
  bind();
  return()=>{disposed=true;serial++;request?.abort();stopAnimation();clearInterval(timer);observer.disconnect();resize.disconnect();document.removeEventListener('visibilitychange',recover);if(audio)events.forEach(e=>audio.removeEventListener(e,event));host.replaceChildren();};
}
