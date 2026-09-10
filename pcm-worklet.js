class ReceptionPCM extends AudioWorkletProcessor {
  constructor(){super();this.buffer=new ArrayBuffer(3200);this.view=new DataView(this.buffer);this.index=0;}
  process(inputs){
    const input=inputs[0]?.[0];if(!input)return true;
    for(const sample of input){const s=Math.max(-1,Math.min(1,sample));this.view.setInt16(this.index*2,Math.round(s*(s<0?32768:32767)),true);this.index++;
      if(this.index===1600){this.port.postMessage(this.buffer,[this.buffer]);this.buffer=new ArrayBuffer(3200);this.view=new DataView(this.buffer);this.index=0;}
    }return true;
  }
}
registerProcessor('reception-pcm',ReceptionPCM);
