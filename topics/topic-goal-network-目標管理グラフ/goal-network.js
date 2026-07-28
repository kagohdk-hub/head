(function(){

const STORAGE_KEY = 'goal-network-data';

const fs = require('fs');

const jsonObject = JSON.parse(fs.readFileSync('./goal-network-data.json', 'utf8'));
const DEFAULT_DATA = {};
var masterData = [];

jsonObject.MyDog.forEach((obj) => {
	DEFAULT_DATA[obj.date] = obj;
	console.log(obj.Name, obj.age ,obj.weight )
	var data = {
	    Name: obj.Name,
	    age: obj.age,
	    weight: obj.weight,
	};
	masterData.push(data)
});

let masterData2 = JSON.stringify({MyDog: masterData}, null, ' ')
fs.writeFileSync('output2.json', masterData2);

const DEFAULT_DATA = {
  nodes: [
    { id:'ingredients', label:'材料がある', status:'achieved', requires:[] },
    { id:'tools',       label:'調理器具がある', status:'achieved', requires:[] },
    { id:'money',       label:'手持ちのお金がある', status:'achieved', requires:[] },
    { id:'can_cook',    label:'カレーを作れる', status:'wip', requires:[['ingredients','tools']] },
    { id:'can_go_shop', label:'カレー屋に行ける', status:'achieved', requires:[['money']] },
    { id:'can_eat',     label:'カレーを食べられる', status:'target', requires:[['can_cook'],['can_go_shop']], isGoal:true }
  ]
};

const STATUS_ORDER = ['locked','target','wip','achieved'];
const STATUS_LABEL = { locked:'未着手', target:'到達できる', wip:'取り組み中', achieved:'到達済み' };
const STATUS_COLOR_VAR = { locked:'--locked', target:'--target', wip:'--wip', achieved:'--achieved' };
const STATUS_FILL_VAR  = { locked:null, target:null, wip:'--wip-dim', achieved:'--achieved-dim' };

let data = null;
let selectedId = null;
let layout = null; // {nodes:[{...node,x,y,layer}], layerGap, radius}
let pan = {x:0, y:0};
let zoom = 1;

const svg = document.getElementById('graph-svg');
const panelContent = document.getElementById('panel-content');
const graphWrap = document.getElementById('graph-wrap');

// ---------- 永続化 ----------
async function loadData(){
  try{
    const res = await window.storage.get(STORAGE_KEY);
    if(res && res.value){
      data = JSON.parse(res.value);
      return;
    }
  }catch(e){ /* not found or storage unavailable */ }
  data = JSON.parse(JSON.stringify(DEFAULT_DATA));
}

let saveTimer = null;
function saveData(){
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async ()=>{
    try{ await window.storage.set(STORAGE_KEY, JSON.stringify(data)); }
    catch(e){ console.warn('save failed', e); }
  }, 250);
}

// ---------- レイアウト計算(一度だけ・静的) ----------
function computeLayout(){
  const nodesById = {};
  data.nodes.forEach(n => nodesById[n.id] = n);

  // 層(layer)をメモ化して算出。循環があれば無限再帰を避ける。
  const layerCache = {};
  const visiting = new Set();
  function getLayer(id){
    if(layerCache[id] !== undefined) return layerCache[id];
    if(visiting.has(id)) return 0; // 循環防止フォールバック
    visiting.add(id);
    const n = nodesById[id];
    let layer = 0;
    if(n && n.requires && n.requires.length){
      let maxOfGroups = 0;
      n.requires.forEach(group=>{
        let groupMax = 0;
        group.forEach(depId=>{
          if(nodesById[depId]) groupMax = Math.max(groupMax, getLayer(depId)+1);
        });
        maxOfGroups = Math.max(maxOfGroups, groupMax);
      });
      layer = maxOfGroups;
    }
    visiting.delete(id);
    layerCache[id] = layer;
    return layer;
  }
  data.nodes.forEach(n => getLayer(n.id));

  const maxLayer = Math.max(0, ...data.nodes.map(n=>layerCache[n.id]));
  const byLayer = {};
  data.nodes.forEach(n=>{
    const l = layerCache[n.id];
    (byLayer[l] = byLayer[l] || []).push(n.id);
  });

  // 初期順序 → バリセンター法で交差を軽減(2パス)
  let order = {}; // id -> index within its layer
  Object.keys(byLayer).forEach(l=>{
    byLayer[l].forEach((id,i)=> order[id]=i);
  });

  function barycenterPass(fromLowToHigh){
    const layers = Object.keys(byLayer).map(Number).sort((a,b)=> fromLowToHigh ? a-b : b-a);
    layers.forEach(l=>{
      const ids = byLayer[l];
      const scores = ids.map(id=>{
        const n = nodesById[id];
        let neighbors = [];
        if(fromLowToHigh){
          // 自分より下の層(依存先)を見る
          (n.requires||[]).forEach(g=> g.forEach(dep=>{ if(nodesById[dep]) neighbors.push(order[dep]); }));
        } else {
          // 自分より上の層(自分に依存する子)を見る
          data.nodes.forEach(other=>{
            (other.requires||[]).forEach(g=>{ if(g.includes(id)) neighbors.push(order[other.id]); });
          });
        }
        const avg = neighbors.length ? neighbors.reduce((a,b)=>a+b,0)/neighbors.length : (order[id]||0);
        return {id, avg};
      });
      scores.sort((a,b)=> a.avg - b.avg);
      byLayer[l] = scores.map(s=>s.id);
      byLayer[l].forEach((id,i)=> order[id]=i);
    });
  }
  barycenterPass(true);
  barycenterPass(false);
  barycenterPass(true);

  const layerGap = 130;
  const nodeGap = 130;
  const radius = 30;
  const padding = 70;

  const widestLayer = Math.max(...Object.values(byLayer).map(a=>a.length));
  const svgWidth = Math.max(700, widestLayer * nodeGap + padding*2);
  const svgHeight = (maxLayer+1) * layerGap + padding*2;

  const positioned = data.nodes.map(n=>{
    const l = layerCache[n.id];
    const ids = byLayer[l];
    const idx = ids.indexOf(n.id);
    const rowWidth = ids.length * nodeGap;
    const startX = (svgWidth - rowWidth)/2 + nodeGap/2;
    const x = startX + idx*nodeGap;
    const y = svgHeight - padding - l*layerGap; // layer0を下に、上に行くほど高い層
    return Object.assign({}, n, { x, y, layer: l });
  });

  return { nodes: positioned, width: svgWidth, height: svgHeight, radius };
}

// ---------- 描画 ----------
function render(){
  layout = computeLayout();
  svg.setAttribute('viewBox', `0 0 ${layout.width} ${layout.height}`);
  svg.innerHTML = '';

  const byId = {};
  layout.nodes.forEach(n=> byId[n.id]=n);

  // 選択中ノードのハイライト対象(祖先・子孫)を計算
  let litSet = null;
  if(selectedId){
    litSet = new Set([selectedId]);
    // 祖先(依存先)をたどる
    (function walkUp(id){
      const n = byId[id];
      if(!n) return;
      (n.requires||[]).forEach(g=> g.forEach(dep=>{
        if(!litSet.has(dep)){ litSet.add(dep); walkUp(dep); }
      }));
    })(selectedId);
    // 子孫(自分に依存するもの)をたどる
    (function walkDown(id){
      layout.nodes.forEach(n=>{
        (n.requires||[]).forEach(g=>{
          if(g.includes(id) && !litSet.has(n.id)){
            litSet.add(n.id);
            walkDown(n.id);
          }
        });
      });
    })(selectedId);
  }

  // エッジ描画
  const edgeLayer = document.createElementNS('http://www.w3.org/2000/svg','g');
  layout.nodes.forEach(n=>{
    (n.requires||[]).forEach(group=>{
      const isOr = (n.requires.length > 1);
      group.forEach(depId=>{
        const dep = byId[depId];
        if(!dep) return;
        const path = document.createElementNS('http://www.w3.org/2000/svg','path');
        const x1 = dep.x, y1 = dep.y - layout.radius;
        const x2 = n.x, y2 = n.y + layout.radius;
        const midY = (y1+y2)/2;
        path.setAttribute('d', `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`);
        let cls = 'edge' + (isOr ? ' or' : '');
        if(litSet){
          cls += (litSet.has(n.id) && litSet.has(depId)) ? ' lit' : ' dim';
        }
        path.setAttribute('class', cls);
        edgeLayer.appendChild(path);
      });
    });
  });
  svg.appendChild(edgeLayer);

  // ノード描画
  const nodeLayer = document.createElementNS('http://www.w3.org/2000/svg','g');
  layout.nodes.forEach(n=>{
    const g = document.createElementNS('http://www.w3.org/2000/svg','g');
    let cls = 'node';
    if(n.id === selectedId) cls += ' selected';
    if(litSet && !litSet.has(n.id)) cls += ' dim';
    g.setAttribute('class', cls);
    g.setAttribute('data-id', n.id);

    if(n.isGoal){
      const ring = document.createElementNS('http://www.w3.org/2000/svg','circle');
      ring.setAttribute('class','goal-ring');
      ring.setAttribute('cx', n.x); ring.setAttribute('cy', n.y); ring.setAttribute('r', layout.radius+7);
      g.appendChild(ring);
    }

    const halo = document.createElementNS('http://www.w3.org/2000/svg','circle');
    halo.setAttribute('class','halo');
    halo.setAttribute('cx', n.x); halo.setAttribute('cy', n.y); halo.setAttribute('r', layout.radius+5);
    halo.setAttribute('fill','none');
    halo.setAttribute('stroke','var(--text)');
    halo.setAttribute('stroke-width','1');
    g.appendChild(halo);

    const circle = document.createElementNS('http://www.w3.org/2000/svg','circle');
    circle.setAttribute('class','node-circle');
    circle.setAttribute('cx', n.x); circle.setAttribute('cy', n.y); circle.setAttribute('r', layout.radius);
    const strokeVar = STATUS_COLOR_VAR[n.status] || '--locked';
    const fillVar = STATUS_FILL_VAR[n.status];
    circle.setAttribute('stroke', `var(${strokeVar})`);
    circle.setAttribute('fill', fillVar ? `var(${fillVar})` : 'var(--bg)');
    g.appendChild(circle);

    const label = document.createElementNS('http://www.w3.org/2000/svg','text');
    label.setAttribute('class','node-label');
    label.setAttribute('x', n.x); label.setAttribute('y', n.y + layout.radius + 20);
    label.textContent = n.label;
    g.appendChild(label);

    const sub = document.createElementNS('http://www.w3.org/2000/svg','text');
    sub.setAttribute('class','node-sub');
    sub.setAttribute('x', n.x); sub.setAttribute('y', n.y + layout.radius + 33);
    sub.textContent = STATUS_LABEL[n.status] || n.status;
    g.appendChild(sub);

    g.addEventListener('click', (e)=>{ e.stopPropagation(); selectNode(n.id); });
    nodeLayer.appendChild(g);
  });
  svg.appendChild(nodeLayer);

  applyTransform();
}

function selectNode(id){
  selectedId = id;
  render();
  renderPanel();
}

svg.addEventListener('click', ()=>{ selectedId=null; render(); renderPanel(); });

// ---------- パネル ----------
function renderPanel(){
  if(!selectedId){
    panelContent.innerHTML = `<div class="empty">ノードをクリックすると詳細が表示されます。ステータスの変更や、ゴール指定もここから行えます。</div>`;
    return;
  }
  const n = data.nodes.find(x=>x.id===selectedId);
  if(!n){ panelContent.innerHTML=''; return; }

  const statusButtons = STATUS_ORDER.map(s=>{
    const active = s===n.status ? 'active' : '';
    return `<button class="status-btn ${active}" data-status="${s}">
      <span class="dot" style="border-color:var(${STATUS_COLOR_VAR[s]})"></span>${STATUS_LABEL[s]}
    </button>`;
  }).join('');

  let reqHtml = '';
  if(n.requires && n.requires.length){
    reqHtml = n.requires.map(group=>{
      const items = group.map(depId=>{
        const dep = data.nodes.find(x=>x.id===depId);
        if(!dep) return '';
        return `<div class="req-item" data-jump="${depId}">
          <span class="dot" style="border-color:var(${STATUS_COLOR_VAR[dep.status]})"></span>${dep.label}
        </div>`;
      }).join('');
      return `<div class="req-group">
        ${n.requires.length>1 ? '<div class="or-label">OR いずれか</div>' : ''}
        ${items}
      </div>`;
    }).join('');
  } else {
    reqHtml = `<div class="empty" style="font-size:12px;">前提条件なし(出発点)</div>`;
  }

  const unlocks = data.nodes.filter(other => (other.requires||[]).some(g=>g.includes(n.id)));
  const unlocksHtml = unlocks.length
    ? unlocks.map(u=>`<div data-jump="${u.id}">→ ${u.label}</div>`).join('')
    : `<div style="color:var(--text-faint)">なし</div>`;

  panelContent.innerHTML = `
    <div>
      <h2>${n.label}</h2>
      <div style="font-family:var(--mono); font-size:10px; color:var(--text-faint);">${n.id}</div>
    </div>
    <div>
      <div class="field-label">ステータス</div>
      <div class="status-grid">${statusButtons}</div>
    </div>
    <div>
      <button class="goal-toggle ${n.isGoal?'active':''}" id="goal-toggle-btn">
        ${n.isGoal ? '★ 最終到達点(ゴール)に指定中' : '☆ 最終到達点(ゴール)にする'}
      </button>
    </div>
    <div>
      <div class="field-label">前提条件</div>
      <div class="req-list">${reqHtml}</div>
    </div>
    <div>
      <div class="field-label">これが開ける先</div>
      <div class="unlocks-list">${unlocksHtml}</div>
    </div>
  `;

  panelContent.querySelectorAll('.status-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      n.status = btn.getAttribute('data-status');
      saveData();
      render(); renderPanel();
    });
  });
  const goalBtn = panelContent.querySelector('#goal-toggle-btn');
  if(goalBtn) goalBtn.addEventListener('click', ()=>{
    n.isGoal = !n.isGoal;
    saveData();
    render(); renderPanel();
  });
  panelContent.querySelectorAll('[data-jump]').forEach(el=>{
    el.addEventListener('click', ()=> selectNode(el.getAttribute('data-jump')));
  });
}

// ---------- パン・ズーム(静的変換。継続的な物理計算はしない) ----------
function applyTransform(){
  const g = svg.querySelector('#viewport-group');
}
let vgroup;
function ensureViewportGroup(){
  // 全描画要素を1つのgでラップしてtransformする
  const children = Array.from(svg.childNodes);
  vgroup = document.createElementNS('http://www.w3.org/2000/svg','g');
  vgroup.setAttribute('id','viewport-group');
  children.forEach(c=> vgroup.appendChild(c));
  svg.appendChild(vgroup);
}
const _origRender = render;
render = function(){
  _origRender();
  ensureViewportGroup();
  updateTransform();
};
function updateTransform(){
  if(!vgroup) return;
  vgroup.setAttribute('transform', `translate(${pan.x},${pan.y}) scale(${zoom})`);
}

let isDragging = false, dragStart = {x:0,y:0}, panStart = {x:0,y:0};
graphWrap.addEventListener('mousedown', (e)=>{
  isDragging = true;
  graphWrap.classList.add('dragging');
  dragStart = {x:e.clientX, y:e.clientY};
  panStart = {x:pan.x, y:pan.y};
});
window.addEventListener('mousemove', (e)=>{
  if(!isDragging) return;
  pan.x = panStart.x + (e.clientX - dragStart.x);
  pan.y = panStart.y + (e.clientY - dragStart.y);
  updateTransform();
});
window.addEventListener('mouseup', ()=>{ isDragging=false; graphWrap.classList.remove('dragging'); });
graphWrap.addEventListener('wheel', (e)=>{
  e.preventDefault();
  const delta = e.deltaY > 0 ? -0.08 : 0.08;
  zoom = Math.min(2.2, Math.max(0.35, zoom + delta));
  updateTransform();
}, { passive:false });

// ---------- ツールバー ----------
document.getElementById('btn-reset').addEventListener('click', async ()=>{
  if(!confirm('例のデータにリセットします。よろしいですか?')) return;
  data = JSON.parse(JSON.stringify(DEFAULT_DATA));
  selectedId = null;
  saveData();
  render(); renderPanel();
});

document.getElementById('btn-edit').addEventListener('click', ()=>{
  selectedId = null;
  render();
  panelContent.innerHTML = `
    <div>
      <h2>データを編集</h2>
      <div style="font-size:11.5px; color:var(--text-faint); line-height:1.6; margin-top:4px;">
        requires は [[AND条件...], [AND条件...]] の形。外側配列が複数あればOR、内側の複数idはAND。
      </div>
    </div>
    <textarea id="json-editor">${JSON.stringify(data, null, 2)}</textarea>
    <div id="json-msg"></div>
    <div id="edit-actions">
      <button class="btn" id="apply-json">適用</button>
      <button class="btn" id="cancel-json">閉じる</button>
    </div>
  `;
  document.getElementById('apply-json').addEventListener('click', ()=>{
    const msg = document.getElementById('json-msg');
    try{
      const parsed = JSON.parse(document.getElementById('json-editor').value);
      if(!parsed.nodes || !Array.isArray(parsed.nodes)) throw new Error('nodes 配列が必要です');
      data = parsed;
      saveData();
      render(); renderPanel();
    }catch(e){
      msg.textContent = 'エラー: ' + e.message;
      msg.classList.add('error');
    }
  });
  document.getElementById('cancel-json').addEventListener('click', ()=> renderPanel());
});

// ---------- 起動 ----------
(async function init(){
  await loadData();
  render();
  renderPanel();
})();

})();