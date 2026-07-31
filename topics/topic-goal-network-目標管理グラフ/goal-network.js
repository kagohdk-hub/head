(function(){

const STORAGE_KEY = 'goal-network-data';

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

const STATUS_ORDER = ['locked','target','wip','achieved','avoid','problem'];
const STATUS_LABEL = { locked:'未着手', target:'到達できる', wip:'取り組み中', achieved:'到達済み', avoid:'やらない', problem:'問題が発生する' };
const STATUS_COLOR_VAR = { locked:'--locked', target:'--target', wip:'--wip', achieved:'--achieved', avoid:'--locked', problem:'--danger' };
const STATUS_FILL_VAR  = { locked:'--locked-dim', target:'--target-dim', wip:'--wip-dim', achieved:'--achieved-dim', avoid:'#111111', problem:'#111111' };

let data = null;
let selectedIds = [];
let selectedId = null;
let pan = {x:0, y:0};
let zoom = 1;

const svg = document.getElementById('graph-svg');
const panelContent = document.getElementById('panel-content');
const graphWrap = document.getElementById('graph-wrap');

const CANVAS_SIZE = 2400;
const NODE_RADIUS = 22;
const ARROW_OFFSET = 10;

let rectSelecting = false;
let rectStartClient = null;
let marqueeEl = null;

async function loadData(){
  try{
    const res = await window.storage.get(STORAGE_KEY);
    if(res && res.value){
      data = JSON.parse(res.value);
      return;
    }
  }catch(e){}
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

function computeAutoPositions(){
  const nodesById = {};
  data.nodes.forEach(n => nodesById[n.id] = n);

  const layerCache = {};
  const visiting = new Set();
  function getLayer(id){
    if(layerCache[id] !== undefined) return layerCache[id];
    if(visiting.has(id)) return 0;
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

  let order = {};
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
          (n.requires||[]).forEach(g=> g.forEach(dep=>{ if(nodesById[dep]) neighbors.push(order[dep]); }));
        } else {
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

  const baseRadius = 90;
  const ringGap = 118;
  const minArcPerNode = 46;
  const ringRadius = {};
  for(let l=0; l<=maxLayer; l++){
    const count = (byLayer[l] || []).length || 1;
    const neededByArc = (count * minArcPerNode) / (2*Math.PI);
    ringRadius[l] = Math.max(baseRadius + l*ringGap, l===0 ? baseRadius : (ringRadius[l-1]||baseRadius) + Math.max(ringGap, neededByArc*0.6));
  }

  const CENTER = CANVAS_SIZE/2;
  const result = {};
  data.nodes.forEach(n=>{
    const l = layerCache[n.id];
    const ids = byLayer[l];
    const idx = ids.indexOf(n.id);
    const count = ids.length;
    const r = (count === 1 && l === 0) ? 0 : ringRadius[l];
    const angle = (idx / count) * Math.PI * 2 - Math.PI/2;
    result[n.id] = { x: CENTER + r*Math.cos(angle), y: CENTER + r*Math.sin(angle) };
  });
  return result;
}

function autoLayoutPositions(forceAll){
  const auto = computeAutoPositions();
  data.nodes.forEach(n=>{
    if(forceAll || n.x === undefined || n.y === undefined || n.x === null || n.y === null){
      const p = auto[n.id];
      if(p){ n.x = p.x; n.y = p.y; }
    }
  });
}

function escapeHtml(s){
  return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

let selectedEdge = null;
let draggingNodeId = null;
let dragNodeIds = [];
let dragStartLocal = {x:0, y:0};
let dragOriginPositions = {};
let connecting = null;
let connectMouse = {x:0, y:0};
let vgroup = null;
let rafPending = false;

function scheduleRender(){
  if(rafPending) return;
  rafPending = true;
  requestAnimationFrame(()=>{ rafPending = false; render(); });
}

function screenToLocal(clientX, clientY){
  if(!vgroup) return {x:0,y:0};
  const pt = svg.createSVGPoint();
  pt.x = clientX; pt.y = clientY;
  const ctm = vgroup.getScreenCTM();
  if(!ctm) return {x:0,y:0};
  const loc = pt.matrixTransform(ctm.inverse());
  return {x: loc.x, y: loc.y};
}

function render(){
  svg.setAttribute('viewBox', `0 0 ${CANVAS_SIZE} ${CANVAS_SIZE}`);
  svg.innerHTML = '';

  const byId = {};
  data.nodes.forEach(n=> byId[n.id]=n);

  let litSet = null;
  if(selectedIds && selectedIds.length){
    litSet = new Set(selectedIds);
    function walkUp(id){
      const n = byId[id];
      if(!n) return;
      (n.requires||[]).forEach(g=> g.forEach(dep=>{
        if(!litSet.has(dep)){ litSet.add(dep); walkUp(dep); }
      }));
    }
    function walkDown(id){
      data.nodes.forEach(n=>{
        (n.requires||[]).forEach(g=>{
          if(g.includes(id) && !litSet.has(n.id)){
            litSet.add(n.id);
            walkDown(n.id);
          }
        });
      });
    }
    selectedIds.forEach(id=>{ walkUp(id); walkDown(id); });
  }

  const root = document.createElementNS('http://www.w3.org/2000/svg','g');
  const defs = document.createElementNS('http://www.w3.org/2000/svg','defs');
  const marker = document.createElementNS('http://www.w3.org/2000/svg','marker');
  marker.setAttribute('id','arrow');
  marker.setAttribute('markerWidth','10');
  marker.setAttribute('markerHeight','10');
  marker.setAttribute('refX','10');
  marker.setAttribute('refY','5');
  marker.setAttribute('orient','auto');
  marker.setAttribute('markerUnits','strokeWidth');
  const mpath = document.createElementNS('http://www.w3.org/2000/svg','path');
  mpath.setAttribute('d','M 0 0 L 10 5 L 0 10 z');
  mpath.setAttribute('fill','currentColor');
  marker.appendChild(mpath);
  defs.appendChild(marker);
  root.appendChild(defs);

  const edgeLayer = document.createElementNS('http://www.w3.org/2000/svg','g');
  data.nodes.forEach(n=>{
    (n.requires||[]).forEach((group, gi)=>{
      const isOr = (n.requires.length > 1);
      group.forEach(depId=>{
        const dep = byId[depId];
        if(!dep || dep.x===undefined) return;
        const dx = n.x - dep.x, dy = n.y - dep.y;
        const dist = Math.max(1, Math.hypot(dx, dy));
        const ux = dx/dist, uy = dy/dist;
        const x1 = dep.x + ux*(NODE_RADIUS + 2), y1 = dep.y + uy*(NODE_RADIUS + 2);
        const x2 = n.x - ux*(NODE_RADIUS + ARROW_OFFSET), y2 = n.y - uy*(NODE_RADIUS + ARROW_OFFSET);
        const mx = (x1+x2)/2, my = (y1+y2)/2;
        const d = `M ${x1} ${y1} Q ${mx} ${my}, ${x2} ${y2}`;

        const isSelected = selectedEdge && selectedEdge.fromId===n.id && selectedEdge.groupIndex===gi && selectedEdge.depId===depId;

        const visible = document.createElementNS('http://www.w3.org/2000/svg','path');
        visible.setAttribute('d', d);
        let cls = 'edge' + (isOr ? ' or' : '');
        if(isSelected) cls += ' selected';
        else if(litSet) cls += (litSet.has(n.id) && litSet.has(depId)) ? ' lit' : ' dim';
        visible.setAttribute('class', cls);
        let strokeColor = 'var(--line)';
        if(isSelected) strokeColor = 'var(--danger)';
        else if(litSet) strokeColor = (litSet.has(n.id) && litSet.has(depId)) ? 'var(--text-dim)' : 'var(--line)';
        visible.setAttribute('stroke', strokeColor);
        visible.setAttribute('style', `color: ${strokeColor};`);
        visible.setAttribute('marker-end', 'url(#arrow)');
        edgeLayer.appendChild(visible);

        const hit = document.createElementNS('http://www.w3.org/2000/svg','path');
        hit.setAttribute('d', d);
        hit.setAttribute('class', 'edge-hit');
        hit.addEventListener('mousedown', (e)=>{ e.stopPropagation(); });
        hit.addEventListener('mouseup', (e)=>{ e.stopPropagation(); });
        hit.addEventListener('click', (e)=>{ e.stopPropagation(); selectEdge(n.id, gi, depId); });
        edgeLayer.appendChild(hit);
      });
    });
  });
  root.appendChild(edgeLayer);

  const nodeLayer = document.createElementNS('http://www.w3.org/2000/svg','g');
  data.nodes.forEach(n=>{
    if(n.x===undefined || n.y===undefined) return;
    const g = document.createElementNS('http://www.w3.org/2000/svg','g');
    let cls = 'node';
    if(selectedIds && selectedIds.includes(n.id)) cls += ' selected';
    if(litSet && !litSet.has(n.id)) cls += ' dim';
    if(n.status === 'avoid') cls += ' node-status-avoid';
    if(n.status === 'problem') cls += ' node-status-problem';
    g.setAttribute('class', cls);
    g.setAttribute('data-id', n.id);

    if(n.isGoal){
      const ring = document.createElementNS('http://www.w3.org/2000/svg','circle');
      ring.setAttribute('class','goal-ring');
      ring.setAttribute('cx', n.x); ring.setAttribute('cy', n.y); ring.setAttribute('r', NODE_RADIUS+7);
      g.appendChild(ring);
    }

    const halo = document.createElementNS('http://www.w3.org/2000/svg','circle');
    halo.setAttribute('class','halo');
    halo.setAttribute('cx', n.x); halo.setAttribute('cy', n.y); halo.setAttribute('r', NODE_RADIUS+5);
    halo.setAttribute('fill','none');
    halo.setAttribute('stroke','var(--text)');
    halo.setAttribute('stroke-width','1');
    g.appendChild(halo);

    const circle = document.createElementNS('http://www.w3.org/2000/svg','circle');
    circle.setAttribute('class','node-circle');
    circle.setAttribute('cx', n.x); circle.setAttribute('cy', n.y); circle.setAttribute('r', NODE_RADIUS);
    if(n.status === 'avoid' || n.status === 'problem'){
      circle.setAttribute('stroke', '#111111');
      circle.setAttribute('fill', '#111111');
    } else {
      const strokeVar = STATUS_COLOR_VAR[n.status] || '--locked';
      const fillVar = STATUS_FILL_VAR[n.status];
      circle.setAttribute('stroke', `var(${strokeVar})`);
      circle.setAttribute('fill', fillVar ? `var(${fillVar})` : 'var(--bg)');
    }
    g.appendChild(circle);

    if(n.status === 'problem'){
      const cross1 = document.createElementNS('http://www.w3.org/2000/svg','line');
      cross1.setAttribute('class','node-cross');
      cross1.setAttribute('x1', n.x - 10); cross1.setAttribute('y1', n.y - 10);
      cross1.setAttribute('x2', n.x + 10); cross1.setAttribute('y2', n.y + 10);
      g.appendChild(cross1);

      const cross2 = document.createElementNS('http://www.w3.org/2000/svg','line');
      cross2.setAttribute('class','node-cross');
      cross2.setAttribute('x1', n.x - 10); cross2.setAttribute('y1', n.y + 10);
      cross2.setAttribute('x2', n.x + 10); cross2.setAttribute('y2', n.y - 10);
      g.appendChild(cross2);
    }

    const title = document.createElementNS('http://www.w3.org/2000/svg','title');
    title.textContent = `${n.label}(${STATUS_LABEL[n.status]||n.status})`;
    g.appendChild(title);

    const showLabel = (n.status === 'avoid' || n.status === 'problem')
      ? ((selectedIds && selectedIds.includes(n.id)) || (litSet && litSet.has(n.id)))
      : (n.isGoal || n.status === 'wip' || (litSet && litSet.has(n.id)));
    if(showLabel){
      const labelGroup = document.createElementNS('http://www.w3.org/2000/svg','g');
      labelGroup.setAttribute('class','node-label-group');
      labelGroup.setAttribute('data-anchor-x', n.x);
      labelGroup.setAttribute('data-anchor-y', n.y);

      const label = document.createElementNS('http://www.w3.org/2000/svg','text');
      label.setAttribute('class','node-label');
      label.setAttribute('x', n.x); label.setAttribute('y', n.y + NODE_RADIUS + 20);
      label.textContent = n.label;
      labelGroup.appendChild(label);

      const sub = document.createElementNS('http://www.w3.org/2000/svg','text');
      sub.setAttribute('class','node-sub');
      sub.setAttribute('x', n.x); sub.setAttribute('y', n.y + NODE_RADIUS + 33);
      sub.textContent = STATUS_LABEL[n.status] || n.status;
      labelGroup.appendChild(sub);
      g.appendChild(labelGroup);
    }

    g.addEventListener('mousedown', (e)=>{
      e.stopPropagation();
      if(e.shiftKey){
        connecting = { fromId: n.id, x: n.x, y: n.y };
        connectMouse = { x: n.x, y: n.y };
      } else {
        draggingNodeId = n.id;
        dragStartLocal = screenToLocal(e.clientX, e.clientY);
        dragNodeIds = (selectedIds && selectedIds.includes(n.id) && selectedIds.length > 1)
          ? selectedIds.slice()
          : [n.id];
        dragOriginPositions = {};
        dragNodeIds.forEach(id=>{
          const node = data.nodes.find(x=>x.id===id);
          if(node) dragOriginPositions[id] = { x: node.x, y: node.y };
        });
      }
    });
    g.addEventListener('click', (e)=>{ e.stopPropagation(); selectNode(n.id, e); });
    nodeLayer.appendChild(g);
  });
  root.appendChild(nodeLayer);

  if(connecting){
    const preview = document.createElementNS('http://www.w3.org/2000/svg','path');
    preview.setAttribute('d', `M ${connecting.x} ${connecting.y} L ${connectMouse.x} ${connectMouse.y}`);
    preview.setAttribute('class','connect-preview');
    root.appendChild(preview);
  }

  svg.appendChild(root);
  vgroup = root;
  updateTransform();
}

function updateTransform(){
  if(!vgroup) return;
  vgroup.setAttribute('transform', `translate(${pan.x},${pan.y}) scale(${zoom})`);

  vgroup.querySelectorAll('.node-label-group').forEach(group => {
    const anchorX = Number(group.getAttribute('data-anchor-x') || 0);
    const anchorY = Number(group.getAttribute('data-anchor-y') || 0);
    const inverseScale = zoom > 0 ? 1 / zoom : 1;
    group.setAttribute('transform', `translate(${anchorX} ${anchorY}) scale(${inverseScale}) translate(${-anchorX} ${-anchorY})`);
  });
}

function selectNode(id, e){
  selectedEdge = null;
  if(e && e.shiftKey){
    if(!selectedIds) selectedIds = [];
    const idx = selectedIds.indexOf(id);
    if(idx === -1) selectedIds.push(id);
    else selectedIds.splice(idx,1);
  } else {
    selectedIds = [id];
  }
  selectedId = selectedIds[0] || null;
  render();
  renderPanel();
}

function selectEdge(fromId, groupIndex, depId){
  selectedIds = []; selectedId = null;
  selectedEdge = { fromId, groupIndex, depId };
  render();
  renderPanel();
}

function deleteNode(id){
  data.nodes = data.nodes.filter(n=>n.id!==id);
  data.nodes.forEach(n=>{
    n.requires = (n.requires||[]).map(g=> g.filter(d=>d!==id)).filter(g=>g.length>0);
  });
  selectedIds = (selectedIds || []).filter(x=>x!==id);
  selectedId = selectedIds[0] || null;
  saveData();
  render(); renderPanel();
}

function deleteEdge(fromId, groupIndex, depId){
  const n = data.nodes.find(x=>x.id===fromId);
  if(!n || !n.requires || !n.requires[groupIndex]) return;
  n.requires[groupIndex] = n.requires[groupIndex].filter(d=>d!==depId);
  n.requires = n.requires.filter(g=>g.length>0);
  saveData();
  render(); renderPanel();
}

function addRequirement(fromId, toId){
  if(fromId === toId) return;
  const n = data.nodes.find(x=>x.id===fromId);
  if(!n) return;
  n.requires = n.requires || [];
  const exists = n.requires.some(g=>g.includes(toId));
  if(exists) return;
  n.requires.push([toId]);
  saveData();
  render(); renderPanel();
}

function createNodeAt(x, y){
  const id = 'node_' + Date.now().toString(36) + Math.random().toString(36).slice(2,5);
  const newNode = { id, label:'新規ノード', status:'locked', requires:[], x, y };
  data.nodes.push(newNode);
  selectedEdge = null;
  selectedIds = [id]; selectedId = id;
  saveData();
  render(); renderPanel();
}

// 状態ボタン生成
function buildStatusButtons(node){
  return STATUS_ORDER.map(s=>{
    const active = s===node.status ? 'active' : '';
    return `<button class="status-btn ${active}" data-status="${s}">
      <span class="dot" style="border-color:var(${STATUS_COLOR_VAR[s]})"></span>${STATUS_LABEL[s]}
    </button>`;
  }).join('');
}

// 前提条件HTML生成
function buildRequirementHtml(node){
  if(node.requires && node.requires.length){
    return node.requires.map((group)=>{
      const items = group.map(depId=>{
        const dep = data.nodes.find(x=>x.id===depId);
        if(!dep) return '';
        return `<div class="req-item" data-jump="${depId}">
          <span class="dot" style="border-color:var(${STATUS_COLOR_VAR[dep.status]})"></span>${escapeHtml(dep.label)}
        </div>`;
      }).join('');
      return `<div class="req-group">
        ${node.requires.length>1 ? '<div class="or-label">OR いずれか</div>' : ''}
        ${items}
      </div>`;
    }).join('');
  }
  return `<div class="empty" style="font-size:12px;">前提条件なし(出発点)</div>`;
}

// 開ける先HTML生成
function buildUnlocksHtml(node){
  const unlocks = data.nodes.filter(other => (other.requires||[]).some(g=>g.includes(node.id)));
  return unlocks.length
    ? unlocks.map(u=>`<div data-jump="${u.id}">→ ${escapeHtml(u.label)}</div>`).join('')
    : `<div style="color:var(--text-faint)">なし</div>`;
}

// 関係パネル描画
function renderEdgePanel(){
  const from = data.nodes.find(x=>x.id===selectedEdge.fromId);
  const dep = data.nodes.find(x=>x.id===selectedEdge.depId);
  panelContent.innerHTML = `
    <div><h2>関係</h2></div>
    <div class="req-group">
      <div style="font-size:13px;">${from ? escapeHtml(from.label) : '?'}</div>
      <div style="color:var(--text-faint); font-size:11px; margin:6px 0;">↑ 前提として必要</div>
      <div style="font-size:13px;">${dep ? escapeHtml(dep.label) : '?'}</div>
    </div>
    <button class="btn" id="delete-edge-btn" style="color:var(--danger); border-color:var(--danger);">この関係を削除</button>
  `;
  document.getElementById('delete-edge-btn').addEventListener('click', ()=>{
    deleteEdge(selectedEdge.fromId, selectedEdge.groupIndex, selectedEdge.depId);
    selectedEdge = null;
    render(); renderPanel();
  });
}

// 複数選択パネル描画
function renderMultiSelectPanel(){
  const list = selectedIds.map(id=>{
    const node = data.nodes.find(x=>x.id===id);
    return `<div style="display:flex; justify-content:space-between; align-items:center; padding:6px 0;">
      <div>${node ? escapeHtml(node.label) : id}</div>
      <div style="font-family:var(--mono); font-size:11px; color:var(--text-faint);">${id}</div>
    </div>`;
  }).join('');
  panelContent.innerHTML = `
    <div><h2>選択中: ${selectedIds.length} 件</h2></div>
    <div style="max-height:240px; overflow:auto; margin-top:8px;">${list}</div>
    <div style="margin-top:10px;"><button class="btn" id="delete-multi-btn" style="color:var(--danger); border-color:var(--danger);">選択したノードを削除</button></div>
  `;
  document.getElementById('delete-multi-btn').addEventListener('click', ()=>{
    if(!confirm(`選択中の ${selectedIds.length} 件を削除しますか?`)) return;
    const toDelete = selectedIds.slice();
    toDelete.forEach(id=> deleteNode(id));
    selectedIds = [];
    selectedId = null;
    render(); renderPanel();
  });
}

// 空状態パネル描画
function renderEmptyPanel(){
  panelContent.innerHTML = `<div class="empty">
    <br />
    <br />
    ノードをクリックすると詳細が表示されます。<br><br>
    ・空白をクリック → ノード作成<br>
    ・ノードをドラッグ → 移動<br>
    ・Shift+ドラッグ → 別ノードへ関係作成<br>
    ・選択してDelete → 削除<br>
    ・Escape → 選択解除
  </div>`;
}

// ノード詳細パネルイベントバインド
function bindNodePanelEvents(node){
  const labelInput = document.getElementById('label-input');
  labelInput.addEventListener('change', ()=>{
    node.label = labelInput.value.trim() || '(無題)';
    saveData();
    render(); renderPanel();
  });

  panelContent.querySelectorAll('.status-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      node.status = btn.getAttribute('data-status');
      saveData();
      render(); renderPanel();
    });
  });

  const goalBtn = panelContent.querySelector('#goal-toggle-btn');
  if(goalBtn) goalBtn.addEventListener('click', ()=>{
    node.isGoal = !node.isGoal;
    saveData();
    render(); renderPanel();
  });

  panelContent.querySelectorAll('[data-jump]').forEach(el=>{
    el.addEventListener('click', (ev)=> selectNode(el.getAttribute('data-jump'), ev));
  });

  const delBtn = document.getElementById('delete-node-btn');
  if(delBtn) delBtn.addEventListener('click', ()=>{
    if(confirm(`「${node.label}」を削除しますか?`)) deleteNode(node.id);
  });
}

// ノード詳細パネル描画
function renderNodePanel(node){
  panelContent.innerHTML = `
    <div>
      <br />
      <br />
      <br />
      <input type="text" id="label-input" value="${escapeHtml(node.label)}">
      <div style="font-family:var(--mono); font-size:10px; color:var(--text-faint); margin-top:4px;">${node.id}</div>
    </div>
    <div>
      <div class="field-label">ステータス</div>
      <div class="status-grid">${buildStatusButtons(node)}</div>
    </div>
    <div>
      <button class="goal-toggle ${node.isGoal?'active':''}" id="goal-toggle-btn">
        ${node.isGoal ? '★ 最終到達点(ゴール)に指定中' : '☆ 最終到達点(ゴール)にする'}
      </button>
    </div>
    <div>
      <div class="field-label">前提条件</div>
      <div class="req-list">${buildRequirementHtml(node)}</div>
    </div>
    <div>
      <div class="field-label">これが開ける先</div>
      <div class="unlocks-list">${buildUnlocksHtml(node)}</div>
    </div>
    <button class="btn" id="delete-node-btn" style="color:var(--danger); border-color:var(--danger);">このノードを削除</button>
  `;
  bindNodePanelEvents(node);
}

// パネル描画入口
function renderPanel(){
  if(selectedEdge){
    renderEdgePanel();
    return;
  }
  if(selectedIds && selectedIds.length > 1){
    renderMultiSelectPanel();
    return;
  }
  if(!selectedIds || selectedIds.length === 0){
    renderEmptyPanel();
    return;
  }
  const node = data.nodes.find(x=>x.id=== (selectedIds[0] || selectedId));
  if(!node){
    panelContent.innerHTML = '';
    return;
  }
  renderNodePanel(node);
}

let panActive = false, panStart = {x:0,y:0}, panOrigin = {x:0,y:0};
let clickCandidate = null;

graphWrap.addEventListener('mousedown', (e)=>{
  if(e.target.closest && e.target.closest('.node')) return;
  if(e.shiftKey){
    rectSelecting = true;
    rectStartClient = { x: e.clientX, y: e.clientY };
    if(marqueeEl) marqueeEl.remove();
    marqueeEl = document.createElement('div');
    marqueeEl.className = 'marquee';
    marqueeEl.style.left = rectStartClient.x + 'px';
    marqueeEl.style.top = rectStartClient.y + 'px';
    marqueeEl.style.width = '0px';
    marqueeEl.style.height = '0px';
    graphWrap.appendChild(marqueeEl);
    clickCandidate = null;
    panActive = false;
    graphWrap.classList.remove('dragging');
    return;
  }
  panActive = true;
  graphWrap.classList.add('dragging');
  panStart = {x:e.clientX, y:e.clientY};
  panOrigin = {x:pan.x, y:pan.y};
  clickCandidate = {x:e.clientX, y:e.clientY};
});

window.addEventListener('mousemove', (e)=>{
  if(rectSelecting){
    const x = Math.min(rectStartClient.x, e.clientX);
    const y = Math.min(rectStartClient.y, e.clientY);
    const w = Math.abs(e.clientX - rectStartClient.x);
    const h = Math.abs(e.clientY - rectStartClient.y);
    if(marqueeEl){
      marqueeEl.style.left = x + 'px';
      marqueeEl.style.top = y + 'px';
      marqueeEl.style.width = w + 'px';
      marqueeEl.style.height = h + 'px';
    }
    return;
  }
  if(panActive){
    const dx = e.clientX - panStart.x, dy = e.clientY - panStart.y;
    if(Math.hypot(dx,dy) > 4) clickCandidate = null;
    pan.x = panOrigin.x + dx;
    pan.y = panOrigin.y + dy;
    updateTransform();
  }
  if(draggingNodeId){
    const p = screenToLocal(e.clientX, e.clientY);
    const dx = p.x - dragStartLocal.x;
    const dy = p.y - dragStartLocal.y;
    dragNodeIds.forEach(id=>{
      const node = data.nodes.find(x=>x.id===id);
      if(node){
        const origin = dragOriginPositions[id] || { x: node.x, y: node.y };
        node.x = origin.x + dx;
        node.y = origin.y + dy;
      }
    });
    scheduleRender();
  }
  if(connecting){
    connectMouse = screenToLocal(e.clientX, e.clientY);
    scheduleRender();
  }
});

window.addEventListener('mouseup', (e)=>{
  if(rectSelecting){
    const a = screenToLocal(rectStartClient.x, rectStartClient.y);
    const b = screenToLocal(e.clientX, e.clientY);
    const minx = Math.min(a.x,b.x), maxx = Math.max(a.x,b.x);
    const miny = Math.min(a.y,b.y), maxy = Math.max(a.y,b.y);
    data.nodes.forEach(n=>{
      if(n.x===undefined || n.y===undefined) return;
      if(n.x >= minx && n.x <= maxx && n.y >= miny && n.y <= maxy){
        if(!selectedIds.includes(n.id)) selectedIds.push(n.id);
      }
    });
    if(marqueeEl){ marqueeEl.remove(); marqueeEl = null; }
    rectSelecting = false; rectStartClient = null;
    selectedId = selectedIds[0] || null;
    scheduleRender(); renderPanel();
    return;
  }
  if(panActive){
    panActive = false;
    graphWrap.classList.remove('dragging');
    if(clickCandidate){
      const p = screenToLocal(clickCandidate.x, clickCandidate.y);
      createNodeAt(p.x, p.y);
    }
    clickCandidate = null;
  }
  if(draggingNodeId){
    saveData();
    draggingNodeId = null;
    dragNodeIds = [];
    dragOriginPositions = {};
  }
  if(connecting){
    const target = document.elementFromPoint(e.clientX, e.clientY);
    const nodeEl = target && target.closest && target.closest('.node');
    if(nodeEl){
      const targetId = nodeEl.getAttribute('data-id');
      if(targetId) addRequirement(connecting.fromId, targetId);
    }
    connecting = null;
    scheduleRender();
  }
});

graphWrap.addEventListener('wheel', (e)=>{
  e.preventDefault();
  const delta = e.deltaY > 0 ? -0.08 : 0.08;
  zoom = Math.min(2.2, Math.max(0.35, zoom + delta));
  updateTransform();
}, { passive:false });

graphWrap.addEventListener('click', (e)=>{
  if(e.target.closest && e.target.closest('.node')) return;
  if(e.shiftKey) return;
  selectedIds = [];
  selectedId = null;
  selectedEdge = null;
  render(); renderPanel();
});

document.addEventListener('keydown', (e)=>{
  const tag = (e.target && e.target.tagName) || '';
  if(tag === 'INPUT' || tag === 'TEXTAREA') return;
  if(e.key === 'Escape'){
    selectedIds = []; selectedId = null; selectedEdge = null; connecting = null;
    render(); renderPanel();
  } else if(e.key === 'Delete' || e.key === 'Backspace'){
    if(selectedIds && selectedIds.length){
      e.preventDefault();
      if(!confirm(`選択中の ${selectedIds.length} 件を削除しますか?`)) return;
      const toDelete = selectedIds.slice();
      toDelete.forEach(id=> deleteNode(id));
      selectedIds = []; selectedId = null;
      render(); renderPanel();
    } else if(selectedEdge){
      e.preventDefault();
      deleteEdge(selectedEdge.fromId, selectedEdge.groupIndex, selectedEdge.depId);
      selectedEdge = null;
      render(); renderPanel();
    }
  }
});

document.getElementById('btn-reset').addEventListener('click', async ()=>{
  if(!confirm('例のデータにリセットします。よろしいですか?')) return;
  data = JSON.parse(JSON.stringify(DEFAULT_DATA));
  autoLayoutPositions(false);
  selectedIds = []; selectedId = null; selectedEdge = null;
  saveData();
  render(); renderPanel();
});

document.getElementById('btn-recompute').addEventListener('click', ()=>{
  autoLayoutPositions(true);
  saveData();
  render(); renderPanel();
});

document.getElementById('btn-export').addEventListener('click', ()=>{
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const ts = new Date().toISOString().slice(0,10);
  a.href = url;
  a.download = `goal-network-${ts}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

const fileInput = document.getElementById('file-input');
document.getElementById('btn-import').addEventListener('click', ()=> fileInput.click());
fileInput.addEventListener('change', (e)=>{
  const file = e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = ()=>{
    try{
      const parsed = JSON.parse(reader.result);
      if(!parsed.nodes || !Array.isArray(parsed.nodes)) throw new Error('nodes 配列が必要です');
      data = parsed;
      autoLayoutPositions(false);
      selectedIds = []; selectedId = null; selectedEdge = null;
      saveData();
      render(); renderPanel();
    }catch(err){
      alert('読み込みエラー: ' + err.message);
    }
  };
  reader.readAsText(file);
  fileInput.value = '';
});

document.getElementById('btn-edit').addEventListener('click', ()=>{
  selectedIds = []; selectedId = null; selectedEdge = null;
  render();
  panelContent.innerHTML = `
    <div>
      <br />
      <br />
      <h2>データを編集</h2>
      <div style="font-size:11.5px; color:var(--text-faint); line-height:1.6; margin-top:4px;">
        requires は [[AND条件...], [AND条件...]] の形。外側配列が複数あればOR、内側の複数idはAND。x, y は座標(省略可、その場合は適用後に自動配置)。
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
      autoLayoutPositions(false);
      saveData();
      render(); renderPanel();
    }catch(e){
      msg.textContent = 'エラー: ' + e.message;
      msg.classList.add('error');
    }
  });
  document.getElementById('cancel-json').addEventListener('click', ()=> renderPanel());
});

(async function init(){
  await loadData();
  autoLayoutPositions(false);
  render();
  renderPanel();
})();

})();
