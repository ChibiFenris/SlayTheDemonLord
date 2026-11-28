'use strict';
// ─── SOUND EFFECTS ────────────────────────────────────────────────────────────
// Small synthesised cues (no audio files): hits, crits, misses, heals, spells,
// boss warnings, level-ups and battle start/end. Follows the music mute/volume.
let sfxCtx=null, sfxLast={};
function sfxContext(){
  if(sfxCtx) return sfxCtx;
  const AC=window.AudioContext||window.webkitAudioContext; if(!AC) return null;
  try{ sfxCtx=new AC(); }catch(e){ return null; }
  return sfxCtx;
}
// Browsers only allow audio after a user gesture; unlock on the first tap/click.
['pointerdown','keydown'].forEach(ev=>document.addEventListener(ev,()=>{ const c=sfxContext(); if(c&&c.state==='suspended') c.resume(); if(typeof sfxLoadSamples==='function') sfxLoadSamples(c); },{once:true}));

function tone(c,{type='sine',from=440,to=from,dur=0.15,vol=0.3,delay=0}){
  const out=c._sfxOut||c.destination;
  const t=c.currentTime+delay, o=c.createOscillator(), g=c.createGain();
  o.type=type; o.frequency.setValueAtTime(from,t); o.frequency.exponentialRampToValueAtTime(Math.max(20,to),t+dur);
  g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(vol,t+0.01); g.gain.exponentialRampToValueAtTime(0.0001,t+dur);
  o.connect(g).connect(out); o.start(t); o.stop(t+dur+0.02);
}
function noise(c,{dur=0.12,vol=0.3,filter=1200,delay=0}){
  const out=c._sfxOut||c.destination;
  const t=c.currentTime+delay, len=Math.floor(c.sampleRate*dur), buf=c.createBuffer(1,len,c.sampleRate), d=buf.getChannelData(0);
  for(let i=0;i<len;i++) d[i]=(Math.random()*2-1)*(1-i/len);
  const src=c.createBufferSource(), f=c.createBiquadFilter(), g=c.createGain();
  src.buffer=buf; f.type='lowpass'; f.frequency.value=filter; g.gain.value=vol;
  src.connect(f).connect(g).connect(out); src.start(t);
}
const SFX={
  dmg:   c=>{ noise(c,{dur:0.12,vol:0.35,filter:900}); tone(c,{type:'triangle',from:140,to:60,dur:0.14,vol:0.35}); },
  crit:  c=>{ noise(c,{dur:0.18,vol:0.4,filter:2500}); tone(c,{type:'square',from:220,to:70,dur:0.2,vol:0.2}); tone(c,{from:1320,to:1100,dur:0.25,vol:0.08,delay:0.03}); },
  miss:  c=>{ noise(c,{dur:0.2,vol:0.15,filter:3000}); },
  heal:  c=>{ tone(c,{from:523,dur:0.12,vol:0.12}); tone(c,{from:784,dur:0.18,vol:0.12,delay:0.08}); },
  dot:   c=>{ tone(c,{type:'sawtooth',from:200,to:120,dur:0.1,vol:0.06}); },
  debuff:c=>{ tone(c,{type:'triangle',from:330,to:220,dur:0.2,vol:0.1}); },
  warn:  c=>{ tone(c,{type:'sawtooth',from:98,dur:0.6,vol:0.18}); tone(c,{type:'sawtooth',from:104,dur:0.6,vol:0.12}); },
  start: c=>{ tone(c,{type:'sawtooth',from:147,to:150,dur:0.35,vol:0.12}); tone(c,{type:'sawtooth',from:220,to:222,dur:0.45,vol:0.1,delay:0.18}); },
  win:   c=>{ [392,494,587,784].forEach((f,i)=>tone(c,{type:'triangle',from:f,dur:0.25,vol:0.12,delay:i*0.09})); },
  level: c=>{ [523,659,784,1047].forEach((f,i)=>tone(c,{from:f,dur:0.2,vol:0.1,delay:i*0.07})); },
  death: c=>{ tone(c,{type:'triangle',from:110,to:55,dur:1.2,vol:0.25}); },
};
// Recorded combat sounds (PSFX — Peri's Sound Effects, non-commercial licence; see public/sfx/CREDITS.txt).
// Each cue has a few variations so repeated hits don't sound identical. They load after the
// first tap/click; until then (or if loading fails) the synthesised cues above are used.
const SFX_SAMPLES={hit:['hit1','hit2','hit3','hit4'],hurt:['hurt1','hurt2','hurt3','hurt4'],crit:['crit1','crit2'],miss:['miss1','miss2','miss3','miss4'],block:['block1','block2','block3','block4'],heal:['heal1']};
const SFX_GAIN={hit:0.8,hurt:0.85,crit:1,miss:0.6,block:0.8,heal:0.5};
const sfxBuffers={}; let sfxLoading=false;
function sfxLoadSamples(c){
  if(sfxLoading||!c||!window.fetch) return; sfxLoading=true;
  Object.values(SFX_SAMPLES).flat().forEach(n=>{
    fetch('sfx/'+n+'.mp3').then(r=>r.ok?r.arrayBuffer():Promise.reject()).then(b=>new Promise((res,rej)=>c.decodeAudioData(b,res,rej))).then(buf=>{ sfxBuffers[n]=buf; }).catch(()=>{});
  });
}
function playSample(c,name){
  const list=(SFX_SAMPLES[name]||[]).filter(n=>sfxBuffers[n]); if(!list.length) return false;
  const src=c.createBufferSource(), g=c.createGain();
  src.buffer=sfxBuffers[list[Math.floor(Math.random()*list.length)]];
  src.playbackRate.value=0.94+Math.random()*0.12; // a little pitch variety
  g.gain.value=SFX_GAIN[name]||0.8;
  src.connect(g).connect(c._sfxOut); src.start();
  return true;
}
function playSfx(name){
  if(typeof audioMuted!=='undefined'&&audioMuted) return;
  const f=SFX[name]||(name==='hit'||name==='hurt'?SFX.dmg:name==='block'?SFX.miss:null); if(!f) return;
  const now=performance.now(); if(now-(sfxLast[name]||0)<70) return; sfxLast[name]=now;
  const c=sfxContext(); if(!c||c.state!=='running') return;
  if(!c._sfxOut){ c._sfxOut=c.createGain(); c._sfxOut.connect(c.destination); }
  c._sfxOut.gain.value=(typeof audioVolume==='number'?audioVolume:0.5)*1.4;
  sfxLoadSamples(c);
  if(playSample(c,name)) return;
  f(c);
}

// Cues for big moments, worked out from the change between two states.
let sfxPrev=null;
function sfxOnState(st){
  const gs=st.gs, me=st.players.find(p=>p.id===myId), prev=sfxPrev; sfxPrev={phase:gs.phase,level:me&&me.char&&me.char.level,windups:(gs.enemies||[]).filter(e=>e&&e._windup).length};
  if(!prev) return;
  if(gs.phase==='combat'&&prev.phase!=='combat') playSfx('start');
  if(gs.phase==='aftermath'&&prev.phase==='combat') playSfx('win');
  if((gs.phase==='gameover'||gs.phase==='dying')&&prev.phase!==gs.phase) playSfx('death');
  if(me&&me.char&&prev.level&&me.char.level>prev.level) playSfx('level');
  if(sfxPrev.windups>prev.windups) playSfx('warn');
}
