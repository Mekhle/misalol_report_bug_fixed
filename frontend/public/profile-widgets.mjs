const root = document.body, slots = [...root.querySelectorAll('[data-widget-id]')];
if (slots.length && root.dataset.profileUser) {
  const url = `/api/v1/profile/${encodeURIComponent(root.dataset.profileUser)}/widgets`;
  const safe = value => { try { const u = new URL(value, location.origin); return ['https:','http:'].includes(u.protocol) ? u.href : null; } catch { return null; } };
  fetch(url).then(r => { if (!r.ok) throw new Error('Unavailable'); return r.json(); }).then(({widgets}) => {
    for (const slot of slots) {
      const widget = widgets?.find(w => w.id === slot.dataset.widgetId), old = slot.querySelector('.widget');
      if (!old) continue;
      const title = old.querySelector('strong'), subtitle = old.querySelector('.widget-meta span');
      title.textContent = widget?.title || widget?.type || title.textContent;
      subtitle.textContent = widget?.subtitle || 'Temporarily unavailable';
      if (widget?.image && safe(widget.image)) { const image = document.createElement('img'); image.className='widget-art';image.alt='';image.loading='lazy';image.src=safe(widget.image);old.querySelector('.widget-art')?.replaceWith(image); }
      if (widget?.status === 'ok') old.classList.remove('is-error');
      if (widget?.status === 'ok' && safe(widget.href)) { const link = document.createElement('a');link.className=old.className;link.href=safe(widget.href);link.target='_blank';link.rel='noopener noreferrer';link.append(...old.childNodes);old.replaceWith(link); }
      if (widget?.type === 'timezone' && widget.meta?.timezone) {
        const tick = () => { try { title.textContent = new Intl.DateTimeFormat('en-GB',{hour:'2-digit',minute:'2-digit',timeZone:widget.meta.timezone}).format(new Date()); } catch { /* Retain resolver text. */ } };
        tick();const timer=setInterval(()=>{if(!document.hidden)tick();},15000);addEventListener('pagehide',()=>clearInterval(timer),{once:true});
      }
    }
  }).catch(()=>slots.forEach(slot=>{const label=slot.querySelector('.widget-meta span');if(label)label.textContent='Temporarily unavailable';}));
}
