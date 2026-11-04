'use client'

import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
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
  return [t.student_name||'',t.task_type||'',t.title||'',t.resource||'',t.subject||''].join('||')
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
   IMPORTANT: the UI uses these even before/if Supabase seeding occurs. */
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

/* Merge schedule expectations with database state.
   DB rows win, but missing DB rows still display from schedule.json. */
function mergeExpected(expected, dbRows) {
  const bySig=new Map(dbRows.map(t=>[sig(t),t]))
  const merged=expected.map(e=>bySig.get(sig(e)) || e)
  const expectedSigs=new Set(expected.map(sig))
  dbRows.forEach(t=>{ if(!expectedSigs.has(sig(t))) merged.push(t) })
  return merged.sort((a,b)=>(Number(a.sort_order)||0)-(Number(b.sort_order)||0))
}

export default function Home() {
  const [session,setSession]=useState(null)
  const [authLoading,setAuthLoading]=useState(true)
  const [email,setEmail]=useState('')
  const [password,setPassword]=useState('')
  const [authMode,setAuthMode]=useState('signin')
  const [message,setMessage]=useState('')
  const [view,setView]=useState('Today')
  const [selectedDate,setSelectedDate]=useState(localISO())
  const [tasks,setTasks]=useState([])
  const [questionLogs,setQuestionLogs]=useState([])
  const [fullLengths,setFullLengths]=useState([])
  const [studySessions,setStudySessions]=useState([])
  const [loaded,setLoaded]=useState(false)
  const [syncing,setSyncing]=useState(false)
  const syncRef=useRef(false)
  const uid=session?.user?.id || null

  useEffect(()=>{
    if(!supabase){setAuthLoading(false);return}
    supabase.auth.getSession().then(({data})=>{setSession(data.session||null);setAuthLoading(false)})
    const {data:{subscription}}=supabase.auth.onAuthStateChange((_e,s)=>setSession(s||null))
    return ()=>subscription.unsubscribe()
  },[])

  async function auth(e) {
    e.preventDefault(); setMessage('')
    const r=authMode==='signup'
      ? await supabase.auth.signUp({email,password})
      : await supabase.auth.signInWithPassword({email,password})
    if(r.error)setMessage(r.error.message)
    else if(authMode==='signup')setMessage('Account created. Check email if confirmation is required.')
  }

  async function loadAll() {
    if(!uid||!supabase)return []
    const [a,b,c,d]=await Promise.all([
      supabase.from('daily_tasks').select('*').eq('user_id',uid).order('task_date').order('sort_order'),
      supabase.from('question_blocks').select('*').eq('user_id',uid).order('question_date',{ascending:false}),
      supabase.from('full_length_scores').select('*').eq('user_id',uid).order('exam_date',{ascending:false}),
      supabase.from('study_sessions').select('*').eq('user_id',uid).order('session_date',{ascending:false})
    ])
    if(a.error){console.error(a.error);setMessage(`Task load error: ${a.error.message}`)}
    const rows=a.data||[]
    setTasks(rows.filter(validPlanTask));setQuestionLogs((b.data||[]).filter(x=>isMyLog(x,'source')));setFullLengths((c.data||[]).filter(x=>isMyLog(x,'exam_name')));setStudySessions((d.data||[]).filter(x=>isMyLog(x,'session_type')));setLoaded(true)
    return rows
  }
  useEffect(()=>{if(uid){setLoaded(false);loadAll()}},[uid])

  async function syncDay(iso) {
    if(!uid||!supabase||syncRef.current||iso<PLAN_START||iso>EXAM_DATE)return
    if(!dayFor(iso)){setMessage(`No schedule entry for ${iso}.`);return}
    syncRef.current=true;setSyncing(true)
    try {
      const {data:existing,error}=await supabase.from('daily_tasks').select('*')
        .eq('user_id',uid).eq('task_date',iso)
      if(error)throw error
      const expected=expectedTasks(iso,'Diya')
      const have=new Set((existing||[]).filter(validPlanTask).map(t=>`${t.source_type}||${sig(t)}`))
      const seen=new Set(have)
      const missing=expected.filter(t=>{
        const k=`${t.source_type}||${sig(t)}`
        if(seen.has(k))return false
        seen.add(k);return true
      }).map(({_virtual,_key,...t})=>({...t,user_id:uid}))
      if(missing.length){const {error:e}=await supabase.from('daily_tasks').insert(missing);if(e)throw e}
      if(missing.length)await loadAll()
    } catch(e){console.error('[MCAT sync]',e);setMessage(`Save warning: ${e?.message||'Unknown error'}. Planned tasks remain visible.`)}
    finally{syncRef.current=false;setSyncing(false)}
  }
  useEffect(()=>{if(uid&&loaded)syncDay(selectedDate)},[uid,loaded,selectedDate])

  const dbDay=(student,iso)=>tasks.filter(t=>validPlanTask(t)&&t.student_name===student&&t.task_date===iso)
  const displayTasks=(student,iso)=>mergeExpected(expectedTasks(iso,student),dbDay(student,iso))
  const diyaTasks=displayTasks('Diya',selectedDate)

  function overflowFor(student,iso) {
    // Do not silently add overdue tasks every day. Carryover is explicit and version-scoped.
    return tasks.filter(t=>validPlanTask(t)&&t.student_name===student&&!t.completed&&t.carried_forward&&t.current_due_date===iso&&t.task_date<iso&&t.task_type!=='Chapter')
  }

  async function toggleTask(task) {
    if(!uid||!supabase)return
    const next=!task.completed
    if(task._virtual || !task.id) {
      const {_virtual,_key,...row}=task
      const {data,error}=await supabase.from('daily_tasks').insert({
        ...row,user_id:uid,completed:next,completed_at:next?new Date().toISOString():null,status:next?'completed':'scheduled'
      }).select().single()
      if(error){setMessage(`Could not save task: ${error.message}`);return}
    } else {
      const {error}=await supabase.from('daily_tasks').update({
        completed:next,completed_at:next?new Date().toISOString():null,
        status:next?'completed':(task.carried_forward?'overdue':'scheduled')
      }).eq('id',task.id).eq('user_id',uid)
      if(error){setMessage(error.message);return}
    }
    await loadAll()
  }

  async function addQuestionBlock(x) {
    const {error}=await supabase.from('question_blocks').insert({
      user_id:uid,question_date:x.date,source:`${x.student} — ${x.source}`,subject:x.subject,
      total_questions:Number(x.total),correct_questions:Number(x.correct),timed:Boolean(x.timed)
    })
    if(error)setMessage(error.message);else await loadAll()
  }
  async function addFL(x) {
    const {error}=await supabase.from('full_length_scores').insert({
      user_id:uid,exam_date:x.date,exam_name:`${x.student} — ${x.name}`,
      cp_score:Number(x.cp),cars_score:Number(x.cars),bb_score:Number(x.bb),ps_score:Number(x.ps),
      total_score:Number(x.cp)+Number(x.cars)+Number(x.bb)+Number(x.ps)
    })
    if(error)setMessage(error.message);else await loadAll()
  }
  async function logSession(student,minutes,type='Focus') {
    const {error}=await supabase.from('study_sessions').insert({
      user_id:uid,session_date:localISO(),actual_minutes:Number(minutes),planned_minutes:Number(minutes),
      session_type:`${student} — ${type}`,ended_at:new Date().toISOString()
    })
    if(error)setMessage(error.message);else await loadAll()
  }

  if(authLoading)return <div className="auth"><div className="card authCard"><h1>MCAT Study Tracker</h1><p>Loading...</p></div></div>
  if(!session)return <div className="auth"><form className="card authCard" onSubmit={auth}>
    <div className="logo"><span>M</span><div><b>MCAT TRACKER</b><small>JANUARY 21, 2027</small></div></div>
    <h1>{authMode==='signin'?'Welcome back':'Create account'}</h1>
    <p>Diya MCAT Study System</p>
    <input type="email" placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)} required/>
    <input type="password" placeholder="Password" value={password} onChange={e=>setPassword(e.target.value)} required/>
    <button type="submit">{authMode==='signin'?'Sign In':'Create Account'}</button>
    <button type="button" className="secondary" onClick={()=>setAuthMode(authMode==='signin'?'signup':'signin')}>
      {authMode==='signin'?'Need an account?':'Already have an account?'}
    </button>
    {message&&<div className="message">{message}</div>}
  </form></div>

  const daysLeft=Math.max(0,daysBetween(localISO(),EXAM_DATE))
  return <div className="shell">
    <aside className="aside">
      <div className="logo"><span>M</span><div><b>MCAT TRACKER</b><small>NOV 4 RESET</small></div></div>
      <div className="profileMini"><small>PERSONAL PLAN</small><b>Diya</b><span>Target: 510+</span></div>
      <nav>{['Today','Calendar','Questions','Full Lengths','Study Plan','Analytics'].map(x=>
        <button key={x} className={view===x?'active':''} onClick={()=>setView(x)}>{x}</button>)}</nav>
      <div className="sideExam"><small>MCAT</small><b>{daysLeft}</b><span>days remaining</span></div>
      <button className="secondary" onClick={()=>supabase.auth.signOut()}>Sign Out</button>
    </aside>
    <main className="content">
      <header className="header"><div><h1>{view}</h1><p>Diya • MCAT January 21, 2027</p></div>
        <div className="headerRight"><div className="countdown"><b>{daysLeft}</b><span>DAYS TO MCAT</span></div></div></header>
      {message&&<div className="message">{message}</div>}
      {view==='Today'&&<Today selectedDate={selectedDate} setSelectedDate={setSelectedDate}
        diya={diyaTasks} diyaOverflow={overflowFor('Diya',selectedDate)} allTasks={tasks} toggle={toggleTask} logSession={logSession} syncing={syncing}/>}
      {view==='Calendar'&&<Calendar tasks={tasks} selectedDate={selectedDate} choose={d=>{setSelectedDate(d);setView('Today')}}/>}
      {view==='Questions'&&<Questions logs={questionLogs} add={addQuestionBlock}/>}
      {view==='Full Lengths'&&<FullLengths rows={fullLengths} add={addFL}/>}
      {view==='Study Plan'&&<StudyPlan sessions={studySessions}/>}
      {view==='Analytics'&&<Analytics tasks={tasks} q={questionLogs} fl={fullLengths} sessions={studySessions}/>}
    </main>
  </div>
}

function Today({selectedDate,setSelectedDate,diya,diyaOverflow,allTasks,toggle,logSession,syncing}) {
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
    {syncing&&<div className="message">Syncing schedule with database...</div>}
    {!day&&<div className="message">No schedule entry for this date.</div>}
    <StudentHeader name="Diya" subtitle="Question-Heavy Track • 510+ Target" badge={fmtMin(day?.diya?.target_minutes||sumMin(diya))}/>
    <Dashboard student="Diya" date={selectedDate} plan={day?.diya} tasks={diya} overflow={diyaOverflow} toggle={toggle} logSession={logSession}/>
  </>
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
    <button className={`taskCheck ${x.completed?'done':''}`} onClick={()=>toggle(x)}>{x.completed?'✓':''}</button>
    <div className="taskBody"><small>{overflow?`OVERFLOW • ${x.task_type}`:x.task_type}</small><b>{x.title}</b>{x.description&&<span>{x.description}</span>}
      <span>{Number(x.estimated_minutes)>0?fmtMin(x.estimated_minutes):''}{x.resource?`${Number(x.estimated_minutes)>0?' • ':''}${x.resource}`:''}</span></div></div>
}
function Progress({p,done,total,mins}) {
  return <div className="card progressCard"><div><b>Daily Progress</b><span>{done} of {total} tasks complete • {fmtMin(mins)} planned</span></div><strong>{p}%</strong>
    <div className="progress"><i style={{width:`${p}%`}}/></div></div>
}
function Pomodoro({student,log}) {
  const [focus,setFocus]=useState(50),[brk,setBrk]=useState(10),[mode,setMode]=useState('Focus'),[seconds,setSeconds]=useState(3000),[running,setRunning]=useState(false)
  const ref=useRef(null)
  useEffect(()=>{if(!running)setSeconds((mode==='Focus'?focus:brk)*60)},[mode,focus,brk,running])
  useEffect(()=>{
    if(!running){clearInterval(ref.current);return}
    ref.current=setInterval(()=>setSeconds(s=>{if(s<=1){clearInterval(ref.current);setRunning(false);if(mode==='Focus')log(student,focus,'Pomodoro');return 0}return s-1}),1000)
    return()=>clearInterval(ref.current)
  },[running,mode,focus,student])
  const mm=String(Math.floor(seconds/60)).padStart(2,'0'),ss=String(seconds%60).padStart(2,'0')
  return <div className="card pomodoro"><div className="sectionTitle"><div><small>{student.toUpperCase()}</small><h2>Pomodoro</h2></div><span>{mode}</span></div><div className="timer">{mm}:{ss}</div>
    <div className="timerModes"><button onClick={()=>{setRunning(false);setMode('Focus')}}>Focus</button><button onClick={()=>{setRunning(false);setMode('Break')}}>Break</button></div>
    <div className="timerInputs"><label>Focus<input type="number" min="1" value={focus} onChange={e=>setFocus(Number(e.target.value)||1)}/></label><label>Break<input type="number" min="1" value={brk} onChange={e=>setBrk(Number(e.target.value)||1)}/></label></div>
    <button className="timerButton" onClick={()=>setRunning(x=>!x)}>{running?'Pause':'Start'}</button></div>
}
function Calendar({tasks,selectedDate,choose}) {
  const [off,setOff]=useState(0), base=fromISO(selectedDate), m=new Date(base.getFullYear(),base.getMonth()+off,1), y=m.getFullYear(),mi=m.getMonth()
  const last=new Date(y,mi+1,0).getDate(), dates=Array.from({length:last},(_,i)=>localISO(new Date(y,mi,i+1)))
  return <div className="card"><div className="sectionTitle"><div><small>STUDY CALENDAR</small><h2>{m.toLocaleDateString('en-US',{month:'long',year:'numeric'})}</h2></div>
    <div><button className="secondary" onClick={()=>setOff(x=>x-1)}>←</button> <button className="secondary" onClick={()=>setOff(x=>x+1)}>→</button></div></div>
    <div className="calendarGrid">{dates.map(d=>{const e=expectedTasks(d,'Diya').filter(x=>x.task_type!=='Chapter'),db=tasks.filter(x=>x.task_date===d&&validPlanTask(x)),x=mergeExpected(e,db)
      return <button key={d} className={d===localISO()?'current':''} onClick={()=>choose(d)}><small>{fromISO(d).toLocaleDateString('en-US',{weekday:'short'})}</small><b>{fromISO(d).getDate()}</b><span>{x.filter(t=>t.completed).length}/{x.length}</span></button>})}</div></div>
}
function Questions({logs,add}) {
  const student='Diya'
  const [date,setDate]=useState(localISO()),[source,setSource]=useState('UWorld'),[subject,setSubject]=useState('B/B'),[total,setTotal]=useState(20),[correct,setCorrect]=useState(0),[timed,setTimed]=useState(true)
  return <div className="dashboardGrid"><form className="card form" onSubmit={e=>{e.preventDefault();add({student,date,source,subject,total,correct,timed})}}>
    <div className="sectionTitle"><div><small>QUESTION LOG</small><h2>Add Practice Block</h2></div></div>

    <label>Date<input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label>
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
<label>Date<input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label>
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
    <div className="card"><h2>How to Use Each Study Day</h2>{(schedule.study_rules||[]).map((rule,i)=><p key={rule}><b>{i+1}.</b> {rule}</p>)}</div>
    <div className="dashboardGrid"><div className="card"><h2>Scheduled Full Lengths</h2>{exams.map((d,i)=><div className="logRow" key={d.date}><div><small>FULL LENGTH {i+1}</small><b>{formatDate(d.date,true,true)}</b><p>{d.diya.tasks[0].resource}</p><span>Dedicated review the following day.</span></div></div>)}</div>
    <div className="card"><h2>Recent Focus Sessions</h2>{sessions.slice(0,20).map(x=><div className="logRow" key={x.id}><div><small>{formatDate(x.session_date)}</small><b>{x.session_type}</b></div><strong>{fmtMin(x.actual_minutes)}</strong></div>)}</div></div>
  </>
}
function Analytics({tasks,q,fl,sessions}) {
  const d=tasks.filter(x=>validPlanTask(x)&&x.student_name==='Diya'&&x.task_type!=='Chapter')
  const tq=q.reduce((a,x)=>a+(Number(x.total_questions)||0),0),cq=q.reduce((a,x)=>a+(Number(x.correct_questions)||0),0),fm=sessions.reduce((a,x)=>a+(Number(x.actual_minutes)||0),0)
  return <div className="analyticsGrid"><Metric l="DIYA COMPLETION" v={d.length?`${Math.round(d.filter(x=>x.completed).length/d.length*100)}%`:'0%'} s={`${d.filter(x=>x.completed).length}/${d.length} tasks`}/>
    <Metric l="QUESTIONS LOGGED" v={tq} s={`${tq?Math.round(cq/tq*100):0}% accuracy`}/>
    <Metric l="FOCUS TIME" v={fmtMin(fm)} s={`${sessions.length} sessions`}/><Metric l="BEST FL" v={fl.length?Math.max(...fl.map(x=>Number(x.total_score)||0)):'—'} s={`${fl.length} exams logged`}/></div>
}
function Metric({l,v,s}) { return <div className="card statCard"><small>{l}</small><b>{v}</b><span>{s}</span></div> }
