import { authenticate, callPollinations, cors, json, fail, resolveModel } from '../../lib/api-v1-shared.js';

export const config = { runtime: 'edge' };

function readMidi(bytes) {
  let offset = 0;
  const u32 = () => { const n = (bytes[offset] * 0x1000000) + (bytes[offset+1] << 16) + (bytes[offset+2] << 8) + bytes[offset+3]; offset += 4; return n >>> 0; };
  const u16 = () => { const n = (bytes[offset] << 8) | bytes[offset+1]; offset += 2; return n; };
  const text = (start, length) => String.fromCharCode(...bytes.slice(start, start + length));
  if (text(0,4) !== 'MThd') throw new Error('Invalid Standard MIDI File header.');
  offset = 4; const headerLength = u32();
  const format = u16(), trackCount = u16(), division = u16();
  if (headerLength < 6 || !trackCount || trackCount > 64 || (division & 0x8000)) throw new Error('Unsupported MIDI format or PPQ timing.');
  offset = 8 + headerLength;
  const tracks = []; let tempo = 500000;
  const readVlq = () => { let value = 0, byte; do { if (offset >= bytes.length) throw new Error('Truncated MIDI data.'); byte = bytes[offset++]; value = (value << 7) | (byte & 0x7f); } while (byte & 0x80); return value; };
  for (let ti = 0; ti < trackCount; ti++) {
    if (text(offset,4) !== 'MTrk') throw new Error('Invalid MIDI track chunk.');
    offset += 4; const end = offset + u32(); if (end > bytes.length) throw new Error('Truncated MIDI track.');
    const track = { name: '', channel: 0, program: 0, notes: [] }, active = new Map(); let tick = 0, running = 0;
    while (offset < end) {
      tick += readVlq();
      let status = bytes[offset];
      if (status < 0x80) { if (!running) throw new Error('Invalid MIDI running status.'); status = running; }
      else { offset++; if (status < 0xf0) running = status; }
      if (status === 0xff) {
        const type = bytes[offset++], length = readVlq(), data = bytes.slice(offset, offset + length); offset += length;
        if (type === 0x03) track.name = String.fromCharCode(...data).slice(0,100);
        if (type === 0x51 && length === 3) tempo = (data[0] << 16) | (data[1] << 8) | data[2];
        if (type === 0x2f) break;
        continue;
      }
      if (status === 0xf0 || status === 0xf7) { const length = readVlq(); offset += length; continue; }
      const command = status & 0xf0, channel = status & 0x0f; track.channel = channel;
      const first = bytes[offset++], second = (command === 0xc0 || command === 0xd0) ? 0 : bytes[offset++];
      if (command === 0xc0) track.program = first;
      if (command === 0x90 && second > 0) {
        const key = channel + ':' + first, list = active.get(key) || [];
        list.push({ tick, velocity: second / 127 }); active.set(key,list);
      } else if (command === 0x80 || (command === 0x90 && second === 0)) {
        const key = channel + ':' + first, list = active.get(key) || [], start = list.shift();
        if (start) track.notes.push({ midi:first, time:start.tick, duration:Math.max(1,tick-start.tick), velocity:start.velocity });
      }
    }
    for (const [key,list] of active) { const pitch = Number(key.split(':')[1]); for (const n of list) track.notes.push({ midi:pitch,time:n.tick,duration:Math.max(1,division),velocity:n.velocity }); }
    tracks.push(track); offset = end;
  }
  const secondsPerTick = (tempo / 1000000) / division;
  return { format, ppq:division, bpm:Math.round(60000000/tempo), tracks:tracks.map((t,i)=>({ ...t, index:i, notes:t.notes.map(n=>({ midi:n.midi,time:n.tick*secondsPerTick,duration:n.duration*secondsPerTick,velocity:n.velocity })) })).filter(t=>t.notes.length) };
}
function notation(notes,bpm) {
  const beat = 60 / bpm;
  return notes.sort((a,b)=>a.time-b.time).map(n => [n.midi, +(n.time/beat).toFixed(3), +(n.duration/beat).toFixed(3), Math.max(1,Math.min(9,Math.round(n.velocity*9)))].join(':')).join('|');
}
function validateGeneratedNotation(value, trackType) {
  if (typeof value !== 'string' || !value.trim() || value.length >= 50000) return false;
  const items = value.split('|');
  if (!items.length || items.length > 5000) return false;
  for (const item of items) {
    const fields = item.trim().split(':');
    if (fields.length !== 4 || fields.some(field => field.trim() === '')) return false;
    const [pitch, beat, duration, velocity] = fields.map(Number);
    if (![pitch, beat, duration, velocity].every(Number.isFinite)) return false;
    if (!Number.isInteger(pitch) || pitch < 24 || pitch > 96) return false;
    if (beat < 0 || beat > 4096 || duration <= 0 || duration > 256) return false;
    if (!Number.isInteger(velocity) || velocity < 1 || velocity > 9) return false;
  }
  return true;
}
function classify(track) {
  const pitches = track.notes.map(n=>n.midi).sort((a,b)=>a-b), median=pitches[Math.floor(pitches.length/2)];
  const simultaneous = track.notes.length > 2 && new Set(track.notes.map(n=>n.time.toFixed(3))).size < track.notes.length*0.7;
  if (track.channel===9) return 'percs';
  if (median<48) return 'bassline';
  if (simultaneous) return 'chord';
  if (median>70 && pitches[pitches.length-1]-pitches[0]>10) return 'lead';
  return 'melody';
}
export default async function handler(req) {
  if (req.method==='OPTIONS') return cors(new Response(null,{status:204}));
  if (req.method!=='POST') return cors(json({error:'Method Not Allowed'},405));
  const auth=await authenticate(req); if(auth.response) return auth.response;
  try {
    const body=await req.json();
    if(typeof body.midiBase64!=='string' || body.midiBase64.length>4_000_000) throw Object.assign(new Error('Provide midiBase64 (base64-encoded .mid file, maximum 3 MB).'),{status:400});
    const binary=atob(body.midiBase64.replace(/^data:.*?;base64,/,''));
    const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
    const parsed=readMidi(bytes);
    if(!parsed.tracks.length) throw Object.assign(new Error('No playable MIDI notes were found.'),{status:422});
    const bpm=Math.max(40,Math.min(300,Number(body.bpm)||parsed.bpm||120));
    const imported=parsed.tracks.map(t=>({index:t.index,name:t.name||'Track '+(t.index+1),role:classify(t),noteCount:t.notes.length,notation:notation(t.notes,bpm),notes:t.notes}));
    const requested=Array.isArray(body.trackTypes)?[...new Set(body.trackTypes.filter(t=>['bassline','chord','melody','arpeggio','lead','plucks','strings','keys','pad-textures','guitar','brass'].includes(t)))].slice(0,4):[];
    let generated={};
    if(requested.length) {
      const anchor=imported[0];
      const prompt='Analyze this imported MIDI arrangement. Preserve every imported track exactly and create ONLY the requested new melodic companion tracks. Follow its key, harmony, groove, note register and phrase structure. Use the provided pitch:beat:duration:velocity notation as source evidence. Return JSON with keys title, desc, tracks; tracks must contain only requested abbreviated track names (bass,chd,mel,arp,lead,plk,str,keys,pad,gtr,brss), each value a pipe-separated list of pitch:beat:duration:velocity. Use MIDI pitches 24-96, beats within the arrangement, durations >0, velocities 1-9.\nBPM: '+bpm+'\nRequested tracks: '+requested.join(', ')+'\nImported tracks:\n'+imported.map(t=>t.role+' '+t.name+': '+t.notation.slice(0,9000)).join('\n');
      const ai=await callPollinations({pollenKey:auth.pollenKey,model:resolveModel(body.model),prompt,maxTokens:5000});
      const abbreviations={bassline:'bass',chord:'chd',melody:'mel',arpeggio:'arp',lead:'lead',plucks:'plk',strings:'str',keys:'keys','pad-textures':'pad',guitar:'gtr',brass:'brss'};
      for(const type of requested){const value=ai.tracks?.[abbreviations[type]];if(!validateGeneratedNotation(value,type)) throw Object.assign(new Error('AI returned invalid companion-track notation for '+type+'. Expected up to 5,000 notes in pitch:beat:duration:velocity format (pitch 24–96, beat 0–4096, duration >0, velocity 1–9). Retry the request.'),{status:502});generated[type]=value;}
      if(Object.keys(generated).length!==requested.length) throw Object.assign(new Error('AI did not return all requested companion tracks. Retry with fewer tracks.'),{status:502});
    }
    return cors(json({analysis:{format:parsed.format,ppq:parsed.ppq,bpm,trackCount:imported.length,tracks:imported.map(({index,name,role,noteCount})=>({index,name,role,noteCount}))},importedTracks:imported.map(({index,name,role,notation})=>({index,name,role,notation})),generated}));
  } catch(error){return fail(error);}
}
