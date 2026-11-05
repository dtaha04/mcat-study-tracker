'use client'

import { useEffect, useRef, useState } from 'react'
import schedule from '../data/schedule.json'

const PLAN_START = schedule.plan_start || '2026-11-04'
const EXAM_DATE = schedule.exam_date || '2027-01-21'
const SOURCE_TYPE = 'v5_diya_nov04_extensive'
const sourceFor = () => SOURCE_TYPE
const validPlanTask = t => t.student_name === 'Diya' && t.source_type === SOURCE_TYPE && t.task_date >= PLAN_START && t.task_date <= EXAM_DATE
const isMyLog = (row, field) => !/^hamzah(?:\s|$)/i.test(String(row[field] || '').trim())
const DAYS = Array.isArray(schedule.days) ? schedule.days : []

function localISO(d = new Date()) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
function fromISO(s) {
  const [y,m,d] = s.split('-').map(Number)
  return new Date(y,m-1,d)
}
function addDays(s,n) {
  const d=fromISO(s); d.setDate(d.getDate()+n); return localISO(d)
}
function daysBetween(a,b) { return Math.round((fromISO(b)-fromISO(a))/86400000) }
function formatDate(s, weekday=false, year=false) {
  return fromISO(s).toLocaleDateString('en-US',{
    weekday:weekday?'short':undefined, month:'short', day:'numeric', year:year?'numeric':undefined
  })
}
function fmtMin(n=0) {
  n=Math.max(0,Math.round(Number(n)||0))
  const h=Math.floor(n/60), m=n%60
  return h ? `${h}h${m?` ${m}m`:''}` : `${m}m`
}
function dayFor(iso) { return DAYS.find(d=>d.date===iso) || null }
function planFor(iso, student) {
  const d=dayFor(iso)
  if (!d) return null
  return student === 'Diya' ? d.diya : null
}
function sig(t) {
  return [t.student_name||'',t.task_type||'',t.sort_order||''].join('||')
}
function sumMin(ts=[]) { return ts.reduce((a,t)=>a+(Number(t.estimated_minutes)||0),0) }
function progress(ts=[]) {
  const x=ts.filter(t=>t.task_type!=='Chapter')
  return x.length ? Math.round(x.filter(t=>t.completed).length/x.length*100) : 0
}
function weekDates(iso) {
  const d=fromISO(iso), dow=d.getDay(), off=dow===0?-6:1-dow
  const mon=new Date(d); mon.setDate(d.getDate()+off)
  return Array.from({length:7},(_,i)=>{const x=new Date(mon);x.setDate(mon.getDate()+i);return localISO(x)})
}

/* Build expected tasks directly from schedule.json.
   The UI displays the plan even before any progress is saved. */
function expectedTasks(iso, student) {
  const plan=planFor(iso,student)
  if(!plan || !Array.isArray(plan.tasks)) return []
  const out=plan.tasks.map((item,i)=>{
    let title=item.title || 'Study Task'
    let subject=item.subject || ''
    let description=item.details || ''
    return {
      _virtual:true,
      _key:`${iso}-${student}-${i}`,
      student_name:student, task_date:iso, current_due_date:iso,
      task_type:item.type||'Study', title, description,
      resource:item.resource||'', subject,
      estimated_minutes:Math.max(0,Math.round(Number(item.minutes)||0)),
      priority:Number(item.priority)||2, sort_order:i+1,
      completed:false, source_type:sourceFor(student), status:'scheduled',
      carried_forward:false, carry_count:0
    }
  })
  return out
}

/* Merge current schedule text with saved completion state. */
function mergeExpected(expected, dbRows) {
  const bySig=new Map(dbRows.map(t=>[sig(t),t]))
  const merged=expected.map(e=>{
    const saved=bySig.get(sig(e))
    return saved ? {...saved,title:e.title,description:e.description,resource:e.resource,subject:e.subject,estimated_minutes:e.estimated_minutes} : e
  })
  const expectedSigs=new Set(expected.map(sig))
  dbRows.forEach(t=>{ if(!expectedSigs.has(sig(t))) merged.push(t) })
  return merged.sort((a,b)=>(Number(a.sort_order)||0)-(Number(b.sort_order)||0))
}

const STORAGE_KEY = 'diya-mcat-personal-v1'
const emptyProgress = () => ({schemaVersion:1,tasks:[],questionLogs:[],fullLengths:[],studySessions:[]})
function validateProgress(data) {
  if(!data || data.schemaVersion!==1)throw new Error('Choose a backup exported by this tracker.')
  const dateOK=x=>typeof x==='string' && /^\d{4}-\d{2}-\d{2}$/.test(x) && !Number.isNaN(fromISO(x).getTime()) && localISO(fromISO(x))===x
  for(const key of ['tasks','questionLogs','fullLengths','studySessions']) {
    if(!Array.isArray(data[key]) || data[key].some(x=>!x || typeof x!=='object' || typeof x.id!=='string'))throw new Error('Invalid backup records.')
  }
  if(data.tasks.some(x=>!dateOK(x.task_date)||typeof x.completed!=='boolean'||x.student_name!=='Diya'||!Number.isInteger(x.sort_order)))throw new Error('Invalid task data.')
  if(data.questionLogs.some(x=>!dateOK(x.question_date)||!Number.isInteger(x.total_questions)||x.total_questions<1||!Number.isInteger(x.correct_questions)||x.correct_questions<0||x.correct_questions>x.total_questions))throw new Error('Invalid question data.')
  if(data.fullLengths.some(x=>!dateOK(x.exam_date)||['cp_score','cars_score','bb_score','ps_score'].some(k=>!Number.isInteger(x[k])||x[k]<118||x[k]>132)||x.total_score!==x.cp_score+x.cars_score+x.bb_score+x.ps_score))throw new Error('Invalid exam data.')
  if(data.studySessions.some(x=>!dateOK(x.session_date)||!Number.isFinite(x.actual_minutes)||x.actual_minutes<0))throw new Error('Invalid focus data.')
  return {schemaVersion:1,tasks:data.tasks,questionLogs:data.questionLogs,fullLengths:data.fullLengths,studySessions:data.studySessions}
}
function mergeProgress(current,incoming) {
  const next=emptyProgress()
  for(const key of ['tasks','questionLogs','fullLengths','studySessions']) {
    const recordKey=x=>key==='tasks' ? `${x.source_type}|${x.task_date}|${sig(x)}` : x.id
    next[key]=[...new Map([...current[key],...incoming[key]].map(x=>[recordKey(x),x])).values()]
  }
  return next
}
export default function Home() {
  const [message,setMessage]=useState('')
  const [view,setView]=useState('Today')
  const [selectedDate,setSelectedDate]=useState(PLAN_START)
  const [data,setData]=useState(emptyProgress)
  const dataRef=useRef(emptyProgress())
  const [loaded,setLoaded]=useState(false)
  const [storageReady,setStorageReady]=useState(false)
  const importRef=useRef(null)
  useEffect(()=>{
    setSelectedDate(localISO())
    try {
      const stored=localStorage.getItem(STORAGE_KEY)
      const initial=stored ? validateProgress(JSON.parse(stored)) : emptyProgress()
      dataRef.current=initial;setData(initial);setStorageReady(true)
    } catch(e){setMessage('Browser progress could not be read. Existing data was left unchanged. Use a valid backup or restore browser storage access.')}
    setLoaded(true)
  },[])
  function save(next, restoring=false) {
    if(!storageReady&&!restoring){setMessage('Saving is unavailable because browser storage could not be read.');return false}
    try {localStorage.setItem(STORAGE_KEY,JSON.stringify(next));dataRef.current=next;setData(next);setStorageReady(true);setMessage('');return true}
    catch(e){setMessage('Progress was not saved. Browser storage may be blocked or full. Export a backup before changing browser settings.');return false}
  }
  const tasks=data.tasks.filter(validPlanTask)
  const questionLogs=data.questionLogs.filter(x=>isMyLog(x,'source')).slice().sort((a,b)=>b.question_date.localeCompare(a.question_date))
  const fullLengths=data.fullLengths.filter(x=>isMyLog(x,'exam_name')).slice().sort((a,b)=>b.exam_date.localeCompare(a.exam_date))
  const studySessions=data.studySessions.filter(x=>isMyLog(x,'session_type')).slice().sort((a,b)=>b.session_date.localeCompare(a.session_date))
  const diyaTasks=mergeExpected(expectedTasks(selectedDate,'Diya'),tasks.filter(t=>t.task_date===selectedDate))
  function overflowFor(student,iso) {
    return tasks.filter(t=>t.student_name===student&&!t.completed&&t.carried_forward&&t.current_due_date===iso&&t.task_date<iso)
  }
  function toggleTask(task) {
    const current=dataRef.current,next=!task.completed
    const {_virtual,_key,...fields}=task
    const row={...fields,id:task.id||crypto.randomUUID(),completed:next,completed_at:next?new Date().toISOString():null,status:next?'completed':'scheduled'}
    const others=current.tasks.filter(t=>!(t.source_type===row.source_type&&t.task_date===row.task_date&&sig(t)===sig(row)))
    save({...current,tasks:[...others,row]})
  }
  function addQuestionBlock(x) {
    const total=Number(x.total),correct=Number(x.correct)
    if(!Number.isInteger(total)||total<1||!Number.isInteger(correct)||correct<0||correct>total){setMessage('Correct answers must be between zero and the total questions.');return}
    const row={id:crypto.randomUUID(),question_date:x.date,source:`Diya — ${x.source}`,subject:x.subject,total_questions:total,correct_questions:correct,timed:Boolean(x.timed)}
    const current=dataRef.current;save({...current,questionLogs:[row,...current.questionLogs]})
  }
  function addFL(x) {
    const scores=[x.cp,x.cars,x.bb,x.ps].map(Number)
    if(scores.some(n=>!Number.isInteger(n)||n<118||n>132)){setMessage('Each section score must be between 118 and 132.');return}
    const row={id:crypto.randomUUID(),exam_date:x.date,exam_name:`Diya — ${x.name}`,cp_score:scores[0],cars_score:scores[1],bb_score:scores[2],ps_score:scores[3],total_score:scores.reduce((a,b)=>a+b,0)}
    const current=dataRef.current;save({...current,fullLengths:[row,...current.fullLengths]})
  }
  function logSession(student,minutes,type='Focus') {
    const row={id:crypto.randomUUID(),session_date:localISO(),actual_minutes:Number(minutes),planned_minutes:Number(minutes),session_type:`Diya — ${type}`,ended_at:new Date().toISOString()}
    const current=dataRef.current;save({...current,studySessions:[row,...current.studySessions]})
  }
  function exportBackup() {
    const url=URL.createObjectURL(new Blob([JSON.stringify(dataRef.current,null,2)],{type:'application/json'}))
    const a=document.createElement('a');a.href=url;a.download=`MCAT-progress-${localISO()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
  }
  async function importBackup(event) {
    const file=event.target.files?.[0];event.target.value='';if(!file)return
    try {
      if(file.size>10*1024*1024)throw new Error('Backup is too large.')
      const incoming=validateProgress(JSON.parse(await file.text()))
      if(save(mergeProgress(dataRef.current,incoming),true))setMessage('Backup imported. Matching records use the backup version; other records are kept.')
    } catch(e){setMessage(`Import failed: ${e.message}. Current progress was not changed.`)}
  }
  if(!loaded)return <div className="card"><p>Loading your personal tracker...</p></div>
  const daysLeft=Math.max(0,daysBetween(localISO(),EXAM_DATE))
  return <div className="shell">
    <aside className="aside">
      <div className="logo"><span>M</span><div><b>MCAT TRACKER</b><small>NOV 4 RESET</small></div></div>
      <div className="profileMini"><small>PERSONAL PLAN</small><b>Diya</b><span>Target: 510+</span></div>
      <nav>{['Today','Calendar','Questions','Full Lengths','Study Plan','Reference','Analytics'].map(x=>
        <button key={x} className={view===x?'active':''} onClick={()=>setView(x)}>{x}</button>)}</nav>
      <div className="sideExam"><small>MCAT</small><b>{daysLeft}</b><span>days remaining</span></div>
      <p style={{fontSize:12}}>Saved on this browser. Export a backup before switching devices or clearing browser data.</p>
      <button className="secondary" onClick={exportBackup}>Export Progress</button>
      <button className="secondary" onClick={()=>importRef.current?.click()}>Import Progress</button>
      <input ref={importRef} type="file" accept=".json,application/json" style={{display:'none'}} onChange={importBackup}/>
      <p style={{fontSize:12}}>Import merges a tracker backup; matching records use the imported version.</p>
    </aside>
    <main className="content">
      <header className="header"><div><h1>{view}</h1><p>Diya • MCAT January 21, 2027</p></div>
        <div className="headerRight"><div className="countdown"><b>{daysLeft}</b><span>DAYS TO MCAT</span></div></div></header>
      {message&&<div className="message">{message}</div>}
      {view==='Today'&&<Today selectedDate={selectedDate} setSelectedDate={setSelectedDate}
        diya={diyaTasks} diyaOverflow={overflowFor('Diya',selectedDate)} allTasks={tasks} toggle={toggleTask} logSession={logSession}/>}
      {view==='Calendar'&&<Calendar tasks={tasks} selectedDate={selectedDate} choose={d=>{setSelectedDate(d);setView('Today')}}/>}
      {view==='Questions'&&<Questions logs={questionLogs} add={addQuestionBlock}/>}
      {view==='Full Lengths'&&<FullLengths rows={fullLengths} add={addFL}/>}
      {view==='Study Plan'&&<StudyPlan sessions={studySessions}/>}
      {view==='Reference'&&<ReferenceLibrary/>}
      {view==='Analytics'&&<Analytics tasks={tasks} q={questionLogs} fl={fullLengths} sessions={studySessions}/>}
    </main>
  </div>
}

function Today({selectedDate,setSelectedDate,diya,diyaOverflow,allTasks,toggle,logSession}) {
  const week=weekDates(selectedDate), day=dayFor(selectedDate)
  return <>
    <div className="card weekSummary"><div className="weekTitle"><div><small>STUDY WEEK</small><h2>{formatDate(week[0])} – {formatDate(week[6],false,true)}</h2></div></div>
      <div className="weekDays">{week.map(d=>{
        const expected=expectedTasks(d,'Diya').filter(x=>x.task_type!=='Chapter')
        const db=allTasks.filter(x=>x.task_date===d&&validPlanTask(x))
        const shown=mergeExpected(expected,db)
        const done=shown.length&&shown.every(x=>x.completed)
        const missed=d<localISO()&&shown.some(x=>!x.completed)
        return <button key={d} className={[selectedDate===d?'selected':'',d===localISO()?'current':'',done?'complete':'',missed?'missed':''].filter(Boolean).join(' ')}
          onClick={()=>setSelectedDate(d)}><small>{fromISO(d).toLocaleDateString('en-US',{weekday:'short'})}</small><b>{fromISO(d).getDate()}</b>
          <span>{shown.filter(x=>x.completed).length}/{shown.length}</span></button>})}</div>
    </div>
    {!day&&<div className="message">No schedule entry for this date.</div>}
    <VideoPlan plan={day?.diya}/>
    <StudentHeader name="Diya" subtitle="Question-Heavy Track • 510+ Target" badge={fmtMin(day?.diya?.target_minutes||sumMin(diya))}/>
    <Dashboard student="Diya" date={selectedDate} plan={day?.diya} tasks={diya} overflow={diyaOverflow} toggle={toggle} logSession={logSession}/>
  </>
}
function ResourceLinks({items=[]}) {
  return <ul>{items.map((v,i)=><li key={i} style={{marginBottom:8}}><a href={v.url} target="_blank" rel="noopener noreferrer" style={{color:'#60a5fa'}}>{v.title}</a><small style={{display:'block'}}>Search exact title on Khan Academy</small></li>)}</ul>
}
function VideoPlan({plan}) {
  if(!plan)return null
  const p=plan.pankow
  return <>
    {p&&<section className="card" style={{marginBottom:20}}><h2>MrPankow: {p.topic}</h2><p><b>{p.new_card_limit ? `Up to ${p.new_card_limit} new cards` : 'Due reviews only'} · {p.minutes} minutes within your Anki block</b></p><p>{p.action}</p><p>{p.rule}</p>
      {!!p.optional_videos?.length&&<details><summary>Optional videos if these cards are unclear</summary><ResourceLinks items={p.optional_videos}/></details>}
    </section>}
    <section className="card" style={{marginBottom:20}}><h2>Optional video references</h2><p>Skip concepts you can explain and apply. C/P gets priority. Use saved viewing time for questions or error review; these are not extra checklist items.</p>
    {plan.watch?.length ? plan.watch.map((v,i)=><div key={i} style={{padding:'16px 0',borderTop:'1px solid #334155'}}>
      <small>{v.subject} · up to {v.minutes} minutes within the existing block</small><h3>{v.sections.join(' → ')}</h3>
      <ResourceLinks items={v.videos}/><p>{v.instructions}</p>{v.source_note&&<p>{v.source_note}</p>}<small>Included in: {v.within_task}</small>
    </div>) : <p>{plan.video_note}</p>}</section>
  </>
}
function ReferenceLibrary() {
  const [query,setQuery]=useState(''),[kind,setKind]=useState('All')
  const entries=(schedule.reference_library||[]).filter(x=>(kind==='All'||x.kind===kind)&&`${x.title} ${x.unit}`.toLowerCase().includes(query.toLowerCase()))
  return <section className="card"><h2>Your Khan Academy reference list</h2><p>Optional lookup only. This is not an additional study checklist. Search links use the exact title. Some supplied entries are headings or articles; their type is marked conservatively.</p>
    <input aria-label="Search reference list" placeholder="Search a topic or title" value={query} onChange={e=>setQuery(e.target.value)}/>
    <select aria-label="Resource type" value={kind} onChange={e=>setKind(e.target.value)}>{['All',...new Set((schedule.reference_library||[]).map(x=>x.kind))].map(x=><option key={x}>{x}</option>)}</select>
    <p>{entries.length} matching entries</p>{entries.map((x,i)=><div className="logRow" key={i}><div><small>{x.kind} · {x.unit}</small><a href={x.url} target="_blank" rel="noopener noreferrer" style={{color:'#60a5fa'}}>{x.title}</a></div></div>)}
  </section>
}
function StudentHeader({name,subtitle,badge}) {
  return <div className="studentHeader"><div><small>STUDENT</small><h2>{name}</h2><p>{subtitle}</p></div><strong>{badge}</strong></div>
}
function Dashboard({student,date,plan,tasks,overflow,toggle,logSession}) {
  const real=tasks.filter(x=>x.task_type!=='Chapter'), done=real.filter(x=>x.completed).length
  return <><Overflow student={student} rows={overflow} toggle={toggle}/>
    <div className="todayHeading"><div><small>{(plan?.phase||'STUDY PLAN').toUpperCase()}</small><h2>{formatDate(date,true,true)}</h2>
      <p>{plan?.focus || 'Questions → review → repair → recall.'}</p><p>{plan?.guidance}</p></div>
      <div className="todayMetrics"><span><small>PLANNED</small><b>{fmtMin(sumMin(real))}</b></span><span><small>DONE</small><b>{done}/{real.length}</b></span>
      <span><small>QUESTIONS</small><b>{plan?.question_target || 0}</b></span><span><small>OVERFLOW</small><b>{fmtMin(sumMin(overflow))}</b></span></div></div>
    <Progress p={progress(real)} done={done} total={real.length} mins={sumMin(real)}/>
    <div className="dashboardGrid"><div className="card"><div className="sectionTitle"><div><small>TODAY'S CHECKLIST</small><h2>{student}'s Work</h2></div><span>{plan?.phase}</span></div>
      <div className="taskList">{real.length?real.map(x=><Task key={x.id||x._key} x={x} toggle={toggle}/>):<p className="empty">No scheduled tasks.</p>}</div></div>
      <Pomodoro student={student} log={logSession}/></div></>
}
function Overflow({student,rows,toggle}) {
  if(!rows.length)return null
  return <div className="card overflowPanel"><div className="sectionTitle"><div><small>{student.toUpperCase()} OVERFLOW</small><h2>Carried Work</h2></div><strong>{fmtMin(sumMin(rows))}</strong></div>
    <div className="taskList">{rows.map(x=><Task key={x.id} x={x} toggle={toggle} overflow/>)}</div></div>
}
function Task({x,toggle,overflow=false}) {
  return <div className={['task',x.completed?'completed':'',overflow?'overflowTask':''].filter(Boolean).join(' ')}>
    <button className={`taskCheck ${x.completed?'done':''}`} aria-label={`${x.completed?'Uncheck':'Complete'} ${x.title}`} onClick={()=>toggle(x)}>{x.completed?'✓':''}</button>
    <div className="taskBody"><small>{overflow?`OVERFLOW • ${x.task_type}`:x.task_type}</small><b>{x.title}</b>{x.description&&<span>{x.description}</span>}
      <span>{Number(x.estimated_minutes)>0?fmtMin(x.estimated_minutes):''}{x.resource?`${Number(x.estimated_minutes)>0?' • ':''}${x.resource}`:''}</span></div></div>
}
function Progress({p,done,total,mins}) {
  return <div className="card progressCard"><div><b>Daily Progress</b><span>{done} of {total} tasks complete • {fmtMin(mins)} planned</span></div><strong>{p}%</strong>
    <div className="progress"><i style={{width:`${p}%`}}/></div></div>
}
function Pomodoro({student,log}) {
  const [focus,setFocus]=useState(50),[brk,setBrk]=useState(10),[mode,setMode]=useState('Focus'),[seconds,setSeconds]=useState(3000),[running,setRunning]=useState(false)
  const ref=useRef(null), logRef=useRef(log), finished=useRef(false)
  useEffect(()=>{logRef.current=log},[log])
  useEffect(()=>{setRunning(false);setSeconds((mode==='Focus'?focus:brk)*60);finished.current=false},[mode,focus,brk])
  useEffect(()=>{
    if(!running)return
    ref.current=setInterval(()=>setSeconds(s=>Math.max(0,s-1)),1000)
    return()=>clearInterval(ref.current)
  },[running])
  useEffect(()=>{
    if(running&&seconds===0&&!finished.current){
      finished.current=true;setRunning(false)
      if(mode==='Focus')logRef.current(student,focus,'Pomodoro')
    }
  },[seconds,running,mode,student,focus])
  const mm=String(Math.floor(seconds/60)).padStart(2,'0'),ss=String(seconds%60).padStart(2,'0')
  return <div className="card pomodoro"><div className="sectionTitle"><div><small>{student.toUpperCase()}</small><h2>Pomodoro</h2></div><span>{mode}</span></div><div className="timer">{mm}:{ss}</div>
    <div className="timerModes"><button onClick={()=>{setRunning(false);setMode('Focus')}}>Focus</button><button onClick={()=>{setRunning(false);setMode('Break')}}>Break</button></div>
    <div className="timerInputs"><label>Focus<input type="number" min="1" value={focus} onChange={e=>setFocus(Number(e.target.value)||1)}/></label><label>Break<input type="number" min="1" value={brk} onChange={e=>setBrk(Number(e.target.value)||1)}/></label></div>
    <button className="timerButton" onClick={()=>{if(seconds===0){setSeconds((mode==='Focus'?focus:brk)*60);finished.current=false}setRunning(x=>!x)}}>{running?'Pause':'Start'}</button></div>
}
function Calendar({tasks,selectedDate,choose}) {
  const [off,setOff]=useState(0), base=fromISO(selectedDate), m=new Date(base.getFullYear(),base.getMonth()+off,1), y=m.getFullYear(),mi=m.getMonth()
  const last=new Date(y,mi+1,0).getDate(), dates=Array.from({length:last},(_,i)=>localISO(new Date(y,mi,i+1)))
  return <div className="card"><div className="sectionTitle"><div><small>STUDY CALENDAR</small><h2>{m.toLocaleDateString('en-US',{month:'long',year:'numeric'})}</h2></div>
    <div><button className="secondary" onClick={()=>setOff(x=>x-1)}>←</button> <button className="secondary" onClick={()=>setOff(x=>x+1)}>→</button></div></div>
    <div className="calendarGrid">{dates.map(d=>{const e=expectedTasks(d,'Diya').filter(x=>x.task_type!=='Chapter'),db=tasks.filter(x=>x.task_date===d&&validPlanTask(x)),x=mergeExpected(e,db)
      return <button key={d} className={d===localISO()?'current':''} onClick={()=>choose(d)}><small>{fromISO(d).toLocaleDateString('en-US',{weekday:'short'})}</small><b>{fromISO(d).getDate()}</b><span>{x.filter(t=>t.completed).length}/{x.length}</span><small style={{display:'block',whiteSpace:'normal',fontSize:11}}>MrPankow: {dayFor(d)?.diya?.pankow?.topic || '—'}</small>{dayFor(d)?.diya?.watch?.map((v,i)=><small key={i} style={{display:'block',whiteSpace:'normal',fontSize:11,marginTop:4}}>{v.subject}: {v.sections.join(' / ')}</small>)}</button>})}</div></div>
}
function Questions({logs,add}) {
  const student='Diya'
  const [date,setDate]=useState(localISO()),[source,setSource]=useState('UWorld'),[subject,setSubject]=useState('B/B'),[total,setTotal]=useState(20),[correct,setCorrect]=useState(0),[timed,setTimed]=useState(true)
  return <div className="dashboardGrid"><form className="card form" onSubmit={e=>{e.preventDefault();add({student,date,source,subject,total,correct,timed})}}>
    <div className="sectionTitle"><div><small>QUESTION LOG</small><h2>Add Practice Block</h2></div></div>

    <label>Date<input type="date" required value={date} onChange={e=>setDate(e.target.value)}/></label>
    <label>Resource<input value={source} onChange={e=>setSource(e.target.value)}/></label><label>Section<input value={subject} onChange={e=>setSubject(e.target.value)}/></label>
    <label>Questions<input type="number" min="1" value={total} onChange={e=>setTotal(e.target.value)}/></label><label>Correct<input type="number" min="0" value={correct} onChange={e=>setCorrect(e.target.value)}/></label>
    <label className="checkboxLabel"><input type="checkbox" checked={timed} onChange={e=>setTimed(e.target.checked)}/>Timed</label><button type="submit">Save Question Block</button></form>
    <div className="card"><div className="sectionTitle"><div><small>RECENT PRACTICE</small><h2>Question History</h2></div></div><div className="logList">
      {logs.slice(0,30).map(x=>{const n=Number(x.total_questions)||0,c=Number(x.correct_questions)||0;return <div className="logRow" key={x.id}><div><small>{formatDate(x.question_date)} • {x.source}</small><b>{x.subject} • {c}/{n}</b></div><strong>{n?Math.round(c/n*100):0}%</strong></div>})}</div></div></div>
}
function FullLengths({rows,add}) {
  const student='Diya'
  const [date,setDate]=useState(localISO()),[name,setName]=useState('AAMC FL'),[cp,setCp]=useState(125),[cars,setCars]=useState(125),[bb,setBb]=useState(125),[ps,setPs]=useState(125)
  return <div className="dashboardGrid"><form className="card form" onSubmit={e=>{e.preventDefault();add({student,date,name,cp,cars,bb,ps})}}>
    <div className="sectionTitle"><div><small>FULL LENGTH</small><h2>Log Score</h2></div></div>
<label>Date<input type="date" required value={date} onChange={e=>setDate(e.target.value)}/></label>
    <label>Exam<input value={name} onChange={e=>setName(e.target.value)}/></label>
    {[['C/P',cp,setCp],['CARS',cars,setCars],['B/B',bb,setBb],['P/S',ps,setPs]].map(([l,v,s])=><label key={l}>{l}<input type="number" min="118" max="132" value={v} onChange={e=>s(e.target.value)}/></label>)}
    <button type="submit">Save Full Length</button></form>
    <div className="card"><div className="sectionTitle"><div><small>SCORE HISTORY</small><h2>Full Lengths</h2></div></div><div className="flList">{rows.map(x=><div className="flRow" key={x.id}><div><small>{formatDate(x.exam_date)}</small><b>{x.exam_name}</b><span>C/P {x.cp_score} • CARS {x.cars_score} • B/B {x.bb_score} • P/S {x.ps_score}</span></div><strong>{x.total_score}</strong></div>)}</div></div></div>
}
function StudyPlan({sessions}) {
  const exams=DAYS.filter(d=>d.diya?.tasks?.some(t=>t.type==='Full Length'))
  return <>
    <div className="card"><div className="sectionTitle"><div><small>NOVEMBER 4 – JANUARY 21</small><h2>Your 5–6 Hour Study Plan</h2></div></div>
      <p>C/P gets priority. Regular days contain 5.5 focused hours, plus breaks. Full-length days take about 7.5 hours; the final two days taper.</p>
      {(schedule.phases||[]).map(p=><div className="logRow" key={p.start}><div><small>{formatDate(p.start)} – {formatDate(p.end)}</small><b>{p.name}</b><p>{p.details}</p></div></div>)}
    </div>
    <div className="card"><h2>MrPankow Setup and Daily Rules</h2>{(schedule.pankow_guide||[]).map((r,i)=><p key={i}>{i+1}. {r}</p>)}</div>
    <div className="card"><h2>How to Use Each Study Day</h2>{(schedule.study_rules||[]).map((rule,i)=><p key={rule}><b>{i+1}.</b> {rule}</p>)}</div>
    <div className="dashboardGrid"><div className="card"><h2>Scheduled Full Lengths</h2>{exams.map((d,i)=><div className="logRow" key={d.date}><div><small>FULL LENGTH {i+1}</small><b>{formatDate(d.date,true,true)}</b><p>{d.diya.tasks[0].resource}</p><span>Dedicated review the following day.</span></div></div>)}</div>
    <div className="card"><h2>Recent Focus Sessions</h2>{sessions.slice(0,20).map(x=><div className="logRow" key={x.id}><div><small>{formatDate(x.session_date)}</small><b>{x.session_type}</b></div><strong>{fmtMin(x.actual_minutes)}</strong></div>)}</div></div>
  </>
}
function Analytics({tasks,q,fl,sessions}) {
  const d=DAYS.filter(day=>day.date<=localISO()).flatMap(day=>mergeExpected(expectedTasks(day.date,'Diya'),tasks.filter(x=>validPlanTask(x)&&x.task_date===day.date))).filter(x=>x.task_type!=='Chapter')
  const tq=q.reduce((a,x)=>a+(Number(x.total_questions)||0),0),cq=q.reduce((a,x)=>a+(Number(x.correct_questions)||0),0),fm=sessions.reduce((a,x)=>a+(Number(x.actual_minutes)||0),0)
  return <div className="analyticsGrid"><Metric l="DIYA COMPLETION" v={d.length?`${Math.round(d.filter(x=>x.completed).length/d.length*100)}%`:'0%'} s={`${d.filter(x=>x.completed).length}/${d.length} tasks`}/>
    <Metric l="QUESTIONS LOGGED" v={tq} s={`${tq?Math.round(cq/tq*100):0}% accuracy`}/>
    <Metric l="FOCUS TIME" v={fmtMin(fm)} s={`${sessions.length} sessions`}/><Metric l="BEST FL" v={fl.length?Math.max(...fl.map(x=>Number(x.total_score)||0)):'—'} s={`${fl.length} exams logged`}/></div>
}
function Metric({l,v,s}) { return <div className="card statCard"><small>{l}</small><b>{v}</b><span>{s}</span></div> }
