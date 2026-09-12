/* General Reception PC character v2.0 — no microphone/network/API operations. */
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
class ReceptionCharacter {
 constructor(canvas,{base='assets/character/'}={}){
  this.canvas=canvas;this.ctx=canvas.getContext('2d');this.base=base;this.images={};
  this.enabled=true;this.active=true;this.speaking=false;this.start=0;this.blinkAt=3;this.blinkEnd=0;
  this.smileUntil=0;this.level=0;this.analyser=null;this.frame=0;this.last=0;this.disposed=false;
 }
 async load(){
  const names=['01_skirt','02_torso','head_complete_reference','05_eye_L_closed','05_eye_R_closed','08_mouth_open','08_mouth_smile',
   'L_upper_arm','L_forearm','L_hand','R_upper_arm','R_forearm','R_hand','joint_shoulder_L','joint_elbow_L','joint_wrist','joint_shoulder_R','joint_elbow_R','joint_torso'];
  await Promise.all(names.map(name=>new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>{this.images[name]=im;resolve();};im.onerror=()=>reject(new Error('素材を読み込めません: '+name));im.src=this.base+name+'.png';})));
  if(this.disposed)return;this.draw(performance.now()/1000);this.schedule();
 }
 setSpeaking(value){value=!!value;if(value&&!this.speaking)this.start=performance.now()/1000;this.speaking=value;if(!value)this.level=0;}
 setActive(value){this.active=!!value;cancelAnimationFrame(this.frame);this.frame=0;if(this.images['01_skirt'])this.draw(performance.now()/1000);this.schedule();}
 setEnabled(value){this.enabled=!!value;if(!value)this.level=0;if(this.images['01_skirt'])this.draw(performance.now()/1000);}
 smile(){this.smileUntil=performance.now()/1000+1.4;}
 boundary(){this.boundaryAt=performance.now()/1000;}
 attachAnalyser(analyser){this.analyser=analyser;this.samples=analyser?new Float32Array(analyser.fftSize):null;this.level=0;}
 schedule(){if(!this.disposed&&this.active&&!this.frame)this.frame=requestAnimationFrame(ms=>{this.frame=0;if(ms-this.last>32){this.draw(ms/1000);this.last=ms;}this.schedule();});}
 draw(t){
  const c=this.ctx,moving=this.enabled&&this.active;const p=pose(t,this.speaking,moving,this.start);
  let mouth=p.mouth;
  if(this.analyser&&this.speaking&&moving){try{if(this.samples.length!==this.analyser.fftSize)this.samples=new Float32Array(this.analyser.fftSize);this.analyser.getFloatTimeDomainData(this.samples);mouth=clamp((rms(this.samples)-0.012)*9);}catch{mouth=0;}}
  // Browser TTS does not expose PCM: boundary events optionally accent the approximate rhythm.
  else if(this.speaking&&moving&&t-(this.boundaryAt||-999)<.12)mouth=Math.max(mouth,.7);
  this.level=mouth>this.level?mouth:this.level*.55;if(!this.speaking||!moving)this.level=0;
  if(moving&&t>=this.blinkAt){this.blinkEnd=t+.14;this.blinkAt=t+3.4+Math.random()*2.7;}
  const blink=moving&&t<this.blinkEnd;
  c.clearRect(0,0,1254,1254);
  const image=name=>c.drawImage(this.images[name],0,0,1254,1254);
  const patch=(name,x,y,w,h)=>c.drawImage(this.images[name],x-w/2,y-h/2,w,h);
  const rotate=(x,y,angle,fn)=>{c.save();c.translate(x,y);c.rotate(angle*Math.PI/180);c.translate(-x,-y);fn();c.restore();};
  
  // Extended cloth underpainting sits behind the moving seams, not on top of sleeve detail.
  patch('joint_torso',494,690,14,65);patch('joint_torso',765,690,14,65);
  for(const side of ['L','R']){
   const left=side==='L',sx=left?443:817,sy=433,ex=left?420:861,ey=726,wx=left?352:896,wy=1037;
   const factor=left?1:-.55;
   patch('joint_shoulder_'+side,sx,sy+12,42,45);
   rotate(sx,sy,p.upper*factor,()=>{
    patch('joint_elbow_'+side,ex,ey,80,28);image(side+'_upper_arm');
    rotate(ex,ey,p.fore*factor,()=>{
     patch('joint_wrist',wx,wy,46,14);image(side+'_forearm');
     rotate(wx,wy,p.hand*factor,()=>image(side+'_hand'));
    });
   });
  }
  image('01_skirt');image('02_torso');image('head_complete_reference');
  if(blink){image('05_eye_L_closed');image('05_eye_R_closed');}
  if(this.level>.12){c.save();c.globalAlpha=smooth(clamp(this.level));image('08_mouth_open');c.restore();}
  else if(moving&&!this.speaking&&t<this.smileUntil)image('08_mouth_smile');
 }
 destroy(){this.disposed=true;cancelAnimationFrame(this.frame);this.attachAnalyser(null);}
}
window.ReceptionCharacter=ReceptionCharacter;
window.ReceptionCharacterMath={rms,pose};
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
