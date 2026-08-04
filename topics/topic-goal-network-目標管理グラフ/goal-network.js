(function(){

const STORAGE_KEY = 'goal-network-data';
const EXPORT_NAME_KEY = 'goal-network-export-name';
const LABEL_MODE_KEY = 'goal-network-label-mode';

const DEFAULT_DATA = {
  nodes: [
    { id:'a001', label:'材料がある', status:'achieved', requires:[] },
    { id:'a002', label:'調理器具がある', status:'achieved', requires:[] },
    { id:'a003', label:'手持ちのお金がある', status:'achieved', requires:[] },
    { id:'a004', label:'カレーを作れる', status:'wip', requires:[['a001','a002']] },
    { id:'a005', label:'カレー屋に行ける', status:'achieved', requires:[['a003']] },
    { id:'a006', label:'カレーを食べられる', status:'target', requires:[['a004'],['a005']], isGoal:true }
  ],
  node_positions: {}
};

const STATUS_ORDER = ['locked','target','wip','achieved','avoid','problem'];
const STATUS_LABEL = { locked:'未着手', target:'到達できる', wip:'取り組み中', achieved:'到達済み', avoid:'やらない', problem:'問題が発生する' };
const STATUS_COLOR_VAR = { locked:'--locked', target:'--target', wip:'--wip', achieved:'--achieved', avoid:'--locked', problem:'--danger' };
const STATUS_FILL_VAR  = { locked:'--locked-dim', target:'--target-dim', wip:'--wip-dim', achieved:'--achieved-dim', avoid:'#111111', problem:'#111111' };

let data = null;
let exportName = '';
let selectedIds = [];

function generateNodeId(existingIds = []){
  const chars = '0123456789abcdefghijklmnopqrstuvwxyz';
  const pool = new Set(existingIds || []);
  for(let attempt = 0; attempt < 1000; attempt++){
    let id = '';
    for(let i = 0; i < 4; i++) id += chars[Math.floor(Math.random() * chars.length)];
    if(!pool.has(id)) return id;
  }
  return `n${Date.now().toString(36).slice(-4)}`;
}

function migrateDataShape(raw){
  const cloned = JSON.parse(JSON.stringify(raw || {}));
  if(!cloned.nodes || !Array.isArray(cloned.nodes)) return cloned;

  const idMap = {};
  const usedIds = new Set();
  const originalNodes = cloned.nodes.map((node)=> ({ ...node }));
  originalNodes.forEach((node)=>{
    const originalId = node && typeof node.id === 'string' ? node.id : '';
    let nextId = originalId;
    if(!/^[a-z0-9]{4}$/.test(nextId)){
      nextId = generateNodeId(Array.from(usedIds));
    } else if(usedIds.has(nextId)){
      nextId = generateNodeId(Array.from(usedIds));
    }
    usedIds.add(nextId);
    idMap[originalId] = nextId;
  });

  const migratedNodes = originalNodes.map((node)=>{
    const originalId = node && typeof node.id === 'string' ? node.id : '';
    const nextId = idMap[originalId] || originalId;
    const nextNode = { ...node, id: nextId };
    delete nextNode.x;
    delete nextNode.y;
    nextNode.requires = (nextNode.requires || []).map((group)=>{
      if(!Array.isArray(group)) return [];
      return group.map((depId)=> idMap[depId] || depId).filter(Boolean);
    }).filter((group)=> group.length > 0);
    return nextNode;
  });

  const migratedPositions = {};
  originalNodes.forEach((node, index) => {
    const nextNode = migratedNodes[index];
    if(!nextNode) return;
    const pos = {};
    if(node && node.x !== undefined) pos.x = node.x;
    if(node && node.y !== undefined) pos.y = node.y;
    if(Object.keys(pos).length) migratedPositions[nextNode.id] = pos;
  });

  Object.entries(cloned.node_positions || {}).forEach(([oldId, pos]) => {
    const nextId = idMap[oldId] || oldId;
    if(pos && typeof pos === 'object' && (pos.x !== undefined || pos.y !== undefined)){
      migratedPositions[nextId] = { x: pos.x, y: pos.y };
    }
  });

  cloned.nodes = migratedNodes;
  cloned.node_positions = migratedPositions;
  return cloned;
}

function getNodePosition(nodeId){
  if(!data || !data.node_positions || typeof data.node_positions !== 'object') return null;
  const pos = data.node_positions[nodeId];
  return pos && (pos.x !== undefined || pos.y !== undefined) ? { x: pos.x, y: pos.y } : null;
}

function setNodePosition(nodeId, x, y){
  if(!data) return;
  data.node_positions = data.node_positions || {};
  data.node_positions[nodeId] = { x, y };
}
let selectedId = null;
let pan = {x:0, y:0};
let zoom = 1;
let showAllLabels = false;

const svg = document.getElementById('graph-svg');
const panelContent = document.getElementById('panel-content');
const graphWrap = document.getElementById('graph-wrap');
const exportNameInput = document.getElementById('export-name-input');

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
      data = migrateDataShape(JSON.parse(res.value));
      return;
    }
  }catch(e){}
  data = JSON.parse(JSON.stringify(DEFAULT_DATA));
  data = migrateDataShape(data);
}

function normalizeExportName(value){
  const base = String(value || '').trim().replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '-').replace(/\.+$/, '');
  return base || 'goal-network';
}

async function loadExportName(){
  try{
    const res = await window.storage.get(EXPORT_NAME_KEY);
    if(res && res.value){ exportName = res.value; }
  }catch(e){}
  if(exportNameInput){
    exportNameInput.value = exportName;
  }
}

function saveExportName(){
  const next = normalizeExportName(exportNameInput ? exportNameInput.value : exportName);
  exportName = next;
  if(exportNameInput){ exportNameInput.value = next; }
  try{ window.storage.set(EXPORT_NAME_KEY, next); }
  catch(e){ console.warn('save export name failed', e); }
}

let saveTimer = null;
function saveData(){
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async ()=>{
    try{ await window.storage.set(STORAGE_KEY, JSON.stringify(data)); }
    catch(e){ console.warn('save failed', e); }
  }, 250);
}

async function loadLabelMode(){
  try{
    const res = await window.storage.get(LABEL_MODE_KEY);
    if(res && typeof res.value === 'boolean') showAllLabels = res.value;
  }catch(e){}
  applyLabelMode();
}

function saveLabelMode(){
  try{ window.storage.set(LABEL_MODE_KEY, showAllLabels); }
  catch(e){ console.warn('save label mode failed', e); }
}

function applyLabelMode(){
  const btn = document.getElementById('btn-toggle-labels');
  if(!btn) return;
  const label = btn.querySelector('.toggle-label');
  btn.classList.toggle('active', showAllLabels);
  btn.setAttribute('aria-pressed', String(showAllLabels));
  if(label){ label.textContent = showAllLabels ? 'ラベル: すべて表示' : 'ラベル: 省略'; }
}

function toggleLabelMode(){
  showAllLabels = !showAllLabels;
  applyLabelMode();
  saveLabelMode();
  render();
  renderPanel();
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
    const current = getNodePosition(n.id);
    if(forceAll || !current || current.x === undefined || current.y === undefined || current.x === null || current.y === null){
      const p = auto[n.id];
      if(p){ setNodePosition(n.id, p.x, p.y); }
    }
  });
}

function escapeHtml(s){
  return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function setPanelContent(html){
  panelContent.innerHTML = `<br/><br/>${html}`;
}

let selectedEdge = null;
let selectedEdgeIds = [];
let edgeMoveTargetSelectMode = false;
let edgeMoveTargetSelectSide = null;
let edgeMoveTargetValue = '';
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

  function wrapLabel(text){
    const source = String(text || '');
    if(!source) return [''];
    const lines = [];
    let current = '';
    Array.from(source).forEach((char)=>{
      if(current.length && current.length % 15 === 0){
        lines.push(current);
        current = '';
      }
      current += char;
    });
    if(current) lines.push(current);
    return lines.length ? lines : [source];
  }

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
        const fromPos = getNodePosition(n.id);
        const depPos = getNodePosition(depId);
        if(!dep || !fromPos || !depPos) return;
        const dx = fromPos.x - depPos.x, dy = fromPos.y - depPos.y;
        const dist = Math.max(1, Math.hypot(dx, dy));
        const ux = dx/dist, uy = dy/dist;
        const x1 = depPos.x + ux*(NODE_RADIUS + 2), y1 = depPos.y + uy*(NODE_RADIUS + 2);
        const x2 = fromPos.x - ux*(NODE_RADIUS + ARROW_OFFSET), y2 = fromPos.y - uy*(NODE_RADIUS + ARROW_OFFSET);
        const mx = (x1+x2)/2, my = (y1+y2)/2;
        const d = `M ${x1} ${y1} Q ${mx} ${my}, ${x2} ${y2}`;

        const isSelected = Boolean((selectedEdge && selectedEdge.fromId===n.id && selectedEdge.groupIndex===gi && selectedEdge.depId===depId) || selectedEdgeIds.some(item=> item.fromId===n.id && item.groupIndex===gi && item.depId===depId));

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
        hit.addEventListener('click', (e)=>{ e.stopPropagation(); selectEdge(n.id, gi, depId, e); });
        edgeLayer.appendChild(hit);
      });
    });
  });
  root.appendChild(edgeLayer);

  const nodeLayer = document.createElementNS('http://www.w3.org/2000/svg','g');
  data.nodes.forEach(n=>{
    const pos = getNodePosition(n.id);
    if(!pos) return;
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
      ring.setAttribute('cx', pos.x); ring.setAttribute('cy', pos.y); ring.setAttribute('r', NODE_RADIUS+7);
      g.appendChild(ring);
    }

    const halo = document.createElementNS('http://www.w3.org/2000/svg','circle');
    halo.setAttribute('class','halo');
    halo.setAttribute('cx', pos.x); halo.setAttribute('cy', pos.y); halo.setAttribute('r', NODE_RADIUS+5);
    halo.setAttribute('fill','none');
    halo.setAttribute('stroke','var(--text)');
    halo.setAttribute('stroke-width','1');
    g.appendChild(halo);

    const circle = document.createElementNS('http://www.w3.org/2000/svg','circle');
    circle.setAttribute('class','node-circle');
    circle.setAttribute('cx', pos.x); circle.setAttribute('cy', pos.y); circle.setAttribute('r', NODE_RADIUS);
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
      cross1.setAttribute('x1', pos.x - 10); cross1.setAttribute('y1', pos.y - 10);
      cross1.setAttribute('x2', pos.x + 10); cross1.setAttribute('y2', pos.y + 10);
      g.appendChild(cross1);

      const cross2 = document.createElementNS('http://www.w3.org/2000/svg','line');
      cross2.setAttribute('class','node-cross');
      cross2.setAttribute('x1', pos.x - 10); cross2.setAttribute('y1', pos.y + 10);
      cross2.setAttribute('x2', pos.x + 10); cross2.setAttribute('y2', pos.y - 10);
      g.appendChild(cross2);
    }

    const title = document.createElementNS('http://www.w3.org/2000/svg','title');
    title.textContent = `${n.label}(${STATUS_LABEL[n.status]||n.status})`;
    g.appendChild(title);

    const showLabel = showAllLabels
      ? true
      : ((n.status === 'avoid' || n.status === 'problem')
        ? ((selectedIds && selectedIds.includes(n.id)) || (litSet && litSet.has(n.id)))
        : (n.isGoal || n.status === 'wip' || (litSet && litSet.has(n.id))));
    if(showLabel){
      const labelGroup = document.createElementNS('http://www.w3.org/2000/svg','g');
      labelGroup.setAttribute('class','node-label-group');
      labelGroup.setAttribute('data-anchor-x', pos.x);
      labelGroup.setAttribute('data-anchor-y', pos.y);

      const label = document.createElementNS('http://www.w3.org/2000/svg','text');
      label.setAttribute('class','node-label');
      label.setAttribute('x', pos.x); label.setAttribute('y', pos.y + NODE_RADIUS + 20);
      const lines = wrapLabel(n.label);
      lines.forEach((line, idx)=>{
        const tspan = document.createElementNS('http://www.w3.org/2000/svg','tspan');
        tspan.setAttribute('x', pos.x);
        tspan.setAttribute('dy', idx === 0 ? 0 : 1.15 + 'em');
        tspan.textContent = line;
        label.appendChild(tspan);
      });
      labelGroup.appendChild(label);

      const sub = document.createElementNS('http://www.w3.org/2000/svg','text');
      sub.setAttribute('class','node-sub');
      sub.setAttribute('x', pos.x); sub.setAttribute('y', pos.y + NODE_RADIUS + 33);
      sub.textContent = STATUS_LABEL[n.status] || n.status;
      labelGroup.appendChild(sub);
      g.appendChild(labelGroup);
    }

    g.addEventListener('mousedown', (e)=>{
      e.stopPropagation();
      if(e.shiftKey){
        connecting = { fromId: n.id, x: pos.x, y: pos.y };
        connectMouse = { x: pos.x, y: pos.y };
      } else {
        draggingNodeId = n.id;
        dragStartLocal = screenToLocal(e.clientX, e.clientY);
        dragNodeIds = (selectedIds && selectedIds.includes(n.id) && selectedIds.length > 1)
          ? selectedIds.slice()
          : [n.id];
        dragOriginPositions = {};
        dragNodeIds.forEach(id=>{
          const node = data.nodes.find(x=>x.id===id);
          const pos = getNodePosition(id);
          if(node && pos) dragOriginPositions[id] = { x: pos.x, y: pos.y };
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
  const wasEdgeSelectionMode = edgeMoveTargetSelectMode;
  if(!wasEdgeSelectionMode){
    selectedEdge = null;
    selectedEdgeIds = [];
  }
  if(e && e.shiftKey){
    if(!selectedIds) selectedIds = [];
    const idx = selectedIds.indexOf(id);
    if(idx === -1) selectedIds.push(id);
    else selectedIds.splice(idx,1);
  } else {
    selectedIds = [id];
  }
  selectedId = selectedIds[0] || null;
  if(wasEdgeSelectionMode){
    edgeMoveTargetValue = id;
    edgeMoveTargetSelectMode = false;
    edgeMoveTargetSelectSide = null;
  }
  render();
  renderPanel();
}

function selectEdge(fromId, groupIndex, depId, e){
  selectedIds = []; selectedId = null;
  const edge = { fromId, groupIndex, depId };
  if(e && e.shiftKey){
    const exists = selectedEdgeIds.some(item=> item.fromId===edge.fromId && item.groupIndex===edge.groupIndex && item.depId===edge.depId);
    if(exists){
      selectedEdgeIds = selectedEdgeIds.filter(item=> !(item.fromId===edge.fromId && item.groupIndex===edge.groupIndex && item.depId===edge.depId));
    } else {
      selectedEdgeIds.push(edge);
    }
    selectedEdge = null;
  } else {
    selectedEdgeIds = [edge];
    selectedEdge = edge;
  }
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
  const id = generateNodeId(data.nodes.map(n=>n.id));
  const newNode = { id, label:'新規ノード', status:'locked', requires:[] };
  data.nodes.push(newNode);
  setNodePosition(id, x, y);
  selectedEdge = null;
  selectedEdgeIds = [];
  selectedIds = [id]; selectedId = id;
  saveData();
  render(); renderPanel();
}

function showMergeNodeDialog(sourceId, targetId){
  const sourceNode = data.nodes.find(x=>x.id===sourceId);
  const targetNode = data.nodes.find(x=>x.id===targetId);
  if(!sourceNode || !targetNode || sourceId === targetId) return;

  const overlay = document.createElement('div');
  overlay.style.position = 'fixed';
  overlay.style.inset = '0';
  overlay.style.background = 'rgba(0,0,0,0.5)';
  overlay.style.display = 'flex';
  overlay.style.alignItems = 'center';
  overlay.style.justifyContent = 'center';
  overlay.style.zIndex = '1000';

  const dialog = document.createElement('div');
  dialog.style.width = '420px';
  dialog.style.maxWidth = '90vw';
  dialog.style.background = '#2A2521';
  dialog.style.border = '1px solid #3A332C';
  dialog.style.borderRadius = '10px';
  dialog.style.padding = '16px';
  dialog.style.color = '#EDE6DB';

  dialog.innerHTML = `
    <div style="font-size:14px; font-weight:600; margin-bottom:8px;">ノードを結合しますか？</div>
    <div style="font-size:12px; line-height:1.6; color:var(--text-dim); margin-bottom:10px;">「${escapeHtml(sourceNode.label)}」のエッジを「${escapeHtml(targetNode.label)}」へ引き継ぎ、元のノードは削除します。</div>
    <div class="field-label">新しいラベル</div>
    <input id="merge-label-input" type="text" value="${escapeHtml(targetNode.label)}" style="width:100%; background:#1B1713; color:#EDE6DB; border:1px solid #3A332C; border-radius:6px; padding:8px 10px; font-size:13px;">
    <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:12px;">
      <button class="btn" id="merge-cancel-btn">キャンセル</button>
      <button class="btn" id="merge-confirm-btn" style="color:var(--goal-ring); border-color:var(--goal-ring);">結合する</button>
    </div>
  `;

  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  overlay.querySelector('#merge-cancel-btn').addEventListener('click', ()=> overlay.remove());
  overlay.querySelector('#merge-confirm-btn').addEventListener('click', ()=>{
    const nextLabel = overlay.querySelector('#merge-label-input').value.trim();
    mergeNodes(sourceId, targetId, nextLabel || targetNode.label);
    overlay.remove();
  });
}

function mergeNodes(sourceId, targetId, newLabel){
  const sourceNode = data.nodes.find(x=>x.id===sourceId);
  const targetNode = data.nodes.find(x=>x.id===targetId);
  if(!sourceNode || !targetNode || sourceId === targetId) return;

  if(newLabel && String(newLabel).trim()) targetNode.label = String(newLabel).trim();

  const sourceRequires = Array.isArray(sourceNode.requires) ? sourceNode.requires : [];
  if(sourceRequires.length){
    targetNode.requires = targetNode.requires || [];
    targetNode.requires.push(...sourceRequires.map(group => group.slice()));
  }

  data.nodes.forEach(node=>{
    if(node.id === sourceId || node.id === targetId) return;
    node.requires = (node.requires || []).map(group => group.map(depId => depId === sourceId ? targetId : depId));
    node.requires = node.requires.filter(group => group.length > 0);
  });

  data.nodes = data.nodes.filter(node => node.id !== sourceId);
  delete data.node_positions[sourceId];

  selectedIds = selectedIds.filter(id => id !== sourceId);
  selectedIds = selectedIds.includes(targetId) ? selectedIds : [...selectedIds, targetId];
  selectedId = targetId;
  selectedEdge = null;
  selectedEdgeIds = [];
  saveData();
  render();
  renderPanel();
}

function resolveNodeReference(value){
  const trimmed = String(value || '').trim();
  if(!trimmed) return null;
  const direct = data.nodes.find(node => node.id === trimmed);
  if(direct) return direct;
  const byLabel = data.nodes.find(node => node.label === trimmed);
  if(byLabel) return byLabel;
  const contains = data.nodes.find(node => node.label.includes(trimmed));
  return contains || null;
}

function moveSelectedEdges(side, targetNodeId){
  const targetNode = data.nodes.find(node => node.id === targetNodeId);
  if(!targetNode) return;

  selectedEdgeIds.forEach(edge=>{
    const sourceNode = data.nodes.find(node => node.id === edge.fromId);
    if(!sourceNode) return;
    if(!sourceNode.requires || !sourceNode.requires[edge.groupIndex]) return;

    if(side === 'dep'){
      sourceNode.requires[edge.groupIndex] = sourceNode.requires[edge.groupIndex]
        .map(depId => depId === edge.depId ? targetNodeId : depId)
        .filter(Boolean);
      sourceNode.requires = sourceNode.requires.filter(group => group.length > 0);
      return;
    }

    const depId = edge.depId;
    const exists = targetNode.requires && targetNode.requires.some(group => group.includes(depId));
    if(!exists){
      targetNode.requires = targetNode.requires || [];
      targetNode.requires.push([depId]);
    }
    sourceNode.requires[edge.groupIndex] = sourceNode.requires[edge.groupIndex].filter(depIdValue => depIdValue !== depId);
    sourceNode.requires = sourceNode.requires.filter(group => group.length > 0);
  });

  selectedEdge = null;
  selectedEdgeIds = [];
  saveData();
  render();
  renderPanel();
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
  if(selectedEdgeIds.length > 1){
    const reqs = [...new Set(selectedEdgeIds.map(e=>e.depId).filter(Boolean))];
    const targets = [...new Set(selectedEdgeIds.map(e=>e.fromId).filter(Boolean))];
    const showAmbiguityError = reqs.length > 1 && targets.length > 1;
    const moveSide = reqs.length === 1 ? 'dep' : (targets.length === 1 ? 'from' : null);
    const moveTargetNode = moveSide === 'dep' ? data.nodes.find(node => node.id === reqs[0]) : data.nodes.find(node => node.id === targets[0]);
    const moveLabel = moveSide === 'dep' ? '前提を移動' : '向き先を移動';
    setPanelContent(`
      <div><h2>関係（複数選択）</h2></div>
      ${showAmbiguityError ? '<div style="margin-top:6px; color:var(--danger); font-size:12px; line-height:1.6;">前提・向き先がどちらも1つにまとまっていません。</div>' : ''}
      <div style="margin-top:8px;">
        <div class="field-label">前提</div>
        <div class="req-list">${reqs.map(id=>{
          const node = data.nodes.find(x=>x.id===id);
          return `<div class="req-item"><span class="dot" style="border-color:var(${STATUS_COLOR_VAR[node?.status || 'locked']})"></span>${escapeHtml(node?.label || id)}</div>`;
        }).join('')}</div>
      </div>
      <div style="margin-top:8px;">
        <div class="field-label">向き先</div>
        <div class="unlocks-list">${targets.map(id=>{
          const node = data.nodes.find(x=>x.id===id);
          return `<div>→ ${escapeHtml(node?.label || id)}</div>`;
        }).join('')}</div>
      </div>
      ${moveSide ? `<div style="margin-top:10px;">
        <div class="field-label">${moveLabel}</div>
        <div style="display:flex; gap:6px; align-items:center;">
          <input type="text" id="edge-move-input" value="${escapeHtml(edgeMoveTargetValue)}" placeholder="ノードID / ラベル" style="flex:0 0 50%; width:50%; background:#1B1713; color:#EDE6DB; border:1px solid #3A332C; border-radius:6px; padding:8px 10px; font-size:13px;">
          <button class="btn" id="edge-move-btn" style="flex:0 0 auto; color:${edgeMoveTargetSelectMode && edgeMoveTargetSelectSide === moveSide ? 'var(--text)' : 'var(--goal-ring)'}; border-color:${edgeMoveTargetSelectMode && edgeMoveTargetSelectSide === moveSide ? 'var(--text)' : 'var(--goal-ring)'};">移動先選択</button>
        </div>
        <div style="margin-top:6px; font-size:11px; color:var(--text-faint);">ノードを選択すると ID が入ります。</div>
      </div>` : ''}
      <div style="margin-top:10px; display:flex; gap:8px; flex-wrap:wrap;">
        <button class="btn" id="edge-move-exec-btn" style="color:var(--goal-ring); border-color:var(--goal-ring);">移動</button>
        <button class="btn" id="delete-edge-btn" style="color:var(--danger); border-color:var(--danger);">選択した関係を削除</button>
      </div>
    `);
    document.getElementById('delete-edge-btn').addEventListener('click', ()=>{
      selectedEdgeIds.forEach(edge=> deleteEdge(edge.fromId, edge.groupIndex, edge.depId));
      selectedEdgeIds = [];
      selectedEdge = null;
      render(); renderPanel();
    });
    const moveExecBtn = document.getElementById('edge-move-exec-btn');
    if(moveExecBtn){
      moveExecBtn.addEventListener('click', ()=>{
        const input = document.getElementById('edge-move-input');
        const targetNode = resolveNodeReference(input ? input.value : '');
        if(!targetNode){ alert('移動先のノードが見つかりません'); return; }
        if(moveSide === 'dep' && targetNode.id === moveTargetNode?.id){
          alert('同じノードには移動できません'); return;
        }
        if(moveSide === 'from' && targetNode.id === moveTargetNode?.id){
          alert('同じノードには移動できません'); return;
        }
        moveSelectedEdges(moveSide, targetNode.id);
      });
    }
    const moveBtn = document.getElementById('edge-move-btn');
    if(moveBtn){
      moveBtn.addEventListener('click', ()=>{
        if(edgeMoveTargetSelectMode && edgeMoveTargetSelectSide === moveSide){
          edgeMoveTargetSelectMode = false;
          edgeMoveTargetSelectSide = null;
          render();
          renderPanel();
          return;
        }
        edgeMoveTargetSelectMode = true;
        edgeMoveTargetSelectSide = moveSide;
        render();
        renderPanel();
      });
    }
    const moveInput = document.getElementById('edge-move-input');
    if(moveInput){
      moveInput.addEventListener('change', ()=>{
        edgeMoveTargetValue = moveInput.value;
      });
    }
    return;
  }

  const edge = selectedEdge || selectedEdgeIds[0];
  if(!edge){ renderEmptyPanel(); return; }
  const from = data.nodes.find(x=>x.id===edge.fromId);
  const dep = data.nodes.find(x=>x.id===edge.depId);
  setPanelContent(`
    <div><h2>関係</h2></div>
    <div class="req-group">
      <div style="font-size:13px;">${from ? escapeHtml(from.label) : '?'}</div>
      <div style="color:var(--text-faint); font-size:11px; margin:6px 0;">↑ 前提として必要</div>
      <div style="font-size:13px;">${dep ? escapeHtml(dep.label) : '?'}</div>
    </div>
    <button class="btn" id="delete-edge-btn" style="color:var(--danger); border-color:var(--danger);">この関係を削除</button>
  `);
  document.getElementById('delete-edge-btn').addEventListener('click', ()=>{
    deleteEdge(edge.fromId, edge.groupIndex, edge.depId);
    selectedEdge = null;
    selectedEdgeIds = [];
    render(); renderPanel();
  });
}

function buildBulkStatusButtons(selectedNodeIds){
  const selectedNodes = selectedNodeIds.map(id=>data.nodes.find(x=>x.id===id)).filter(Boolean);
  const commonStatus = selectedNodes.length && selectedNodes.every(n=>n.status===selectedNodes[0].status)
    ? selectedNodes[0].status
    : null;
  return STATUS_ORDER.map(s=>{
    const active = commonStatus && s===commonStatus ? 'active' : '';
    return `<button class="status-btn ${active}" data-status="${s}">
      <span class="dot" style="border-color:var(${STATUS_COLOR_VAR[s]})"></span>${STATUS_LABEL[s]}
    </button>`;
  }).join('');
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
  setPanelContent(`
    <div><h2>選択中: ${selectedIds.length} 件</h2></div>
    <div style="max-height:240px; overflow:auto; margin-top:8px;">${list}</div>
    <div style="margin-top:14px;">
      <div class="field-label">ステータスを一括変更</div>
      <div class="status-grid">${buildBulkStatusButtons(selectedIds)}</div>
    </div>
    <div style="margin-top:14px;">
      <div class="field-label">ゴール指定を一括変更</div>
      <button class="goal-toggle" id="bulk-goal-toggle" type="button">
        ${selectedIds.some(id=>{
          const node = data.nodes.find(x=>x.id===id);
          return node && node.isGoal;
        }) ? '★ 選択中のノードをゴールに指定' : '☆ 選択中のノードをゴールに指定'}
      </button>
    </div>
    <div style="margin-top:10px; display:flex; gap:8px; flex-wrap:wrap;">
      <button class="btn" id="merge-multi-btn" style="color:var(--goal-ring); border-color:var(--goal-ring);">選択を結合</button>
      <button class="btn" id="delete-multi-btn" style="color:var(--danger); border-color:var(--danger);">選択したノードを削除</button>
    </div>
  `);
  panelContent.querySelectorAll('.status-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const status = btn.getAttribute('data-status');
      selectedIds.forEach(id=>{
        const node = data.nodes.find(x=>x.id===id);
        if(node) node.status = status;
      });
      saveData();
      render(); renderPanel();
    });
  });
  const bulkGoalToggle = document.getElementById('bulk-goal-toggle');
  if(bulkGoalToggle){
    bulkGoalToggle.addEventListener('click', ()=>{
      const nextValue = !selectedIds.some(id=>{
        const node = data.nodes.find(x=>x.id===id);
        return node && node.isGoal;
      });
      selectedIds.forEach(id=>{
        const node = data.nodes.find(x=>x.id===id);
        if(node) node.isGoal = nextValue;
      });
      saveData();
      render(); renderPanel();
    });
  }
  const mergeMultiBtn = document.getElementById('merge-multi-btn');
  if(mergeMultiBtn){
    mergeMultiBtn.addEventListener('click', ()=>{
      if(selectedIds.length < 2){ return; }
      const primaryId = selectedIds[0];
      const targetId = selectedIds[1];
      showMergeNodeDialog(primaryId, targetId);
    });
  }
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
  setPanelContent(`<div class="empty">
    <br />
    <br />
    ノードをクリックすると詳細が表示されます。<br><br>
    ・空白をクリック → ノード作成<br>
    ・ノードをドラッグ → 移動<br>
    ・Shift+ドラッグ → 別ノードへ関係作成<br>
    ・選択してDelete → 削除<br>
    ・Escape → 選択解除
  </div>`);
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
  setPanelContent(`
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
  `);
  bindNodePanelEvents(node);
}

// パネル描画入口
function renderPanel(){
  if(selectedEdge || selectedEdgeIds.length){
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
    setPanelContent('');
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
        const origin = dragOriginPositions[id] || { x: getNodePosition(id).x, y: getNodePosition(id).y };
        setNodePosition(id, origin.x + dx, origin.y + dy);
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
      const pos = getNodePosition(n.id);
      if(!pos || pos.x===undefined || pos.y===undefined) return;
      if(pos.x >= minx && pos.x <= maxx && pos.y >= miny && pos.y <= maxy){
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
      const shouldCreate = e.metaKey || e.ctrlKey;
      if(shouldCreate) createNodeAt(p.x, p.y);
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
      if(targetId) addRequirement(targetId, connecting.fromId);
    }
    connecting = null;
    scheduleRender();
  }
});

graphWrap.addEventListener('wheel', (e)=>{
  e.preventDefault();
  const delta = e.deltaY > 0 ? -0.08 : 0.08;
  const before = screenToLocal(e.clientX, e.clientY);
  const nextZoom = Math.min(2.2, Math.max(0.35, zoom + delta));
  pan.x += (zoom - nextZoom) * before.x;
  pan.y += (zoom - nextZoom) * before.y;
  zoom = nextZoom;
  updateTransform();
}, { passive:false });

graphWrap.addEventListener('click', (e)=>{
  if(e.target.closest && e.target.closest('.node')) return;
  if(e.shiftKey) return;
  if(e.metaKey || e.ctrlKey) return;
  if(edgeMoveTargetSelectMode){
    render();
    renderPanel();
    return;
  }
  selectedIds = [];
  selectedId = null;
  selectedEdge = null;
  selectedEdgeIds = [];
  render(); renderPanel();
});

document.addEventListener('keydown', (e)=>{
  const tag = (e.target && e.target.tagName) || '';
  if(tag === 'INPUT' || tag === 'TEXTAREA') return;
  if(e.key === 'Escape'){
    if(edgeMoveTargetSelectMode){
      edgeMoveTargetSelectMode = false;
      edgeMoveTargetSelectSide = null;
      render(); renderPanel();
      return;
    }
    selectedIds = []; selectedId = null; selectedEdge = null; selectedEdgeIds = []; connecting = null;
    render(); renderPanel();
  } else if(e.key === 'Delete' || e.key === 'Backspace'){
    if(selectedIds && selectedIds.length){
      e.preventDefault();
      if(!confirm(`選択中の ${selectedIds.length} 件を削除しますか?`)) return;
      const toDelete = selectedIds.slice();
      toDelete.forEach(id=> deleteNode(id));
      selectedIds = []; selectedId = null;
      render(); renderPanel();
    } else if(selectedEdge || selectedEdgeIds.length){
      e.preventDefault();
      const edges = selectedEdgeIds.length ? selectedEdgeIds : [selectedEdge];
      edges.filter(Boolean).forEach(edge=> deleteEdge(edge.fromId, edge.groupIndex, edge.depId));
      selectedEdge = null;
      selectedEdgeIds = [];
      render(); renderPanel();
    }
  }
});

document.getElementById('btn-reset').addEventListener('click', async ()=>{
  if(!confirm('例のデータにリセットします。よろしいですか?')) return;
  data = migrateDataShape(JSON.parse(JSON.stringify(DEFAULT_DATA)));
  autoLayoutPositions(false);
  selectedIds = []; selectedId = null; selectedEdge = null; selectedEdgeIds = [];
  saveData();
  render(); renderPanel();
});

// 配置を再計算　の処理はいけてないので、非活性化
// document.getElementById('btn-recompute').addEventListener('click', ()=>{
//   autoLayoutPositions(true);
//   saveData();
//   render(); renderPanel();
// });

document.getElementById('btn-export').addEventListener('click', ()=>{
  saveExportName();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const ts = new Date().toISOString().slice(0,10);
  const baseName = normalizeExportName(exportName);
  a.href = url;
  a.download = `${baseName}-${ts}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

const fileInput = document.getElementById('file-input');
document.getElementById('btn-import').addEventListener('click', ()=> fileInput.click());
if(exportNameInput){
  exportNameInput.addEventListener('input', ()=>{
    saveExportName();
  });
}

fileInput.addEventListener('change', (e)=>{
  const file = e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = ()=>{
    try{
      const parsed = JSON.parse(reader.result);
      if(!parsed.nodes || !Array.isArray(parsed.nodes)) throw new Error('nodes 配列が必要です');
      data = migrateDataShape(parsed);
      autoLayoutPositions(false);
      selectedIds = []; selectedId = null; selectedEdge = null; selectedEdgeIds = [];
      exportName = normalizeExportName(file.name.replace(/\.json$/i, ''));
      if(exportNameInput){ exportNameInput.value = exportName; }
      saveExportName();
      saveData();
      render(); renderPanel();
    }catch(err){
      alert('読み込みエラー: ' + err.message);
    }
  };
  reader.readAsText(file);
  fileInput.value = '';
});

document.getElementById('btn-toggle-labels').addEventListener('click', toggleLabelMode);

document.getElementById('btn-edit').addEventListener('click', ()=>{
  selectedIds = []; selectedId = null; selectedEdge = null; selectedEdgeIds = [];
  render();
  setPanelContent(`
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
  `);
  document.getElementById('apply-json').addEventListener('click', ()=>{
    const msg = document.getElementById('json-msg');
    try{
      const parsed = JSON.parse(document.getElementById('json-editor').value);
      if(!parsed.nodes || !Array.isArray(parsed.nodes)) throw new Error('nodes 配列が必要です');
      data = migrateDataShape(parsed);
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
  await loadExportName();
  await loadLabelMode();
  autoLayoutPositions(false);
  render();
  renderPanel();
})();

})();
