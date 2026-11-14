'use strict';
/* 카메라 회피 보조 — 단안 카메라 물체 인식 + 거리 추정 + 회피 방법 4종 (학습·표시용)
   좌표: X 오른쪽(+), Z 전방(+), 카메라 기준 m. 진행각 ψ는 오른쪽(+). */
(function(){
const $ = s => document.querySelector(s);
{ const ld = document.getElementById('loading'); if (ld) ld.hidden = true; }
const DEG = Math.PI / 180;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

/* ---------- 설정 ---------- */
const DEF = { method:'zone3', camH:1.2, pitch:2, fov:72, dist:'fuse', vehW:1.9, margin:0.4, wb:2.9, ratio:14,
  look:8, zmax:30, dstop:4, ttcB:1.5, ttcW:3.0, score:0.45, cls:'all' };
const S = Object.assign({}, DEF);
try { const j = JSON.parse(localStorage.getItem('camAvoid.v1') || '{}'); for (const k in DEF) if (k in j && typeof j[k] === typeof DEF[k]) S[k] = j[k]; } catch (e) {}
function save(){ try { localStorage.setItem('camAvoid.v1', JSON.stringify(S)); } catch (e) {} }

const SLIDERS = [
  ['camH','sCamH','oCamH',v=>v.toFixed(2)+' m'], ['pitch','sPitch','oPitch',v=>v.toFixed(1)+'°'], ['fov','sFov','oFov',v=>v.toFixed(0)+'°'],
  ['vehW','sVehW','oVehW',v=>v.toFixed(2)+' m'], ['margin','sMargin','oMargin',v=>v.toFixed(2)+' m'], ['wb','sWb','oWb',v=>v.toFixed(2)+' m'],
  ['ratio','sRatio','oRatio',v=>v.toFixed(1)+' : 1'], ['look','sLook','oLook',v=>v.toFixed(1)+' m'], ['zmax','sZmax','oZmax',v=>v.toFixed(0)+' m'],
  ['dstop','sDstop','oDstop',v=>v.toFixed(1)+' m'], ['ttcB','sTtcB','oTtcB',v=>v.toFixed(1)+' s'], ['ttcW','sTtcW','oTtcW',v=>v.toFixed(1)+' s'],
  ['score','sScore','oScore',v=>v.toFixed(2)]
];
for (const [k, id, oid, fmt] of SLIDERS){
  const el = $('#'+id), o = $('#'+oid);
  el.value = S[k]; o.textContent = fmt(S[k]);
  el.addEventListener('input', () => { S[k] = parseFloat(el.value); o.textContent = fmt(S[k]); save(); });
}
for (const [k, id] of [['dist','sDist'],['cls','sCls']]){
  const el = $('#'+id); el.value = S[k];
  el.addEventListener('change', () => { S[k] = el.value; save(); });
}

const METHODS = {
  zone3:{name:'3구역 최소 위험', desc:'차 앞을 좌·중·우 세 차로(폭 = 차폭 + 좌우 여유×2)로 나누고, 각 차로에 걸친 장애물의 위험(가까울수록 1, 관심 거리에서 0)을 합칩니다. 가운데가 안전하면 직진, 아니면 덜 위험한 옆 차로 중심을 주시거리 Ld에서 바라보는 방향으로 갑니다. 세 차로 모두 막히면 정지.'},
  fan:{name:'다방향 비용함수', desc:'-30°부터 +30°까지 2° 간격의 직선 경로 후보마다 비용 J = 6·장애물비용 + 2·(ψ/30°)² + 0.5·(이전 ψ와 차이/30°)² 를 계산해 가장 작은 방향을 고릅니다. 장애물비용은 경로와 장애물 사이 여유가 0 이하이면 1, 여유 0.4 m마다 1/e배로 줄어듭니다. 모든 방향이 막히면 정지.'},
  brake:{name:'제동 우선 (TTC)', desc:'조향으로 피하지 않고, 내 차로(차폭+여유) 안 장애물만 봅니다. 거리가 정지 거리보다 짧거나 TTC(충돌까지 남은 시간 = 거리 ÷ 접근 속도)가 제동 TTC보다 짧으면 정지, 주의 TTC보다 짧으면 감속을 표시합니다. 필요 감속도 a = v²/(2·남은 거리)도 보여줍니다.'},
  apf:{name:'가상 포텐셜필드', desc:'앞쪽으로 끌어당기는 힘(인력 1)과 각 장애물이 밀어내는 힘(척력 k(1/d − 1/d0)/d², d0 = 관심 거리의 0.6배)을 더한 합력 방향으로 갑니다. 장애물이 정확히 정면에 있으면 좌우로 미는 힘이 거의 0이 되는 "국소 최소" 문제가 생기는데, 이것도 학습 포인트입니다.'}
};
const ACT = { go:['직진','var(--go)','#36d17c'], left:['좌측 회피','var(--slow)','#ffb020'], right:['우측 회피','var(--slow)','#ffb020'],
  slow:['감속','var(--slow)','#ffb020'], stop:['정지 (제동)','var(--stop)','#ff4d4f'] };
function setMethod(m){
  S.method = m; save();
  document.querySelectorAll('.methods button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.m === m)));
  $('#mDesc').textContent = METHODS[m].desc;
}
document.querySelectorAll('.methods button').forEach(b => b.addEventListener('click', () => setMethod(b.dataset.m)));
setMethod(S.method in METHODS ? S.method : 'zone3');

/* ---------- 카메라 기하 (핀홀 + 숙임각 + 평평한 지면) ---------- */
function camModel(W, H){
  const f = (Math.max(W, H) / 2) / Math.tan(S.fov * DEG / 2);
  return { W, H, f, cx: W/2, cy: H/2, th: S.pitch * DEG, h: S.camH };
}
// 영상 픽셀 (u,v) → 카메라 광선 → 지면(카메라 아래 h m) 교점 {X,Z}
function unprojectGround(c, u, v){
  const dx = (u - c.cx) / c.f, dy = (v - c.cy) / c.f;
  const Yw = dy * Math.cos(c.th) + Math.sin(c.th);      // 아래 방향 성분
  const Zw = -dy * Math.sin(c.th) + Math.cos(c.th);     // 수평 전방 성분
  if (Yw <= 1e-4) return null;                           // 수평선 위: 지면과 안 만남
  const t = c.h / Yw;
  return { X: t * dx, Z: t * Zw };
}
// 월드(X, Yw=카메라 기준 아래, Z) → 영상 픽셀
function project(c, X, Yw, Zw){
  const dy = Yw * Math.cos(c.th) - Zw * Math.sin(c.th);
  const dz = Yw * Math.sin(c.th) + Zw * Math.cos(c.th);
  if (dz <= 0.05) return null;
  return { u: c.cx + c.f * X / dz, v: c.cy + c.f * dy / dz };
}
const horizonV = c => c.cy - c.f * Math.tan(c.th);
// 주어진 거리 Z에서 픽셀 u의 좌우 위치 X (v행 기준 광선 비율 사용)
function lateralAt(c, u, v, Z){
  const dx = (u - c.cx) / c.f, dy = (v - c.cy) / c.f;
  const Zw = -dy * Math.sin(c.th) + Math.cos(c.th);
  return Z * dx / Math.max(Zw, 0.05);
}

const KNOWN_H = { person:1.7, bicycle:1.1, car:1.5, motorcycle:1.3, bus:3.2, truck:3.0, train:3.8, dog:0.6, cat:0.3, horse:1.6,
  sheep:0.9, cow:1.4, elephant:3.0, bear:1.2, 'fire hydrant':0.8, bench:0.8, chair:0.9, 'potted plant':0.6, suitcase:0.6,
  backpack:0.5, bottle:0.25, cup:0.1, 'traffic light':0.9, 'stop sign':0.75, umbrella:1.0, 'sports ball':0.22, toilet:0.75,
  couch:0.85, bed:0.6, 'dining table':0.75, tv:0.6, laptop:0.25, refrigerator:1.8, skateboard:0.12, bird:0.25, 'parking meter':1.3 };
const ROAD = new Set(['person','bicycle','car','motorcycle','bus','truck','train','dog','cat','horse','sheep','cow','elephant','bear','fire hydrant','stop sign','bench','parking meter','traffic light','skateboard','suitcase','bird']);
const KO = { person:'사람', bicycle:'자전거', car:'승용차', motorcycle:'오토바이', bus:'버스', truck:'트럭', train:'열차', dog:'개', cat:'고양이',
  horse:'말', sheep:'양', cow:'소', bird:'새', 'fire hydrant':'소화전', 'stop sign':'정지표지', 'traffic light':'신호등', bench:'벤치', chair:'의자',
  bottle:'병', cup:'컵', 'potted plant':'화분', suitcase:'가방', backpack:'배낭', laptop:'노트북', tv:'모니터', couch:'소파', 'dining table':'탁자',
  umbrella:'우산', 'sports ball':'공', skateboard:'스케이트보드', refrigerator:'냉장고', 'parking meter':'주차미터', 'cell phone':'휴대폰',
  book:'책', keyboard:'키보드', mouse:'마우스', remote:'리모컨', clock:'시계', vase:'꽃병', scissors:'가위', 'teddy bear':'곰인형', bowl:'그릇',
  toilet:'변기', bed:'침대', sink:'세면대', oven:'오븐', microwave:'전자레인지', handbag:'핸드백', tie:'넥타이', kite:'연', frisbee:'원반' };
const ko = c => KO[c] || c;

// 검출 박스 → 장애물 {X, Z, hw, ...}
function toObstacle(c, d){
  const [x, y, w, h] = d.bbox;
  const ub = x + w/2, vb = y + h;
  const cut = vb > c.H * 0.985;                // 아래가 화면 밖으로 잘림 → 바닥 접점 신뢰 불가
  let Zg = null, Zs = null;
  const g = unprojectGround(c, ub, Math.min(vb, c.H));
  if (g && g.Z > 0.2) Zg = g.Z;
  if (KNOWN_H[d.class] && h > 4){
    const a = Math.atan((y + h/2 - c.cy) / c.f);          // 물체 중심 광선의 광축 아래 각
    const Dopt = c.f * KNOWN_H[d.class] / h;               // 광축 방향 깊이 (닮음비)
    Zs = Dopt * Math.cos(a + c.th) / Math.cos(a);          // 숙임각 보정한 수평 거리
  }
  let Z = null, how = '';
  if (S.dist === 'ground'){ Z = Zg; how = cut ? '≤' : ''; }
  else if (S.dist === 'size'){ Z = Zs; how = '~'; }
  else {
    if (cut || Zg == null) { Z = Zs != null ? Zs : Zg; how = Zs != null ? '~' : '≤'; }
    else if (Zs == null) Z = Zg;
    else Z = 0.6 * Zg + 0.4 * Zs;
  }
  if (Z == null || !isFinite(Z)) return null;
  Z = clamp(Z, 0.3, 200);
  const Xl = lateralAt(c, x, vb, Z), Xr = lateralAt(c, x + w, vb, Z);
  return { cls: d.class, score: d.score, bbox: d.bbox, Z, X: (Xl + Xr)/2, hw: Math.abs(Xr - Xl)/2, how };
}

/* ---------- 추적 (TTC용 접근 속도) ---------- */
let tracks = [], nextId = 1;
function iou(a, b){
  const x1 = Math.max(a[0], b[0]), y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[0]+a[2], b[0]+b[2]), y2 = Math.min(a[1]+a[3], b[1]+b[3]);
  const i = Math.max(0, x2-x1) * Math.max(0, y2-y1);
  return i / (a[2]*a[3] + b[2]*b[3] - i + 1e-6);
}
function updateTracks(obs, t){
  const used = new Set(); const out = [];
  for (const o of obs){
    let best = null, bi = 0.25;
    for (const tr of tracks){ if (used.has(tr) || tr.cls !== o.cls) continue; const v = iou(tr.bbox, o.bbox); if (v > bi){ bi = v; best = tr; } }
    if (best){
      used.add(best);
      const dt = t - best.t;
      const Zf = best.Z + 0.45 * (o.Z - best.Z);
      if (dt > 0.01 && dt < 1.0){ const vc = (best.Z - Zf) / dt; best.v += 0.3 * (vc - best.v); }
      Object.assign(best, o, { Z: Zf, t, seen: (best.seen || 1) + 1 });
      out.push(best);
    } else {
      const tr = Object.assign({ id: nextId++, v: 0, t, seen: 1 }, o); out.push(tr);
    }
  }
  for (const tr of tracks) if (!used.has(tr) && t - tr.t < 0.7 && !out.includes(tr)) { tr.stale = true; out.push(tr); }
  tracks = out.filter(tr => !(tr.stale && t - tr.t >= 0.7));
  for (const tr of tracks){ tr.ttc = (tr.v > 0.2 && tr.seen > 2) ? tr.Z / tr.v : Infinity; }
  return tracks.filter(tr => !tr.stale);
}

/* ---------- 회피 방법 4종 ---------- */
const PSI_MAX = 30 * DEG;
const half = () => S.vehW/2 + S.margin;                  // 경로 반폭
function weight(o){                                       // 0..1 위험 가중치 (거리 + TTC)
  const wz = clamp((S.zmax - o.Z) / Math.max(S.zmax - S.dstop, 0.1), 0, 1);
  const wt = isFinite(o.ttc) ? clamp(1 - (o.ttc - S.ttcB) / Math.max(S.ttcW*2 - S.ttcB, 0.1), 0, 1) : 0;
  return Math.max(wz, wt);
}
const orCombine = ws => 1 - ws.reduce((p, w) => p * (1 - clamp(w, 0, 1)), 1);
function actFromPsi(psi, riskAhead){
  if (Math.abs(psi) < 4*DEG) return riskAhead > 0.5 ? 'slow' : 'go';
  return psi < 0 ? 'left' : 'right';
}
let prevPsi = { zone3:0, fan:0, brake:0, apf:0 };

function mZone3(obs){
  const lw = 2 * half(), cs = [-lw, 0, lw];
  const r = cs.map(cx => orCombine(obs.filter(o => o.X + o.hw > cx - lw/2 && o.X - o.hw < cx + lw/2 && o.Z < S.zmax).map(weight)));
  let pick = 1;
  if (r[1] >= 0.35){
    if (Math.abs(r[0] - r[2]) < 0.05) pick = prevPsi.zone3 > 0 ? 2 : 0; else pick = r[0] < r[2] ? 0 : 2;
    if (r[pick] > r[1] - 0.1) pick = 1;
  }
  let act, psi = Math.atan2(cs[pick], S.look);
  if (Math.min(...r) > 0.85) { act = 'stop'; psi = 0; }
  else if (pick === 1) act = r[1] > 0.6 ? 'slow' : 'go';
  else act = pick === 0 ? 'left' : 'right';
  return { psi, act, risk: r[1], extra: { zones: r, lw, pick } };
}
function pathCost(obs, psi){
  const s_ = Math.sin(psi), c_ = Math.cos(psi), ws = [];
  for (const o of obs){
    const along = o.X * s_ + o.Z * c_, cross = o.X * c_ - o.Z * s_;
    if (along <= 0 || along > S.zmax) continue;
    const clear = Math.abs(cross) - o.hw - half();
    const fcl = clear <= 0 ? 1 : Math.exp(-clear / 0.4);
    ws.push(weight(Object.assign({}, o, { Z: along })) * fcl);
  }
  return orCombine(ws);
}
function mFan(obs){
  let best = null; const fan = [];
  for (let d = -30; d <= 30.001; d += 2){
    const psi = d * DEG, ob = pathCost(obs, psi);
    const J = 6*ob + 2*(psi/PSI_MAX)**2 + 0.5*((psi - prevPsi.fan)/PSI_MAX)**2;
    fan.push({ psi, ob, J });
    if (!best || J < best.J) best = { psi, ob, J };
  }
  const risk0 = pathCost(obs, 0);
  let act = actFromPsi(best.psi, risk0), psi = best.psi;
  if (best.ob > 0.85){ act = 'stop'; psi = 0; }
  return { psi, act, risk: risk0, extra: { fan } };
}
function mBrake(obs){
  const inPath = obs.filter(o => Math.abs(o.X) - o.hw < half() && o.Z < S.zmax);
  let near = null, minT = Infinity;
  for (const o of inPath){ if (!near || o.Z < near.Z) near = o; if (o.ttc < minT) minT = o.ttc; }
  let act = 'go', risk = 0, areq = null;
  if (near){
    const rz = clamp(1 - (near.Z - S.dstop) / Math.max(S.zmax - S.dstop, 0.1), 0, 1);
    const rt = isFinite(minT) ? clamp(1 - (minT - S.ttcB) / Math.max(S.ttcW*2 - S.ttcB, 0.1), 0, 1) : 0;
    risk = Math.max(rz, rt);
    if (near.Z < S.dstop || minT < S.ttcB) act = 'stop';
    else if (minT < S.ttcW || near.Z < S.dstop * 2.5) act = 'slow';
    if (near.v > 0.2) areq = near.v * near.v / (2 * Math.max(near.Z - 1.0, 0.1));
  }
  return { psi: 0, act, risk, extra: { near, minT, areq } };
}
function mApf(obs){
  const d0 = S.zmax * 0.6, k = 150; let Fx = 0, Fz = 1, rep = 0;
  for (const o of obs){
    const lo = o.X - o.hw - half(), hi = o.X + o.hw + half();
    let xe = (lo <= 0 && hi >= 0) ? 0 : (lo > 0 ? lo : hi);
    if (xe === 0) xe = (o.X === 0 ? (prevPsi.apf >= 0 ? -1 : 1) : Math.sign(o.X)) * 0.1;
    const rx = -xe, rz = -o.Z, d = Math.max(Math.hypot(rx, rz), 0.5);
    if (d >= d0) continue;
    const mag = k * (1/d - 1/d0) / (d*d);
    Fx += mag * rx / d; Fz += mag * rz / d; rep += mag;
  }
  let psi = Math.atan2(Fx, Math.max(Fz, 1e-3));
  psi = clamp(psi, -PSI_MAX, PSI_MAX);
  const risk = clamp(rep, 0, 1);
  let act = actFromPsi(psi, risk);
  if (Fz <= 0.05){ act = 'stop'; psi = 0; }
  return { psi, act, risk, extra: { Fx, Fz } };
}
const RUN = { zone3: mZone3, fan: mFan, brake: mBrake, apf: mApf };
const smPsi = { zone3:0, fan:0, brake:0, apf:0 };
function decideAll(obs){
  const res = {};
  for (const m in RUN){
    const r = RUN[m](obs);
    r.psi = clamp(r.psi, -PSI_MAX, PSI_MAX);
    prevPsi[m] = r.psi;
    smPsi[m] += 0.35 * (r.psi - smPsi[m]);
    r.psiS = r.act === 'stop' ? 0 : smPsi[m];
    r.delta = Math.atan(2 * S.wb * Math.sin(r.psiS) / S.look);   // 순수추종(pure pursuit)
    r.wheel = r.delta * S.ratio;
    res[m] = r;
  }
  return res;
}

/* ---------- 소스: 데모 / 카메라 / 영상 / 사진 ---------- */
const view = $('#view'), vctx = view.getContext('2d');
const det = document.createElement('canvas'), dctx = det.getContext('2d', { willReadFrequently: true });
let src = { kind: 'demo' }, stream = null, objURL = null;
const video = document.createElement('video'); video.muted = true; video.playsInline = true; video.setAttribute('playsinline', '');
const img = new Image();

function showMsg(t){ const m = $('#msg'); m.textContent = t || ''; m.hidden = !t; }
function setChip(id, text, cls){ const e = $('#'+id); e.textContent = text; e.className = 'chip' + (cls ? ' ' + cls : ''); }
function stopSource(){
  if (stream){ stream.getTracks().forEach(t => t.stop()); stream = null; }
  video.pause(); video.removeAttribute('src'); video.srcObject = null;
  if (objURL){ URL.revokeObjectURL(objURL); objURL = null; }
  tracks = []; lastDet = []; lastObs = [];
}
let wakeLock = null;
async function keepAwake(){ try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch (e) {} }

$('#btnDemo').addEventListener('click', () => { stopSource(); src = { kind: 'demo' }; demoReset(); setChip('stSrc', '데모'); showMsg(''); });
$('#btnCam').addEventListener('click', startCamera);
async function startCamera(){
  showMsg('');
  if (!window.isSecureContext){ showMsg('카메라는 https:// 주소에서만 켜집니다. GitHub Pages 링크로 여세요. 지금 주소에서는 "영상 찍어서 분석"을 쓰세요.'); return; }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){ showMsg('이 브라우저는 카메라 API를 지원하지 않습니다. 크롬 최신 버전으로 여세요.'); return; }
  stopSource();
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } });
  } catch (e){
    stream = null;
    const n = e && e.name;
    if (n === 'NotAllowedError' || n === 'SecurityError')
      showMsg('카메라 권한이 막혔습니다. 크롬 주소창 왼쪽 아이콘 → 권한 → 카메라 → 허용 후 다시 누르세요. (Claude 미리보기 화면 안에서는 카메라가 항상 막혀 있으니 GitHub Pages 링크를 쓰세요.)');
    else if (n === 'NotFoundError' || n === 'OverconstrainedError') showMsg('후면 카메라를 찾지 못했습니다. (' + n + ')');
    else if (n === 'NotReadableError') showMsg('다른 앱이 카메라를 쓰고 있습니다. 카메라 앱을 닫고 다시 누르세요.');
    else showMsg('카메라를 열지 못했습니다: ' + (n || '') + ' ' + (e && e.message || ''));
    src = { kind: 'demo' }; setChip('stSrc', '데모'); return;
  }
  video.srcObject = stream;
  try { await video.play(); } catch (e) {}
  src = { kind: 'video', live: true }; setChip('stSrc', '카메라', 'ok'); keepAwake();
}
function openFile(file){
  if (!file) return;
  stopSource(); showMsg('');
  objURL = URL.createObjectURL(file);
  if (file.type.startsWith('image/')){
    img.onload = () => { src = { kind: 'image' }; setChip('stSrc', '사진', 'ok'); };
    img.onerror = () => showMsg('사진을 열지 못했습니다.');
    img.src = objURL;
  } else {
    video.src = objURL; video.loop = true;
    video.play().then(() => { src = { kind: 'video', live: false }; setChip('stSrc', '영상', 'ok'); keepAwake(); })
      .catch(e => showMsg('영상을 재생하지 못했습니다: ' + (e && e.message || '')));
  }
}
$('#fileRec').addEventListener('change', e => { openFile(e.target.files[0]); e.target.value = ''; });
$('#fileOpen').addEventListener('change', e => { openFile(e.target.files[0]); e.target.value = ''; });
document.addEventListener('visibilitychange', () => { if (!document.hidden && src.kind === 'video' && src.live) keepAwake(); });

/* ---------- 데모: 같은 카메라 모델로 가상 장애물을 투영 (모델 사용 안 함) ---------- */
let demoObjs = [], demoT = 0;
function demoReset(){
  demoT = 0;
  demoObjs = [
    { cls:'car', X: 0.2, Z: 34, w: 1.8, h: 1.5, vz: -5.5, vx: 0, z0: 34, color:'#7aa6c9' },
    { cls:'person', X: 4.5, Z: 14, w: 0.5, h: 1.7, vz: -1.0, vx: -1.1, z0: 14, x0: 4.5, color:'#d9b38c' },
    { cls:'car', X: -3.6, Z: 22, w: 1.8, h: 1.5, vz: -2.0, vx: 0, z0: 22, color:'#9c8bd0' }
  ];
}
demoReset();
function demoStep(dt){
  demoT += dt;
  for (const o of demoObjs){
    o.Z += o.vz * dt; o.X += (o.vx || 0) * dt;
    if (o.Z < 2.2 || Math.abs(o.X) > 9){ o.Z = o.z0 + Math.random()*6; o.X = o.x0 != null ? o.x0 : o.X; }
  }
}
function demoFrame(c){
  const W = c.W, H = c.H, hv = clamp(horizonV(c), -H, 2*H);
  const sky = vctx.createLinearGradient(0, 0, 0, Math.max(hv, 1));
  sky.addColorStop(0, '#29435a'); sky.addColorStop(1, '#8aa3b5');
  vctx.fillStyle = sky; vctx.fillRect(0, 0, W, H);
  vctx.fillStyle = '#3b4146'; vctx.fillRect(0, clamp(hv, 0, H), W, H);
  const lane = (X, dash) => {
    vctx.strokeStyle = dash ? '#e8e8e0' : '#d8c25a'; vctx.lineWidth = 3;
    for (let z = 2; z < 80; z += dash ? 6 : 1){
      const a = project(c, X, c.h, z), b = project(c, X, c.h, z + (dash ? 3 : 1));
      if (!a || !b) continue; vctx.beginPath(); vctx.moveTo(a.u, a.v); vctx.lineTo(b.u, b.v); vctx.stroke();
    }
  };
  lane(-1.75, true); lane(1.75, true); lane(-5.25, false); lane(5.25, false);
  const dets = [];
  const sorted = demoObjs.slice().sort((a, b) => b.Z - a.Z);
  for (const o of sorted){
    const bl = project(c, o.X - o.w/2, c.h, o.Z), br = project(c, o.X + o.w/2, c.h, o.Z), top = project(c, o.X, c.h - o.h, o.Z);
    if (!bl || !br || !top) continue;
    const x = bl.u, y = top.v, w = br.u - bl.u, h = bl.v - top.v;
    if (x > W || x + w < 0 || y > H) continue;
    vctx.fillStyle = o.color;
    if (o.cls === 'car'){ vctx.fillRect(x, y + h*0.35, w, h*0.65); vctx.fillRect(x + w*0.15, y, w*0.7, h*0.4); }
    else { vctx.beginPath(); vctx.arc(x + w/2, y + h*0.1, w*0.35, 0, 7); vctx.fill(); vctx.fillRect(x + w*0.2, y + h*0.2, w*0.6, h*0.8); }
    const cx0 = Math.max(0, x), cy0 = Math.max(0, y), cx1 = Math.min(W, x + w), cy1 = Math.min(H, y + h);
    if (cx1 - cx0 > 2 && cy1 - cy0 > 2) dets.push({ class: o.cls, score: 0.99, bbox: [cx0, cy0, cx1 - cx0, cy1 - cy0] });
  }
  vctx.fillStyle = 'rgba(0,0,0,.45)'; vctx.fillRect(0, H - 34, W, 34);
  vctx.fillStyle = '#fff'; vctx.font = '600 18px system-ui,sans-serif'; vctx.textAlign = 'left';
  vctx.fillText('데모: 가상 장애물을 카메라 설정으로 투영한 화면 (인식 모델은 쓰지 않음)', 12, H - 11);
  return dets;
}

/* ---------- 인식 모델 (COCO-SSD, 파일 내장) ---------- */
let model = null, busy = false, lastDet = [], lastObs = [], infMs = 0;
async function loadModel(){
  try {
    if (!window.tf || !window.cocoSsd || !window.SSD_MODEL) throw new Error('라이브러리 누락');
    try { await tf.setBackend('webgl'); } catch (e) {}
    await tf.ready();
    const M = window.SSD_MODEL;
    const bin = atob(M.b64), u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    M.b64 = null;
    const handler = tf.io.fromMemory({ modelTopology: M.topology, weightSpecs: M.specs, weightData: u8.buffer, format: 'graph-model' });
    model = await cocoSsd.load({ modelUrl: handler });
    const be = tf.getBackend();
    setChip('stModel', '모델 준비됨 · ' + (be === 'webgl' ? 'GPU(WebGL)' : be.toUpperCase()), be === 'webgl' ? 'ok' : 'warn');
  } catch (e){
    setChip('stModel', '모델 오류', 'bad');
    showMsg('인식 모델을 불러오지 못했습니다: ' + (e && e.message || e));
  }
}
function runDetect(srcEl, sw, sh){
  if (!model || busy) return;
  busy = true;
  const scale = Math.min(1, 480 / Math.max(sw, sh));
  det.width = Math.round(sw * scale); det.height = Math.round(sh * scale);
  dctx.drawImage(srcEl, 0, 0, det.width, det.height);
  const t0 = performance.now();
  model.detect(det, 20, S.score).then(ds => {
    infMs = performance.now() - t0;
    lastDet = ds.map(d => ({ class: d.class, score: d.score, bbox: d.bbox.map(v => v / scale) }));
    lastDetT = srcTime();
    detCount++;
  }).catch(e => { showMsg('인식 중 오류: ' + (e && e.message || e)); }).finally(() => { busy = false; });
}
let lastDetT = 0, detCount = 0, procCount = -1;
function srcTime(){ return (src.kind === 'video' && !src.live) ? video.currentTime : performance.now() / 1000; }

/* ---------- 그리기 ---------- */
function drawOverlay(c, obs, res){
  const W = c.W, H = c.H;
  const cw = view.clientWidth || W, ch = view.clientHeight || H;
  const k = clamp(Math.max(W / cw, H / ch), 0.5, 6);   // 화면 1 CSS px = 캔버스 k px
  const r = res[S.method], col = ACT[r.act][2];
  // 경로 띠 (차폭+여유)
  const hw = half(), pts = [];
  for (let z = 1.5; z <= S.zmax; z += 0.5){ const p = project(c, -hw, c.h, z); if (p) pts.push(p); }
  for (let z = S.zmax; z >= 1.5; z -= 0.5){ const p = project(c, hw, c.h, z); if (p) pts.push(p); }
  if (pts.length > 4){
    vctx.beginPath(); pts.forEach((p, i) => i ? vctx.lineTo(p.u, p.v) : vctx.moveTo(p.u, p.v)); vctx.closePath();
    vctx.fillStyle = col + '2e'; vctx.fill(); vctx.strokeStyle = col + 'aa'; vctx.lineWidth = 2*k; vctx.stroke();
  }
  // 수평선
  const hv = horizonV(c);
  if (hv > 0 && hv < H){
    vctx.setLineDash([12*k, 10*k]); vctx.strokeStyle = 'rgba(255,255,255,.75)'; vctx.lineWidth = 1.5*k;
    vctx.beginPath(); vctx.moveTo(0, hv); vctx.lineTo(W, hv); vctx.stroke(); vctx.setLineDash([]);
    vctx.fillStyle = 'rgba(255,255,255,.8)'; vctx.font = `${10*k}px system-ui,sans-serif`; vctx.textAlign = 'right';
    vctx.fillText('수평선 (숙인 각도로 맞춤)', W - 6*k, hv - 4*k);
  }
  // 박스
  vctx.textAlign = 'left';
  for (const o of obs){
    const [x, y, w, h] = o.bbox, inPath = Math.abs(o.X) - o.hw < hw;
    const danger = inPath && (o.Z < S.dstop || o.ttc < S.ttcB) ? '#ff4d4f' : inPath && (o.Z < S.dstop*2.5 || o.ttc < S.ttcW) ? '#ffb020' : inPath ? '#5ab4ff' : '#9aa7b3';
    vctx.strokeStyle = danger; vctx.lineWidth = 3*k; vctx.strokeRect(x, y, w, h);
    const t1 = `${ko(o.cls)} ${(o.score*100).toFixed(0)}%`;
    const t2 = `${o.how}${o.Z.toFixed(1)}m  X${o.X >= 0 ? '+' : ''}${o.X.toFixed(1)}${isFinite(o.ttc) ? '  TTC ' + o.ttc.toFixed(1) + 's' : ''}`;
    vctx.font = `700 ${11*k}px system-ui,sans-serif`;
    const tw = Math.max(vctx.measureText(t1).width, vctx.measureText(t2).width * 1.1) + 8*k;
    const ly = y > 30*k ? y - 29*k : y + 2*k;
    vctx.fillStyle = 'rgba(0,0,0,.66)'; vctx.fillRect(x, ly, tw, 27*k);
    vctx.fillStyle = danger; vctx.fillText(t1, x + 4*k, ly + 11.5*k);
    vctx.fillStyle = '#fff'; vctx.font = `${10*k}px "JetBrains Mono",ui-monospace,monospace`;
    vctx.fillText(t2, x + 4*k, ly + 23.5*k);
  }
  // 큰 화살표 + 판단
  const L = clamp(34*k, 0, H*0.16), ax = W/2, ay = Math.max(H * 0.18, L*1.1 + 22*k);
  vctx.save(); vctx.translate(ax, ay);
  vctx.fillStyle = 'rgba(0,0,0,.5)'; vctx.beginPath(); vctx.arc(0, 0, L*1.05, 0, 7); vctx.fill();
  if (r.act === 'stop'){
    vctx.fillStyle = col; vctx.beginPath();
    for (let i = 0; i < 8; i++){ const a = Math.PI/8 + i*Math.PI/4; vctx[i ? 'lineTo' : 'moveTo'](Math.cos(a)*L*0.8, Math.sin(a)*L*0.8); }
    vctx.closePath(); vctx.fill(); vctx.fillStyle = '#fff'; vctx.font = `800 ${L*0.38}px system-ui,sans-serif`; vctx.textAlign = 'center'; vctx.fillText('정지', 0, L*0.13);
  } else {
    vctx.rotate(r.psiS * 2.2);   // 화면용 과장(×2.2)
    vctx.fillStyle = col; vctx.beginPath();
    vctx.moveTo(0, -L*0.85); vctx.lineTo(L*0.42, -L*0.2); vctx.lineTo(L*0.15, -L*0.2); vctx.lineTo(L*0.15, L*0.7);
    vctx.lineTo(-L*0.15, L*0.7); vctx.lineTo(-L*0.15, -L*0.2); vctx.lineTo(-L*0.42, -L*0.2); vctx.closePath(); vctx.fill();
  }
  vctx.restore();
  vctx.textAlign = 'center'; vctx.font = `800 ${15*k}px system-ui,sans-serif`;
  const lab = `${ACT[r.act][0]}  ·  핸들 ${fmtSide(r.wheel, 0)}`;
  const lw2 = vctx.measureText(lab).width + 16*k;
  vctx.fillStyle = 'rgba(0,0,0,.6)'; vctx.fillRect(ax - lw2/2, ay + L*1.12, lw2, 22*k);
  vctx.fillStyle = col; vctx.fillText(lab, ax, ay + L*1.12 + 16*k);
  vctx.font = `${10*k}px system-ui,sans-serif`; vctx.fillStyle = 'rgba(255,255,255,.85)';
  vctx.fillText(METHODS[S.method].name + ' · 화살표 기울기 2.2배 과장', ax, ay + L*1.12 + 34*k);
}
function fmtSide(rad, dp){
  const d = rad / DEG; if (Math.abs(d) < 0.5 * Math.pow(10, -dp)) return '0°';
  return (d < 0 ? '좌 ' : '우 ') + Math.abs(d).toFixed(dp) + '°';
}

const bev = $('#bev'), bctx = bev.getContext('2d');
function drawBEV(obs, res){
  const W = bev.width, H = bev.height, zr = Math.max(S.zmax, 10), xr = zr * (W / H) / 2;
  const sx = W / (2*xr), sz = (H - 40) / zr;
  const P = (X, Z) => [W/2 + X*sx, H - 30 - Z*sz];
  bctx.fillStyle = '#141b21'; bctx.fillRect(0, 0, W, H);
  bctx.strokeStyle = '#273440'; bctx.lineWidth = 1; bctx.fillStyle = '#8e9ca8'; bctx.font = '20px system-ui,sans-serif'; bctx.textAlign = 'left';
  const step = zr > 35 ? 10 : 5;
  for (let z = step; z <= zr; z += step){ const [, y] = P(0, z); bctx.beginPath(); bctx.moveTo(0, y); bctx.lineTo(W, y); bctx.stroke(); bctx.fillText(z + ' m', 8, y - 4); }
  const r = res[S.method], col = ACT[r.act][2], hw = half();
  // 3구역 표시
  if (S.method === 'zone3' && r.extra){
    const { zones, lw, pick } = r.extra;
    [-lw, 0, lw].forEach((cx, i) => {
      const [x0, y0] = P(cx - lw/2, zr), [x1] = P(cx + lw/2, 0);
      bctx.fillStyle = `rgba(255,77,79,${0.08 + 0.4*zones[i]})`; bctx.fillRect(x0, y0, x1 - x0, H - 30 - y0);
      if (i === pick){ bctx.strokeStyle = col; bctx.lineWidth = 3; bctx.strokeRect(x0 + 1.5, y0, x1 - x0 - 3, H - 31 - y0); }
      bctx.fillStyle = '#e7eef3'; bctx.textAlign = 'center'; bctx.font = '20px "JetBrains Mono",monospace';
      bctx.fillText(zones[i].toFixed(2), (x0 + x1)/2, H - 36);
    });
  }
  // 다방향 비용 부채꼴
  if (S.method === 'fan' && r.extra){
    for (const f of r.extra.fan){
      const [x, y] = P(Math.sin(f.psi)*zr*0.9, Math.cos(f.psi)*zr*0.9), [x0, y0] = P(0, 0);
      bctx.strokeStyle = `rgba(${Math.round(255*f.ob)},${Math.round(200*(1-f.ob))},90,.55)`; bctx.lineWidth = 4;
      bctx.beginPath(); bctx.moveTo(x0, y0); bctx.lineTo(x, y); bctx.stroke();
    }
  }
  // 포텐셜 합력 벡터
  if (S.method === 'apf' && r.extra){
    const { Fx, Fz } = r.extra, n = Math.hypot(Fx, Fz) || 1, [x0, y0] = P(0, 0), [x1, y1] = P(Fx/n*zr*0.5, Math.max(Fz,0)/n*zr*0.5);
    bctx.strokeStyle = '#e7eef3'; bctx.lineWidth = 3; bctx.setLineDash([8, 6]); bctx.beginPath(); bctx.moveTo(x0, y0); bctx.lineTo(x1, y1); bctx.stroke(); bctx.setLineDash([]);
  }
  // 경로 띠
  { const [x0, y0] = P(-hw, zr), [x1] = P(hw, 0); bctx.strokeStyle = 'rgba(90,180,255,.6)'; bctx.lineWidth = 2; bctx.setLineDash([10, 8]); bctx.strokeRect(x0, y0, x1 - x0, H - 30 - y0); bctx.setLineDash([]); }
  // 장애물
  bctx.font = '19px system-ui,sans-serif'; bctx.textAlign = 'center';
  for (const o of obs){
    const [x0, y0] = P(o.X - o.hw, o.Z + 0.4), [x1, y1] = P(o.X + o.hw, o.Z);
    const inPath = Math.abs(o.X) - o.hw < hw;
    bctx.fillStyle = inPath ? (o.Z < S.dstop || o.ttc < S.ttcB ? '#ff4d4f' : '#ffb020') : '#9aa7b3';
    bctx.fillRect(x0, y0, Math.max(x1 - x0, 4), Math.max(y1 - y0, 4));
    bctx.fillStyle = '#e7eef3'; bctx.fillText(`${ko(o.cls)} ${o.Z.toFixed(1)}m`, (x0 + x1)/2, y0 - 6);
  }
  // 내 차 + 진행 방향
  const [cx, cy] = P(0, 0);
  bctx.fillStyle = '#5ab4ff'; bctx.fillRect(cx - S.vehW/2*sx, cy, S.vehW*sx, 24);
  if (r.act !== 'stop'){
    const [tx, ty] = P(Math.sin(r.psiS)*S.look, Math.cos(r.psiS)*S.look);
    bctx.strokeStyle = col; bctx.lineWidth = 5; bctx.beginPath(); bctx.moveTo(cx, cy); bctx.lineTo(tx, ty); bctx.stroke();
    bctx.fillStyle = col; bctx.beginPath(); bctx.arc(tx, ty, 8, 0, 7); bctx.fill();
  } else { bctx.fillStyle = col; bctx.font = '800 28px system-ui,sans-serif'; bctx.fillText('정지', cx, cy - 16); }
}

const elD = { act: $('#dAct'), psi: $('#dPsi'), delta: $('#dDelta'), wheel: $('#dWheel'), near: $('#dNear'), risk: $('#dRisk'), bar: $('#dBar'), cmp: $('#cmp') };
let uiTick = 0;
function updatePanel(obs, res){
  const r = res[S.method], a = ACT[r.act];
  elD.act.textContent = a[0]; elD.act.style.color = a[1];
  elD.psi.textContent = fmtSide(r.psiS, 1); elD.delta.textContent = fmtSide(r.delta, 1); elD.wheel.textContent = fmtSide(r.wheel, 0);
  const inPath = obs.filter(o => Math.abs(o.X) - o.hw < half()).sort((p, q) => p.Z - q.Z)[0];
  let nt = inPath ? `${ko(inPath.cls)} ${inPath.how}${inPath.Z.toFixed(1)} m` + (isFinite(inPath.ttc) ? ` · TTC ${inPath.ttc.toFixed(1)} s` : '') : '없음';
  if (S.method === 'brake' && r.extra.areq != null) nt += ` · 필요감속 ${r.extra.areq.toFixed(1)} m/s²`;
  elD.near.textContent = nt;
  elD.risk.textContent = r.risk.toFixed(2);
  elD.bar.style.width = (r.risk*100).toFixed(0) + '%'; elD.bar.style.background = r.risk > 0.7 ? 'var(--stop)' : r.risk > 0.35 ? 'var(--slow)' : 'var(--go)';
  if (uiTick++ % 4 === 0){
    elD.cmp.innerHTML = '';
    for (const m in RUN){
      const x = res[m], tr = document.createElement('tr'); if (m === S.method) tr.className = 'sel';
      const cells = [METHODS[m].name, ACT[x.act][0], fmtSide(x.psiS, 1), fmtSide(x.wheel, 0), x.risk.toFixed(2)];
      cells.forEach((t, i) => { const td = document.createElement('td'); td.textContent = t; if (i >= 2) td.className = 'n'; if (i === 1) td.style.color = ACT[x.act][1]; tr.appendChild(td); });
      tr.addEventListener('click', () => setMethod(m)); tr.style.cursor = 'pointer';
      elD.cmp.appendChild(tr);
    }
  }
}

/* ---------- 메인 루프 ---------- */
let lastT = performance.now(), fpsAcc = 0, fpsN = 0, fpsT = performance.now(), res = decideAll([]);
function frame(){
  const now = performance.now(), dt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
  let W, H, dets = null, srcEl = null;
  if (src.kind === 'demo'){ W = 1280; H = 720; }
  else if (src.kind === 'video'){ W = video.videoWidth; H = video.videoHeight; srcEl = video; }
  else if (src.kind === 'image'){ W = img.naturalWidth; H = img.naturalHeight; srcEl = img; }
  if (!W || !H){ requestAnimationFrame(frame); return; }
  const sc = Math.min(1, 1280 / Math.max(W, H)), CW = Math.round(W*sc), CH = Math.round(H*sc);
  if (view.width !== CW || view.height !== CH){ view.width = CW; view.height = CH; }
  const c = camModel(CW, CH);
  let t;
  if (src.kind === 'demo'){
    demoStep(dt); dets = demoFrame(c).filter(d => d.score >= S.score); t = now / 1000;
  } else {
    vctx.drawImage(srcEl, 0, 0, CW, CH);
    runDetect(srcEl, W, H);
    if (detCount !== procCount){ procCount = detCount; dets = lastDet.map(d => ({ class: d.class, score: d.score, bbox: d.bbox.map(v => v*sc) })); t = lastDetT; }
  }
  if (dets){
    const f = dets.filter(d => S.cls === 'all' || ROAD.has(d.class));
    lastObs = updateTracks(f.map(d => toObstacle(c, d)).filter(Boolean), t);
    res = decideAll(lastObs);
  }
  drawOverlay(c, lastObs, res);
  drawBEV(lastObs, res);
  updatePanel(lastObs, res);
  fpsN++;
  if (now - fpsT > 1000){
    setChip('stFps', (fpsN * 1000 / (now - fpsT)).toFixed(0) + ' fps');
    setChip('stInf', src.kind === 'demo' ? '추론 없음(데모)' : '추론 ' + infMs.toFixed(0) + ' ms');
    fpsN = 0; fpsT = now;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
setTimeout(loadModel, 300);

// 시험용 노출 (자체 점검)
window.__camAvoid = { S, camModel, unprojectGround, project, toObstacle, decideAll, RUN, get model(){ return model; }, get obs(){ return lastObs; }, get res(){ return res; } };
})();
