// Gemini Live supplies input transcripts only. Answers remain approved FAQ text.
export class TranscriptBuffer {
  constructor(commit, delay=1400){this.commit=commit;this.delay=delay;this.text='';this.timer=null;}
  partial(){clearTimeout(this.timer);}
  final(text){this.text+=String(text||'');clearTimeout(this.timer);this.timer=setTimeout(()=>{const value=this.text.trim();this.text='';if(value)this.commit(value);},this.delay);}
  clear(){clearTimeout(this.timer);this.text='';}
}
export class LiveTranscription {
  constructor({base,onText,onPreview,onError}){
    Object.assign(this,{base,onText,onPreview,onError});this.closed=false;this.paused=true;
    this.buffer=new TranscriptBuffer(text=>{if(!this.closed&&!this.paused){this.pause();onText(text);}});
    this.abort=new AbortController();
  }
  async start(){
    try{
      this.context=new AudioContext({sampleRate:16000});await this.context.resume();
      const stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true},video:false});
      if(this.closed){stream.getTracks().forEach(t=>t.stop());return;}
      this.stream=stream;
      if(this.context.sampleRate!==16000)throw new Error('AUDIO_RATE_UNSUPPORTED');
      await this.context.audioWorklet.addModule(new URL('./pcm-worklet.js',import.meta.url));
      if(this.closed)return;
      this.source=this.context.createMediaStreamSource(stream);
      this.node=new AudioWorkletNode(this.context,'reception-pcm');
      this.gain=this.context.createGain();this.gain.gain.value=0;
      this.source.connect(this.node);this.node.connect(this.gain);this.gain.connect(this.context.destination);
      this.node.port.onmessage=e=>{
        if(this.closed||this.paused||this.ws?.readyState!==1)return;
        if(this.ws.bufferedAmount>320000){this.fail(new Error('VOICE_NETWORK_SLOW'));return;}
        const bytes=new Uint8Array(e.data);let value='';for(const b of bytes)value+=String.fromCharCode(b);
        this.ws.send(JSON.stringify({realtimeInput:{audio:{mimeType:'audio/pcm;rate=16000',data:btoa(value)}}}));
      };
      const timeout=setTimeout(()=>this.abort.abort(),15000);
      let data;
      try{
        const response=await fetch(this.base+'/api/gemini-live-token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({purpose:'general-reception-transcribe-v0.3'}),signal:this.abort.signal});
        data=await response.json();if(!response.ok||!data.ok)throw new Error(data.code||'VOICE_TOKEN_FAILED');
      }finally{clearTimeout(timeout);}
      if(this.closed)return;
      if(!/^auth_tokens\/[A-Za-z0-9._~-]+$/.test(data.token||''))throw new Error('VOICE_TOKEN_INVALID');
      this.ws=new WebSocket('wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token='+data.token);
      await new Promise((resolve,reject)=>{
        let settled=false;
        const finish=error=>{if(settled)return;settled=true;clearTimeout(timer);this.cancelConnect=null;error?reject(error):resolve();};
        this.cancelConnect=()=>finish(new Error('VOICE_CANCELLED'));
        const timer=setTimeout(()=>finish(new Error('VOICE_CONNECT_TIMEOUT')),15000);
        this.ws.onopen=()=>this.ws.send(JSON.stringify({setup:{model:'models/'+data.model.replace(/^models\//,''),generationConfig:{responseModalities:['TEXT']},inputAudioTranscription:{languageCodes:['ja-JP']}}}));
        // Serialize Blob decoding to preserve transcript order.
        let chain=Promise.resolve();
        this.ws.onmessage=e=>{chain=chain.then(async()=>{
          if(this.closed)return;
          const m=JSON.parse(typeof e.data==='string'?e.data:await e.data.text());
          if(m.error)throw new Error('VOICE_SERVER_ERROR');
          if(m.setupComplete){finish();return;}
          const content=m.serverContent;
          if(this.paused||!content)return;
          if(content.interimInputTranscription){this.buffer.partial();this.onPreview(content.interimInputTranscription.text||'');}
          if(content.inputTranscription)this.buffer.final(content.inputTranscription.text);
        }).catch(error=>{finish(error);this.fail(error);});};
        this.ws.onerror=()=>{const error=new Error('VOICE_CONNECTION_ERROR');finish(error);this.fail(error);};
        this.ws.onclose=()=>{const error=new Error('VOICE_CONNECTION_CLOSED');finish(error);if(!this.closed)this.fail(error);};
      });
    }catch(error){this.close();throw error;}
  }
  pause(){this.paused=true;this.buffer.clear();if(this.ws?.readyState===1)this.ws.send(JSON.stringify({realtimeInput:{audioStreamEnd:true}}));}
  resume(){if(!this.closed)this.paused=false;}
  fail(error){if(this.closed)return;this.close();this.onError(error);}
  close(){
    if(this.closed)return;this.closed=true;this.paused=true;this.buffer.clear();this.abort.abort();this.cancelConnect?.();
    this.stream?.getTracks().forEach(t=>t.stop());this.source?.disconnect();this.node?.disconnect();this.gain?.disconnect();
    if(this.ws){this.ws.onmessage=null;this.ws.onerror=null;this.ws.onclose=null;this.ws.close();}
    if(this.context&&this.context.state!=='closed')void this.context.close().catch(()=>{});
  }
}
