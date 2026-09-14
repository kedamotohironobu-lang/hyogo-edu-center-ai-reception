/* General Reception PC character v3.0 — no microphone/network/API operations. */
(() => {
'use strict';
const clamp=(n,a=0,b=1)=>Math.min(b,Math.max(a,n));
const smooth=n=>n*n*(3-2*n);
function rms(samples){let s=0;for(const v of samples)s+=v*v;return samples.length?Math.sqrt(s/samples.length):0;}
function pose(t,speaking,enabled,start=0){
 if(!enabled)return {upper:0,fore:0,hand:0,mouth:0};
 const elapsed=Math.max(0,t-start),cycle=elapsed%8.5;
 const gesture=speaking&&cycle<3.2?Math.sin(Math.PI*cycle/3.2)**2:0;
 return {upper:gesture*.8,fore:gesture*3.5,hand:-gesture*.8,
 mouth:speaking?clamp((Math.sin(elapsed*19)+0.35)*0.72):0};
}
// Continuous vertices keep shoulders and elbows connected; no separated sleeve cutouts.
function warpPoint(x,y,amount){
 const down=smooth(clamp((y-410)/760));
 const leftCenter=445-clamp((y-410)/700)*100;
 const rightCenter=819+clamp((y-410)/700)*80;
 const left=Math.exp(-(((x-leftCenter)/62)**2));
 const right=Math.exp(-(((x-rightCenter)/62)**2));
 return [x+amount*down*(-left*26+right*16),y-amount*down*(left*5+right*3)];
}
function triangle(c,im,a,b,d,A,B,D){
 const den=(b[0]-a[0])*(d[1]-a[1])-(d[0]-a[0])*(b[1]-a[1]);
 const ux=(B[0]-A[0]),vx=(D[0]-A[0]),uy=(B[1]-A[1]),vy=(D[1]-A[1]);
 const aa=(ux*(d[1]-a[1])-vx*(b[1]-a[1]))/den,cc=(vx*(b[0]-a[0])-ux*(d[0]-a[0]))/den;
 const bb=(uy*(d[1]-a[1])-vy*(b[1]-a[1]))/den,dd=(vy*(b[0]-a[0])-uy*(d[0]-a[0]))/den;
 c.save();c.beginPath();
 // Subpixel overlap prevents hairline cracks caused by clip antialiasing.
 const mx=(A[0]+B[0]+D[0])/3,my=(A[1]+B[1]+D[1])/3;
 [A,B,D].forEach((v,i)=>{const dx=v[0]-mx,dy=v[1]-my,len=Math.hypot(dx,dy)||1;const X=v[0]+dx/len*1.2,Y=v[1]+dy/len*1.2;i?c.lineTo(X,Y):c.moveTo(X,Y);});
 c.closePath();c.clip();c.transform(aa,bb,cc,dd,A[0]-aa*a[0]-cc*a[1],A[1]-bb*a[0]-dd*a[1]);c.drawImage(im,0,0,1254,1254);c.restore();
}
function drawMesh(c,im,amount){
 if(Math.abs(amount)<.002){c.drawImage(im,0,0,1254,1254);return;}
 // Head and collar remain at the exact original position.
 c.drawImage(im,0,0,1254,400,0,0,1254,400);
 const cols=18,rows=22,x0=240,w=774,y0=400,h=854;
 for(let j=0;j<rows;j++)for(let i=0;i<cols;i++){
  const x=x0+i*w/cols,y=y0+j*h/rows,dx=w/cols,dy=h/rows;
  const a=[x,y],b=[x+dx,y],d=[x,y+dy],e=[x+dx,y+dy];
  const A=warpPoint(...a,amount),B=warpPoint(...b,amount),D=warpPoint(...d,amount),E=warpPoint(...e,amount);
  triangle(c,im,a,b,d,A,B,D);triangle(c,im,b,e,d,B,E,D);
 }
}
class ReceptionCharacter {
 constructor(canvas,{base='assets/character/'}={}){
  this.canvas=canvas;this.ctx=canvas.getContext('2d');this.base=base;this.images={};
  this.enabled=true;this.active=true;this.speaking=false;this.start=0;this.blinkAt=3;this.blinkEnd=0;
  this.smileUntil=0;this.level=0;this.analyser=null;this.frame=0;this.last=0;this.disposed=false;this.gesture=0;this.previousTime=null;this.smileLevel=0;
 }
 async load(){
  const names=['front','05_eye_L_closed','05_eye_R_closed','08_mouth_open','08_mouth_smile'];
  await Promise.all(names.map(name=>new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>{this.images[name]=im;resolve();};im.onerror=()=>reject(new Error('素材を読み込めません: '+name));im.src=this.base+name+'.png';})));
  if(this.disposed)return;this.draw(performance.now()/1000);this.schedule();
 }
 setSpeaking(value){value=!!value;if(value&&!this.speaking)this.start=performance.now()/1000;this.speaking=value;if(!value)this.mouthTarget=0;}
 setActive(value){this.active=!!value;cancelAnimationFrame(this.frame);this.frame=0;if(this.images.front)this.draw(performance.now()/1000);this.schedule();}
 setEnabled(value){this.enabled=!!value;if(!value)this.mouthTarget=0;if(this.images.front)this.draw(performance.now()/1000);}
 smile(){this.smileUntil=performance.now()/1000+1.4;}
 boundary(){this.boundaryAt=performance.now()/1000;}
 attachAnalyser(analyser){this.analyser=analyser;this.samples=analyser?new Float32Array(analyser.fftSize):null;this.level=0;}
 schedule(){if(!this.disposed&&this.active&&!this.frame)this.frame=requestAnimationFrame(ms=>{this.frame=0;if(ms-this.last>15){this.draw(ms/1000);this.last=ms;}this.schedule();});}
 draw(t){
  const c=this.ctx,moving=this.enabled&&this.active;const p=pose(t,this.speaking,moving,this.start);
  const dt=this.previousTime===null?1/60:clamp(t-this.previousTime,0,.08);this.previousTime=t;
  const follow=(value,target,tau)=>value+(target-value)*(1-Math.exp(-dt/tau));
  let mouth=p.mouth;
  if(this.analyser&&this.speaking&&moving){try{if(this.samples.length!==this.analyser.fftSize)this.samples=new Float32Array(this.analyser.fftSize);this.analyser.getFloatTimeDomainData(this.samples);mouth=clamp((rms(this.samples)-0.012)*9);}catch{mouth=0;}}
  // Browser TTS does not expose PCM: boundary events optionally accent the approximate rhythm.
  else if(this.speaking&&moving&&t-(this.boundaryAt||-999)<.12)mouth=Math.max(mouth,.7);
  this.level=follow(this.level,moving&&this.speaking?mouth:0,mouth>this.level?.045:.085);
  if(!moving){this.level=0;this.gesture=0;this.smileLevel=0;}
  const targetGesture=moving&&this.speaking?p.fore/3.5:0;
  this.gesture=follow(this.gesture,targetGesture,.23);
  if(moving&&t>=this.blinkAt){this.blinkStart=t;this.blinkAt=t+3.4+Math.random()*2.7;}
  const phase=t-(this.blinkStart??-999);
  const blink=!moving?0:phase<.09?smooth(clamp(phase/.09)):phase<.13?1:phase<.26?1-smooth((phase-.13)/.13):0;
  this.smileLevel=follow(this.smileLevel,moving&&!this.speaking&&t<this.smileUntil?1:0,.16);
  c.clearRect(0,0,1254,1254);c.imageSmoothingEnabled=true;c.imageSmoothingQuality='high';
  drawMesh(c,this.images.front,this.gesture);
  const overlay=(name,opacity)=>{if(opacity<.005)return;c.save();c.globalAlpha=clamp(opacity);c.drawImage(this.images[name],0,0,1254,1254);c.restore();};
  overlay('05_eye_L_closed',blink);overlay('05_eye_R_closed',blink);
  overlay('08_mouth_smile',this.smileLevel*(1-this.level));
  overlay('08_mouth_open',smooth(clamp(this.level)));

 }
 destroy(){this.disposed=true;cancelAnimationFrame(this.frame);this.attachAnalyser(null);}
}
window.ReceptionCharacter=ReceptionCharacter;
window.ReceptionCharacterMath={rms,pose,warpPoint};
function mount(){
 const preview=document.getElementById('characterPreview');
 const portrait=preview||document.querySelector('.portrait');if(!portrait)return;
 const canvas=document.createElement('canvas');canvas.width=1254;canvas.height=1254;canvas.className='reception-rig';canvas.setAttribute('role','img');canvas.setAttribute('aria-label','正面向きの受付キャラクター');portrait.append(canvas);
 const rig=new ReceptionCharacter(canvas);window.receptionCharacter=rig;
 const desktop=matchMedia('(min-width:721px)'),reduce=matchMedia('(prefers-reduced-motion:reduce)');
 const panel=preview||document.querySelector('.assistant-panel');
 let control=document.querySelector('.motion-preference');
 if(!control){control=document.createElement('div');control.className='motion-preference';control.innerHTML='<label><input type="checkbox" checked> キャラクターを動かす</label>';panel.append(control);}
 const toggle=control.querySelector('input');try{const saved=localStorage.getItem('general-reception-pc-motion');toggle.checked=saved===null?!reduce.matches:saved==='on';}catch{toggle.checked=!reduce.matches;}
 const update=()=>{rig.setEnabled(toggle.checked&&!reduce.matches);rig.setSpeaking(document.body.classList.contains('speaking'));rig.setActive(!document.hidden&&(!!preview||desktop.matches));};
 toggle.addEventListener('change',()=>{try{localStorage.setItem('general-reception-pc-motion',toggle.checked?'on':'off');}catch{}update();});
 const observer=new MutationObserver(update);observer.observe(document.body,{attributes:true,attributeFilter:['class']});
 document.addEventListener('visibilitychange',update);desktop.addEventListener('change',update);reduce.addEventListener('change',update);
 const receipt=document.getElementById('receipt');let lastReceipt='';
 if(receipt)new MutationObserver(()=>{const text=receipt.textContent;if(text!==lastReceipt&&text.includes('受付番号'))rig.smile();lastReceipt=text;}).observe(receipt,{childList:true,characterData:true,subtree:true});
 window.addEventListener('reception-speech-boundary',()=>rig.boundary());
 window.addEventListener('reception-character-smile',()=>rig.smile());
 window.addEventListener('pagehide',()=>rig.setActive(false));window.addEventListener('pageshow',update);
 rig.load().then(()=>{portrait.classList.add('rig-ready');update();if(preview)document.getElementById('previewStatus').textContent='準備できました。';}).catch(e=>{canvas.remove();rig.destroy();if(preview)document.getElementById('previewStatus').textContent=e.message;console.warn(e.message);});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
})();
