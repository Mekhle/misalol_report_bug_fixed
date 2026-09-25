export function mountCursor(root, color, mode) {
  const preview = root.hasAttribute('data-profile-preview');
  const canvas = document.createElement('canvas');
  Object.assign(canvas.style, { position:preview?'absolute':'fixed', inset:'0', width:'100%', height:'100%', pointerEvents:'none', zIndex:'45' });
  canvas.setAttribute('aria-hidden','true'); root.appendChild(canvas);
  const context = canvas.getContext('2d');
  let frame=0, active=false, x=0, y=0, fx=0, fy=0, particles=[], last=0;
  const resize=()=>{ canvas.width=preview?root.clientWidth:innerWidth;canvas.height=preview?root.clientHeight:innerHeight;canvas.style.top=preview?`${root.scrollTop}px`:"0"; };
  const draw=(time)=>{
    context.clearRect(0,0,canvas.width,canvas.height);
    fx+=(x-fx)*.16;fy+=(y-fy)*.16;context.fillStyle=color;context.strokeStyle=color;
    if(mode==='dot'){context.beginPath();context.arc(fx,fy,5,0,Math.PI*2);context.fill();}
    else if(mode==='cat'||mode==='ghost'){
      context.save();context.translate(fx+18,fy+18);context.beginPath();context.arc(0,0,10,Math.PI,0);context.lineTo(10,10);
      if(mode==='cat'){context.lineTo(-10,10);context.closePath();context.fill();context.beginPath();context.moveTo(-10,-3);context.lineTo(-11,-16);context.lineTo(-3,-9);context.moveTo(3,-9);context.lineTo(11,-16);context.lineTo(10,-3);context.fill();}
      else{for(let i=10;i>=-10;i-=5)context.lineTo(i, i%10===0?13:8);context.closePath();context.fill();}
      context.fillStyle='#15151c';context.fillRect(-5,-1,2,3);context.fillRect(3,-1,2,3);context.restore();
    }else{
      if(time-last>65&&particles.length<24){particles.push({x,y,life:1,drift:Math.random()*2-1});last=time;}
      particles=particles.filter(p=>p.life>0);for(const p of particles){p.life-=.02;p.y+=mode==='bubbles'?-.6:.7;p.x+=p.drift;context.globalAlpha=p.life;context.beginPath();if(mode==='bubbles'){context.arc(p.x,p.y,3+(1-p.life)*5,0,Math.PI*2);context.stroke();}else{for(let i=0;i<3;i++){const a=i*Math.PI/3;context.moveTo(p.x-Math.cos(a)*4,p.y-Math.sin(a)*4);context.lineTo(p.x+Math.cos(a)*4,p.y+Math.sin(a)*4);}context.stroke();}}context.globalAlpha=1;
    }
    if(active&&!document.hidden)frame=requestAnimationFrame(draw);
  };
  const move=e=>{if(e.pointerType!=='mouse')return;const box=root.getBoundingClientRect();x=preview?(e.clientX-box.left)*root.clientWidth/box.width:e.clientX;y=preview?(e.clientY-box.top)*root.clientHeight/box.height:e.clientY;if(!active){fx=x;fy=y;active=true;frame=requestAnimationFrame(draw);}};
  const stop=()=>{active=false;cancelAnimationFrame(frame);context.clearRect(0,0,canvas.width,canvas.height);};
  const visibility=()=>{if(document.hidden)stop();};
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');const change=()=>{if(reduced.matches)stop();};
  const pointer=e=>{if(!reduced.matches)move(e);};
  const observer=new ResizeObserver(resize);observer.observe(root);
  root.addEventListener("scroll",resize,{passive:true});resize();root.addEventListener('pointermove',pointer,{passive:true});root.addEventListener('pointerleave',stop);addEventListener('resize',resize);document.addEventListener('visibilitychange',visibility);reduced.addEventListener('change',change);
  return()=>{observer.disconnect();root.removeEventListener("scroll",resize);stop();canvas.remove();root.removeEventListener('pointermove',pointer);root.removeEventListener('pointerleave',stop);removeEventListener('resize',resize);document.removeEventListener('visibilitychange',visibility);reduced.removeEventListener('change',change);};
}
