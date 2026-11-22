import { authenticate, callPollinations, cors, json, fail, resolveModel } from '../../../lib/api-v1-shared.js';
export const config = { runtime: 'edge' };
const ABBR={bassline:'bass',chord:'chd',melody:'mel',arpeggio:'arp',lead:'lead',plucks:'plk',strings:'str',keys:'keys','pad-textures':'pad',guitar:'gtr',brass:'brss',percs:'perc'};
const VALID=new Set(Object.keys(ABBR));
function parseNotes(value,name){
  if(typeof value!=='string'||!value.trim()) throw Object.assign(new Error('Track '+name+' must contain pipe-separated pitch:beat:duration:velocity notes.'),{status:400});
  const notes=value.split('|').map((item)=>{const p=item.trim().split(':').map(Number);if(p.length!==4||p.some(n=>!Number.isFinite(n))||!Number.isInteger(p[0])||p[0]<0||p[0]>127||p[1]<0||p[2]<=0||p[3]<1||p[3]>9) throw Object.assign(new Error('Invalid note in track '+name+'.'),{status:400});return p;});
  if(notes.length>5000) throw Object.assign(new Error('Track exceeds 5,000 notes.'),{status:413});
  return notes;
}
export default async function handler(req){
  if(req.method==='OPTIONS') return cors(new Response(null,{status:204}));
  if(req.method!=='POST') return cors(json({error:'Method Not Allowed'},405));
  const auth=await authenticate(req);if(auth.response)return auth.response;
  try{
    const body=await req.json(), composition=body.composition;
    if(!composition||typeof composition!=='object'||!composition.tracks||typeof composition.tracks!=='object') throw Object.assign(new Error('composition.tracks object is required.'),{status:400});
    const tracks={...composition.tracks}, targets=[...new Set(body.targetTracks||[])];
    if(!targets.length||targets.length>6||targets.some(t=>!VALID.has(t)||!tracks[t])) throw Object.assign(new Error('Select 1–6 existing valid targetTracks.'),{status:400});
    const unchanged=Object.keys(tracks).filter(t=>!targets.includes(t));
    const editType=String(body.editType||'custom');
    let changedNotes=0;
    if(['transpose_up','transpose_down','quantize','velocity_up','velocity_down','velocity_normalize'].includes(editType)){
      for(const type of targets){const notes=parseNotes(tracks[type],type);const transformed=notes.map(n=>{const v=[...n];if(editType==='transpose_up'||editType==='transpose_down'){v[0]+=(editType==='transpose_up'?12:-12);if(v[0]<0||v[0]>127)throw Object.assign(new Error('Transpose would exceed MIDI pitch range.'),{status:400});}
        else if(editType==='quantize'){const grid=Math.max(0.0625,Math.min(4,Number(body.grid)||0.25));v[1]=Math.round(v[1]/grid)*grid;}
        else if(editType==='velocity_up')v[3]=Math.min(9,v[3]+Math.max(1,Math.min(4,Number(body.amount)||1)));
        else if(editType==='velocity_down')v[3]=Math.max(1,v[3]-Math.max(1,Math.min(4,Number(body.amount)||1)));
        else if(editType==='velocity_normalize')v[3]=Math.max(1,Math.min(9,Number(body.targetVelocity)||6));
        if(v.some((x,i)=>x!==n[i]))changedNotes++;return v;});
        tracks[type]=transformed.map(n=>n.join(':')).join('|');
      }
      return cors(json({composition:{...composition,tracks},edit:{editType,targetTracks:targets,unchangedTracks:unchanged,changedNotes,aiUsed:false}}));
    }
    const selected=Object.fromEntries(targets.map(t=>[t,tracks[t]]));
    const prompt='Edit only the selected MIDI tracks. Preserve all unselected tracks exactly; they are immutable harmonic and rhythmic references. Keep the original BPM, key, scale, bar length and musical identity unless the instructions explicitly request otherwise. Return JSON with tracks object containing ONLY the selected track names in abbreviated notation. Each value must be pipe-separated pitch:beat:duration:velocity.\nEdit type: '+editType+'\nInstructions: '+String(body.instructions||'').slice(0,1200)+'\nIntensity: '+Math.max(0,Math.min(1,Number(body.intensity)||0.5))+'\nBPM: '+(Number(body.bpm)||120)+'; key: '+(body.key||'unspecified')+'; scale: '+(body.scale||'unspecified')+'\nSelected tracks: '+JSON.stringify(selected)+'\nUnchanged references: '+JSON.stringify(Object.fromEntries(unchanged.map(t=>[t,String(tracks[t]).slice(0,4000)])));
    const ai=await callPollinations({pollenKey:auth.pollenKey,model:resolveModel(body.model),prompt,maxTokens:5000});
    for(const type of targets){const value=ai.tracks?.[ABBR[type]]??ai.tracks?.[type];if(typeof value!=='string')throw Object.assign(new Error('AI omitted edited track '+type+'. No changes were applied.'),{status:502});parseNotes(value,type);tracks[type]=value;}
    return cors(json({composition:{...composition,tracks},edit:{editType,targetTracks:targets,unchangedTracks:unchanged,aiUsed:true,description:ai.desc||ai.description||''}}));
  }catch(error){return fail(error);}
}
