class ReceptionPCM extends AudioWorkletProcessor {
  constructor(){super();this.buffer=new ArrayBuffer(3200);this.view=new DataView(this.buffer);this.index=0;this.area=0;this.filled=0;}
  emit(sample){
    const s=Math.max(-1,Math.min(1,sample));this.view.setInt16(this.index++*2,Math.round(s*(s<0?32768:32767)),true);
    if(this.index===1600){this.port.postMessage(this.buffer,[this.buffer]);this.buffer=new ArrayBuffer(3200);this.view=new DataView(this.buffer);this.index=0;}
  }
  process(inputs){
    const input=inputs[0]?.[0];if(!input)return true;
    const ratio=sampleRate/16000;
    for(const sample of input){
      let left=1;
      while(left>1e-9){
        const take=Math.min(left,ratio-this.filled);this.area+=sample*take;this.filled+=take;left-=take;
        if(this.filled>=ratio-1e-9){this.emit(this.area/ratio);this.area=0;this.filled=0;}
      }
    }
    return true;
  }
}
registerProcessor('reception-pcm',ReceptionPCM);
