/* ============================================================
   MAHATHIR'S LIFE TRACKER — data layer + app
   Single-file, localStorage-backed, no server/database.
   ============================================================ */
const STORE_KEY = "mahathir_tracker_v1";
const todayISO = () => new Date().toISOString().slice(0,10);
const pad = n => String(n).padStart(2,"0");
const isoOf = (y,m,d) => `${y}-${pad(m+1)}-${pad(d)}`;
const fmtDate = iso => { const d = new Date(iso+"T00:00:00"); return d.toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short',year:'numeric'}); };
const fmtShort = iso => { const d = new Date(iso+"T00:00:00"); return d.toLocaleDateString('en-GB',{day:'numeric',month:'short'}); };
const dowIndexBD = iso => { // 0=Saturday ... 6=Friday (Bangladesh week)
  const jsDow = new Date(iso+"T00:00:00").getDay(); // 0=Sun..6=Sat
  return (jsDow + 1) % 7; // Sat(6)->0, Sun(0)->1, Mon(1)->2 ... Fri(5)->6
};
const BD_DOW_NAMES = ["Saturday","Sunday","Monday","Tuesday","Wednesday","Thursday","Friday"];

function getWeekParity(iso){
  // ISO week number parity: "even" or "odd" — used to alternate biweekly labs
  const d = new Date(iso+"T00:00:00");
  const target = new Date(d.valueOf());
  const dayNr = (d.getUTCDay()+6)%7;
  target.setUTCDate(target.getUTCDate()-dayNr+3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(),0,4));
  const weekNo = 1 + Math.round(((target-firstThursday)/86400000 - 3 + ((firstThursday.getUTCDay()+6)%7))/7);
  return (weekNo % 2 === 0) ? "even" : "odd";
}
function subjectFrequencyLabel(s){
  if(s.type==="Theory") return "Theory · 3 classes/week";
  const c = Number(s.credit);
  if(c >= 1.5) return `Lab · ${c} cr · weekly`;
  return `Lab · ${c} cr · alternate weeks`;
}
function labOccursOnDate(s, iso){
  if(s.type!=="Lab") return true;
  const c = Number(s.credit);
  if(c >= 1.5) return true; // weekly
  return getWeekParity(iso) === (s.labWeek||"even");
}
// Attendance math (target = 75% unless overridden):
// canMiss: how many more classes you can miss and still be >= target
// needToAttend: consecutive classes you'd need to attend (if currently below target) to reach it
function attendancePrediction(attended, total, target){
  target = target || 0.75;
  if(total <= 0) return {canMiss:0, needToAttend:0, pct:null};
  const pct = attended/total;
  const canMiss = Math.max(0, Math.floor(attended/target - total));
  const needToAttend = pct >= target ? 0 : Math.max(0, Math.ceil((target*total - attended) / (1-target)));
  return {canMiss, needToAttend, pct: pct*100};
}
const uid = () => Math.random().toString(36).slice(2,10);

const DATA_VERSION = 4;
const CT_DEFAULT_COUNT = 4;
const CT_DEFAULT_OUT_OF = 20;
const DEFAULT_TASK_CATEGORIES = ["Lab Report","Assignment","Daily Reading","Academic Study","Personal","Others"];
const MONEY_SOURCES = ["Family","Father","Mother","Salary","Refund","Friend","Other"];
const PERSON_TXN_TYPES = ["I paid for them","They paid for me","I sent them money","They sent me money","Shared expense","Other"];
const COURSE_STATUSES = ["Not Started","In Progress","Completed","Paused","Archived"];
const MODULE_STATUSES = ["Not Started","In Progress","Completed"];
const RESEARCH_STATUSES = ["Idea","Literature Review","Planning","Implementation","Experiment","Analysis","Writing","Submitted","Published","Archived"];
const PAPER_STATUSES = ["Unread","Reading","Read","Important","Referenced"];

function defaultState(){
  return {
    dataVersion: DATA_VERSION,
    habitsList: [
      {id:"h1",name:"Fajr walk / exercise"},
      {id:"h2",name:"Read Qur'an"},
      {id:"h3",name:"DSA practice (1 problem)"},
      {id:"h4",name:"Study — CSE"},
      {id:"h5",name:"Study — Electrical"},
      {id:"h6",name:"Gym / workout"},
      {id:"h7",name:"No social media before noon"},
      {id:"h8",name:"Reading (non-academic)"},
      {id:"h9",name:"Sleep before 11 PM"},
      {id:"h10",name:"Journal / plan tomorrow"}
    ],
    funds: [
      {name:"Food", startingBalance:0}, {name:"Transport", startingBalance:0},
      {name:"Books & Study", startingBalance:0}, {name:"Savings", startingBalance:0},
      {name:"Family", startingBalance:0}, {name:"Personal", startingBalance:0}, {name:"Emergency", startingBalance:0}
    ],
    moneyIn: [], // {id, amount, date, source, category, destinationFund, note}
    people: [], // {id, name}
    personTransactions: [], // {id, personId, direction:"i_gave"|"they_gave", type, amount, date, note}
    courses: [], // {id, name, platform, instructor, url, startDate, targetDate, status, notes, manualProgress:null, modules:[]}
    research: {
      projects: [], // {id,title,area,question,problem,abstract,keywords,supervisor,collaborators,status,progress,startDate,deadline,lastUpdated,notesUrl,githubUrl,datasetUrl}
      papers: []    // {id,title,authors,year,journal,url,pdfUrl,area,status,findings,notes,rating,tags}
    },
    settings: { theme:"light", animations:true },
    taskCategories: DEFAULT_TASK_CATEGORIES.slice(),
    ctBestN: 3,
    trash: [], // {id, text, category, priority, description, notes, url, deadline, originalDate, deletedDate}
    subjects: [
      {id:"s1", name:"DSA (ECE2104)", code:"ECE2104", type:"Theory", credit:3, labWeek:"even", manualAttendance:null},
      {id:"s2", name:"Analog Electronics", code:"EEE-2xx", type:"Theory", credit:3, labWeek:"even", manualAttendance:null},
      {id:"s3", name:"Vector Analysis & Linear Algebra", code:"MATH2117", type:"Theory", credit:3, labWeek:"even", manualAttendance:null}
    ],
    routine: { // dowIndex(0=Sat..6=Fri) -> [{time, subjectId, label}]
      0:[],1:[],2:[],3:[],4:[],5:[],6:[]
    },
    ctMarks: [], // {id, subjectId, ctNo, marks, outOf, date, topic, note}
    reading: [
      {id:uid(), title:"Introduction to Algorithms (CLRS)", type:"Book", totalPages:1200, pagesRead:300, startDate:todayISO(), targetDate:"", status:"In Progress", notes:"", url:"", category:""}
    ],
    dev: {
      papers:[{id:uid(), title:"PitchCode — auction engine design", journal:"IEEE Access (target)", progress:35, status:"Writing", deadline:"", subtasks:[]}],
      cse:[{id:uid(), title:"PitchCode full-stack app", category:"Web Dev / DSA", progress:90, status:"Testing", notes:"Team lead, 40% contribution", subtasks:[]}],
      eee:[{id:uid(), title:"555 Timer circuit mastery", category:"Analog Electronics", progress:60, status:"Building", notes:"Focus for exam prep", subtasks:[]}]
    },
    days: {} // "YYYY-MM-DD" -> { prayers:{}, habits:{}, tasks:[], attendance:{}, journal:"", expenses:[], concept:null }
  };
}

let STATE = null;

function loadState(){
  try{
    const raw = localStorage.getItem(STORE_KEY);
    if(!raw){ STATE = defaultState(); saveState(); return; }
    STATE = JSON.parse(raw);
    const fromVersion = STATE.dataVersion || 1; // capture BEFORE backfill can mask it
    // backfill any new top-level fields for users on older saves
    const d = defaultState();
    for(const k in d){ if(!(k in STATE)) STATE[k] = d[k]; }
    migrateState(fromVersion);
    normalizeState();
  }catch(e){
    console.error("Failed to load state, resetting.", e);
    STATE = defaultState();
  }
}

// Versioned migration — never destroys existing data, only adds fields the
// new version needs. Add a new migrateVxToVy() block here whenever
// DATA_VERSION bumps, and never remove the ones before it.
function migrateState(fromVersion){
  if(fromVersion < 2){
    migrateV1ToV2();
  }
  if(fromVersion < 3){
    migrateV2ToV3();
  }
  if(fromVersion < 4){
    migrateV3ToV4();
  }
  STATE.dataVersion = DATA_VERSION;
}
function migrateV1ToV2(){
  if(!STATE.taskCategories) STATE.taskCategories = DEFAULT_TASK_CATEGORIES.slice();
  if(STATE.ctBestN===undefined) STATE.ctBestN = 3;
  if(!STATE.trash) STATE.trash = [];
  (STATE.subjects||[]).forEach(s=>{ if(s.manualAttendance===undefined) s.manualAttendance = null; });
  Object.values(STATE.days||{}).forEach(day=>{
    if(day.concept===undefined) day.concept = null;
    (day.tasks||[]).forEach(t=>{
      if(t.category===undefined) t.category = "Others";
      if(t.description===undefined) t.description = "";
      if(t.notes===undefined) t.notes = "";
      if(t.url===undefined) t.url = "";
      if(t.deadline===undefined) t.deadline = "";
    });
  });
}
function migrateV2ToV3(){
  // funds used to be a plain string array — upgrade to {name, startingBalance} objects
  if(Array.isArray(STATE.funds) && STATE.funds.length && typeof STATE.funds[0] === "string"){
    STATE.funds = STATE.funds.map(name=>({name, startingBalance:0}));
  }
  if(!STATE.moneyIn) STATE.moneyIn = [];
  if(!STATE.people) STATE.people = [];
  if(!STATE.personTransactions) STATE.personTransactions = [];
  if(!STATE.courses) STATE.courses = [];
  if(!STATE.research) STATE.research = {projects:[], papers:[]};
  if(STATE.research && !STATE.research.projects) STATE.research.projects = [];
  if(STATE.research && !STATE.research.papers) STATE.research.papers = [];
  (STATE.reading||[]).forEach(b=>{
    if(b.notes===undefined) b.notes = "";
    if(b.url===undefined) b.url = "";
    if(b.category===undefined) b.category = "";
  });
}
function migrateV3ToV4(){
  if(!STATE.settings) STATE.settings = {theme:"light", animations:true};
  // attendance manual entry gained a countingMode ("held" vs "total")
  (STATE.subjects||[]).forEach(s2=>{
    if(s2.manualAttendance && !s2.manualAttendance.countingMode) s2.manualAttendance.countingMode = "total";
  });
  // tasks gained a partial-progress percentage
  Object.values(STATE.days||{}).forEach(day=>{
    (day.tasks||[]).forEach(t=>{ if(t.progress===undefined) t.progress = t.done ? 100 : 0; });
  });
  // ct marks gained outOf default of 20 and are keyed per theory subject
  (STATE.ctMarks||[]).forEach(c=>{ if(!c.outOf) c.outOf = CT_DEFAULT_OUT_OF; });
  // existing theory subjects now get their automatic CT slots (without
  // touching any marks already entered), and labs lose stray CT rows
  (STATE.subjects||[]).forEach(s2=>{
    if(s2.type === "Theory") seedCtSlots(s2.id);
  });
}
function normalizeState(){
  if(!STATE.settings) STATE.settings = {theme:"light", animations:true};
  if(!STATE.settings.theme) STATE.settings.theme = "light";
  (STATE.subjects||[]).forEach(s=>{
    if(!s.type) s.type = "Theory";
    if(s.credit===undefined || s.credit===null) s.credit = 3;
    if(!s.labWeek) s.labWeek = "even";
    if(s.manualAttendance===undefined) s.manualAttendance = null;
  });
  if(!STATE.ctMarks) STATE.ctMarks = [];
  if(!STATE.taskCategories) STATE.taskCategories = DEFAULT_TASK_CATEGORIES.slice();
  if(STATE.ctBestN===undefined) STATE.ctBestN = 3;
  if(!STATE.trash) STATE.trash = [];
  if(!STATE.moneyIn) STATE.moneyIn = [];
  if(!STATE.people) STATE.people = [];
  if(!STATE.personTransactions) STATE.personTransactions = [];
  if(!STATE.courses) STATE.courses = [];
  if(!STATE.research) STATE.research = {projects:[], papers:[]};
  (STATE.funds||[]).forEach(f=>{ if(typeof f.startingBalance !== "number") f.startingBalance = 0; });
  (STATE.courses||[]).forEach(c=>{ if(!c.modules) c.modules = []; if(c.manualProgress===undefined) c.manualProgress = null; });
  ["papers","cse","eee"].forEach(k=>{
    (STATE.dev[k]||[]).forEach(it=>{ if(!it.subtasks) it.subtasks = []; });
  });
  Object.values(STATE.days||{}).forEach(day=>{
    (day.tasks||[]).forEach(t=>{ if(t.progress===undefined) t.progress = t.done ? 100 : 0; });
  });
  (STATE.ctMarks||[]).forEach(c=>{ if(!c.outOf) c.outOf = CT_DEFAULT_OUT_OF; });
}
function saveState(){
  if(!STATE._meta) STATE._meta = {};
  STATE._meta.updatedAt = Date.now();
  localStorage.setItem(STORE_KEY, JSON.stringify(STATE));
  scheduleAutoSync();
}
function getDay(iso){
  if(!STATE.days[iso]) STATE.days[iso] = { prayers:{}, habits:{}, tasks:[], attendance:{}, journal:"", expenses:[], concept:null };
  const day = STATE.days[iso];
  if(!day.prayers) day.prayers = {};
  if(!day.habits) day.habits = {};
  if(!day.tasks) day.tasks = [];
  if(!day.attendance) day.attendance = {};
  if(!day.expenses) day.expenses = [];
  if(day.journal === undefined) day.journal = "";
  if(day.concept === undefined) day.concept = null;
  return day;
}

const GIST_TOKEN_KEY = "mahathir_tracker_gist_token";
const GIST_ID_KEY = "mahathir_tracker_gist_id";
const GIST_FILENAME = "mahathir-tracker-data.json";
let SYNC_BUSY = false;
let SYNC_TIMER = null;
let LAST_SYNC_MSG = "";

loadState();

/* ============================================================
   CLOUD SYNC — GitHub Gist (a plain text file on your own
   GitHub account acting as shared storage; not a database)
   ============================================================ */

function getGistToken(){ return localStorage.getItem(GIST_TOKEN_KEY) || ""; }
function getGistId(){ return localStorage.getItem(GIST_ID_KEY) || ""; }
function setGistToken(t){ localStorage.setItem(GIST_TOKEN_KEY, t); }
function setGistId(id){ localStorage.setItem(GIST_ID_KEY, id); }
function gistConfigured(){ return !!(getGistToken() && getGistId()); }

function setSyncStatus(msg){
  LAST_SYNC_MSG = msg;
  const el = document.getElementById("syncStatusText");
  if(el) el.textContent = msg;
}

async function ghFetch(url, options={}){
  const token = getGistToken();
  const headers = Object.assign({
    "Authorization": "token " + token,
    "Accept": "application/vnd.github+json"
  }, options.headers||{});
  const res = await fetch(url, Object.assign({}, options, {headers}));
  if(!res.ok){
    const body = await res.text().catch(()=> "");
    throw new Error(`GitHub API ${res.status}: ${body.slice(0,200)}`);
  }
  return res.json();
}

async function createGistForSync(){
  const token = document.getElementById("gistTokenInput").value.trim();
  if(!token){ setSyncStatus("Paste your GitHub token first."); return; }
  setGistToken(token);
  setSyncStatus("Creating your private Gist…");
  try{
    const data = await ghFetch("https://api.github.com/gists", {
      method:"POST",
      body: JSON.stringify({
        description: "Mahathir's Life Tracker — data store (do not edit manually)",
        public: false,
        files: { [GIST_FILENAME]: { content: JSON.stringify(STATE) } }
      })
    });
    setGistId(data.id);
    setSyncStatus("Created! Synced just now.");
    render();
  }catch(e){
    setSyncStatus("Couldn't create Gist: " + e.message);
  }
}

// Pull helper that can target an explicit id/token pair without relying on
// what's already saved — used to safety-check a connection before committing
// to it or auto-pushing anything.
async function pullFromGistRaw(token, id){
  const res = await fetch(`https://api.github.com/gists/${id}`, {
    headers:{ "Authorization":"token "+token, "Accept":"application/vnd.github+json" }
  });
  if(!res.ok){
    const body = await res.text().catch(()=> "");
    throw new Error(`GitHub API ${res.status}: ${body.slice(0,200)}`);
  }
  const data = await res.json();
  const file = data.files && data.files[GIST_FILENAME];
  if(!file || !file.content) return undefined; // gist exists but has no tracker data yet
  try{ return JSON.parse(file.content); }catch(e){ throw new Error("The data in that Gist isn't valid — wrong Gist ID?"); }
}
async function pullFromGist(){
  const token = getGistToken(), id = getGistId();
  if(!token || !id) return null;
  return (await pullFromGistRaw(token, id)) ?? null;
}

async function pushToGist(){
  const token = getGistToken(), id = getGistId();
  if(!token || !id) return;
  await ghFetch(`https://api.github.com/gists/${id}`, {
    method:"PATCH",
    body: JSON.stringify({ files: { [GIST_FILENAME]: { content: JSON.stringify(STATE) } } })
  });
}

function scheduleAutoSync(){
  if(!gistConfigured()) return;
  if(SYNC_TIMER) clearTimeout(SYNC_TIMER);
  SYNC_TIMER = setTimeout(async ()=>{
    try{
      setSyncStatus("Syncing…");
      await pushToGist();
      setSyncStatus("Synced " + new Date().toLocaleTimeString());
    }catch(e){
      setSyncStatus("Sync failed: " + e.message);
    }
  }, 2500);
}

// "Sync Now" on an already-connected device. Safe by construction: it only
// ever pushes when a pull genuinely succeeded and local is at least as new —
// a failed/ambiguous pull always aborts instead of falling through to a push,
// so a network hiccup can never overwrite your real cloud data with a blank state.
async function syncNowManual(){
  if(!gistConfigured()){ setSyncStatus("Set up your token and Gist first."); return; }
  if(SYNC_BUSY) return;
  SYNC_BUSY = true;
  setSyncStatus("Syncing…");
  try{
    const token = getGistToken(), id = getGistId();
    const cloud = await pullFromGistRaw(token, id); // undefined = empty gist (ok to seed), throws = real error
    if(cloud === undefined){
      await pushToGist();
      setSyncStatus("Synced " + new Date().toLocaleTimeString());
    } else {
      const cloudTime = cloud._meta ? cloud._meta.updatedAt||0 : 0;
      const localTime = STATE._meta ? STATE._meta.updatedAt||0 : 0;
      if(cloudTime > localTime){
        STATE = cloud;
        localStorage.setItem(STORE_KEY, JSON.stringify(STATE));
        normalizeState();
        setSyncStatus("Pulled newer data from the cloud (" + new Date().toLocaleTimeString() + ")");
        render();
      } else {
        await pushToGist();
        setSyncStatus("Synced " + new Date().toLocaleTimeString());
      }
    }
  }catch(e){
    setSyncStatus("Sync failed: " + e.message + " — nothing was overwritten.");
  }
  SYNC_BUSY = false;
}

async function autoPullOnLoad(){
  if(!gistConfigured()) return;
  try{
    const token = getGistToken(), id = getGistId();
    const cloud = await pullFromGistRaw(token, id);
    if(cloud !== undefined){
      const cloudTime = cloud._meta ? cloud._meta.updatedAt||0 : 0;
      const localTime = STATE._meta ? STATE._meta.updatedAt||0 : 0;
      if(cloudTime > localTime){
        STATE = cloud;
        localStorage.setItem(STORE_KEY, JSON.stringify(STATE));
        normalizeState();
        render();
      }
    }
    setSyncStatus("Synced " + new Date().toLocaleTimeString());
  }catch(e){
    setSyncStatus("Couldn't reach GitHub: " + e.message + " — using your local data for now.");
  }
}

// Connecting to an EXISTING Gist (2nd, 3rd, ... device) is pull-only by
// design: it must never push before it has proven it can fetch the real
// shared data, or a fresh/blank device could silently wipe the cloud copy.
async function connectExistingGist(){
  const token = document.getElementById("gistTokenInput").value.trim();
  const id = document.getElementById("gistIdInput").value.trim();
  if(!token || !id){ setSyncStatus("Enter both the token and the Gist ID."); return; }
  setSyncStatus("Connecting — fetching your existing data…");
  try{
    const cloud = await pullFromGistRaw(token, id);
    if(cloud === undefined){
      setSyncStatus("That Gist doesn't have tracker data in it yet — double-check the Gist ID from your first device's Settings page.");
      return;
    }
    // only now, having confirmed real data exists, do we commit the credentials
    setGistToken(token);
    setGistId(id);
    STATE = cloud;
    localStorage.setItem(STORE_KEY, JSON.stringify(STATE));
    normalizeState();
    setSyncStatus("Connected — pulled your data from the cloud (" + new Date().toLocaleTimeString() + ")");
    render();
  }catch(e){
    setSyncStatus("Couldn't connect: " + e.message + " — your local data was not touched.");
  }
}

function disconnectGist(){
  if(!confirm("Disconnect cloud sync? Your data stays on this device either way.")) return;
  localStorage.removeItem(GIST_TOKEN_KEY);
  localStorage.removeItem(GIST_ID_KEY);
  setSyncStatus("");
  render();
}
function toggleTokenVisibility(){
  const el = document.getElementById("tokenRevealText");
  if(!el) return;
  const hidden = el.dataset.hidden !== "false";
  el.textContent = hidden ? getGistToken() : "•".repeat(Math.min(20, getGistToken().length));
  el.dataset.hidden = hidden ? "false" : "true";
  const btn = document.getElementById("tokenRevealBtn");
  if(btn) btn.textContent = hidden ? "Hide" : "Show";
}
function copyToken(){
  const token = getGistToken();
  navigator.clipboard.writeText(token).then(()=>{
    const btn = document.getElementById("copyTokenBtn");
    if(btn){ const old = btn.textContent; btn.textContent = "Copied ✓"; setTimeout(()=>btn.textContent=old, 1200); }
  }).catch(()=>{
    setSyncStatus("Couldn't copy automatically — long-press the token text to copy it manually.");
  });
}

/* ============================================================
   ROUTER + NAV
   ============================================================ */
const NAV = [
  {group:"Overview", items:[
    {id:"dashboard", label:"Dashboard", ic:"◆"},
    {id:"calendar", label:"Calendar", ic:"▦"},
  ]},
  {group:"Daily Trackers", items:[
    {id:"prayers", label:"Prayers", ic:"☾"},
    {id:"habits", label:"Habits", ic:"✓"},
    {id:"tasks", label:"Tasks", ic:"▤"},
    {id:"trash", label:"Trash", ic:"🗑"},
    {id:"attendance", label:"Attendance", ic:"▣"},
    {id:"ct", label:"CT Marks", ic:"📝"},
    {id:"journal", label:"Journal", ic:"✎"},
  ]},
  {group:"Academic & Growth", items:[
    {id:"reading", label:"Reading", ic:"▥"},
    {id:"routine", label:"Class Routine", ic:"▧"},
    {id:"dev", label:"Dev Progress", ic:"⚙"},
    {id:"courses", label:"Courses", ic:"🎓"},
    {id:"research", label:"Research Hub", ic:"🔬"},
  ]},
  {group:"Finance", items:[
    {id:"expenses", label:"Expenses & Funds", ic:"৳"},
    {id:"finance", label:"Money In & Overview", ic:"📥"},
    {id:"people", label:"People & Money", ic:"👥"},
  ]},
  {group:"Insight", items:[
    {id:"review", label:"Weekly / Monthly", ic:"📊"},
    {id:"reminders", label:"Reminders", ic:"🔔"},
  ]},
  {group:"Tools", items:[
    {id:"importpdf", label:"Import PDF", ic:"⇪"},
    {id:"settings", label:"Settings & Data", ic:"⚬"},
  ]},
];

let ROUTE = {page:"dashboard", params:{}};

function navigate(page, params={}){
  ROUTE = {page, params};
  location.hash = "#"+page+(params.date ? "/"+params.date : "");
  render();
  closeSidebar();
}
window.addEventListener("hashchange", ()=>{
  const h = location.hash.replace("#","");
  const [page, date] = h.split("/");
  if(page) ROUTE = {page, params: date?{date}:{}};
  render();
});

function toggleSidebar(){
  document.getElementById("sidebar").classList.toggle("open");
  document.getElementById("sidebarBackdrop").classList.toggle("open");
}
function closeSidebar(){
  document.getElementById("sidebar").classList.remove("open");
  document.getElementById("sidebarBackdrop").classList.remove("open");
}

function renderSidebar(){
  const sb = document.getElementById("sidebar");
  const theme = (STATE.settings && STATE.settings.theme) || "light";
  let html = `<div class="brand">
    <div class="name">Life Tracker</div>
    <div class="sub">Plan · Track · Learn · Build</div>
  </div>
  <div class="theme-toggle">
    <button class="${theme==='light'?'active':''}" onclick="setTheme('light')">🕷 SPIDER</button>
    <button class="${theme==='dark'?'active':''}" onclick="setTheme('dark')">🦇 BATMAN</button>
  </div>`;
  NAV.forEach(g=>{
    html += `<div class="nav-group"><div class="nav-label">${g.group}</div>`;
    g.items.forEach(it=>{
      const active = ROUTE.page===it.id ? "active" : "";
      html += `<button class="nav-item ${active}" onclick="navigate('${it.id}')"><span class="ic">${it.ic}</span>${it.label}</button>`;
    });
    html += `</div>`;
  });
  html += `<div class="sidebar-foot">Saved locally in this browser.<br>No account, no server.</div>`;
  sb.innerHTML = html;
}

const PAGE_TITLES = {
  dashboard:"Dashboard", calendar:"Calendar", prayers:"Prayers", habits:"Habits",
  tasks:"Tasks", trash:"Trash", attendance:"Attendance", ct:"CT Marks", journal:"Journal", expenses:"Expenses & Funds",
  finance:"Money In & Overview", people:"People & Money",
  reading:"Reading", routine:"Class Routine", dev:"Development Progress",
  courses:"Courses", research:"Research Hub", review:"Weekly / Monthly Review", reminders:"Reminder Center",
  importpdf:"Import from PDF", settings:"Settings & Data", day:"Day"
};

function render(){
  renderSidebar();
  document.getElementById("topActions").innerHTML = `<button class="btn sm" onclick="openSearch()" title="Search">⌕ Search</button>`;
  const view = document.getElementById("view");
  const title = document.getElementById("pageTitle");
  switch(ROUTE.page){
    case "dashboard": title.textContent="Dashboard"; view.innerHTML = renderDashboard(); afterRenderDashboard(); break;
    case "calendar": title.textContent="Calendar"; view.innerHTML = renderCalendar(); break;
    case "day": title.textContent = fmtDate(ROUTE.params.date); view.innerHTML = renderDay(ROUTE.params.date); afterRenderDay(ROUTE.params.date); break;
    case "prayers": title.textContent="Prayers"; view.innerHTML = renderPrayersPage(); break;
    case "habits": title.textContent="Habits"; view.innerHTML = renderHabitsPage(); break;
    case "tasks": title.textContent="Tasks"; view.innerHTML = renderTasksPage(); break;
    case "trash": title.textContent="Trash"; view.innerHTML = renderTrashPage(); break;
    case "attendance": title.textContent="Attendance"; view.innerHTML = renderAttendancePage(); break;
    case "ct": title.textContent="CT Marks"; view.innerHTML = renderCtPage(); break;
    case "journal": title.textContent="Journal"; view.innerHTML = renderJournalPage(); break;
    case "expenses": title.textContent="Expenses & Funds"; view.innerHTML = renderExpensesPage(); afterRenderExpenses(); break;
    case "finance": title.textContent="Money In & Overview"; view.innerHTML = renderFinancePage(); break;
    case "people": title.textContent="People & Money"; view.innerHTML = renderPeoplePage(); break;
    case "reading": title.textContent="Reading"; view.innerHTML = renderReadingPage(); break;
    case "routine": title.textContent="Class Routine"; view.innerHTML = renderRoutinePage(); break;
    case "dev": title.textContent="Development Progress"; view.innerHTML = renderDevPage(); break;
    case "courses": title.textContent="Courses"; view.innerHTML = renderCoursesPage(); break;
    case "research": title.textContent="Research Hub"; view.innerHTML = renderResearchPage(); break;
    case "review": title.textContent="Weekly / Monthly Review"; view.innerHTML = renderReviewPage(); break;
    case "reminders": title.textContent="Reminder Center"; view.innerHTML = renderRemindersPage(); break;
    case "importpdf": title.textContent="Import from PDF"; view.innerHTML = renderImportPdfPage(); break;
    case "settings": title.textContent="Settings & Data"; view.innerHTML = renderSettingsPage(); break;
    default: view.innerHTML = "<p>Not found.</p>";
  }
}

/* ============================================================
   SHARED STAT HELPERS
   ============================================================ */
let CAL_CURSOR = { y: new Date().getFullYear(), m: new Date().getMonth() }; // m = 0-11

function daysInMonth(y,m){ return new Date(y, m+1, 0).getDate(); }

function habitPctForDay(iso){
  const day = STATE.days[iso];
  if(!day || STATE.habitsList.length===0) return null;
  const total = STATE.habitsList.length;
  let done = 0;
  STATE.habitsList.forEach(h=>{ if(day.habits[h.id]) done++; });
  return {done, total};
}
function prayerCountForDay(iso){
  const day = STATE.days[iso];
  const names = ["Fajr","Dhuhr","Asr","Maghrib","Isha"];
  let done = 0;
  if(day) names.forEach(n=>{ if(day.prayers[n]) done++; });
  return {done, total:5};
}
function tasksStatForDay(iso){
  const day = STATE.days[iso];
  if(!day || !day.tasks.length) return {done:0,total:0};
  return {done: day.tasks.filter(t=>t.done).length, total: day.tasks.length};
}

function renderCalendar(){
  const {y,m} = CAL_CURSOR;
  const first = new Date(y,m,1);
  const startDow = dowIndexBD(isoOf(y,m,1)); // 0..6, Sat..Fri
  const nDays = daysInMonth(y,m);
  const monthName = first.toLocaleDateString('en-GB',{month:'long', year:'numeric'});

  let cells = "";
  for(let i=0;i<startDow;i++) cells += `<div class="cal-cell empty-cell"></div>`;
  for(let d=1; d<=nDays; d++){
    const iso = isoOf(y,m,d);
    const isToday = iso === todayISO();
    const hp = habitPctForDay(iso);
    const pp = prayerCountForDay(iso);
    let dots = "";
    for(let i=0;i<5;i++) dots += `<span class="${i<pp.done ? 'on':''}"></span>`;
    const habitPct = hp && hp.total ? Math.round((hp.done/hp.total)*100) : 0;
    const dayObj = STATE.days[iso];
    const comp = dayObj ? dailyCompletion(iso).overall : 0;
    // tiny kind indicators — only shown when that kind actually has something
    const kinds = [];
    if(dayObj){
      if(dayObj.tasks && dayObj.tasks.length) kinds.push('<i class="k-task" title="tasks"></i>');
      if(dayObj.concept && dayObj.concept.topic) kinds.push('<i class="k-study" title="concept / study"></i>');
      if(dayObj.journal && dayObj.journal.trim()) kinds.push('<i class="k-read" title="journal"></i>');
      if(dayObj.attendance && Object.keys(dayObj.attendance).length) kinds.push('<i class="k-att" title="attendance"></i>');
      if(dayObj.tasks && dayObj.tasks.some(t=>!t.done && (t.deadline===iso))) kinds.push('<i class="k-due" title="deadline"></i>');
    }
    if(STATE.ctMarks.some(c=>c.date===iso && c.marks!==null)) kinds.push('<i class="k-ct" title="CT"></i>');
    cells += `<div class="cal-cell ${isToday?'today':''}" onclick="navigate('day',{date:'${iso}'})" title="${comp}% complete">
      <div class="cal-date">${d}${isToday?' <span style=\"color:var(--accent)\">•today</span>':''}</div>
      <div class="cal-dots">${dots}</div>
      ${kinds.length?`<div class="cal-kind">${kinds.join("")}</div>`:''}
      <div class="cal-mini-bar"><div class="cal-mini-fill" style="width:${comp}%"></div></div>
    </div>`;
  }
  const dowHeader = ["Sat","Sun","Mon","Tue","Wed","Thu","Fri"].map(d=>`<div class="cal-dow">${d}</div>`).join("");

  return `
  <div class="between" style="margin-bottom:18px;">
    <div class="row">
      <button class="btn sm" onclick="calShift(-1)">← Prev</button>
      <h2 style="min-width:210px;text-align:center;">${monthName}</h2>
      <button class="btn sm" onclick="calShift(1)">Next →</button>
    </div>
    <div class="row">
      <button class="btn sm" onclick="calToday()">Today</button>
      <button class="btn primary sm" onclick="navigate('day',{date:'${todayISO()}'})">Open Today</button>
    </div>
  </div>
  <div class="card card-pad">
    <div class="cal-grid" style="margin-bottom:8px;">${dowHeader}</div>
    <div class="cal-grid">${cells}</div>
  </div>
  <div class="row" style="margin-top:14px; gap:16px; font-size:12px; color:var(--ink-soft);">
    <div class="row" style="gap:5px;"><span style="width:8px;height:8px;border-radius:50%;background:var(--success);display:inline-block;"></span> prayer logged</div>
    <div class="row" style="gap:5px;"><span style="width:22px;height:5px;border-radius:3px;background:var(--accent);display:inline-block;"></span> daily completion %</div>
    <div class="row" style="gap:5px;"><i style="width:6px;height:6px;border-radius:50%;background:var(--accent);display:inline-block;"></i> tasks</div>
    <div class="row" style="gap:5px;"><i style="width:6px;height:6px;border-radius:50%;background:var(--accent-2);display:inline-block;"></i> concept</div>
    <div class="row" style="gap:5px;"><i style="width:6px;height:6px;border-radius:50%;background:var(--success);display:inline-block;"></i> attendance</div>
    <div class="row" style="gap:5px;"><i style="width:6px;height:6px;border-radius:50%;background:var(--warn);display:inline-block;"></i> CT</div>
    <div class="row" style="gap:5px;"><i style="width:6px;height:6px;border-radius:50%;background:var(--danger);display:inline-block;"></i> deadline</div>
  </div>`;
}
function calShift(delta){
  CAL_CURSOR.m += delta;
  if(CAL_CURSOR.m<0){ CAL_CURSOR.m=11; CAL_CURSOR.y--; }
  if(CAL_CURSOR.m>11){ CAL_CURSOR.m=0; CAL_CURSOR.y++; }
  render();
}
function calToday(){ const t=new Date(); CAL_CURSOR={y:t.getFullYear(), m:t.getMonth()}; render(); }

/* ============================================================
   DAY VIEW  (signature: prayer-time "day arc")
   ============================================================ */
const PRAYERS = [
  {name:"Fajr", color:"var(--fajr)", time:"Dawn"},
  {name:"Dhuhr", color:"var(--dhuhr)", time:"Midday"},
  {name:"Asr", color:"var(--asr)", time:"Afternoon"},
  {name:"Maghrib", color:"var(--maghrib)", time:"Sunset"},
  {name:"Isha", color:"var(--isha)", time:"Night"},
];

function renderDay(iso){
  if(!iso) iso = todayISO();
  const day = getDay(iso);
  const dowName = BD_DOW_NAMES[dowIndexBD(iso)];
  const prev = new Date(iso+"T00:00:00"); prev.setDate(prev.getDate()-1);
  const next = new Date(iso+"T00:00:00"); next.setDate(next.getDate()+1);
  const prevIso = prev.toISOString().slice(0,10), nextIso = next.toISOString().slice(0,10);

  const arcNodes = PRAYERS.map(p=>{
    const on = !!day.prayers[p.name];
    return `<div class="arc-node" onclick="togglePrayer('${iso}','${p.name}')">
      <div class="dot" style="border-color:${p.color}; ${on?`background:${p.color};color:#fff;`:''}">${on?'✓':''}</div>
      <div class="name">${p.name}</div>
      <div class="time">${p.time}</div>
    </div>`;
  }).join("");

  const habitsHtml = STATE.habitsList.map(h=>{
    const on = !!day.habits[h.id];
    return `<div class="list-item">
      <div class="checkbox ${on?'checked':''}" onclick="toggleHabit('${iso}','${h.id}')">${on?'✓':''}</div>
      <div style="flex:1;">${h.name}</div>
      <div class="mono muted" style="font-size:11px;">${habitStreakText(h.id)}</div>
    </div>`;
  }).join("") || `<div class="empty">No habits yet. Add some on the Habits page.</div>`;

  const dowIdx = dowIndexBD(iso);
  const scheduled = (STATE.routine[dowIdx]||[]);
  const attendanceHtml = scheduled.length ? scheduled.map(cls=>{
    const subj = STATE.subjects.find(s=>s.id===cls.subjectId);
    const status = day.attendance[cls.subjectId+"@"+cls.time] || "";
    const occurs = subj ? labOccursOnDate(subj, iso) : true;
    if(!occurs){
      return `<div class="list-item">
        <div style="flex:1;">
          <div style="font-weight:600;color:var(--ink-soft);">${subj?escapeHtml(subj.name):'(unknown subject)'}</div>
          <div class="muted" style="font-size:11.5px;">${escapeHtml(cls.time||'')} · not held this week (biweekly lab)</div>
        </div>
        <span class="badge neutral">Off week</span>
      </div>`;
    }
    return `<div class="list-item">
      <div style="flex:1;">
        <div style="font-weight:600;">${subj?escapeHtml(subj.name):'(unknown subject)'}</div>
        <div class="muted" style="font-size:11.5px;">${escapeHtml(cls.time||'')}${subj?' · '+subjectFrequencyLabel(subj):''}</div>
      </div>
      <div class="row" style="gap:6px;">
        ${["Present","Absent","Cancelled"].map(s=>`<button class="btn sm ${status===s?'primary':''}" onclick="setAttendance('${iso}','${cls.subjectId}','${cls.time}','${s}')">${s}</button>`).join("")}
      </div>
    </div>`;
  }).join("") : `<div class="empty">No classes scheduled for ${dowName}. Set up your <a href="#routine" onclick="navigate('routine')" style="color:var(--accent-red);font-weight:600;">Class Routine</a>.</div>`;

  const tasksHtml = day.tasks.map(t=>`
    <div class="list-item" style="align-items:flex-start;flex-wrap:wrap;">
      <div class="checkbox ${t.done?'checked':''}" onclick="toggleTask('${iso}','${t.id}')" style="margin-top:2px;">${t.done?'✓':''}</div>
      <div style="flex:1;min-width:140px;">
        <div style="${t.done?'text-decoration:line-through;color:var(--ink-soft);':''}">${escapeHtml(t.text)}</div>
        <div class="row" style="gap:5px;margin-top:4px;flex-wrap:wrap;">
          <span class="badge neutral">${escapeHtml(t.category||'Others')}</span>
          <span class="badge ${t.priority==='High'?'bad':t.priority==='Low'?'neutral':'warn'}">${t.priority||'—'}</span>
          ${t.deadline ? `<span class="badge ${t.deadline<todayISO() && !t.done?'bad':'neutral'}">due ${fmtShort(t.deadline)}</span>` : ''}
        </div>
        ${t.description ? `<div class="muted" style="font-size:12px;margin-top:4px;">${escapeHtml(t.description)}</div>` : ''}
        ${!t.done ? `<div class="row" style="gap:8px;margin-top:8px;">
          <input type="range" class="speed-range" min="0" max="100" step="5" value="${Number(t.progress)||0}"
                 style="flex:1;max-width:200px;" oninput="setTaskProgress('${iso}','${t.id}',this.value,true)">
          <span class="mono" id="tp-${t.id}" style="font-size:12px;font-weight:700;width:42px;">${Number(t.progress)||0}%</span>
        </div>` : ''}
      </div>
      ${!t.done ? `<div class="row" style="gap:4px;">
        <button class="btn sm primary" onclick="completeTask('${iso}','${t.id}')" title="Mark complete">✅</button>
        <button class="btn sm" onclick="moveTaskToTomorrow('${iso}','${t.id}')" title="Move to tomorrow">📅 Tomorrow</button>
        <input type="date" id="moveDate-${t.id}" style="width:130px;">
        <button class="btn sm" onclick="moveTaskToChosenDate('${iso}','${t.id}')" title="Move to chosen date">📆 Move</button>
        <button class="icon-btn" onclick="trashTask('${iso}','${t.id}')" title="Move to trash">🗑</button>
      </div>` : `<button class="icon-btn" onclick="trashTask('${iso}','${t.id}')" title="Move to trash">🗑</button>`}
    </div>`).join("") || `<div class="empty">No tasks logged for this day yet.</div>`;
  const taskCatOptions = STATE.taskCategories.map(c=>`<option>${escapeHtml(c)}</option>`).join("");

  const concept = day.concept;
  const conceptView = concept && concept.topic ? `
    <div class="row" style="align-items:flex-start;justify-content:space-between;">
      <div>
        <div style="font-family:var(--font-display);font-size:19px;font-weight:600;">${escapeHtml(concept.topic)}</div>
        ${concept.subject ? `<div class="muted" style="font-size:12.5px;margin-top:2px;">${escapeHtml(concept.subject)}</div>` : ''}
        ${concept.description ? `<p style="margin:8px 0 0;">${escapeHtml(concept.description)}</p>` : ''}
        ${concept.notes ? `<p class="muted" style="margin:6px 0 0;font-size:12.5px;white-space:pre-wrap;">${escapeHtml(concept.notes)}</p>` : ''}
        ${concept.url ? `<a href="${escapeHtml(concept.url)}" target="_blank" rel="noopener" style="font-size:12.5px;color:var(--accent-red);font-weight:600;">Open link ↗</a>` : ''}
      </div>
      <button class="btn sm" onclick="toggleConceptEdit()">Edit</button>
    </div>` : `
    <div class="between">
      <span class="muted">No concept set for today.</span>
      <button class="btn sm primary" onclick="toggleConceptEdit()">+ Add concept</button>
    </div>`;
  const conceptEditForm = `
    <div id="conceptEditForm" style="${CONCEPT_EDIT_OPEN?'':'display:none;'}margin-top:12px;">
      <div class="grid grid-2" style="margin-bottom:8px;">
        <input type="text" id="conceptTopic" placeholder="Topic (e.g. Fourier Transform)" value="${escapeHtml(concept?.topic||'')}">
        <input type="text" id="conceptSubject" placeholder="Subject (e.g. Signals & Systems)" value="${escapeHtml(concept?.subject||'')}">
      </div>
      <textarea id="conceptDescription" placeholder="Short description…" style="margin-bottom:8px;">${escapeHtml(concept?.description||'')}</textarea>
      <textarea id="conceptNotes" placeholder="Notes…" style="margin-bottom:8px;">${escapeHtml(concept?.notes||'')}</textarea>
      <input type="text" id="conceptUrl" placeholder="Related link (optional)" value="${escapeHtml(concept?.url||'')}" style="margin-bottom:10px;">
      <div class="row" style="justify-content:flex-end;">
        <button class="btn sm" onclick="toggleConceptEdit()">Cancel</button>
        <button class="btn sm primary" onclick="saveConcept('${iso}')">Save concept</button>
      </div>
    </div>`;

  const expHtml = day.expenses.map(e=>`
    <div class="list-item">
      <div style="flex:1;">${escapeHtml(e.desc||'(no description)')} <span class="badge neutral">${e.fund}</span></div>
      <div class="mono" style="font-weight:600;">৳${Number(e.amount||0).toLocaleString()}</div>
      <button class="icon-btn" onclick="deleteExpense('${iso}','${e.id}')">✕</button>
    </div>`).join("") || `<div class="empty">No expenses logged for this day.</div>`;
  const fundOptions = STATE.funds.map(f=>`<option value="${escapeHtml(f.name)}">${escapeHtml(f.name)}</option>`).join("");

  const comp = dailyCompletion(iso);
  const brkRows = comp.parts.map(p=>`
    <div class="brk">
      <div class="brk-label">${p.key}</div>
      <div class="brk-bar"><div class="brk-fill" style="width:${p.pct}%;"></div></div>
      <div class="brk-val">${p.raw}</div>
    </div>`).join("");
  const isToday = iso === todayISO();

  return `
  <div class="between no-print" style="margin-bottom:16px;">
    <div class="row">
      <button class="btn sm" onclick="navigate('day',{date:'${prevIso}'})">← ${fmtShort(prevIso)}</button>
      <button class="btn sm ${isToday?'primary':''}" onclick="navigate('day',{date:'${todayISO()}'})">Today</button>
      <button class="btn sm" onclick="navigate('day',{date:'${nextIso}'})">${fmtShort(nextIso)} →</button>
      <input type="date" value="${iso}" style="width:150px;" onchange="if(this.value)navigate('day',{date:this.value})">
      <button class="btn sm" onclick="navigate('calendar')">▦ Calendar</button>
    </div>
    <div class="row">
      <button class="btn sm" onclick="window.print()">⇩ Export / Print</button>
    </div>
  </div>

  <div class="card card-pad" style="margin-bottom:20px;">
    <div class="hud-ring-wrap">
      ${speedometerSvg(comp.overall, 150, isToday ? "TODAY" : fmtShort(iso))}
      <div style="flex:1;min-width:240px;">
        <div class="section-title" style="margin-bottom:6px;">Daily Completion</div>
        <div class="hud-big">${comp.overall}%</div>
        <div class="hud-sub">${comp.overall} / 100 · ${BD_DOW_NAMES[dowIndexBD(iso)]}, ${fmtDate(iso)}</div>
      </div>
      <div style="flex:1.2;min-width:250px;">
        ${brkRows}
      </div>
    </div>
  </div>

  <div class="card day-arc" style="margin-bottom:20px;">
    <div class="arc-line"></div>
    ${arcNodes}
  </div>

  <div class="card card-pad" style="margin-bottom:20px;">
    <div class="section-title">◈ Concept of the Day</div>
    ${conceptView}
    ${conceptEditForm}
  </div>

  <div class="grid grid-2">
    <div class="card card-pad">
      <div class="section-title">✓ Habits <span class="tag">${Object.values(day.habits).filter(Boolean).length}/${STATE.habitsList.length} today</span></div>
      ${habitsHtml}
    </div>
    <div class="card card-pad">
      <div class="section-title">▣ Attendance <span class="tag">${dowName}</span></div>
      ${attendanceHtml}
    </div>
    <div class="card card-pad">
      <div class="section-title">▤ Tasks</div>
      ${tasksHtml}
      <div class="divider"></div>
      <div class="row" style="margin-bottom:8px;">
        <input type="text" id="newTaskText" placeholder="Add a task for this day…">
        <select id="newTaskCategory" style="width:130px;">${taskCatOptions}</select>
        <select id="newTaskPriority" style="width:100px;"><option>Medium</option><option>High</option><option>Low</option></select>
      </div>
      <div id="taskMoreFields" style="display:none;margin-bottom:8px;">
        <textarea id="newTaskDescription" placeholder="Description (optional)" style="margin-bottom:6px;min-height:44px;"></textarea>
        <div class="row">
          <input type="date" id="newTaskDeadline" style="width:150px;">
          <input type="text" id="newTaskUrl" placeholder="Link (optional)">
        </div>
      </div>
      <div class="row" style="justify-content:space-between;">
        <button class="btn sm ghost" onclick="toggleTaskMoreFields()">+ More options</button>
        <button class="btn primary sm" onclick="addTask('${iso}')">Add task</button>
      </div>
    </div>
    <div class="card card-pad">
      <div class="section-title">৳ Expenses</div>
      ${expHtml}
      <div class="row" style="margin-top:12px;">
        <select id="newExpFund" style="width:120px;">${fundOptions}</select>
        <input type="text" id="newExpDesc" placeholder="Description">
        <input type="number" id="newExpAmount" placeholder="৳" style="width:90px;">
        <button class="btn primary sm" onclick="addExpense('${iso}')">Add</button>
      </div>
    </div>
  </div>

  <div class="card card-pad" style="margin-top:16px;">
    <div class="section-title">✎ Journal — ${dowName}, ${fmtDate(iso)}</div>
    <textarea id="journalText" rows="4" placeholder="How did today go? Habits, deen, studies, anything worth remembering…">${escapeHtml(day.journal)}</textarea>
    <div class="row" style="margin-top:10px; justify-content:flex-end;">
      <button class="btn primary sm" onclick="saveJournal('${iso}')">Save entry</button>
    </div>
  </div>
  `;
}
function afterRenderDay(iso){ /* reserved for future chart hooks */ }

function escapeHtml(s){ return (s||"").replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

function togglePrayer(iso,name){ const d=getDay(iso); d.prayers[name] = !d.prayers[name]; saveState(); render(); }
function toggleHabit(iso,hid){ const d=getDay(iso); d.habits[hid] = !d.habits[hid]; saveState(); render(); }
function toggleTask(iso,tid){
  const d=getDay(iso); const t=d.tasks.find(x=>x.id===tid); if(!t) return;
  t.done=!t.done;
  t.progress = t.done ? 100 : (Number(t.progress)===100 ? 0 : Number(t.progress)||0);
  saveState(); render();
}
function completeTask(iso,tid){
  const d=getDay(iso); const t=d.tasks.find(x=>x.id===tid); if(!t) return;
  t.done = true; t.progress = 100;
  saveState(); render();
}
function setTaskProgress(iso,tid,value,live){
  const d=getDay(iso); const t=d.tasks.find(x=>x.id===tid); if(!t) return;
  t.progress = Math.max(0, Math.min(100, parseInt(value)||0));
  if(t.progress === 100) t.done = true;
  saveState();
  if(live){
    const lbl = document.getElementById("tp-"+tid);
    if(lbl) lbl.textContent = t.progress+"%";
    if(t.progress === 100) render();
  } else render();
}
function toggleTaskMoreFields(){
  const el = document.getElementById("taskMoreFields");
  if(el) el.style.display = el.style.display==="none" ? "block" : "none";
}
function addTask(iso){
  const txt = document.getElementById("newTaskText").value.trim();
  const pr = document.getElementById("newTaskPriority").value;
  const category = document.getElementById("newTaskCategory").value;
  const description = document.getElementById("newTaskDescription").value.trim();
  const deadline = document.getElementById("newTaskDeadline").value;
  const url = document.getElementById("newTaskUrl").value.trim();
  if(!txt) return;
  const d = getDay(iso);
  d.tasks.push({id:uid(), text:txt, priority:pr, category, description, deadline, url, notes:"", done:false});
  saveState(); render();
}
function findTaskLocation(iso, tid){
  const d = getDay(iso);
  const idx = d.tasks.findIndex(x=>x.id===tid);
  return idx>=0 ? {day:d, idx} : null;
}
function moveTaskToTomorrow(iso, tid){
  const t = new Date(iso+"T00:00:00"); t.setDate(t.getDate()+1);
  moveTaskToDate(iso, tid, t.toISOString().slice(0,10));
}
function moveTaskToChosenDate(iso, tid){
  const input = document.getElementById(`moveDate-${tid}`);
  const newDate = input ? input.value : "";
  if(!newDate){ alert("Pick a date first."); return; }
  moveTaskToDate(iso, tid, newDate);
}
function moveTaskToDate(iso, tid, newDate){
  const loc = findTaskLocation(iso, tid);
  if(!loc) return;
  const [task] = loc.day.tasks.splice(loc.idx, 1);
  getDay(newDate).tasks.push(task);
  saveState(); render();
}
function trashTask(iso, tid){
  const loc = findTaskLocation(iso, tid);
  if(!loc) return;
  const [task] = loc.day.tasks.splice(loc.idx, 1);
  STATE.trash.push(Object.assign({}, task, {originalDate:iso, deletedDate:todayISO()}));
  saveState(); render();
}
function restoreFromTrash(trashId){
  const idx = STATE.trash.findIndex(x=>x.id===trashId);
  if(idx<0) return;
  const [item] = STATE.trash.splice(idx,1);
  const {originalDate, deletedDate, ...task} = item;
  getDay(originalDate || todayISO()).tasks.push(task);
  saveState(); render();
}
function permanentlyDeleteFromTrash(trashId){
  if(!confirm("Permanently delete this task? This cannot be undone.")) return;
  STATE.trash = STATE.trash.filter(x=>x.id!==trashId);
  saveState(); render();
}

let CONCEPT_EDIT_OPEN = false;
function toggleConceptEdit(){ CONCEPT_EDIT_OPEN = !CONCEPT_EDIT_OPEN; render(); }
function saveConcept(iso){
  const d = getDay(iso);
  d.concept = {
    topic: document.getElementById("conceptTopic").value.trim(),
    subject: document.getElementById("conceptSubject").value.trim(),
    description: document.getElementById("conceptDescription").value.trim(),
    notes: document.getElementById("conceptNotes").value.trim(),
    url: document.getElementById("conceptUrl").value.trim()
  };
  CONCEPT_EDIT_OPEN = false;
  saveState(); render();
}

function deleteExpense(iso,eid){ const d=getDay(iso); d.expenses = d.expenses.filter(x=>x.id!==eid); saveState(); render(); }
function addExpense(iso){
  const fund = document.getElementById("newExpFund").value;
  const desc = document.getElementById("newExpDesc").value.trim();
  const amount = parseFloat(document.getElementById("newExpAmount").value)||0;
  if(!amount) return;
  const d = getDay(iso);
  d.expenses.push({id:uid(), fund, desc, amount});
  saveState(); render();
}
function saveJournal(iso){
  const d = getDay(iso);
  d.journal = document.getElementById("journalText").value;
  saveState();
  const btn = event.target; const old = btn.textContent; btn.textContent="Saved ✓"; setTimeout(()=>btn.textContent=old,1200);
}
function setAttendance(iso, subjectId, time, status){
  const d = getDay(iso);
  d.attendance[subjectId+"@"+time] = status;
  saveState(); render();
}
/* ============================================================
   PRAYERS PAGE — month grid + stats
   ============================================================ */
function habitStreakText(hid){
  let streak = 0;
  let d = new Date(todayISO()+"T00:00:00");
  while(true){
    const iso = d.toISOString().slice(0,10);
    const day = STATE.days[iso];
    if(day && day.habits[hid]){ streak++; d.setDate(d.getDate()-1); }
    else break;
  }
  return streak>0 ? `🔥 ${streak}d` : "";
}

let PAGE_MONTH = { y: new Date().getFullYear(), m: new Date().getMonth() };

function monthDaysISO(y,m){
  const n = daysInMonth(y,m);
  const arr = [];
  for(let d=1; d<=n; d++) arr.push(isoOf(y,m,d));
  return arr;
}
function streakForBoolSeries(getBool){
  // getBool(iso)-> true/false ; counts consecutive true days ending today, and longest streak this month (not used deeply)
  let streak = 0, d = new Date(todayISO()+"T00:00:00");
  while(getBool(d.toISOString().slice(0,10))){ streak++; d.setDate(d.getDate()-1); }
  return streak;
}

function renderPrayersPage(){
  const {y,m} = PAGE_MONTH;
  const isos = monthDaysISO(y,m);
  const monthName = new Date(y,m,1).toLocaleDateString('en-GB',{month:'long', year:'numeric'});
  let totalPossible = isos.length*5, totalDone=0, perfectDays=0;
  const rows = PRAYERS.map(p=>{
    let done=0;
    const cells = isos.map(iso=>{
      const on = !!(STATE.days[iso] && STATE.days[iso].prayers[p.name]);
      if(on) done++;
      return `<td style="text-align:center;padding:4px;"><div class="checkbox ${on?'checked':''}" style="margin:0 auto;width:17px;height:17px;" onclick="togglePrayer('${iso}','${p.name}');render()">${on?'✓':''}</div></td>`;
    }).join("");
    totalDone += done;
    return {name:p.name, cells, pct: Math.round(done/isos.length*100)};
  });
  isos.forEach(iso=>{ const d=STATE.days[iso]; if(d && PRAYERS.every(p=>d.prayers[p.name])) perfectDays++; });
  const curStreak = streakForBoolSeries(iso=>{ const d=STATE.days[iso]; return !!(d && PRAYERS.every(p=>d.prayers[p.name])); });

  return `
  <div class="between" style="margin-bottom:16px;">
    <div class="row"><button class="btn sm" onclick="pageMonthShift(-1,render)">← Prev</button><h2 style="min-width:190px;text-align:center;">${monthName}</h2><button class="btn sm" onclick="pageMonthShift(1,render)">Next →</button></div>
  </div>
  <div class="grid grid-4" style="margin-bottom:18px;">
    <div class="kpi" style="background:var(--success-soft);"><div class="label" style="color:var(--success);">Overall</div><div class="value" style="color:var(--success);">${Math.round(totalDone/totalPossible*100)}%</div><div class="sub">${totalDone}/${totalPossible} prayers</div></div>
    <div class="kpi" style="background:var(--warn-soft);"><div class="label" style="color:#8A6A1E;">Perfect Days</div><div class="value" style="color:#8A6A1E;">${perfectDays}</div><div class="sub">all 5 prayers</div></div>
    <div class="kpi" style="background:var(--accent-red-soft);"><div class="label" style="color:var(--accent-red);">Current Streak</div><div class="value" style="color:var(--accent-red);">${curStreak}d</div><div class="sub">consecutive perfect days</div></div>
    <div class="kpi" style="background:var(--paper);"><div class="label">Days Tracked</div><div class="value">${isos.length}</div><div class="sub">this month</div></div>
  </div>
  <div class="card card-pad" style="overflow-x:auto;">
    <table><thead><tr><th>Prayer</th>${isos.map(iso=>`<th style="text-align:center;">${iso.slice(8)}</th>`).join("")}<th>%</th></tr></thead>
    <tbody>${rows.map(r=>`<tr><td style="font-weight:700;">${r.name}</td>${r.cells}<td><b>${r.pct}%</b></td></tr>`).join("")}</tbody></table>
  </div>`;
}
function pageMonthShift(delta, cb){
  PAGE_MONTH.m += delta;
  if(PAGE_MONTH.m<0){ PAGE_MONTH.m=11; PAGE_MONTH.y--; }
  if(PAGE_MONTH.m>11){ PAGE_MONTH.m=0; PAGE_MONTH.y++; }
  cb();
}

/* ============================================================
   HABITS PAGE — manage list + month grid + stats
   ============================================================ */
function renderHabitsPage(){
  const {y,m} = PAGE_MONTH;
  const isos = monthDaysISO(y,m);
  const monthName = new Date(y,m,1).toLocaleDateString('en-GB',{month:'long', year:'numeric'});

  const rows = STATE.habitsList.map(h=>{
    let done=0;
    const cells = isos.map(iso=>{
      const on = !!(STATE.days[iso] && STATE.days[iso].habits[h.id]);
      if(on) done++;
      return `<td style="text-align:center;padding:4px;"><div class="checkbox ${on?'checked':''}" style="margin:0 auto;width:17px;height:17px;" onclick="toggleHabit('${iso}','${h.id}');render()">${on?'✓':''}</div></td>`;
    }).join("");
    const pct = Math.round(done/isos.length*100);
    const cur = streakForBoolSeries(iso=>!!(STATE.days[iso] && STATE.days[iso].habits[h.id]));
    return `<tr><td style="font-weight:700;white-space:nowrap;position:sticky;left:0;background:var(--card);box-shadow:2px 0 4px rgba(0,0,0,0.04);z-index:2;"><div class="row" style="gap:6px;"><span>${escapeHtml(h.name)}</span><button class="icon-btn" onclick="deleteHabit('${h.id}')">✕</button></div></td>${cells}<td><b>${pct}%</b></td><td class="mono">🔥${cur}</td></tr>`;
  }).join("") || "";

  return `
  <div class="between" style="margin-bottom:16px;">
    <div class="row"><button class="btn sm" onclick="pageMonthShift(-1,render)">← Prev</button><h2 style="min-width:190px;text-align:center;">${monthName}</h2><button class="btn sm" onclick="pageMonthShift(1,render)">Next →</button></div>
    <div class="row"><input type="text" id="newHabitName" placeholder="New habit name…" style="width:220px;"><button class="btn primary sm" onclick="addHabit()">+ Add Habit</button></div>
  </div>
  <div class="card card-pad" style="overflow-x:auto;">
    ${STATE.habitsList.length ? `<table style="min-width:900px;"><thead><tr><th style="white-space:nowrap;position:sticky;left:0;background:var(--card);box-shadow:2px 0 4px rgba(0,0,0,0.04);z-index:3;">Habit</th>${isos.map(iso=>`<th style="text-align:center;">${iso.slice(8)}</th>`).join("")}<th>%</th><th>Streak</th></tr></thead><tbody>${rows}</tbody></table>` : `<div class="empty"><div class="big">✓</div>No habits yet — add your first one above.</div>`}
  </div>`;
}
function addHabit(){
  const input = document.getElementById("newHabitName");
  const name = input.value.trim();
  if(!name) return;
  STATE.habitsList.push({id:uid(), name});
  saveState(); render();
}
function deleteHabit(id){
  if(!confirm("Remove this habit? Its logged history stays in each day's data but won't show in trackers.")) return;
  STATE.habitsList = STATE.habitsList.filter(h=>h.id!==id);
  saveState(); render();
}

/* ============================================================
   TASKS PAGE — all tasks across all dates
   ============================================================ */
function renderTasksPage(){
  const allTasks = [];
  Object.keys(STATE.days).sort().reverse().forEach(iso=>{
    STATE.days[iso].tasks.forEach(t=> allTasks.push({...t, iso}));
  });
  const pending = allTasks.filter(t=>!t.done);
  const done = allTasks.filter(t=>t.done);
  const byCat = {};
  pending.forEach(t=>{ const c = t.category||"Others"; (byCat[c]=byCat[c]||[]).push(t); });

  const rows = (list)=> list.map(t=>`
    <div class="list-item" style="flex-wrap:wrap;">
      <div class="checkbox ${t.done?'checked':''}" onclick="toggleTask('${t.iso}','${t.id}');render()">${t.done?'✓':''}</div>
      <div style="flex:1;min-width:140px;${t.done?'text-decoration:line-through;color:var(--ink-soft);':''}">${escapeHtml(t.text)}
        ${t.deadline ? `<span class="badge ${t.deadline<todayISO() && !t.done?'bad':'neutral'}" style="margin-left:6px;">due ${fmtShort(t.deadline)}</span>` : ''}
      </div>
      <span class="badge neutral">${t.priority||'—'}</span>
      <button class="btn sm ghost" onclick="navigate('day',{date:'${t.iso}'})">${fmtShort(t.iso)}</button>
      <button class="icon-btn" onclick="trashTask('${t.iso}','${t.id}');render()" title="Move to trash">🗑</button>
    </div>`).join("") || `<div class="empty">Nothing here.</div>`;

  const categoryBlocks = Object.keys(byCat).length ? Object.entries(byCat).map(([cat, items])=>`
    <div class="card card-pad" style="margin-bottom:14px;">
      <div class="section-title">${escapeHtml(cat)} <span class="tag">${items.length}</span></div>
      ${rows(items)}
    </div>`).join("") : `<div class="card card-pad"><div class="empty">Nothing pending — add tasks from any Day page.</div></div>`;

  return `
  <div class="between" style="margin-bottom:16px;">
    <div class="grid grid-3" style="flex:1;">
      <div class="kpi" style="background:var(--paper);"><div class="label">Total Tasks</div><div class="value">${allTasks.length}</div></div>
      <div class="kpi" style="background:var(--success-soft);"><div class="label" style="color:var(--success);">Completed</div><div class="value" style="color:var(--success);">${done.length}</div></div>
      <div class="kpi" style="background:var(--warn-soft);"><div class="label" style="color:#8A6A1E;">Pending</div><div class="value" style="color:#8A6A1E;">${pending.length}</div></div>
    </div>
  </div>
  <div class="section-title">Pending, by category</div>
  ${categoryBlocks}
  <div class="card card-pad">
    <div class="section-title">Completed <span class="tag">${done.length}</span></div>
    ${rows(done.slice(0,40))}
  </div>`;
}

function renderTrashPage(){
  const items = STATE.trash.slice().sort((a,b)=> (b.deletedDate||"").localeCompare(a.deletedDate||""));
  const rows = items.map(t=>`
    <div class="list-item" style="flex-wrap:wrap;">
      <div style="flex:1;min-width:160px;">
        <div style="font-weight:600;">${escapeHtml(t.text)}</div>
        <div class="row" style="gap:6px;margin-top:4px;flex-wrap:wrap;">
          <span class="badge neutral">${escapeHtml(t.category||'Others')}</span>
          <span class="muted" style="font-size:11.5px;">was on ${fmtShort(t.originalDate)} · trashed ${fmtShort(t.deletedDate)}</span>
        </div>
      </div>
      <div class="row" style="gap:6px;">
        <button class="btn sm" onclick="restoreFromTrash('${t.id}')">Restore</button>
        <button class="btn sm danger" onclick="permanentlyDeleteFromTrash('${t.id}')">Delete forever</button>
      </div>
    </div>`).join("");
  return `
  <p class="muted" style="margin-bottom:14px;">Tasks you trash land here instead of vanishing — restore them or delete them for good.</p>
  <div class="card card-pad">
    ${items.length ? rows : `<div class="empty"><div class="big">🗑</div>Trash is empty.</div>`}
  </div>`;
}

/* ============================================================
   ATTENDANCE PAGE — per subject %, flags below 75%
   ============================================================ */
/* ============================================================
   ATTENDANCE — daily log + manual summary (two counting modes)
   ============================================================ */
function subjectAttendanceStats(s){
  let present=0, absent=0, cancelled=0;
  Object.values(STATE.days).forEach(day=>{
    Object.entries(day.attendance||{}).forEach(([key,status])=>{
      if(key.startsWith(s.id+"@")){
        if(status==="Present") present++;
        else if(status==="Absent") absent++;
        else if(status==="Cancelled") cancelled++;
      }
    });
  });
  const m = s.manualAttendance;
  let source="log", effAttended=present, effAbsent=absent, effCancelled=cancelled;
  let effHeld = present + absent;

  if(m && Number(m.total) > 0){
    source = "manual";
    const mode = m.countingMode || "total";
    effCancelled = Number(m.cancelled)||0;
    if(mode === "held"){
      // "total" field means classes actually HELD (cancelled already excluded)
      effHeld = Number(m.total);
      effAttended = Number(m.attended)||0;
      effAbsent = Math.max(0, effHeld - effAttended);
    } else {
      // "total" field means ALL scheduled classes, so subtract cancelled
      effHeld = Math.max(0, Number(m.total) - effCancelled);
      effAttended = Number(m.attended)||0;
      effAbsent = Math.max(0, effHeld - effAttended);
    }
    if(m.addToLog){
      // combine manual summary WITH the daily log instead of overriding it
      effHeld += present + absent;
      effAttended += present;
      effAbsent += absent;
      effCancelled += cancelled;
      source = "manual+log";
    }
  }
  const pct = effHeld ? (effAttended/effHeld*100) : null;
  const pred = effHeld ? attendancePrediction(effAttended, effHeld) : null;
  return {present, absent, cancelled, effAttended, effAbsent, effCancelled, effHeld, pct, source, pred, m};
}

let MANUAL_ATT_OPEN = null;
function renderAttendancePage(){
  const stats = STATE.subjects.map(s=>({s, ...subjectAttendanceStats(s)}));

  const rows = stats.map(st=>`
    <tr>
      <td style="font-weight:700;">${escapeHtml(st.s.name)}<div class="muted" style="font-size:11px;">${escapeHtml(st.s.code||'')}</div></td>
      <td><span class="badge ${st.s.type==='Lab'?'warn':'neutral'}">${st.s.type}</span><div class="muted" style="font-size:10.5px;margin-top:3px;">${subjectFrequencyLabel(st.s)}</div></td>
      <td class="mono">${st.effAttended}</td>
      <td class="mono">${st.effAbsent}</td>
      <td class="mono">${st.effCancelled}</td>
      <td class="mono">${st.effHeld}${st.source!=='log'?` <span class="badge neutral" style="font-size:9px;">${st.source==='manual+log'?'man+log':'manual'}</span>`:''}</td>
      <td>${st.pct===null ? '<span class="muted">—</span>' : `<b style="color:${st.pct>=75?'var(--success)':'var(--danger)'};">${st.pct.toFixed(2)}%</b>`}</td>
      <td>${st.pct===null?'':(st.pct>=75?'<span class="badge ok">Safe</span>':'<span class="badge bad">Below 75%</span>')}</td>
      <td style="font-size:11.5px;">${st.pred ? (st.pct>=75 ? `can miss <b>${st.pred.canMiss}</b>` : `need <b>${st.pred.needToAttend}</b> in a row`) : '—'}</td>
      <td><button class="btn sm" onclick="toggleManualAttendance('${st.s.id}')">${st.m?'Edit':'+ Manual'}</button></td>
      <td><button class="icon-btn" onclick="deleteSubject('${st.s.id}')">✕</button></td>
    </tr>
    ${MANUAL_ATT_OPEN===st.s.id ? `<tr><td colspan="11" style="background:var(--paper);">
      <div style="padding:10px 0;">
        <div class="row" style="flex-wrap:wrap;margin-bottom:10px;">
          <div style="min-width:230px;">
            <label class="field-label">What does "Total classes" mean?</label>
            <select id="manMode-${st.s.id}" style="width:100%;">
              <option value="total" ${(st.m?.countingMode||'total')==='total'?'selected':''}>All scheduled classes (cancelled will be subtracted)</option>
              <option value="held" ${st.m?.countingMode==='held'?'selected':''}>Only classes actually held (cancelled already excluded)</option>
            </select>
          </div>
          <div style="min-width:220px;">
            <label class="field-label">Combine with daily log?</label>
            <select id="manAdd-${st.s.id}" style="width:100%;">
              <option value="no" ${!st.m?.addToLog?'selected':''}>Override the daily log (use only these numbers)</option>
              <option value="yes" ${st.m?.addToLog?'selected':''}>Add to the daily log (sum both together)</option>
            </select>
          </div>
        </div>
        <div class="row" style="flex-wrap:wrap;">
          <div><label class="field-label">Up to date</label><input type="date" id="manUpTo-${st.s.id}" value="${st.m?.upToDate||''}" style="width:150px;"></div>
          <div><label class="field-label">Total classes</label><input type="number" id="manTotal-${st.s.id}" value="${st.m?st.m.total:''}" style="width:110px;"></div>
          <div><label class="field-label">Attended</label><input type="number" id="manAttended-${st.s.id}" value="${st.m?st.m.attended:''}" style="width:110px;"></div>
          <div><label class="field-label">Cancelled</label><input type="number" id="manCancelled-${st.s.id}" value="${st.m?st.m.cancelled:''}" style="width:110px;"></div>
          <div style="align-self:flex-end;" class="row">
            <button class="btn primary sm" onclick="saveManualAttendance('${st.s.id}')">Save</button>
            ${st.m?`<button class="btn sm danger" onclick="clearManualAttendance('${st.s.id}')">Clear</button>`:''}
          </div>
        </div>
        <div class="muted" style="font-size:11px;margin-top:8px;">
          Daily log so far for this subject: ${st.present} present · ${st.absent} absent · ${st.cancelled} cancelled.
          Attendance % = attended ÷ (held classes), where cancelled classes never count against you.
        </div>
      </div>
    </td></tr>`:''}`).join("") || "";

  return `
  <div class="between" style="margin-bottom:16px;">
    <p class="muted" style="max-width:470px;">Mark attendance day by day, or enter a manual summary per subject — you choose whether the manual numbers <b>override</b> the daily log or <b>add to</b> it. Lab frequency follows credit: ≥1.5 cr = weekly, lower = alternate weeks.</p>
    <div class="row" style="flex-wrap:wrap;max-width:480px;">
      <input type="text" id="newSubjName" placeholder="Subject name" style="width:150px;">
      <input type="text" id="newSubjCode" placeholder="Code" style="width:80px;">
      <select id="newSubjType" style="width:90px;" onchange="document.getElementById('newSubjLabWeek').style.display = this.value==='Lab' ? 'inline-block':'none'">
        <option>Theory</option><option>Lab</option>
      </select>
      <input type="number" id="newSubjCredit" placeholder="Credit" step="0.25" style="width:70px;" value="3">
      <select id="newSubjLabWeek" style="width:100px;display:none;">
        <option value="even">Even weeks</option><option value="odd">Odd weeks</option>
      </select>
      <button class="btn primary sm" onclick="addSubject()">+ Add</button>
    </div>
  </div>
  <div class="card card-pad" style="overflow-x:auto;">
    ${STATE.subjects.length ? `<table style="min-width:860px;"><thead><tr><th>Subject</th><th>Type</th><th>Present</th><th>Absent</th><th>Cancelled</th><th>Held</th><th>%</th><th>Status</th><th>Prediction</th><th></th><th></th></tr></thead><tbody>${rows}</tbody></table>` : `<div class="empty"><div class="big">▣</div>No subjects yet — add one above, then set its weekly slot in Class Routine.</div>`}
  </div>`;
}
function toggleManualAttendance(subjectId){ MANUAL_ATT_OPEN = MANUAL_ATT_OPEN===subjectId ? null : subjectId; render(); }
function saveManualAttendance(subjectId){
  const s = STATE.subjects.find(x=>x.id===subjectId); if(!s) return;
  s.manualAttendance = {
    total: parseInt(document.getElementById(`manTotal-${subjectId}`).value)||0,
    attended: parseInt(document.getElementById(`manAttended-${subjectId}`).value)||0,
    cancelled: parseInt(document.getElementById(`manCancelled-${subjectId}`).value)||0,
    upToDate: document.getElementById(`manUpTo-${subjectId}`).value,
    countingMode: document.getElementById(`manMode-${subjectId}`).value,
    addToLog: document.getElementById(`manAdd-${subjectId}`).value === "yes"
  };
  MANUAL_ATT_OPEN = null;
  saveState(); render();
}
function clearManualAttendance(subjectId){
  const s = STATE.subjects.find(x=>x.id===subjectId); if(!s) return;
  s.manualAttendance = null;
  MANUAL_ATT_OPEN = null;
  saveState(); render();
}
function addSubject(){
  const name = document.getElementById("newSubjName").value.trim();
  const code = document.getElementById("newSubjCode").value.trim();
  const type = document.getElementById("newSubjType").value;
  const credit = parseFloat(document.getElementById("newSubjCredit").value) || 0;
  const labWeek = document.getElementById("newSubjLabWeek").value;
  if(!name) return;
  const id = uid();
  STATE.subjects.push({id, name, code, type, credit, labWeek, manualAttendance:null});
  // Theory subjects automatically get 4 blank CT slots; labs get none (labs have no CTs).
  if(type === "Theory") seedCtSlots(id);
  saveState(); render();
}
function deleteSubject(id){
  if(!confirm("Remove this subject? Its routine slots and logged attendance stay in data but won't display.")) return;
  STATE.subjects = STATE.subjects.filter(s=>s.id!==id);
  STATE.ctMarks = STATE.ctMarks.filter(c=>c.subjectId!==id);
  saveState(); render();
}

/* ============================================================
   CT MARKS — own page. Theory subjects only, auto 4 slots,
   marks out of 20, add extra CTs, best-N shown in MARKS not %.
   ============================================================ */
function seedCtSlots(subjectId, count){
  count = count || CT_DEFAULT_COUNT;
  for(let n=1; n<=count; n++){
    if(!STATE.ctMarks.some(c=>c.subjectId===subjectId && c.ctNo===n)){
      STATE.ctMarks.push({id:uid(), subjectId, ctNo:n, marks:null, outOf:CT_DEFAULT_OUT_OF, date:"", topic:"", note:""});
    }
  }
}
function ctBestNMarks(cts, n){
  // Only CTs with a real entered mark count. Returns MARKS-based figures.
  const taken = cts.filter(c=>c.marks!==null && c.marks!=='' && !isNaN(Number(c.marks)))
                   .map(c=>({...c, marks:Number(c.marks), outOf:Number(c.outOf)||CT_DEFAULT_OUT_OF}));
  if(!taken.length) return {taken:[], bestSet:new Set(), bestAvgMarks:null, bestOutOf:CT_DEFAULT_OUT_OF, highest:null, lowest:null, allAvgMarks:null, countUsed:0};
  const sorted = taken.slice().sort((a,b)=> (b.marks/b.outOf) - (a.marks/a.outOf));
  const used = sorted.slice(0, Math.min(n, sorted.length));
  const bestSet = new Set(used.map(c=>c.id));
  const bestAvgMarks = used.reduce((a,c)=>a+c.marks,0)/used.length;
  const allAvgMarks = taken.reduce((a,c)=>a+c.marks,0)/taken.length;
  const bestOutOf = used[0].outOf;
  return {
    taken, bestSet, bestAvgMarks, bestOutOf,
    highest: Math.max(...taken.map(c=>c.marks)),
    lowest: Math.min(...taken.map(c=>c.marks)),
    allAvgMarks, countUsed: used.length
  };
}
function renderCtPage(){
  const theory = STATE.subjects.filter(s=>s.type==="Theory");
  if(!theory.length){
    return `<div class="card card-pad"><div class="empty"><div class="big">📝</div>No theory subjects yet. Add one on the <a href="#attendance" onclick="navigate('attendance')" style="color:var(--accent-red);font-weight:600;">Attendance</a> page — CT slots are created automatically.<br><span class="muted" style="font-size:12px;">Lab subjects don't get CTs.</span></div></div>`;
  }

  const blocks = theory.map(s=>{
    const cts = STATE.ctMarks.filter(c=>c.subjectId===s.id).sort((a,b)=>a.ctNo-b.ctNo);
    const bn = ctBestNMarks(cts, STATE.ctBestN);
    const slotRows = cts.map(c=>{
      const isBest = bn.bestSet.has(c.id);
      const hasMark = c.marks!==null && c.marks!=='' && !isNaN(Number(c.marks));
      return `<div class="ct-slot ${isBest?'ct-best':''}">
        <div class="ct-slot-no">CT ${c.ctNo}${isBest?' <span class="badge ok" style="font-size:9px;">counted</span>':''}</div>
        <div class="row" style="gap:6px;">
          <input type="number" value="${hasMark?c.marks:''}" placeholder="—" style="width:74px;text-align:center;font-weight:700;"
                 onchange="setCtMark('${c.id}','marks',this.value)">
          <span class="muted" style="font-size:12px;">/</span>
          <input type="number" value="${c.outOf||CT_DEFAULT_OUT_OF}" style="width:64px;text-align:center;"
                 onchange="setCtMark('${c.id}','outOf',this.value)">
          <button class="icon-btn" onclick="deleteCT('${c.id}')" title="Remove this CT slot">✕</button>
        </div>
        <input type="text" value="${escapeHtml(c.topic||'')}" placeholder="Topic (optional)" style="margin-top:6px;font-size:12px;"
               onchange="setCtMark('${c.id}','topic',this.value)">
      </div>`;
    }).join("");

    const nextNo = cts.length ? Math.max(...cts.map(c=>c.ctNo))+1 : 1;
    return `<div class="card card-pad" style="margin-bottom:14px;">
      <div class="between" style="align-items:flex-start;margin-bottom:12px;">
        <div>
          <div style="font-weight:700;font-size:15px;">${escapeHtml(s.name)}</div>
          <div class="muted" style="font-size:11.5px;">${escapeHtml(s.code||'')} · ${bn.taken.length} of ${cts.length} CTs taken</div>
        </div>
        <div style="text-align:right;">
          ${bn.bestAvgMarks===null
            ? `<div class="muted" style="font-size:12px;">No marks entered yet</div>`
            : `<div class="hud-marks">${bn.bestAvgMarks.toFixed(2)} <span class="hud-marks-of">/ ${bn.bestOutOf}</span></div>
               <div class="muted" style="font-size:10.5px;">Best ${bn.countUsed} average</div>`}
        </div>
      </div>
      <div class="ct-grid">${slotRows}</div>
      <div class="row" style="margin-top:12px;justify-content:space-between;">
        <button class="btn sm" onclick="addExtraCt('${s.id}',${nextNo})">+ Add extra CT (CT ${nextNo})</button>
        ${bn.taken.length ? `<div class="muted" style="font-size:11.5px;">
          Highest <b>${bn.highest}</b> · Lowest <b>${bn.lowest}</b> · All-CT avg <b>${bn.allAvgMarks.toFixed(2)}</b> / ${bn.bestOutOf}
        </div>` : ''}
      </div>
    </div>`;
  }).join("");

  return `
  <div class="between" style="margin-bottom:16px;">
    <p class="muted" style="max-width:520px;">Every theory subject automatically gets ${CT_DEFAULT_COUNT} CT slots out of ${CT_DEFAULT_OUT_OF} marks — just type the marks as you get them. Lab subjects are excluded. Results are shown in <b>marks</b>, not percentages.</p>
    <div class="row">
      <label class="field-label" style="margin:0;">Best</label>
      <input type="number" value="${STATE.ctBestN}" min="1" style="width:64px;" onchange="setCtBestN(this.value)">
      <span class="muted" style="font-size:12px;">CTs count</span>
    </div>
  </div>
  ${blocks}`;
}
function setCtMark(ctId, field, value){
  const c = STATE.ctMarks.find(x=>x.id===ctId); if(!c) return;
  if(field==="marks"){
    c.marks = (value===""||value===null) ? null : parseFloat(value);
    if(c.marks!==null && !c.date) c.date = todayISO();
  } else if(field==="outOf"){
    c.outOf = parseFloat(value)||CT_DEFAULT_OUT_OF;
  } else {
    c[field] = value;
  }
  saveState(); render();
}
function addExtraCt(subjectId, ctNo){
  STATE.ctMarks.push({id:uid(), subjectId, ctNo, marks:null, outOf:CT_DEFAULT_OUT_OF, date:"", topic:"", note:""});
  saveState(); render();
}
function setCtBestN(v){
  STATE.ctBestN = Math.max(1, parseInt(v)||1);
  saveState(); render();
}
function deleteCT(id){
  STATE.ctMarks = STATE.ctMarks.filter(c=>c.id!==id);
  saveState(); render();
}

/* ============================================================
   JOURNAL PAGE — list of all entries
   ============================================================ */
function renderJournalPage(){
  const entries = Object.keys(STATE.days).filter(iso=>STATE.days[iso].journal && STATE.days[iso].journal.trim()).sort().reverse();
  const html = entries.map(iso=>`
    <div class="card card-pad" style="margin-bottom:12px;">
      <div class="between" style="margin-bottom:8px;">
        <b>${fmtDate(iso)}</b>
        <button class="btn sm ghost" onclick="navigate('day',{date:'${iso}'})">Open day →</button>
      </div>
      <p style="white-space:pre-wrap;margin:0;color:var(--ink-soft);">${escapeHtml(STATE.days[iso].journal)}</p>
    </div>`).join("");
  return entries.length ? html : `<div class="card card-pad empty"><div class="big">✎</div>No journal entries yet. Write one from any Day page.</div>`;
}

/* ============================================================
   EXPENSES PAGE
   ============================================================ */
let expensesChart = null;
function renderExpensesPage(){
  const allExp = [];
  Object.keys(STATE.days).forEach(iso=> STATE.days[iso].expenses.forEach(e=>allExp.push({...e, iso})));
  const byFund = {};
  STATE.funds.forEach(f=>byFund[f.name]=0);
  allExp.forEach(e=>{ byFund[e.fund] = (byFund[e.fund]||0) + Number(e.amount||0); });
  const totalSpent = Object.values(byFund).reduce((a,b)=>a+b,0);

  const moneyInByFund = {};
  STATE.funds.forEach(f=>moneyInByFund[f.name]=0);
  STATE.moneyIn.forEach(m=>{ if(m.destinationFund) moneyInByFund[m.destinationFund] = (moneyInByFund[m.destinationFund]||0) + Number(m.amount||0); });
  const totalReceived = STATE.moneyIn.reduce((a,m)=>a+Number(m.amount||0),0);
  const totalStarting = STATE.funds.reduce((a,f)=>a+Number(f.startingBalance||0),0);
  const available = totalStarting + totalReceived - totalSpent;
  const netChange = totalReceived - totalSpent;

  const recentRows = allExp.sort((a,b)=>b.iso.localeCompare(a.iso)).slice(0,25).map(e=>`
    <tr><td>${fmtShort(e.iso)}</td><td><span class="badge neutral">${escapeHtml(e.fund)}</span></td><td>${escapeHtml(e.desc||'—')}</td><td class="mono" style="text-align:right;">৳${Number(e.amount).toLocaleString()}</td></tr>`).join("") || `<tr><td colspan="4" class="empty">No expenses logged yet.</td></tr>`;
  const fundRows = STATE.funds.map(f=>{
    const bal = Number(f.startingBalance||0) + (moneyInByFund[f.name]||0) - (byFund[f.name]||0);
    return `
    <div class="list-item">
      <div style="flex:1;font-weight:600;">${escapeHtml(f.name)}<div class="muted" style="font-size:10.5px;">start ৳${Number(f.startingBalance||0).toLocaleString()}</div></div>
      <div class="mono" style="text-align:right;">
        <div style="font-weight:700;">৳${bal.toLocaleString()}</div>
        <div class="muted" style="font-size:10px;">spent ৳${(byFund[f.name]||0).toLocaleString()}</div>
      </div>
      <button class="icon-btn" onclick="editFundBalance('${escapeHtml(f.name)}')" title="Edit starting balance">✎</button>
      <button class="icon-btn" onclick="deleteFund('${escapeHtml(f.name)}')">✕</button>
    </div>`;
  }).join("");

  return `
  <div class="grid grid-4" style="margin-bottom:18px;">
    <div class="kpi" style="background:var(--success-soft);"><div class="label" style="color:var(--success);">Available</div><div class="value" style="color:var(--success);">৳${available.toLocaleString()}</div></div>
    <div class="kpi" style="background:#E3F2FD;"><div class="label" style="color:#1565C0;">Received</div><div class="value" style="color:#1565C0;">৳${totalReceived.toLocaleString()}</div></div>
    <div class="kpi" style="background:#F3E5F5;"><div class="label" style="color:#8E24AA;">Spent</div><div class="value" style="color:#8E24AA;">৳${totalSpent.toLocaleString()}</div></div>
    <div class="kpi" style="background:${netChange>=0?'var(--success-soft)':'var(--danger-soft)'};"><div class="label" style="color:${netChange>=0?'var(--success)':'var(--danger)'};">Net Change</div><div class="value" style="color:${netChange>=0?'var(--success)':'var(--danger)'};">${netChange>=0?'+':''}৳${netChange.toLocaleString()}</div></div>
  </div>
  <div class="grid grid-2">
    <div class="card card-pad">
      <div class="section-title">By Fund</div>
      <canvas id="expChart" height="200"></canvas>
    </div>
    <div class="card card-pad">
      <div class="section-title">Funds <span class="tag">balance = start + received − spent</span></div>
      ${fundRows}
      <div class="row" style="margin-top:10px;">
        <input type="text" id="newFundName" placeholder="New fund name…">
        <input type="number" id="newFundStart" placeholder="Starting ৳" style="width:110px;">
        <button class="btn primary sm" onclick="addFund()">+ Add</button>
      </div>
    </div>
  </div>
  <div class="card card-pad" style="margin-top:16px;">
    <div class="section-title">Recent Expenses</div>
    <table><thead><tr><th>Date</th><th>Fund</th><th>Description</th><th style="text-align:right;">Amount</th></tr></thead><tbody>${recentRows}</tbody></table>
  </div>`;
}
function afterRenderExpenses(){
  const canvas = document.getElementById("expChart");
  if(!canvas || typeof Chart==="undefined") return;
  const byFund = {};
  STATE.funds.forEach(f=>byFund[f.name]=0);
  Object.keys(STATE.days).forEach(iso=> STATE.days[iso].expenses.forEach(e=>{ byFund[e.fund]=(byFund[e.fund]||0)+Number(e.amount||0); }));
  if(expensesChart) expensesChart.destroy();
  expensesChart = new Chart(canvas, {
    type:'doughnut',
    data:{ labels:Object.keys(byFund), datasets:[{ data:Object.values(byFund),
      backgroundColor:['#6C93B0','#E3A63E','#CC8B3C','#C1654A','#4B4272','#5C8A66','#8E24AA','#607D8B'] }]},
    options:{ plugins:{ legend:{ position:'bottom', labels:{ font:{ family:'Inter', size:11 } } } } }
  });
}
function addFund(){
  const v = document.getElementById("newFundName").value.trim();
  const start = parseFloat(document.getElementById("newFundStart").value)||0;
  if(!v || STATE.funds.some(f=>f.name===v)) return;
  STATE.funds.push({name:v, startingBalance:start}); saveState(); render();
}
function deleteFund(f){
  if(!confirm(`Remove fund "${f}"? Past transactions keep their tag.`)) return;
  STATE.funds = STATE.funds.filter(x=>x.name!==f); saveState(); render();
}
function editFundBalance(fundName){
  const f = STATE.funds.find(x=>x.name===fundName); if(!f) return;
  const val = prompt(`Starting balance for ${fundName}:`, f.startingBalance||0);
  if(val===null) return;
  const num = parseFloat(val);
  if(!isNaN(num)){ f.startingBalance = num; saveState(); render(); }
}

/* ============================================================
   FINANCE PAGE — Money In + Financial Overview
   ============================================================ */
function monthKey(iso){ return (iso||"").slice(0,7); }
function renderFinancePage(){
  const fundOptions = STATE.funds.map(f=>`<option value="${escapeHtml(f.name)}">${escapeHtml(f.name)}</option>`).join("");
  const thisMonth = todayISO().slice(0,7);

  const allExp = [];
  Object.keys(STATE.days).forEach(iso=> STATE.days[iso].expenses.forEach(e=>allExp.push({...e, iso})));
  const totalSpent = allExp.reduce((a,e)=>a+Number(e.amount||0),0);
  const totalReceived = STATE.moneyIn.reduce((a,m)=>a+Number(m.amount||0),0);
  const totalStarting = STATE.funds.reduce((a,f)=>a+Number(f.startingBalance||0),0);
  const available = totalStarting + totalReceived - totalSpent;

  const monthReceived = STATE.moneyIn.filter(m=>monthKey(m.date)===thisMonth).reduce((a,m)=>a+Number(m.amount||0),0);
  const monthSpent = allExp.filter(e=>monthKey(e.iso)===thisMonth).reduce((a,e)=>a+Number(e.amount||0),0);
  const todaySpent = allExp.filter(e=>e.iso===todayISO()).reduce((a,e)=>a+Number(e.amount||0),0);

  const familySources = ["Family","Father","Mother"];
  const familyThisMonth = STATE.moneyIn.filter(m=>familySources.includes(m.source) && monthKey(m.date)===thisMonth);
  const familyTotal = familyThisMonth.reduce((a,m)=>a+Number(m.amount||0),0);
  const familyBySource = {};
  familyThisMonth.forEach(m=>{ familyBySource[m.source] = (familyBySource[m.source]||0) + Number(m.amount||0); });
  const familyRows = Object.entries(familyBySource).map(([src,amt])=>`
    <div class="list-item"><div style="flex:1;">${escapeHtml(src)}</div><div class="mono" style="font-weight:700;">৳${amt.toLocaleString()}</div></div>`).join("") || `<div class="empty">No family money logged this month.</div>`;

  const rows = STATE.moneyIn.slice().sort((a,b)=>b.date.localeCompare(a.date)).slice(0,30).map(m=>`
    <tr>
      <td>${fmtShort(m.date)}</td>
      <td><span class="badge neutral">${escapeHtml(m.source)}</span></td>
      <td>${escapeHtml(m.category||'—')}</td>
      <td>${escapeHtml(m.destinationFund||'—')}</td>
      <td>${escapeHtml(m.note||'')}</td>
      <td class="mono" style="text-align:right;">৳${Number(m.amount).toLocaleString()}</td>
      <td><button class="icon-btn" onclick="deleteMoneyIn('${m.id}')">✕</button></td>
    </tr>`).join("") || `<tr><td colspan="7" class="empty">No money received logged yet.</td></tr>`;

  return `
  <div class="grid grid-4" style="margin-bottom:18px;">
    <div class="kpi" style="background:var(--success-soft);"><div class="label" style="color:var(--success);">Money Available</div><div class="value" style="color:var(--success);">৳${available.toLocaleString()}</div></div>
    <div class="kpi" style="background:#E3F2FD;"><div class="label" style="color:#1565C0;">Received (all time)</div><div class="value" style="color:#1565C0;">৳${totalReceived.toLocaleString()}</div></div>
    <div class="kpi" style="background:var(--paper);"><div class="label">This Month Spent</div><div class="value">৳${monthSpent.toLocaleString()}</div></div>
    <div class="kpi" style="background:var(--paper);"><div class="label">Today's Spend</div><div class="value">৳${todaySpent.toLocaleString()}</div></div>
  </div>
  <div class="grid grid-2" style="margin-bottom:16px;">
    <div class="card card-pad">
      <div class="section-title">📥 Log Money In</div>
      <div class="row" style="flex-wrap:wrap;margin-bottom:10px;">
        <select id="miSource" style="width:110px;">${MONEY_SOURCES.map(s=>`<option>${s}</option>`).join("")}</select>
        <input type="text" id="miCategory" placeholder="Category (optional)" style="width:130px;">
        <select id="miFund" style="width:120px;">${fundOptions}</select>
      </div>
      <div class="row">
        <input type="number" id="miAmount" placeholder="৳ Amount">
        <input type="date" id="miDate" value="${todayISO()}" style="width:150px;">
      </div>
      <input type="text" id="miNote" placeholder="Note (optional)" style="margin:8px 0;">
      <button class="btn primary sm" onclick="addMoneyIn()">+ Add</button>
    </div>
    <div class="card card-pad">
      <div class="section-title">👨‍👩‍👧 Family Money — This Month <span class="tag">৳${familyTotal.toLocaleString()}</span></div>
      ${familyRows}
    </div>
  </div>
  <div class="card card-pad">
    <div class="section-title">Money In — Log</div>
    <div style="overflow-x:auto;">
    <table><thead><tr><th>Date</th><th>Source</th><th>Category</th><th>Fund</th><th>Note</th><th style="text-align:right;">Amount</th><th></th></tr></thead><tbody>${rows}</tbody></table>
    </div>
  </div>`;
}
function addMoneyIn(){
  const amount = parseFloat(document.getElementById("miAmount").value);
  if(!amount) return;
  STATE.moneyIn.push({
    id:uid(), amount,
    date: document.getElementById("miDate").value || todayISO(),
    source: document.getElementById("miSource").value,
    category: document.getElementById("miCategory").value.trim(),
    destinationFund: document.getElementById("miFund").value,
    note: document.getElementById("miNote").value.trim()
  });
  saveState(); render();
}
function deleteMoneyIn(id){
  STATE.moneyIn = STATE.moneyIn.filter(m=>m.id!==id);
  saveState(); render();
}

/* ============================================================
   PEOPLE & MONEY PAGE
   ============================================================ */
const GIVE_DIRECTIONS = {"I paid for them":"i_gave", "I sent them money":"i_gave", "They paid for me":"they_gave", "They sent me money":"they_gave", "Shared expense":"i_gave", "Other":"i_gave"};
function personBalance(personId){
  const txns = STATE.personTransactions.filter(t=>t.personId===personId);
  let iGave=0, theyGave=0;
  txns.forEach(t=>{ if(t.direction==="i_gave") iGave += Number(t.amount||0); else theyGave += Number(t.amount||0); });
  return {iGave, theyGave, net: iGave - theyGave};
}
function renderPeoplePage(){
  const peopleRows = STATE.people.map(p=>{
    const bal = personBalance(p.id);
    const label = bal.net>0 ? `<span class="badge bad">${escapeHtml(p.name)} owes you ৳${bal.net.toLocaleString()}</span>`
                : bal.net<0 ? `<span class="badge warn">You owe ${escapeHtml(p.name)} ৳${Math.abs(bal.net).toLocaleString()}</span>`
                : `<span class="badge ok">Settled</span>`;
    return `<div class="card card-pad" style="margin-bottom:12px;">
      <div class="between" style="margin-bottom:8px;">
        <div style="font-weight:700;font-size:15px;">${escapeHtml(p.name)}</div>
        ${label}
      </div>
      <div class="muted" style="font-size:12px;margin-bottom:8px;">You gave ৳${bal.iGave.toLocaleString()} · They gave ৳${bal.theyGave.toLocaleString()}</div>
      ${personTxnRows(p.id)}
      <div class="row" style="margin-top:10px;flex-wrap:wrap;">
        <select id="ptType-${p.id}" style="width:150px;">${PERSON_TXN_TYPES.map(t=>`<option>${t}</option>`).join("")}</select>
        <select id="ptDirection-${p.id}" style="width:110px;"><option value="i_gave">I gave</option><option value="they_gave">They gave</option></select>
        <input type="number" id="ptAmount-${p.id}" placeholder="৳" style="width:90px;">
        <input type="date" id="ptDate-${p.id}" value="${todayISO()}" style="width:150px;">
        <input type="text" id="ptNote-${p.id}" placeholder="Note (optional)">
        <button class="btn sm primary" onclick="addPersonTxn('${p.id}')">+ Add</button>
      </div>
      <button class="btn sm danger" style="margin-top:8px;" onclick="deletePerson('${p.id}')">Remove person</button>
    </div>`;
  }).join("") || `<div class="card card-pad"><div class="empty"><div class="big">👥</div>No people yet — add one below.</div></div>`;

  return `
  <div class="card card-pad" style="margin-bottom:16px;">
    <div class="section-title">+ Add Person</div>
    <div class="row">
      <input type="text" id="newPersonName" placeholder="Name">
      <button class="btn primary sm" onclick="addPerson()">Add</button>
    </div>
  </div>
  ${peopleRows}`;
}
function personTxnRows(personId){
  const txns = STATE.personTransactions.filter(t=>t.personId===personId).sort((a,b)=>b.date.localeCompare(a.date));
  if(!txns.length) return `<div class="muted" style="font-size:12px;">No transactions yet.</div>`;
  return txns.map(t=>`
    <div class="list-item" style="font-size:12.5px;">
      <span class="badge ${t.direction==='i_gave'?'neutral':'ok'}">${t.direction==='i_gave'?'I gave':'They gave'}</span>
      <div style="flex:1;">${escapeHtml(t.type)}${t.note?' — '+escapeHtml(t.note):''}</div>
      <span class="muted">${fmtShort(t.date)}</span>
      <span class="mono" style="font-weight:700;">৳${Number(t.amount).toLocaleString()}</span>
      <button class="icon-btn" onclick="deletePersonTxn('${t.id}')">✕</button>
    </div>`).join("");
}
function addPerson(){
  const name = document.getElementById("newPersonName").value.trim();
  if(!name) return;
  STATE.people.push({id:uid(), name});
  saveState(); render();
}
function deletePerson(id){
  if(!confirm("Remove this person? Their transaction history will be removed too.")) return;
  STATE.people = STATE.people.filter(p=>p.id!==id);
  STATE.personTransactions = STATE.personTransactions.filter(t=>t.personId!==id);
  saveState(); render();
}
function addPersonTxn(personId){
  const type = document.getElementById(`ptType-${personId}`).value;
  const direction = document.getElementById(`ptDirection-${personId}`).value;
  const amount = parseFloat(document.getElementById(`ptAmount-${personId}`).value);
  const date = document.getElementById(`ptDate-${personId}`).value || todayISO();
  const note = document.getElementById(`ptNote-${personId}`).value.trim();
  if(!amount) return;
  STATE.personTransactions.push({id:uid(), personId, type, direction, amount, date, note});
  saveState(); render();
}
function deletePersonTxn(id){
  STATE.personTransactions = STATE.personTransactions.filter(t=>t.id!==id);
  saveState(); render();
}

/* ============================================================
   READING PAGE
   ============================================================ */
function renderReadingPage(){
  const rows = STATE.reading.map(b=>{
    const pct = b.totalPages ? Math.min(100, Math.round(b.pagesRead/b.totalPages*100)) : 0;
    return `<tr>
      <td style="font-weight:700;">${escapeHtml(b.title)}<div class="muted" style="font-size:11px;">${b.type}</div></td>
      <td><input type="number" value="${b.pagesRead}" style="width:70px;" onchange="updateReading('${b.id}','pagesRead',this.value)"> / <input type="number" value="${b.totalPages}" style="width:70px;" onchange="updateReading('${b.id}','totalPages',this.value)"></td>
      <td style="width:140px;"><div class="progress-track"><div class="progress-fill" style="width:${pct}%;background:var(--isha);"></div></div><span class="mono" style="font-size:11px;">${pct}%</span></td>
      <td><select onchange="updateReading('${b.id}','status',this.value)">
        ${["Not Started","In Progress","Completed","On Hold"].map(s=>`<option ${s===b.status?'selected':''}>${s}</option>`).join("")}
      </select></td>
      <td><button class="icon-btn" onclick="deleteReading('${b.id}')">✕</button></td>
    </tr>`;
  }).join("") || "";
  return `
  <div class="between" style="margin-bottom:16px;">
    <p class="muted">Track books, papers, and course material. Progress updates live.</p>
    <button class="btn primary sm" onclick="addReading()">+ Add Title</button>
  </div>
  <div class="card card-pad" style="overflow-x:auto;">
    ${STATE.reading.length ? `<table><thead><tr><th>Title</th><th>Pages</th><th>Progress</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : `<div class="empty"><div class="big">▥</div>Nothing on your list yet.</div>`}
  </div>`;
}
function addReading(){
  STATE.reading.push({id:uid(), title:"New title", type:"Book", totalPages:100, pagesRead:0, startDate:todayISO(), targetDate:"", status:"Not Started"});
  saveState(); render();
}
function updateReading(id, field, value){
  const b = STATE.reading.find(x=>x.id===id); if(!b) return;
  b[field] = (field==="pagesRead"||field==="totalPages") ? parseInt(value)||0 : value;
  saveState(); render();
}
function deleteReading(id){ STATE.reading = STATE.reading.filter(x=>x.id!==id); saveState(); render(); }

/* ============================================================
   ROUTINE PAGE — weekly class schedule
   ============================================================ */
function renderRoutinePage(){
  const cols = BD_DOW_NAMES.map((name, idx)=>{
    const slots = STATE.routine[idx]||[];
    const items = slots.map((cls,i)=>{
      const subj = STATE.subjects.find(s=>s.id===cls.subjectId);
      return `<div class="list-item">
        <div style="flex:1;">
          <div style="font-weight:600;font-size:12.5px;">${subj?escapeHtml(subj.name):'(deleted)'}</div>
          <div class="muted" style="font-size:11px;">${escapeHtml(cls.time||'')}</div>
          ${subj?`<div class="muted" style="font-size:10px;">${subjectFrequencyLabel(subj)}</div>`:''}
        </div>
        <button class="icon-btn" onclick="removeRoutineSlot(${idx},${i})">✕</button>
      </div>`;
    }).join("") || `<div class="muted" style="font-size:12px;padding:8px 0;">No classes</div>`;
    const subjOptions = STATE.subjects.map(s=>`<option value="${s.id}">${escapeHtml(s.name)} — ${s.type} ${s.credit}cr</option>`).join("");
    return `<div class="card card-pad">
      <div class="section-title" style="font-size:13px;">${name}</div>
      ${items}
      <div class="divider"></div>
      <input type="text" id="rt-time-${idx}" placeholder="e.g. 10:00-11:00" style="margin-bottom:6px;font-size:12px;">
      <select id="rt-subj-${idx}" style="margin-bottom:6px;font-size:12px;">${subjOptions || '<option value="">Add a subject first</option>'}</select>
      <button class="btn sm" style="width:100%;" onclick="addRoutineSlot(${idx})">+ Add class</button>
    </div>`;
  }).join("");
  return `<p class="muted" style="margin-bottom:14px;">This weekly schedule auto-populates the Attendance checklist on each Day page. Set each subject's type and credit on the Attendance page — theory subjects typically meet 3×/week; labs follow credit (≥1.5 cr weekly, lower alternate weeks).</p>
  <div class="routine-grid">${cols}</div>`;
}
function addRoutineSlot(dowIdx){
  const time = document.getElementById(`rt-time-${dowIdx}`).value.trim();
  const subjectId = document.getElementById(`rt-subj-${dowIdx}`).value;
  if(!subjectId) return;
  STATE.routine[dowIdx].push({time, subjectId});
  saveState(); render();
}
function removeRoutineSlot(dowIdx, i){
  STATE.routine[dowIdx].splice(i,1);
  saveState(); render();
}

/* ============================================================
   DEV PROGRESS PAGE — Papers / CSE / Electrical
   ============================================================ */
let DEV_TAB = "papers";
function renderDevPage(){
  const tabs = ["papers","cse","eee"];
  const labels = {papers:"📄 Research Papers", cse:"💻 CSE Side", eee:"⚡ Electrical Side"};
  const statusLists = {
    papers:["Idea","Literature Review","Writing","Internal Review","Submitted","Under Revision","Published"],
    cse:["Not Started","Learning","Building","Testing","Completed"],
    eee:["Not Started","Learning","Building","Testing","Completed"]
  };
  const items = STATE.dev[DEV_TAB];
  const avg = items.length ? Math.round(items.reduce((a,b)=>a+Number(b.progress||0),0)/items.length) : 0;
  const barColor = DEV_TAB==='papers'?'#8D6E63':DEV_TAB==='cse'?'#5C6BC0':'#FF7043';
  const rows = items.map(it=>{
    const hasSubtasks = it.subtasks && it.subtasks.length>0;
    const subtaskHtml = (it.subtasks||[]).map(st=>`
      <div class="list-item" style="padding:5px 0;">
        <div class="checkbox ${st.done?'checked':''}" style="width:17px;height:17px;" onclick="toggleSubtask('${it.id}','${st.id}')">${st.done?'✓':''}</div>
        <div style="flex:1;font-size:12.5px;${st.done?'text-decoration:line-through;color:var(--ink-soft);':''}">${escapeHtml(st.text)}</div>
        <button class="icon-btn" onclick="deleteSubtask('${it.id}','${st.id}')">✕</button>
      </div>`).join("");
    return `
    <div class="card card-pad" style="margin-bottom:10px;">
      <div class="row" style="margin-bottom:8px;">
        <input type="text" value="${escapeHtml(it.title)}" style="font-weight:700;flex:2;" onchange="updateDevItem('${it.id}','title',this.value)">
        <input type="text" value="${escapeHtml(it.journal||it.category||'')}" placeholder="${DEV_TAB==='papers'?'Target journal':'Category'}" style="flex:1;" onchange="updateDevItem('${it.id}','${DEV_TAB==='papers'?'journal':'category'}',this.value)">
        <button class="icon-btn" onclick="deleteDevItem('${it.id}')">✕</button>
      </div>
      <div class="row">
        <div style="flex:1;">
          <div class="progress-track"><div class="progress-fill" style="width:${it.progress}%;background:${barColor};"></div></div>
        </div>
        ${hasSubtasks
          ? `<span class="mono" style="width:38px;">${it.progress}%</span><span class="badge neutral">auto from parts</span>`
          : `<input type="range" min="0" max="100" value="${it.progress}" style="width:120px;" oninput="updateDevItem('${it.id}','progress',this.value,true)"><span class="mono" style="width:38px;">${it.progress}%</span>`}
        <select onchange="updateDevItem('${it.id}','status',this.value)">
          ${statusLists[DEV_TAB].map(s=>`<option ${s===it.status?'selected':''}>${s}</option>`).join("")}
        </select>
      </div>
      <div class="divider"></div>
      <div class="section-title" style="font-size:12.5px;margin-bottom:6px;">Parts to do <span class="tag">${(it.subtasks||[]).filter(s=>s.done).length}/${(it.subtasks||[]).length}</span></div>
      ${subtaskHtml || `<div class="muted" style="font-size:12px;padding:4px 0 8px;">Break this into parts — progress % will be calculated from how many are checked off.</div>`}
      <div class="row" style="margin-top:6px;">
        <input type="text" id="newSubtask-${it.id}" placeholder="Add a part to do…" onkeydown="if(event.key==='Enter')addSubtask('${it.id}')">
        <button class="btn sm" onclick="addSubtask('${it.id}')">+ Add part</button>
      </div>
      <textarea placeholder="Notes…" style="margin-top:8px;min-height:40px;" onchange="updateDevItem('${it.id}','notes',this.value)">${escapeHtml(it.notes||it.deadline||'')}</textarea>
    </div>`;
  }).join("") || `<div class="empty">Nothing here yet — add your first item.</div>`;

  return `
  <div class="pill-tabs" style="margin-bottom:16px;">
    ${tabs.map(t=>`<button class="pill-tab ${DEV_TAB===t?'active':''}" onclick="DEV_TAB='${t}';render()">${labels[t]}</button>`).join("")}
  </div>
  <div class="grid grid-3" style="margin-bottom:16px;">
    <div class="kpi" style="background:var(--paper);"><div class="label">Average Progress</div><div class="value">${avg}%</div></div>
    <div class="kpi" style="background:var(--paper);"><div class="label">Items</div><div class="value">${items.length}</div></div>
    <div class="kpi" style="background:var(--paper);"><div class="label">Papers · CSE · EEE avg</div><div class="value" style="font-size:18px;">${devAvg('papers')}% · ${devAvg('cse')}% · ${devAvg('eee')}%</div></div>
  </div>
  ${rows}
  <button class="btn primary" onclick="addDevItem()">+ Add ${labels[DEV_TAB]} item</button>
  `;
}
function devAvg(tab){
  const items = STATE.dev[tab];
  return items.length ? Math.round(items.reduce((a,b)=>a+Number(b.progress||0),0)/items.length) : 0;
}
function addDevItem(){
  const base = {id:uid(), title:"New item", progress:0, status: DEV_TAB==="papers"?"Idea":"Not Started", notes:"", subtasks:[]};
  if(DEV_TAB==="papers") base.journal="";
  else base.category="";
  STATE.dev[DEV_TAB].push(base);
  saveState(); render();
}
function updateDevItem(id, field, value, isRange){
  const it = STATE.dev[DEV_TAB].find(x=>x.id===id); if(!it) return;
  it[field] = field==="progress" ? parseInt(value)||0 : value;
  saveState();
  if(isRange){
    // live-update without full re-render for smooth dragging
    const bar = event.target.parentElement.querySelector(".progress-fill");
    if(bar) bar.style.width = it.progress+"%";
    event.target.nextElementSibling.textContent = it.progress+"%";
  } else render();
}
function deleteDevItem(id){ STATE.dev[DEV_TAB] = STATE.dev[DEV_TAB].filter(x=>x.id!==id); saveState(); render(); }

/* ============================================================
   COURSES + MODULES
   ============================================================ */
function courseProgress(course){
  if(!course.modules || !course.modules.length){
    return course.manualProgress!==null && course.manualProgress!==undefined ? Number(course.manualProgress) : 0;
  }
  const done = course.modules.filter(m=>m.status==="Completed").length;
  return Math.round(done/course.modules.length*100);
}
let COURSE_OPEN = null;
function renderCoursesPage(){
  const cards = STATE.courses.map(c=>{
    const pct = courseProgress(c);
    const nMods = c.modules.length;
    const doneMods = c.modules.filter(m=>m.status==="Completed").length;
    const open = COURSE_OPEN === c.id;
    const modulesHtml = c.modules.map(m=>`
      <div class="card card-pad" style="margin-bottom:8px;background:var(--paper);">
        <div class="row" style="margin-bottom:6px;">
          <input type="text" value="${escapeHtml(m.title)}" style="font-weight:700;flex:2;" onchange="updateModule('${c.id}','${m.id}','title',this.value)">
          <select onchange="updateModule('${c.id}','${m.id}','status',this.value)">
            ${MODULE_STATUSES.map(s=>`<option ${s===m.status?'selected':''}>${s}</option>`).join("")}
          </select>
          <button class="icon-btn" onclick="deleteModule('${c.id}','${m.id}')">✕</button>
        </div>
        <textarea placeholder="Description…" style="margin-bottom:6px;min-height:36px;" onchange="updateModule('${c.id}','${m.id}','description',this.value)">${escapeHtml(m.description||'')}</textarea>
        <div class="row">
          <input type="text" id="resUrl-${m.id}" placeholder="Video/resource link" value="${escapeHtml(m.resourceUrl||'')}" onchange="updateModule('${c.id}','${m.id}','resourceUrl',this.value)">
          <input type="text" id="notesUrl-${m.id}" placeholder="Notes link" value="${escapeHtml(m.notesUrl||'')}" onchange="updateModule('${c.id}','${m.id}','notesUrl',this.value)">
          ${m.notesUrl?`<a href="${escapeHtml(m.notesUrl)}" target="_blank" rel="noopener" class="btn sm">Open Notes</a>`:''}
        </div>
      </div>`).join("") || `<div class="muted" style="font-size:12px;">No modules yet.</div>`;

    return `<div class="card card-pad" style="margin-bottom:14px;">
      <div class="between" style="align-items:flex-start;">
        <div style="flex:1;">
          <div class="row" style="margin-bottom:4px;">
            <input type="text" value="${escapeHtml(c.name)}" style="font-weight:700;font-size:15px;flex:2;" onchange="updateCourse('${c.id}','name',this.value)">
            <input type="text" placeholder="Platform" value="${escapeHtml(c.platform||'')}" style="width:130px;" onchange="updateCourse('${c.id}','platform',this.value)">
          </div>
          <div class="row" style="margin-bottom:6px;">
            <input type="text" placeholder="Instructor" value="${escapeHtml(c.instructor||'')}" onchange="updateCourse('${c.id}','instructor',this.value)">
            <select onchange="updateCourse('${c.id}','status',this.value)">${COURSE_STATUSES.map(s=>`<option ${s===c.status?'selected':''}>${s}</option>`).join("")}</select>
          </div>
          ${c.url?`<a href="${escapeHtml(c.url)}" target="_blank" rel="noopener" style="font-size:12px;color:var(--accent-red);font-weight:600;">Course link ↗</a>`:''}
        </div>
        <div style="text-align:right;min-width:110px;">
          <div style="font-family:var(--font-display);font-size:26px;font-weight:600;color:var(--accent-red);">${pct}%</div>
          <div class="muted" style="font-size:11px;">${doneMods}/${nMods} modules</div>
        </div>
      </div>
      <div class="progress-track" style="margin:10px 0;"><div class="progress-fill" style="width:${pct}%;"></div></div>
      <div class="row" style="justify-content:space-between;">
        <button class="btn sm" onclick="toggleCourseOpen('${c.id}')">${open?'Hide modules':'Show modules'}</button>
        <button class="icon-btn" onclick="deleteCourse('${c.id}')">✕ Remove course</button>
      </div>
      ${open ? `<div style="margin-top:12px;">
        ${modulesHtml}
        <div class="row" style="margin-top:8px;">
          <input type="text" id="newModuleTitle-${c.id}" placeholder="New module title…">
          <button class="btn sm primary" onclick="addModule('${c.id}')">+ Add Module</button>
        </div>
      </div>` : ''}
    </div>`;
  }).join("") || `<div class="card card-pad"><div class="empty"><div class="big">🎓</div>No courses yet — add one below.</div></div>`;

  return `
  <div class="card card-pad" style="margin-bottom:16px;">
    <div class="section-title">+ Add Course</div>
    <div class="grid grid-2">
      <input type="text" id="newCourseName" placeholder="Course name">
      <input type="text" id="newCoursePlatform" placeholder="Platform (Coursera, YouTube, …)">
    </div>
    <div class="row" style="margin-top:8px;">
      <input type="text" id="newCourseUrl" placeholder="Course URL (optional)">
      <button class="btn primary sm" onclick="addCourse()">Add</button>
    </div>
  </div>
  ${cards}`;
}
function toggleCourseOpen(id){ COURSE_OPEN = COURSE_OPEN===id ? null : id; render(); }
function addCourse(){
  const name = document.getElementById("newCourseName").value.trim();
  if(!name) return;
  STATE.courses.push({
    id:uid(), name, platform:document.getElementById("newCoursePlatform").value.trim(),
    instructor:"", url:document.getElementById("newCourseUrl").value.trim(),
    startDate:todayISO(), targetDate:"", status:"Not Started", notes:"", manualProgress:null, modules:[]
  });
  saveState(); render();
}
function updateCourse(id, field, value){
  const c = STATE.courses.find(x=>x.id===id); if(!c) return;
  c[field] = value; saveState(); render();
}
function deleteCourse(id){
  if(!confirm("Remove this course and all its modules?")) return;
  STATE.courses = STATE.courses.filter(c=>c.id!==id);
  saveState(); render();
}
function addModule(courseId){
  const input = document.getElementById(`newModuleTitle-${courseId}`);
  const title = input.value.trim();
  if(!title) return;
  const c = STATE.courses.find(x=>x.id===courseId); if(!c) return;
  c.modules.push({id:uid(), title, description:"", status:"Not Started", notes:"", resourceUrl:"", notesUrl:"", startDate:"", completionDate:""});
  saveState(); render();
}
function updateModule(courseId, moduleId, field, value){
  const c = STATE.courses.find(x=>x.id===courseId); if(!c) return;
  const m = c.modules.find(x=>x.id===moduleId); if(!m) return;
  m[field] = value;
  if(field==="status" && value==="Completed" && !m.completionDate) m.completionDate = todayISO();
  saveState(); render();
}
function deleteModule(courseId, moduleId){
  const c = STATE.courses.find(x=>x.id===courseId); if(!c) return;
  c.modules = c.modules.filter(m=>m.id!==moduleId);
  saveState(); render();
}

/* ============================================================
   RESEARCH HUB
   ============================================================ */
let RESEARCH_TAB = "projects";
function renderResearchPage(){
  const tabs = ["projects","papers"];
  const labels = {projects:"🔬 Projects", papers:"📄 Papers I'm Reading"};

  let body;
  if(RESEARCH_TAB==="projects"){
    body = STATE.research.projects.map(p=>`
      <div class="card card-pad" style="margin-bottom:12px;">
        <div class="row" style="margin-bottom:6px;">
          <input type="text" value="${escapeHtml(p.title)}" style="font-weight:700;flex:2;" onchange="updateResearchItem('projects','${p.id}','title',this.value)">
          <input type="text" placeholder="Research area" value="${escapeHtml(p.area||'')}" onchange="updateResearchItem('projects','${p.id}','area',this.value)">
        </div>
        <textarea placeholder="Research question" style="margin-bottom:6px;min-height:36px;" onchange="updateResearchItem('projects','${p.id}','question',this.value)">${escapeHtml(p.question||'')}</textarea>
        <textarea placeholder="Problem statement / abstract" style="margin-bottom:6px;" onchange="updateResearchItem('projects','${p.id}','abstract',this.value)">${escapeHtml(p.abstract||'')}</textarea>
        <div class="row" style="margin-bottom:6px;">
          <input type="text" placeholder="Supervisor" value="${escapeHtml(p.supervisor||'')}" onchange="updateResearchItem('projects','${p.id}','supervisor',this.value)">
          <input type="text" placeholder="Collaborators" value="${escapeHtml(p.collaborators||'')}" onchange="updateResearchItem('projects','${p.id}','collaborators',this.value)">
          <select onchange="updateResearchItem('projects','${p.id}','status',this.value)">${RESEARCH_STATUSES.map(s=>`<option ${s===p.status?'selected':''}>${s}</option>`).join("")}</select>
        </div>
        <div class="row" style="margin-bottom:6px;">
          <div style="flex:1;"><div class="progress-track"><div class="progress-fill" style="width:${p.progress||0}%;background:var(--maghrib);"></div></div></div>
          <input type="range" min="0" max="100" value="${p.progress||0}" style="width:120px;" oninput="updateResearchItem('projects','${p.id}','progress',this.value,true)">
          <span class="mono" style="width:36px;">${p.progress||0}%</span>
        </div>
        <div class="row">
          <input type="text" placeholder="Notes link" value="${escapeHtml(p.notesUrl||'')}" onchange="updateResearchItem('projects','${p.id}','notesUrl',this.value)">
          <input type="text" placeholder="GitHub link" value="${escapeHtml(p.githubUrl||'')}" onchange="updateResearchItem('projects','${p.id}','githubUrl',this.value)">
          <input type="text" placeholder="Dataset link" value="${escapeHtml(p.datasetUrl||'')}" onchange="updateResearchItem('projects','${p.id}','datasetUrl',this.value)">
        </div>
        <div class="row" style="margin-top:8px;justify-content:space-between;">
          <div class="muted" style="font-size:11px;">${[p.notesUrl&&`<a href="${escapeHtml(p.notesUrl)}" target="_blank" rel="noopener">Notes↗</a>`, p.githubUrl&&`<a href="${escapeHtml(p.githubUrl)}" target="_blank" rel="noopener">GitHub↗</a>`, p.datasetUrl&&`<a href="${escapeHtml(p.datasetUrl)}" target="_blank" rel="noopener">Dataset↗</a>`].filter(Boolean).join(" · ")}</div>
          <button class="icon-btn" onclick="deleteResearchItem('projects','${p.id}')">✕</button>
        </div>
      </div>`).join("") || `<div class="empty">No research projects yet.</div>`;
  } else {
    body = STATE.research.papers.map(p=>`
      <div class="card card-pad" style="margin-bottom:12px;">
        <div class="row" style="margin-bottom:6px;">
          <input type="text" value="${escapeHtml(p.title)}" style="font-weight:700;flex:2;" onchange="updateResearchItem('papers','${p.id}','title',this.value)">
          <input type="text" placeholder="Authors" value="${escapeHtml(p.authors||'')}" onchange="updateResearchItem('papers','${p.id}','authors',this.value)">
          <input type="number" placeholder="Year" value="${p.year||''}" style="width:80px;" onchange="updateResearchItem('papers','${p.id}','year',this.value)">
        </div>
        <div class="row" style="margin-bottom:6px;">
          <input type="text" placeholder="Journal/Conference" value="${escapeHtml(p.journal||'')}" onchange="updateResearchItem('papers','${p.id}','journal',this.value)">
          <select onchange="updateResearchItem('papers','${p.id}','status',this.value)">${PAPER_STATUSES.map(s=>`<option ${s===p.status?'selected':''}>${s}</option>`).join("")}</select>
          <select onchange="updateResearchItem('papers','${p.id}','rating',this.value)">${[1,2,3,4,5].map(n=>`<option value="${n}" ${Number(p.rating)===n?'selected':''}>${'★'.repeat(n)}</option>`).join("")}</select>
        </div>
        <div class="row" style="margin-bottom:6px;">
          <input type="text" placeholder="Paper URL" value="${escapeHtml(p.url||'')}" onchange="updateResearchItem('papers','${p.id}','url',this.value)">
          <input type="text" placeholder="PDF URL" value="${escapeHtml(p.pdfUrl||'')}" onchange="updateResearchItem('papers','${p.id}','pdfUrl',this.value)">
        </div>
        <textarea placeholder="Important findings" style="margin-bottom:6px;" onchange="updateResearchItem('papers','${p.id}','findings',this.value)">${escapeHtml(p.findings||'')}</textarea>
        <textarea placeholder="My notes" onchange="updateResearchItem('papers','${p.id}','notes',this.value)">${escapeHtml(p.notes||'')}</textarea>
        <div class="row" style="margin-top:8px;justify-content:space-between;">
          <div class="muted" style="font-size:11px;">${[p.url&&`<a href="${escapeHtml(p.url)}" target="_blank" rel="noopener">Link↗</a>`, p.pdfUrl&&`<a href="${escapeHtml(p.pdfUrl)}" target="_blank" rel="noopener">PDF↗</a>`].filter(Boolean).join(" · ")}</div>
          <button class="icon-btn" onclick="deleteResearchItem('papers','${p.id}')">✕</button>
        </div>
      </div>`).join("") || `<div class="empty">No papers logged yet.</div>`;
  }

  return `
  <div class="pill-tabs" style="margin-bottom:16px;">
    ${tabs.map(t=>`<button class="pill-tab ${RESEARCH_TAB===t?'active':''}" onclick="RESEARCH_TAB='${t}';render()">${labels[t]}</button>`).join("")}
  </div>
  ${body}
  <button class="btn primary" onclick="addResearchItem()">+ Add ${labels[RESEARCH_TAB]}</button>
  `;
}
function addResearchItem(){
  if(RESEARCH_TAB==="projects"){
    STATE.research.projects.push({id:uid(), title:"New project", area:"", question:"", problem:"", abstract:"", keywords:"", supervisor:"", collaborators:"", status:"Idea", progress:0, startDate:todayISO(), deadline:"", lastUpdated:todayISO(), notesUrl:"", githubUrl:"", datasetUrl:""});
  } else {
    STATE.research.papers.push({id:uid(), title:"New paper", authors:"", year:"", journal:"", url:"", pdfUrl:"", area:"", status:"Unread", findings:"", notes:"", rating:0, tags:""});
  }
  saveState(); render();
}
function updateResearchItem(tab, id, field, value, isRange){
  const list = STATE.research[tab];
  const it = list.find(x=>x.id===id); if(!it) return;
  it[field] = field==="progress" ? parseInt(value)||0 : value;
  it.lastUpdated = todayISO();
  saveState();
  if(isRange){
    const bar = event.target.parentElement.querySelector(".progress-fill");
    if(bar) bar.style.width = it.progress+"%";
    event.target.nextElementSibling.textContent = it.progress+"%";
  } else render();
}
function deleteResearchItem(tab, id){
  STATE.research[tab] = STATE.research[tab].filter(x=>x.id!==id);
  saveState(); render();
}
function recomputeProgressFromSubtasks(it){
  if(it.subtasks && it.subtasks.length>0){
    const done = it.subtasks.filter(s=>s.done).length;
    it.progress = Math.round(done/it.subtasks.length*100);
  }
}
function addSubtask(itemId){
  const input = document.getElementById(`newSubtask-${itemId}`);
  const text = input.value.trim();
  if(!text) return;
  const it = STATE.dev[DEV_TAB].find(x=>x.id===itemId); if(!it) return;
  if(!it.subtasks) it.subtasks = [];
  it.subtasks.push({id:uid(), text, done:false});
  recomputeProgressFromSubtasks(it);
  saveState(); render();
}
function toggleSubtask(itemId, subId){
  const it = STATE.dev[DEV_TAB].find(x=>x.id===itemId); if(!it) return;
  const st = it.subtasks.find(s=>s.id===subId); if(!st) return;
  st.done = !st.done;
  recomputeProgressFromSubtasks(it);
  saveState(); render();
}
function deleteSubtask(itemId, subId){
  const it = STATE.dev[DEV_TAB].find(x=>x.id===itemId); if(!it) return;
  it.subtasks = it.subtasks.filter(s=>s.id!==subId);
  recomputeProgressFromSubtasks(it);
  saveState(); render();
}

/* ============================================================
   DASHBOARD PAGE
   ============================================================ */
let dashTrendChart=null, dashWeekChart=null, dashDevChart=null;
function last30Days(){
  const arr = [];
  let d = new Date(todayISO()+"T00:00:00");
  for(let i=29;i>=0;i--){
    const dd = new Date(d); dd.setDate(d.getDate()-i);
    arr.push(dd.toISOString().slice(0,10));
  }
  return arr;
}
function renderDashboard(){
  const isos = last30Days();
  const nHabits = STATE.habitsList.length;
  let habitDone=0, habitPossible=0, prayerDone=0, prayerPossible=0, taskDone=0, taskTotal=0, spent=0;
  isos.forEach(iso=>{
    const day = STATE.days[iso];
    if(!day) return;
    habitPossible += nHabits;
    STATE.habitsList.forEach(h=>{ if(day.habits[h.id]) habitDone++; });
    prayerPossible += 5;
    PRAYERS.forEach(p=>{ if(day.prayers[p.name]) prayerDone++; });
    taskTotal += day.tasks.length;
    taskDone += day.tasks.filter(t=>t.done).length;
    day.expenses.forEach(e=> spent += Number(e.amount||0));
  });
  const readingAvg = STATE.reading.length ? Math.round(STATE.reading.filter(b=>b.totalPages>0).reduce((a,b)=>a+Math.min(100,(b.pagesRead/b.totalPages*100)),0)/Math.max(1,STATE.reading.filter(b=>b.totalPages>0).length)) : 0;
  const devOverall = Math.round((devAvg('papers')+devAvg('cse')+devAvg('eee'))/3);

  const ctBySubjectDash = {};
  STATE.ctMarks.forEach(ct=>{ (ctBySubjectDash[ct.subjectId]=ctBySubjectDash[ct.subjectId]||[]).push(ct); });
  const ctSubjectAverages = Object.values(ctBySubjectDash)
    .map(cts=>ctBestNMarks(cts, STATE.ctBestN))
    .filter(bn=>bn.bestAvgMarks!==null);
  const ctOverallAvg = ctSubjectAverages.length
    ? (ctSubjectAverages.reduce((a,bn)=>a+bn.bestAvgMarks,0)/ctSubjectAverages.length)
    : null;
  const ctOverallOutOf = ctSubjectAverages.length ? ctSubjectAverages[0].bestOutOf : CT_DEFAULT_OUT_OF;
  let unfinishedTasks = 0;
  Object.values(STATE.days).forEach(day=> unfinishedTasks += day.tasks.filter(t=>!t.done).length);

  const cards = [
    {label:"Habits (30d)", value: habitPossible? Math.round(habitDone/habitPossible*100)+"%" : "—", bg:"var(--paper)", color:"var(--accent-red)"},
    {label:"Prayers (30d)", value: prayerPossible? Math.round(prayerDone/prayerPossible*100)+"%":"—", bg:"var(--success-soft)", color:"var(--success)"},
    {label:"Tasks Done", value: taskTotal? Math.round(taskDone/taskTotal*100)+"%":"—", bg:"var(--warn-soft)", color:"#8A6A1E"},
    {label:"Spent (30d)", value:"৳"+spent.toLocaleString(), bg:"#F3E5F5", color:"#8E24AA"},
    {label:"Reading Avg", value:readingAvg+"%", bg:"var(--paper)", color:"var(--isha)"},
    {label:"Dev Progress", value:devOverall+"%", bg:"var(--paper)", color:"#5C6BC0"},
    {label:`CT Avg (Best ${STATE.ctBestN})`, value: ctOverallAvg===null?"—":`${ctOverallAvg.toFixed(1)}/${ctOverallOutOf}`, bg:"var(--paper)", color:"var(--maghrib)"},
    {label:"Unfinished Tasks", value: String(unfinishedTasks), bg: unfinishedTasks>0 ? "var(--danger-soft)" : "var(--success-soft)", color: unfinishedTasks>0 ? "var(--danger)" : "var(--success)"},
  ];
  const kpis = cards.map(c=>`<div class="kpi" style="background:${c.bg};"><div class="label" style="color:${c.color};">${c.label}</div><div class="value" style="color:${c.color};">${c.value}</div></div>`).join("");
  const todayComp = dailyCompletion(todayISO());
  const dl = collectDeadlines();

  // top habits this month
  const {y,m} = PAGE_MONTH;
  const monthIsos = monthDaysISO(y,m);
  const habitRanked = STATE.habitsList.map(h=>{
    let done=0; monthIsos.forEach(iso=>{ if(STATE.days[iso] && STATE.days[iso].habits[h.id]) done++; });
    return {name:h.name, pct: monthIsos.length? Math.round(done/monthIsos.length*100):0};
  }).sort((a,b)=>b.pct-a.pct).slice(0,5);
  const topHabitsHtml = habitRanked.map(h=>`
    <div class="list-item"><div style="flex:1;">${escapeHtml(h.name)}</div><div class="progress-track" style="width:100px;"><div class="progress-fill" style="width:${h.pct}%;"></div></div><b style="width:40px;text-align:right;">${h.pct}%</b></div>`).join("") || `<div class="empty">No habits tracked yet.</div>`;

  const attRows = STATE.subjects.map(s=>{
    let present=0, absent=0;
    Object.values(STATE.days).forEach(day=>{
      Object.entries(day.attendance).forEach(([k,v])=>{ if(k.startsWith(s.id+"@")){ if(v==="Present") present++; if(v==="Absent") absent++; } });
    });
    const held = present+absent;
    const pct = held? Math.round(present/held*100): null;
    return {name:s.name, pct};
  });

  return `
  <div class="card card-pad" style="margin-bottom:18px;">
    <div class="hud-ring-wrap">
      ${speedometerSvg(todayComp.overall, 146, "TODAY")}
      <div style="flex:1;min-width:220px;">
        <div class="section-title" style="margin-bottom:6px;">Today</div>
        <div class="hud-big">${todayComp.overall}%</div>
        <div class="hud-sub">${fmtDate(todayISO())}</div>
        <button class="btn sm primary" style="margin-top:10px;" onclick="navigate('day',{date:'${todayISO()}'})">Open today's workspace →</button>
      </div>
      <div style="flex:1.1;min-width:230px;">
        ${todayComp.parts.map(p=>`<div class="brk"><div class="brk-label">${p.key}</div><div class="brk-bar"><div class="brk-fill" style="width:${p.pct}%;"></div></div><div class="brk-val">${p.raw}</div></div>`).join("")}
      </div>
    </div>
  </div>

  <div class="grid grid-4" style="margin-bottom:18px;">
    <div class="kpi" style="background:var(--danger-soft);cursor:pointer;" onclick="navigate('reminders')"><div class="label" style="color:var(--danger);">🔴 Overdue</div><div class="value" style="color:var(--danger);">${dl.overdue.length}</div></div>
    <div class="kpi" style="background:var(--warn-soft);cursor:pointer;" onclick="navigate('reminders')"><div class="label" style="color:var(--warn);">🟠 Due Today</div><div class="value" style="color:var(--warn);">${dl.today.length}</div></div>
    <div class="kpi" style="background:var(--accent-soft);cursor:pointer;" onclick="navigate('reminders')"><div class="label" style="color:var(--accent);">🟡 Due Tomorrow</div><div class="value" style="color:var(--accent);">${dl.tomorrow.length}</div></div>
    <div class="kpi" style="background:var(--paper);cursor:pointer;" onclick="navigate('reminders')"><div class="label">📅 This Week</div><div class="value">${dl.week.length}</div></div>
  </div>

  <div class="grid grid-4" style="margin-bottom:20px;">${kpis}</div>
  <div class="grid grid-2" style="margin-bottom:16px;">
    <div class="card card-pad">
      <div class="section-title">Daily Habit Completion — Last 30 Days</div>
      <canvas id="dashTrend" height="160"></canvas>
    </div>
    <div class="card card-pad">
      <div class="section-title">Development Progress</div>
      <canvas id="dashDev" height="160"></canvas>
    </div>
  </div>
  <div class="grid grid-2">
    <div class="card card-pad">
      <div class="section-title">🏆 Top Habits This Month</div>
      ${topHabitsHtml}
    </div>
    <div class="card card-pad">
      <div class="section-title">▣ Attendance Snapshot</div>
      ${attRows.length ? attRows.map(a=>`<div class="list-item"><div style="flex:1;">${escapeHtml(a.name)}</div>${a.pct===null?'<span class="muted">no data</span>':`<b style="color:${a.pct>=75?'var(--success)':'var(--danger)'};">${a.pct}%</b>`}</div>`).join("") : `<div class="empty">No subjects yet.</div>`}
    </div>
  </div>
  `;
}
function afterRenderDashboard(){
  if(typeof Chart==="undefined") return;
  const isos = last30Days();
  const trendData = isos.map(iso=>{
    const day = STATE.days[iso]; if(!day) return 0;
    let done=0; STATE.habitsList.forEach(h=>{ if(day.habits[h.id]) done++; });
    return STATE.habitsList.length ? Math.round(done/STATE.habitsList.length*100) : 0;
  });
  const trendCanvas = document.getElementById("dashTrend");
  if(trendCanvas){
    if(dashTrendChart) dashTrendChart.destroy();
    dashTrendChart = new Chart(trendCanvas, {
      type:'line',
      data:{ labels: isos.map(i=>i.slice(8)), datasets:[{ data:trendData, borderColor:'#C81E2C', backgroundColor:'rgba(200,30,44,0.08)', fill:true, tension:0.35, pointRadius:0, borderWidth:2 }]},
      options:{ plugins:{legend:{display:false}}, scales:{ y:{ min:0, max:100, ticks:{ callback:v=>v+"%" } }, x:{ ticks:{ maxTicksLimit:10 } } } }
    });
  }
  const devCanvas = document.getElementById("dashDev");
  if(devCanvas){
    if(dashDevChart) dashDevChart.destroy();
    dashDevChart = new Chart(devCanvas, {
      type:'bar',
      data:{ labels:['Papers','CSE','Electrical'], datasets:[{ data:[devAvg('papers'), devAvg('cse'), devAvg('eee')], backgroundColor:['#8D6E63','#5C6BC0','#FF7043'], borderRadius:6 }]},
      options:{ plugins:{legend:{display:false}}, scales:{ y:{ min:0, max:100, ticks:{ callback:v=>v+"%" } } } }
    });
  }
}

/* ============================================================
   IMPORT FROM PDF  (pdf.js text extraction, client-side only)
   ============================================================ */
if(window['pdfjsLib']){
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}
function renderImportPdfPage(){
  return `
  <div class="card card-pad" style="margin-bottom:16px;">
    <div class="section-title">⇪ Import text from a PDF</div>
    <p class="muted">Upload a routine, question bank, or any PDF — the text gets pulled out here so you can read it and copy the parts you want into Habits, Routine, Reading, or Dev Progress. This runs entirely in your browser; nothing is uploaded anywhere.</p>
    <input type="file" id="pdfInput" accept="application/pdf" onchange="handlePdfUpload(event)">
    <div id="pdfStatus" class="muted" style="margin-top:10px;font-size:12.5px;"></div>
  </div>
  <div class="card card-pad">
    <div class="between" style="margin-bottom:8px;">
      <div class="section-title" style="margin:0;">Extracted Text</div>
      <button class="btn sm" id="copyPdfBtn" onclick="copyExtractedText()" style="display:none;">Copy all</button>
    </div>
    <textarea id="pdfOutput" rows="16" placeholder="Extracted text will appear here…" readonly></textarea>
  </div>
  <div class="card card-pad" style="margin-top:16px;">
    <div class="section-title">Quick add a Routine slot from text</div>
    <p class="muted" style="margin-bottom:10px;">Paste a line like <code>Sunday 10:00-11:00 DSA</code> and pick the matching day — handy right after extracting a routine PDF.</p>
    <div class="row">
      <select id="quickRoutineDow">${BD_DOW_NAMES.map((n,i)=>`<option value="${i}">${n}</option>`).join("")}</select>
      <input type="text" id="quickRoutineTime" placeholder="10:00-11:00" style="width:140px;">
      <select id="quickRoutineSubj">${STATE.subjects.map(s=>`<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("") || '<option value="">Add a subject first</option>'}</select>
      <button class="btn primary sm" onclick="quickAddRoutine()">Add to Routine</button>
    </div>
  </div>`;
}
async function handlePdfUpload(evt){
  const file = evt.target.files[0];
  if(!file) return;
  const status = document.getElementById("pdfStatus");
  const output = document.getElementById("pdfOutput");
  status.textContent = "Reading PDF…";
  output.value = "";
  try{
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({data:buf}).promise;
    let text = "";
    for(let p=1; p<=pdf.numPages; p++){
      status.textContent = `Extracting page ${p} of ${pdf.numPages}…`;
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      text += content.items.map(it=>it.str).join(" ") + "\n\n";
    }
    output.value = text.trim() || "(No selectable text found — this PDF may be a scanned image.)";
    status.textContent = `Done — ${pdf.numPages} page(s) extracted.`;
    document.getElementById("copyPdfBtn").style.display = "inline-flex";
  }catch(e){
    status.textContent = "Couldn't read this PDF: " + e.message;
  }
}
function copyExtractedText(){
  const output = document.getElementById("pdfOutput");
  output.select();
  document.execCommand("copy");
  const btn = document.getElementById("copyPdfBtn");
  const old = btn.textContent; btn.textContent = "Copied ✓"; setTimeout(()=>btn.textContent=old, 1200);
}
function quickAddRoutine(){
  const dow = parseInt(document.getElementById("quickRoutineDow").value);
  const time = document.getElementById("quickRoutineTime").value.trim();
  const subjectId = document.getElementById("quickRoutineSubj").value;
  if(!subjectId) return;
  STATE.routine[dow].push({time, subjectId});
  saveState();
  const status = document.getElementById("pdfStatus");
  status.textContent = "Added to Routine ✓";
}

/* ============================================================
   SETTINGS & DATA PAGE — backup / restore / print / reset
   ============================================================ */
function renderSettingsPage(){
  const size = new Blob([JSON.stringify(STATE)]).size;
  const configured = gistConfigured();
  return `
  <div class="grid grid-2">
    <div class="card card-pad" style="grid-column:1/-1;">
      <div class="section-title">☁️ Cloud Sync — GitHub Gist <span class="tag">${configured?'connected':'not set up'}</span></div>
      <p class="muted">This links the app to a private Gist (a plain text file) on your own GitHub account — not a real database, just one shared JSON file every device you connect can read and write. Data still lives in your GitHub account, under your control.</p>
      ${configured ? `
        <div class="row" style="margin-bottom:10px;">
          <button class="btn primary" onclick="syncNowManual()">Sync Now</button>
          <button class="btn danger sm" onclick="disconnectGist()">Disconnect</button>
          <span id="syncStatusText" class="muted" style="font-size:12px;">${LAST_SYNC_MSG || 'Not synced yet this session.'}</span>
        </div>
        <div class="muted" style="font-size:11px;margin-bottom:10px;">Gist ID: <span class="mono">${getGistId()}</span> — changes also auto-sync ~2.5s after you stop editing.</div>
        <div class="divider"></div>
        <div class="section-title" style="font-size:12.5px;">Add another device (3rd, 4th, …)</div>
        <p class="muted" style="font-size:12px;">On the new device's Settings page, use "Connect to existing Gist" with this same token and Gist ID — never "Create & Connect" again, that makes a brand new empty Gist.</p>
        <div class="row">
          <span id="tokenRevealText" data-hidden="true" class="mono" style="font-size:12.5px;background:var(--paper);padding:6px 10px;border-radius:8px;flex:1;">${'•'.repeat(Math.min(20, getGistToken().length))}</span>
          <button class="btn sm" id="tokenRevealBtn" onclick="toggleTokenVisibility()">Show</button>
          <button class="btn sm" id="copyTokenBtn" onclick="copyToken()">Copy</button>
        </div>
      ` : `
        <ol class="muted" style="margin:0 0 12px 18px;padding:0;font-size:12.5px;line-height:1.7;">
          <li>Go to <span class="mono">github.com/settings/tokens</span> → <b>Generate new token (classic)</b></li>
          <li>Give it any name, check only the <b>gist</b> scope, generate it, and copy the token</li>
          <li>Paste it below and click "Create & Connect" — do this <b>once only</b>, on the device that already has your real data</li>
          <li>On <b>every other device</b> (2nd, 3rd, …), paste the <i>same token</i> and the <b>Gist ID</b> (shown on the connected device's Settings page) and click "Connect to existing Gist" — this only pulls, it never overwrites the cloud copy</li>
        </ol>
        <div class="row" style="flex-wrap:wrap;">
          <input type="text" id="gistTokenInput" placeholder="GitHub token (starts with ghp_...)" style="width:260px;">
          <button class="btn primary sm" onclick="createGistForSync()">Create & Connect (first device)</button>
        </div>
        <div class="row" style="margin-top:8px;flex-wrap:wrap;">
          <input type="text" id="gistIdInput" placeholder="Existing Gist ID">
          <button class="btn sm" onclick="connectExistingGist()">Connect to existing Gist (other devices)</button>
        </div>
        <div id="syncStatusText" class="muted" style="font-size:12px;margin-top:8px;">${LAST_SYNC_MSG}</div>
      `}
    </div>
    <div class="card card-pad">
      <div class="section-title">💾 Backup your data</div>
      <p class="muted">A local download of everything, independent of cloud sync. Good to keep occasionally regardless.</p>
      <button class="btn primary" onclick="downloadBackup()">Download backup (.json)</button>
      <div class="muted" style="margin-top:8px;font-size:11.5px;">Current data size: ${(size/1024).toFixed(1)} KB</div>
    </div>
    <div class="card card-pad">
      <div class="section-title">📥 Restore from backup</div>
      <p class="muted">Upload a previously downloaded .json backup to restore it. This replaces everything currently in the app.</p>
      <input type="file" accept="application/json" onchange="restoreBackup(event)">
    </div>
    <div class="card card-pad">
      <div class="section-title">🎨 Theme</div>
      <p class="muted">Spider-Man is the light theme (warm paper, spider red + blue). Batman is the dark theme (graphite black, bat gold). Your choice syncs across devices.</p>
      <div class="row">
        <button class="btn ${(STATE.settings.theme||'light')==='light'?'primary':''}" onclick="setTheme('light')">🕷 Spider-Man (Light)</button>
        <button class="btn ${STATE.settings.theme==='dark'?'primary':''}" onclick="setTheme('dark')">🦇 Batman (Dark)</button>
      </div>
      <div class="muted" style="font-size:11.5px;margin-top:8px;">Data version: ${STATE.dataVersion}</div>
    </div>
    <div class="card card-pad">
      <div class="section-title">🖨️ Export as PDF</div>
      <p class="muted">Open a Day page and use "Export / Print this day" — your browser's Print dialog lets you Save as PDF. Works for any page.</p>
      <button class="btn" onclick="navigate('day',{date:'${todayISO()}'})">Go to Today</button>
    </div>
    <div class="card card-pad">
      <div class="section-title" style="color:var(--danger);">⚠ Reset everything</div>
      <p class="muted">Wipes all habits, prayers, tasks, attendance, expenses, and reading data from this browser. Cannot be undone — download a backup first.</p>
      <button class="btn danger" onclick="resetAllData()">Reset all data</button>
    </div>
  </div>`;
}
function downloadBackup(){
  const blob = new Blob([JSON.stringify(STATE, null, 2)], {type:"application/json"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `mahathir-tracker-backup-${todayISO()}.json`;
  a.click();
}
function restoreBackup(evt){
  const file = evt.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try{
      const data = JSON.parse(reader.result);
      if(!confirm("This will modify your current Life Tracker data — everything now in this browser will be replaced by the backup. Continue?")) return;
      STATE = data;
      saveState();
      alert("Restored successfully.");
      render();
    }catch(e){ alert("Couldn't read that file: " + e.message); }
  };
  reader.readAsText(file);
}
function resetAllData(){
  if(!confirm("This permanently deletes everything in this browser. Are you sure?")) return;
  if(!confirm("Really sure? This cannot be undone.")) return;
  localStorage.removeItem(STORE_KEY);
  STATE = defaultState();
  saveState();
  render();
}

/* ============================================================
   GLOBAL SEARCH
   ============================================================ */
function openSearch(){
  document.getElementById("searchOverlay").classList.add("active");
  setTimeout(()=>document.getElementById("searchInput").focus(), 50);
}
function closeSearch(){
  document.getElementById("searchOverlay").classList.remove("active");
  document.getElementById("searchInput").value = "";
  document.getElementById("searchResults").innerHTML = "";
}
function searchGoTo(kind, payload){
  closeSearch();
  if(kind==="day") navigate("day", {date: payload});
  else navigate(kind, payload||{});
}
function runSearch(qRaw){
  const resultsEl = document.getElementById("searchResults");
  const q = qRaw.trim().toLowerCase();
  if(q.length < 2){ resultsEl.innerHTML = `<div class="muted" style="padding:10px 0;">Type at least 2 characters…</div>`; return; }
  const hits = [];
  const has = (s)=> (s||"").toLowerCase().includes(q);

  Object.keys(STATE.days).forEach(iso=>{
    const day = STATE.days[iso];
    day.tasks.forEach(t=>{ if(has(t.text)||has(t.description)) hits.push({type:"Task", label:t.text, sub:fmtShort(iso), go:()=>searchGoTo("day",iso)}); });
    if(has(day.journal)) hits.push({type:"Journal", label:day.journal.slice(0,60), sub:fmtShort(iso), go:()=>searchGoTo("day",iso)});
    if(day.concept && (has(day.concept.topic)||has(day.concept.subject))) hits.push({type:"Concept", label:day.concept.topic, sub:fmtShort(iso), go:()=>searchGoTo("day",iso)});
    day.expenses.forEach(e=>{ if(has(e.desc)||has(e.fund)) hits.push({type:"Expense", label:(e.desc||e.fund), sub:"৳"+e.amount, go:()=>searchGoTo("day",iso)}); });
  });
  STATE.reading.forEach(b=>{ if(has(b.title)) hits.push({type:"Reading", label:b.title, sub:b.status, go:()=>searchGoTo("reading")}); });
  STATE.courses.forEach(c=>{
    if(has(c.name)) hits.push({type:"Course", label:c.name, sub:c.platform||"", go:()=>searchGoTo("courses")});
    (c.modules||[]).forEach(m=>{ if(has(m.title)) hits.push({type:"Module", label:m.title, sub:c.name, go:()=>searchGoTo("courses")}); });
  });
  STATE.research.projects.forEach(p=>{ if(has(p.title)||has(p.question)||has(p.abstract)) hits.push({type:"Research Project", label:p.title, sub:p.area||"", go:()=>searchGoTo("research")}); });
  STATE.research.papers.forEach(p=>{ if(has(p.title)||has(p.authors)) hits.push({type:"Paper", label:p.title, sub:p.authors||"", go:()=>searchGoTo("research")}); });
  STATE.people.forEach(p=>{ if(has(p.name)) hits.push({type:"Person", label:p.name, sub:"", go:()=>searchGoTo("people")}); });
  STATE.subjects.forEach(s=>{ if(has(s.name)||has(s.code)) hits.push({type:"Subject", label:s.name, sub:s.code||"", go:()=>searchGoTo("attendance")}); });
  STATE.ctMarks.forEach(c=>{
    const subj = STATE.subjects.find(s=>s.id===c.subjectId);
    if(subj && has(subj.name) && c.marks!==null && c.marks!=='') hits.push({type:"CT Mark", label:`${subj.name} — CT${c.ctNo}`, sub:`${c.marks}/${c.outOf}`, go:()=>searchGoTo("ct")});
  });

  if(!hits.length){ resultsEl.innerHTML = `<div class="empty">No matches.</div>`; return; }
  window.__searchHits = hits.slice(0,50);
  resultsEl.innerHTML = window.__searchHits.map((h,i)=>`
    <div class="list-item" style="cursor:pointer;" onclick="window.__searchHits[${i}].go()">
      <span class="badge neutral">${h.type}</span>
      <div style="flex:1;">${escapeHtml(h.label||'')}</div>
      <span class="muted" style="font-size:11px;">${escapeHtml(h.sub||'')}</span>
    </div>`).join("");
}

/* ============================================================
   QUICK ADD (floating button)
   ============================================================ */
const QUICK_ADD_ITEMS = [
  {label:"Task", ic:"▤", go:()=>navigate("day",{date:todayISO()})},
  {label:"Expense", ic:"৳", go:()=>navigate("day",{date:todayISO()})},
  {label:"Money Received", ic:"📥", go:()=>navigate("finance")},
  {label:"Attendance", ic:"▣", go:()=>navigate("day",{date:todayISO()})},
  {label:"CT Mark", ic:"📝", go:()=>navigate("ct")},
  {label:"Reading", ic:"▥", go:()=>navigate("reading")},
  {label:"Course", ic:"🎓", go:()=>navigate("courses")},
  {label:"Research", ic:"🔬", go:()=>navigate("research")},
  {label:"Journal", ic:"✎", go:()=>navigate("day",{date:todayISO()})},
];
let QUICK_ADD_OPEN = false;
function toggleQuickAdd(){
  QUICK_ADD_OPEN = !QUICK_ADD_OPEN;
  const menu = document.getElementById("quickAddMenu");
  if(QUICK_ADD_OPEN){
    menu.innerHTML = QUICK_ADD_ITEMS.map((it,i)=>`<button class="quick-add-item" onclick="runQuickAdd(${i})"><span>${it.ic}</span>${it.label}</button>`).join("");
    menu.classList.add("open");
  } else {
    menu.classList.remove("open");
  }
}
function runQuickAdd(i){
  QUICK_ADD_ITEMS[i].go();
  toggleQuickAdd();
}

/* ============================================================
   CINEMATIC LOADER
   ============================================================ */
/* ============================================================
   DEADLINE INTELLIGENCE
   ============================================================ */
function daysBetween(a, b){
  return Math.round((new Date(b+"T00:00:00") - new Date(a+"T00:00:00")) / 86400000);
}
function collectDeadlines(){
  const T = todayISO();
  const items = [];
  // tasks with deadlines (or dated but unfinished)
  Object.keys(STATE.days).forEach(iso=>{
    STATE.days[iso].tasks.forEach(t=>{
      if(t.done) return;
      const due = t.deadline || iso;
      items.push({kind:"Task", label:t.text, category:t.category||"Others", due, goto:()=>navigate("day",{date:iso})});
    });
  });
  // course target dates
  STATE.courses.forEach(c=>{
    if(c.targetDate && c.status!=="Completed" && c.status!=="Archived"){
      items.push({kind:"Course", label:c.name, category:c.platform||"", due:c.targetDate, goto:()=>navigate("courses")});
    }
  });
  // research deadlines
  STATE.research.projects.forEach(p=>{
    if(p.deadline && p.status!=="Published" && p.status!=="Archived"){
      items.push({kind:"Research", label:p.title, category:p.area||"", due:p.deadline, goto:()=>navigate("research")});
    }
  });
  // reading target dates
  STATE.reading.forEach(b=>{
    if(b.targetDate && b.status!=="Completed"){
      items.push({kind:"Reading", label:b.title, category:b.type||"", due:b.targetDate, goto:()=>navigate("reading")});
    }
  });
  // dev items with deadlines
  ["papers","cse","eee"].forEach(k=>{
    (STATE.dev[k]||[]).forEach(it=>{
      if(it.deadline && Number(it.progress) < 100){
        items.push({kind:"Dev", label:it.title, category:k.toUpperCase(), due:it.deadline, goto:()=>navigate("dev")});
      }
    });
  });

  const buckets = {overdue:[], today:[], tomorrow:[], week:[], later:[]};
  items.forEach(it=>{
    const d = daysBetween(T, it.due);
    it.daysLeft = d;
    if(d < 0) buckets.overdue.push(it);
    else if(d === 0) buckets.today.push(it);
    else if(d === 1) buckets.tomorrow.push(it);
    else if(d <= 7) buckets.week.push(it);
    else buckets.later.push(it);
  });
  Object.values(buckets).forEach(b=>b.sort((x,y)=>x.daysLeft-y.daysLeft));
  return buckets;
}

/* ============================================================
   SMART REMINDER CENTER
   ============================================================ */
function buildReminders(){
  const T = todayISO();
  const out = [];
  const b = collectDeadlines();

  b.overdue.forEach(it=> out.push({sev:"red", icon:"⚠️", text:`${it.kind} overdue by ${Math.abs(it.daysLeft)}d — ${it.label}`, goto:it.goto}));
  b.today.forEach(it=> out.push({sev:"orange", icon:"⏰", text:`${it.kind} due today — ${it.label}`, goto:it.goto}));
  b.tomorrow.forEach(it=> out.push({sev:"orange", icon:"⚠️", text:`${it.kind} due tomorrow — ${it.label}`, goto:it.goto}));
  b.week.forEach(it=> out.push({sev:"yellow", icon:"📅", text:`${it.kind} due in ${it.daysLeft}d — ${it.label}`, goto:it.goto}));

  // attendance warnings
  STATE.subjects.forEach(s=>{
    const st = subjectAttendanceStats(s);
    if(st.pct !== null && st.pct < 75){
      out.push({sev:"red", icon:"▣", text:`Attendance at ${st.pct.toFixed(1)}% in ${s.name} — need ${st.pred.needToAttend} in a row`, goto:()=>navigate("attendance")});
    } else if(st.pct !== null && st.pct < 80){
      out.push({sev:"yellow", icon:"▣", text:`${s.name} attendance ${st.pct.toFixed(1)}% — only ${st.pred.canMiss} class(es) of slack`, goto:()=>navigate("attendance")});
    }
  });

  // CT slots still blank
  STATE.subjects.filter(s=>s.type==="Theory").forEach(s=>{
    const cts = STATE.ctMarks.filter(c=>c.subjectId===s.id);
    const blank = cts.filter(c=>c.marks===null || c.marks==="").length;
    if(cts.length && blank === cts.length){
      out.push({sev:"yellow", icon:"📝", text:`No CT marks entered yet for ${s.name}`, goto:()=>navigate("ct")});
    }
  });

  // research staleness
  STATE.research.projects.forEach(p=>{
    if(p.lastUpdated && p.status!=="Published" && p.status!=="Archived"){
      const idle = daysBetween(p.lastUpdated, T);
      if(idle >= 7) out.push({sev:"yellow", icon:"🔬", text:`Research "${p.title}" untouched for ${idle}d`, goto:()=>navigate("research")});
    }
  });

  // today's own hygiene
  const comp = dailyCompletion(T);
  const prayerPart = comp.parts.find(p=>p.key==="Prayer");
  if(prayerPart && prayerPart.done < 5) out.push({sev:"yellow", icon:"☾", text:`${5-prayerPart.done} prayer(s) not logged today`, goto:()=>navigate("day",{date:T})});
  if(!(STATE.days[T] && STATE.days[T].journal && STATE.days[T].journal.trim()))
    out.push({sev:"yellow", icon:"✎", text:"Today's journal is still empty", goto:()=>navigate("day",{date:T})});

  const order = {red:0, orange:1, yellow:2};
  out.sort((a,b2)=>order[a.sev]-order[b2.sev]);
  return out;
}
function renderRemindersPage(){
  const rem = buildReminders();
  window.__reminders = rem;
  const dotColor = {red:"var(--danger)", orange:"var(--warn)", yellow:"var(--accent)"};
  const body = rem.length ? rem.map((r,i)=>`
    <div class="sev sev-${r.sev}" style="cursor:pointer;" onclick="window.__reminders[${i}].goto()">
      <span class="sev-dot" style="background:${dotColor[r.sev]};"></span>
      <span style="font-size:15px;">${r.icon}</span>
      <div style="flex:1;font-size:13px;font-weight:600;">${escapeHtml(r.text)}</div>
    </div>`).join("") : `<div class="empty"><div class="big">✓</div>Nothing needs your attention right now.</div>`;

  const counts = rem.reduce((a,r)=>{ a[r.sev]=(a[r.sev]||0)+1; return a; }, {});
  return `
  <div class="grid grid-3" style="margin-bottom:18px;">
    <div class="kpi" style="background:var(--danger-soft);"><div class="label" style="color:var(--danger);">🔴 Critical</div><div class="value" style="color:var(--danger);">${counts.red||0}</div></div>
    <div class="kpi" style="background:var(--warn-soft);"><div class="label" style="color:var(--warn);">🟠 Soon</div><div class="value" style="color:var(--warn);">${counts.orange||0}</div></div>
    <div class="kpi" style="background:var(--accent-soft);"><div class="label" style="color:var(--accent);">🟡 Watch</div><div class="value" style="color:var(--accent);">${counts.yellow||0}</div></div>
  </div>
  <div class="card card-pad">
    <div class="section-title">🔔 Reminder Center</div>
    <p class="muted" style="margin:0 0 12px;">Everything the tracker noticed on its own — click any row to jump straight there.</p>
    ${body}
  </div>`;
}

/* ============================================================
   WEEKLY / MONTHLY REVIEW
   ============================================================ */
function isoRange(startIso, days){
  const out = [];
  const d = new Date(startIso+"T00:00:00");
  for(let i=0;i<days;i++){
    out.push(d.toISOString().slice(0,10));
    d.setDate(d.getDate()+1);
  }
  return out;
}
function periodStats(isos){
  let prayerDone=0, prayerTotal=0, habitDone=0, habitTotal=0, taskDone=0, taskTotal=0, spent=0, received=0;
  const dayScores = [];
  const habitCounts = {};
  STATE.habitsList.forEach(h=>habitCounts[h.id]={name:h.name, done:0, seen:0});

  isos.forEach(iso=>{
    const day = STATE.days[iso];
    const comp = dailyCompletion(iso);
    if(day) dayScores.push({iso, score:comp.overall});
    prayerTotal += 5;
    if(day){
      prayerDone += PRAYERS.filter(p=>day.prayers[p.name]).length;
      habitTotal += STATE.habitsList.length;
      STATE.habitsList.forEach(h=>{
        habitCounts[h.id].seen++;
        if(day.habits[h.id]){ habitDone++; habitCounts[h.id].done++; }
      });
      taskTotal += day.tasks.length;
      taskDone += day.tasks.filter(t=>t.done).length;
      day.expenses.forEach(e=> spent += Number(e.amount||0));
    }
  });
  STATE.moneyIn.forEach(m=>{ if(isos.includes(m.date)) received += Number(m.amount||0); });

  const ranked = Object.values(habitCounts).filter(h=>h.seen>0)
    .map(h=>({name:h.name, pct: Math.round(h.done/h.seen*100)}))
    .sort((a,b)=>b.pct-a.pct);
  const productivity = dayScores.length ? Math.round(dayScores.reduce((a,d)=>a+d.score,0)/dayScores.length) : 0;
  const best = dayScores.slice().sort((a,b)=>b.score-a.score)[0] || null;
  const worst = dayScores.slice().sort((a,b)=>a.score-b.score)[0] || null;

  return {
    productivity,
    prayerPct: prayerTotal? Math.round(prayerDone/prayerTotal*100):0,
    habitPct: habitTotal? Math.round(habitDone/habitTotal*100):0,
    taskDone, taskTotal,
    taskPct: taskTotal? Math.round(taskDone/taskTotal*100):0,
    spent, received, net: received-spent,
    bestHabit: ranked[0]||null, worstHabit: ranked.length>1?ranked[ranked.length-1]:null,
    bestDay: best, worstDay: worst, dayScores
  };
}
let REVIEW_TAB = "week";
function renderReviewPage(){
  const T = todayISO();
  const isWeek = REVIEW_TAB === "week";

  // week starts Saturday (Bangladesh)
  const todayDow = dowIndexBD(T);
  const weekStart = new Date(T+"T00:00:00");
  weekStart.setDate(weekStart.getDate() - todayDow);
  const weekIsos = isoRange(weekStart.toISOString().slice(0,10), 7);

  const monthStart = T.slice(0,8)+"01";
  const dim = daysInMonth(Number(T.slice(0,4)), Number(T.slice(5,7))-1);
  const monthIsos = isoRange(monthStart, dim);

  const isos = isWeek ? weekIsos : monthIsos;
  const st = periodStats(isos);
  const rangeLabel = isWeek
    ? `${fmtShort(weekIsos[0])} — ${fmtShort(weekIsos[6])}`
    : new Date(T+"T00:00:00").toLocaleDateString('en-GB',{month:'long', year:'numeric'});

  // academic aggregate
  const courseAvg = STATE.courses.length ? Math.round(STATE.courses.reduce((a,c)=>a+courseProgress(c),0)/STATE.courses.length) : null;
  const researchAvg = STATE.research.projects.length ? Math.round(STATE.research.projects.reduce((a,p)=>a+(Number(p.progress)||0),0)/STATE.research.projects.length) : null;
  const ctAverages = STATE.subjects.filter(s=>s.type==="Theory")
    .map(s=>ctBestNMarks(STATE.ctMarks.filter(c=>c.subjectId===s.id), STATE.ctBestN))
    .filter(bn=>bn.bestAvgMarks!==null);
  const ctAvg = ctAverages.length ? (ctAverages.reduce((a,bn)=>a+bn.bestAvgMarks,0)/ctAverages.length) : null;
  const attStats = STATE.subjects.map(s=>subjectAttendanceStats(s)).filter(x=>x.pct!==null);
  const attAvg = attStats.length ? (attStats.reduce((a,x)=>a+x.pct,0)/attStats.length) : null;

  const wentWell = [];
  const missed = [];
  if(st.prayerPct >= 90) wentWell.push(`Prayers held strong at ${st.prayerPct}%`);
  else missed.push(`Prayers at ${st.prayerPct}% — room to improve`);
  if(st.habitPct >= 75) wentWell.push(`Habits at ${st.habitPct}%`);
  else missed.push(`Habits at only ${st.habitPct}%`);
  if(st.taskPct >= 75) wentWell.push(`Completed ${st.taskDone}/${st.taskTotal} tasks`);
  else if(st.taskTotal) missed.push(`Only ${st.taskDone} of ${st.taskTotal} tasks finished`);
  if(st.bestHabit) wentWell.push(`Best habit: ${st.bestHabit.name} (${st.bestHabit.pct}%)`);
  if(st.worstHabit && st.worstHabit.pct < 50) missed.push(`Weakest habit: ${st.worstHabit.name} (${st.worstHabit.pct}%)`);
  if(attAvg !== null && attAvg < 75) missed.push(`Average attendance ${attAvg.toFixed(1)}% is below 75%`);
  const dl = collectDeadlines();
  if(dl.overdue.length) missed.push(`${dl.overdue.length} item(s) overdue`);

  const priorities = [];
  if(dl.overdue.length) priorities.push(`Clear ${dl.overdue.length} overdue item(s) first`);
  if(attAvg !== null && attAvg < 75) priorities.push("Attend every class — attendance is under the 75% line");
  if(st.worstHabit && st.worstHabit.pct < 50) priorities.push(`Rebuild the habit: ${st.worstHabit.name}`);
  if(dl.week.length) priorities.push(`${dl.week.length} deadline(s) land within 7 days`);
  if(!priorities.length) priorities.push("Keep the current pace — nothing is at risk");

  const listOf = (arr, empty)=> arr.length
    ? `<ul style="margin:0;padding-left:18px;font-size:13px;line-height:1.8;">${arr.map(x=>`<li>${escapeHtml(x)}</li>`).join("")}</ul>`
    : `<div class="muted" style="font-size:12.5px;">${empty}</div>`;

  const dayBars = st.dayScores.length ? st.dayScores.map(d=>`
    <div class="brk">
      <div class="brk-label">${fmtShort(d.iso)}</div>
      <div class="brk-bar"><div class="brk-fill" style="width:${d.score}%;"></div></div>
      <div class="brk-val">${d.score}%</div>
    </div>`).join("") : `<div class="muted" style="font-size:12.5px;">No logged days in this period yet.</div>`;

  return `
  <div class="between" style="margin-bottom:16px;">
    <div class="pill-tabs">
      <button class="pill-tab ${isWeek?'active':''}" onclick="REVIEW_TAB='week';render()">📊 Weekly</button>
      <button class="pill-tab ${!isWeek?'active':''}" onclick="REVIEW_TAB='month';render()">📅 Monthly</button>
    </div>
    <div class="muted" style="font-weight:600;">${rangeLabel}</div>
  </div>

  <div class="card card-pad" style="margin-bottom:16px;">
    <div class="hud-ring-wrap">
      ${speedometerSvg(st.productivity, 150, isWeek?"THIS WEEK":"THIS MONTH")}
      <div style="flex:1;min-width:230px;">
        <div class="section-title" style="margin-bottom:6px;">Productivity</div>
        <div class="hud-big">${st.productivity}%</div>
        <div class="hud-sub">average daily completion across ${st.dayScores.length} logged day(s)</div>
      </div>
      <div style="flex:1.2;min-width:250px;">
        <div class="brk"><div class="brk-label">Prayer</div><div class="brk-bar"><div class="brk-fill" style="width:${st.prayerPct}%;"></div></div><div class="brk-val">${st.prayerPct}%</div></div>
        <div class="brk"><div class="brk-label">Habits</div><div class="brk-bar"><div class="brk-fill" style="width:${st.habitPct}%;"></div></div><div class="brk-val">${st.habitPct}%</div></div>
        <div class="brk"><div class="brk-label">Tasks</div><div class="brk-bar"><div class="brk-fill" style="width:${st.taskPct}%;"></div></div><div class="brk-val">${st.taskDone}/${st.taskTotal}</div></div>
        ${attAvg!==null?`<div class="brk"><div class="brk-label">Attendance</div><div class="brk-bar"><div class="brk-fill" style="width:${attAvg}%;"></div></div><div class="brk-val">${attAvg.toFixed(1)}%</div></div>`:''}
      </div>
    </div>
  </div>

  <div class="grid grid-4" style="margin-bottom:16px;">
    <div class="kpi" style="background:var(--paper);"><div class="label">Spent</div><div class="value">৳${st.spent.toLocaleString()}</div></div>
    <div class="kpi" style="background:var(--paper);"><div class="label">Received</div><div class="value">৳${st.received.toLocaleString()}</div></div>
    <div class="kpi" style="background:${st.net>=0?'var(--success-soft)':'var(--danger-soft)'};"><div class="label" style="color:${st.net>=0?'var(--success)':'var(--danger)'};">Net</div><div class="value" style="color:${st.net>=0?'var(--success)':'var(--danger)'};">${st.net>=0?'+':''}৳${st.net.toLocaleString()}</div></div>
    <div class="kpi" style="background:var(--paper);"><div class="label">CT Avg (Best ${STATE.ctBestN})</div><div class="value">${ctAvg===null?'—':ctAvg.toFixed(1)}</div></div>
  </div>

  <div class="grid grid-2" style="margin-bottom:16px;">
    <div class="card card-pad">
      <div class="section-title">✅ What went well</div>
      ${listOf(wentWell, "Not enough data logged yet.")}
    </div>
    <div class="card card-pad">
      <div class="section-title">⚠️ What was missed</div>
      ${listOf(missed, "Nothing flagged — clean period.")}
    </div>
    <div class="card card-pad">
      <div class="section-title">🎯 ${isWeek?"Next week's":"Next month's"} priorities</div>
      ${listOf(priorities, "")}
    </div>
    <div class="card card-pad">
      <div class="section-title">📈 Academic & growth</div>
      <div class="brk"><div class="brk-label">Courses</div><div class="brk-bar"><div class="brk-fill" style="width:${courseAvg||0}%;"></div></div><div class="brk-val">${courseAvg===null?'—':courseAvg+'%'}</div></div>
      <div class="brk"><div class="brk-label">Research</div><div class="brk-bar"><div class="brk-fill" style="width:${researchAvg||0}%;"></div></div><div class="brk-val">${researchAvg===null?'—':researchAvg+'%'}</div></div>
      <div class="brk"><div class="brk-label">Dev</div><div class="brk-bar"><div class="brk-fill" style="width:${Math.round((devAvg('papers')+devAvg('cse')+devAvg('eee'))/3)}%;"></div></div><div class="brk-val">${Math.round((devAvg('papers')+devAvg('cse')+devAvg('eee'))/3)}%</div></div>
      ${st.bestDay?`<div class="divider"></div><div class="muted" style="font-size:12px;">Best day: <b>${fmtShort(st.bestDay.iso)}</b> at ${st.bestDay.score}% · Lowest: <b>${fmtShort(st.worstDay.iso)}</b> at ${st.worstDay.score}%</div>`:''}
    </div>
  </div>

  <div class="card card-pad">
    <div class="section-title">Day by day</div>
    ${dayBars}
  </div>`;
}

/* ============================================================
   THEME
   ============================================================ */
function applyTheme(){
  const theme = (STATE.settings && STATE.settings.theme) || "light";
  document.documentElement.setAttribute("data-theme", theme);
}
function setTheme(t){
  if(!STATE.settings) STATE.settings = {};
  STATE.settings.theme = t;
  applyTheme();
  saveState();
  render();
}

/* ============================================================
   DAILY COMPLETION ENGINE  (real 0–100%, with breakdown)
   ============================================================ */
function dailyCompletion(iso){
  const day = STATE.days[iso];
  const parts = [];

  // Prayers — 5 slots
  const pDone = day ? PRAYERS.filter(p=>day.prayers[p.name]).length : 0;
  parts.push({key:"Prayer", done:pDone, total:5, pct: pDone/5*100, raw:`${pDone}/5`});

  // Habits — however many are defined
  const hTotal = STATE.habitsList.length;
  const hDone = day ? STATE.habitsList.filter(h=>day.habits[h.id]).length : 0;
  if(hTotal) parts.push({key:"Habits", done:hDone, total:hTotal, pct:hDone/hTotal*100, raw:`${hDone}/${hTotal}`});

  // Tasks — partial credit via each task's own progress slider
  const tasks = day ? day.tasks : [];
  if(tasks.length){
    const sum = tasks.reduce((a,t)=>a + (t.done ? 100 : Number(t.progress)||0), 0);
    parts.push({key:"Tasks", done:tasks.filter(t=>t.done).length, total:tasks.length, pct:sum/tasks.length, raw:`${tasks.filter(t=>t.done).length}/${tasks.length}`});
  }

  // Attendance — classes marked today vs scheduled today
  const dowIdx = dowIndexBD(iso);
  const scheduled = (STATE.routine[dowIdx]||[]).filter(cls=>{
    const subj = STATE.subjects.find(s=>s.id===cls.subjectId);
    return subj ? labOccursOnDate(subj, iso) : true;
  });
  if(scheduled.length){
    let attended=0, counted=0;
    scheduled.forEach(cls=>{
      const st = day ? day.attendance[cls.subjectId+"@"+cls.time] : null;
      if(st==="Cancelled") return;
      counted++;
      if(st==="Present") attended++;
    });
    if(counted) parts.push({key:"Attendance", done:attended, total:counted, pct:attended/counted*100, raw:`${attended}/${counted}`});
  }

  // Concept — set or not
  const hasConcept = !!(day && day.concept && day.concept.topic);
  parts.push({key:"Concept", done:hasConcept?1:0, total:1, pct:hasConcept?100:0, raw:hasConcept?"set":"—"});

  // Journal — written or not
  const hasJournal = !!(day && day.journal && day.journal.trim());
  parts.push({key:"Journal", done:hasJournal?1:0, total:1, pct:hasJournal?100:0, raw:hasJournal?"written":"—"});

  const overall = parts.length ? Math.round(parts.reduce((a,p)=>a+p.pct,0)/parts.length) : 0;
  return {overall, parts};
}

/* Speedometer arc: 240° sweep, value 0–100 */
function speedometerSvg(pct, size, label){
  size = size || 132;
  pct = Math.max(0, Math.min(100, Math.round(pct)));
  const r = 52, cx = 70, cy = 66;
  const startA = 150, sweep = 240;                 // degrees
  const toXY = (ang)=>{
    const rad = (ang*Math.PI)/180;
    return [cx + r*Math.cos(rad), cy + r*Math.sin(rad)];
  };
  const arcPath = (fromA, toA)=>{
    const [x1,y1] = toXY(fromA), [x2,y2] = toXY(toA);
    const large = Math.abs(toA-fromA) > 180 ? 1 : 0;
    return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
  };
  const trackLen = 2*Math.PI*r*(sweep/360);
  const tickMarks = [0,25,50,75,100].map(t=>{
    const a = startA + (sweep*t/100);
    const [ox,oy] = toXY(a);
    const rad = (a*Math.PI)/180;
    const ix = cx + (r-8)*Math.cos(rad), iy = cy + (r-8)*Math.sin(rad);
    return `<line x1="${ix.toFixed(1)}" y1="${iy.toFixed(1)}" x2="${ox.toFixed(1)}" y2="${oy.toFixed(1)}" stroke="var(--ink-soft)" stroke-width="1.4" opacity=".45"/>`;
  }).join("");
  return `<div class="speedo">
    <svg viewBox="0 0 140 100" width="${size}" height="${Math.round(size*100/140)}" role="img" aria-label="${pct} percent">
      <path d="${arcPath(startA, startA+sweep)}" class="speedo-track" fill="none" stroke-width="9" stroke-linecap="round"/>
      <path d="${arcPath(startA, startA+sweep)}" class="speedo-fill" fill="none" stroke-width="9" stroke-linecap="round"
            stroke-dasharray="${trackLen.toFixed(2)}" stroke-dashoffset="${(trackLen*(1-pct/100)).toFixed(2)}"/>
      ${tickMarks}
      <text x="70" y="70" text-anchor="middle" class="speedo-value" font-size="26">${pct}%</text>
    </svg>
    ${label?`<div class="speedo-label">${label}</div>`:""}
  </div>`;
}

function runLoader(){
  const loader = document.getElementById("loader");
  if(!loader) return;
  const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const delay = reduced ? 0 : 900;
  setTimeout(()=>{
    loader.classList.add("loader-hide");
    setTimeout(()=>{ if(loader.parentNode) loader.parentNode.removeChild(loader); }, 500);
  }, delay);
}

/* ============================================================
   INIT
   ============================================================ */
(function init(){
  const h = location.hash.replace("#","");
  if(h){
    const [page, date] = h.split("/");
    if(page) ROUTE = {page, params: date?{date}:{}};
  }
  applyTheme();
  render();
  if(gistConfigured()) autoPullOnLoad();
  runLoader();
})();
