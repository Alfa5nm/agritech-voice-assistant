import {test} from 'node:test';
import assert from 'node:assert/strict';
import {collectTurns} from './bangla.js';
import {nextBanglaQuestion} from './bangla-dialogue.js';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

test('phone audio streams every 32 ms without dropping samples between blocks',()=>{
  let Processor;const blocks=[];
  runInNewContext(readFileSync(new URL('./bangla-pcm.js',import.meta.url),'utf8'),{
    AudioWorkletProcessor:class{constructor(){this.port={postMessage:block=>blocks.push([...block])};}},
    registerProcessor:(_name,value)=>Processor=value,
  });
  const processor=new Processor();
  for(let offset=0;offset<1024;offset+=128){
    processor.process([[Float32Array.from({length:128},(_,i)=>(offset+i)/1024)]]);
    assert.equal(blocks.length,Math.floor((offset+128)/512));
  }
  assert.deepEqual(blocks.flat(),Array.from({length:1024},(_,i)=>i/1024));
  assert.equal(processor.process([]),true);
});

test('Chatgaiya audibility checks confirm the intent without changing crop context',()=>{
  for(const cleaned of [
    'ar khota ki bujha jar na',
    'আর খতা আর খতা এইবে হুনা জান না',
    'আর খতা আর খতা কি বুনা জার না',
    'আর শতা কী বোজা জাল না',
  ]){
    const state={crop:'ধান',pending:'timing'};
    assert.equal(nextBanglaQuestion(state,{cleaned}),'audibility');
    assert.equal(nextBanglaQuestion(state,{cleaned:'জি'}),'audible');
    assert.deepEqual(state,{crop:'ধান',pending:'timing'});
  }
  assert.equal(nextBanglaQuestion({},{cleaned:'ধান বুনা জার না'}),'repeat');
  assert.equal(nextBanglaQuestion({},{cleaned:'আস এতটা ওই দেকছিলিগ মোন্যে যাও না'}),'repeat');
});

test('Bangla follow-ups use feedback across turns and preserve context on unreliable input',()=>{
  const state={};
  const turn=cleaned=>nextBanglaQuestion(state,{cleaned});
  assert.equal(turn('পাতায় দাগ পড়েছে'),'crop');
  assert.equal(turn('ধানের'),'spots');
  assert.equal(nextBanglaQuestion(state,{cleaned:'আলু',suspect:true}),'repeat');
  assert.equal(state.crop,'ধান');
  assert.equal(turn('পাতার ডগায়'),'timing');
  assert.equal(turn('তিন দিন ধরে'),'confirm');
  assert.equal(turn('না'),'symptom');
  assert.equal(turn('পোকা দেখা যাচ্ছে'),'insects');
  assert.equal(turn('পাতার নিচে'),'timing');
  assert.equal(turn('গতকাল থেকে'),'confirm');
  assert.equal(turn('হ্যাঁ'),'finish');
});

test('hands-free capture keeps pre-roll and emits again after a pause',()=>{
  const turns=[];
  const collect=collectTurns(16000,blocks=>turns.push(blocks));
  const silence=new Float32Array(1600);
  const speech=new Float32Array(1600).fill(0.05);
  for(let turn=0;turn<2;turn++){
    for(let n=0;n<5;n++)collect(silence);
    for(let n=0;n<3;n++)collect(speech);
    for(let n=0;n<5;n++)collect(silence);
    assert.equal(turns.length,turn);
    collect(silence);
    assert.equal(turns.length,turn+1);
    assert.equal(turns[turn][0],silence);
    assert.ok(turns[turn].includes(speech));
  }
});
