export function transcriptQuality(value,{confirmation=false}={}){
  const raw=String(value||'').normalize('NFC').trim();
  const tags=/<[^>]*(?:noise|cough|inaudible|unintelligible|silence|music|laugh|sneeze)[^>]*>|\[(?:noise|cough(?:ing)?|inaudible|unintelligible|silence|music|laughter|sneeze)\]/giu;
  const tagged=tags.test(raw);tags.lastIndex=0;
  const text=raw.replace(tags,' ').trim();
  if(!/[\p{L}\p{N}]/u.test(text)||/^(?:cough(?:ing)?|noise|silence|music|laughter|কাশি|হাঁচি)[.!। ]*$/iu.test(text))return {usable:false,reason:'non_speech'};
  if(/\uFFFD|\b(?:inaudible|unintelligible)\b/iu.test(text)||(confirmation&&tagged))return {usable:false,reason:'unclear_speech'};
  // This helpline expects Bengali (including regional speech), Roman Bangla or English, not ASR script drift.
  const letters=[...text].filter(char=>/\p{L}/u.test(char));
  if(letters.some(char=>!/[\p{Script=Bengali}\p{Script=Latin}]/u.test(char)))return {usable:false,reason:'unexpected_script'};
  const repeated=text.match(/^(\S+)(?:\s+\1){4,}$/iu);
  if(/(.)\1{7,}/u.test(text)||(repeated&&!/^(জি|জ্বি|হ্যাঁ|হ্যা|হ|ঠিক|না|নাই|yes|no)$/iu.test(repeated[1])))return {usable:false,reason:'incoherent'};
  return {usable:true,reason:tagged?'background_noise':'clear'};
}

export class ResponseDeadline{
  constructor(notify,{setTimer=setTimeout,clearTimer=clearTimeout,now=Date.now,slowMs=4000,timeoutMs=12000}={}){Object.assign(this,{notify,setTimer,clearTimer,now,slowMs,timeoutMs});}
  start(){this.clear();this.started=this.now();this.slow=this.setTimer(()=>this.notify({state:'slow',elapsedMs:this.now()-this.started}),this.slowMs);this.timeout=this.setTimer(()=>{const elapsedMs=this.now()-this.started;this.clear();this.notify({state:'timeout',elapsedMs});},this.timeoutMs);}
  clear(){this.clearTimer(this.slow);this.clearTimer(this.timeout);this.slow=this.timeout=null;}
}
