const crops={
  'ধান':/^(ধান|ধানের|ধানে|ধানগাছে|dhan)$/iu,
  'আলু':/^(আলু|আলুর|আলুতে|alu)$/iu,
  'গম':/^(গম|গমের|গমে|gom)$/iu,
  'ভুট্টা':/^(ভুট্টা|ভুট্টার|ভুট্টায়|bhutta)$/iu
};
const symptoms={
  spots:/^(দাগ|দাগগুলো|দাগটা|দাগের|dag)$/iu,
  yellow:/^(হলুদ|হলুদাভ|holud)$/iu,
  insects:/^(পোকা|পোকার|পোকাগুলো|poka)$/iu
};

export function nextBanglaQuestion(state,{cleaned='',suspect=false}){
  if(!cleaned||suspect)return 'repeat';
  const words=cleaned.match(/[\p{L}\p{M}\p{N}]+/gu)||[];
  const has=pattern=>words.some(word=>pattern.test(word));
  const phrase=words.join(' ');
  const mySpeech=/(?:^|\s)(?:আর খতা|আর কথা|আমার কথা|ar khota)(?:\s|$)/iu.test(phrase);
  const noisyAudioCheck=/^আর শতা (?:কি|কী) বোজা (?:জাল|জার) না$/u.test(phrase);
  if(noisyAudioCheck||(mySpeech&&has(/^(হুনা|শোনা|শুনা|শুনতে|বুঝা|বুঝতে|বুনা|huna|bujha)$/iu))){
    state.checkingAudio=true;
    return 'audibility';
  }
  if(state.checkingAudio){
    delete state.checkingAudio;
    if(words.length<=2&&has(/^(হ্যাঁ|হ্যা|জি|হ|yes)$/iu))return 'audible';
    if(words.length<=2&&has(/^(না|নাই|no)$/iu))return 'repeat';
  }
  if(state.pending==='confirm'){
    if(has(/^(না|নাই|না-জি|no)$/iu)){
      delete state.symptom;
      state.pending='symptom';
      return 'symptom';
    }
    if(has(/^(হ্যাঁ|হ্যা|জি|হ|yes)$/iu)){
      state.pending='finish';
      return 'finish';
    }
    return 'confirm';
  }
  const crop=Object.keys(crops).filter(name=>has(crops[name]));
  const symptom=Object.keys(symptoms).filter(name=>has(symptoms[name]));
  // shortcut: small vocabulary; add reviewed dialect examples before wider use.
  if(crop.length>1||symptom.length>1||has(/^(না|নাই|নেই|নয়)$/u))return 'repeat';
  if(crop.length===1&&state.crop!==crop[0]){
    if(state.crop)delete state.symptom;
    state.crop=crop[0];
    state.pending=null;
  }
  if(symptom.length===1&&state.symptom!==symptom[0]){
    state.symptom=symptom[0];
    state.pending=null;
  }
  if(!state.crop)return state.pending='crop';
  if(!state.symptom)return state.pending='symptom';
  if(state.pending===state.symptom){
    const details=/^(ডগা|ডগায়|আগায়|গোড়ায়|মাঝে|মাঝখানে|কিনারা|কিনারায়|ওপরে|উপরে|নিচে|পুরো|সব|ছোট|বড়|কালো|সাদা|সবুজ)$/u;
    if(!has(details))return state.symptom;
    state.pending='timing';
    return 'timing';
  }
  if(state.pending==='timing'){
    if(!has(/^(আজ|কাল|গতকাল|গত|দিন|দিনের|সপ্তাহ|মাস|[০-৯0-9]+)$/u))return 'timing';
    state.pending='confirm';
    return 'confirm';
  }
  return state.pending=state.symptom;
}
