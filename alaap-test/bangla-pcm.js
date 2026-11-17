class PhonePcm extends AudioWorkletProcessor{
  constructor(){
    super();
    this.block=new Float32Array(2048);
    this.offset=0;
  }
  process(inputs){
    const samples=inputs[0]?.[0];
    if(!samples)return true;
    for(const sample of samples){
      this.block[this.offset++]=sample;
      if(this.offset===this.block.length){
        this.port.postMessage(this.block,[this.block.buffer]);
        this.block=new Float32Array(2048);
        this.offset=0;
      }
    }
    return true;
  }
}
registerProcessor('phone-pcm',PhonePcm);
