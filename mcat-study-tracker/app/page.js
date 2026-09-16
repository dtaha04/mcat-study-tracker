'use client'

import {useEffect,useMemo,useRef,useState} from 'react'
import {supabase} from '../lib/supabase'
import schedule from '../data/schedule.json'

const fmt=d=>new Date(d+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'})
const todayISO=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}

const TASKS=(r)=>{
  const a=[]
  if(r.anki && !/rest/i.test(r.anki)) a.push({type:'Anki',title:r.anki,resource:'Anki'})
  if(r.questions>0) a.push({type:'Questions',title:`${r.questions} science/P-S questions + full review`,resource:r.source})
  if(r.cars>0) a.push({type:'CARS',title:`${r.cars} CARS passage${r.cars>1?'s':''} + review`,resource:/AAMC/i.test(r.source)?'AAMC':'Jack Westin'})
  if(r.content && !/none|rest/i.test(r.content)) a.push({type:'Content',title:r.content,resource:'Targeted review'})
  if(!a.length) a.push({type:'Rest',title:'Recovery / rest day',resource:'Recovery'})
  return a
}

const hoursText=min=>{
  if(!min) return '0m'
  const h=Math.floor(min/60)
  const m=min%60
  return h ? `${h}h ${m ? `${m}m` : ''}` : `${m}m`
}

export default function Home(){
  const [session,setSession]=useState(null)
  const [authMode,setAuthMode]=useState('login')
  const [msg,setMsg]=useState('')
  const [tab,setTab]=useState('Today')
  const [tasks,setTasks]=useState([])
  const [days,setDays]=useState([])
  const [selected,setSelected]=useState(todayISO())
  const [loading,setLoading]=useState(true)
  const [qlogs,setQlogs]=useState([])
  const [fls,setFls]=useState([])
  const [sessions,setSessions]=useState([])
  const [seconds,setSeconds]=useState(50*60)
  const [running,setRunning]=useState(false)
  const [focusMin,setFocusMin]=useState(50)
  const [breakMin,setBreakMin]=useState(10)
  const [timerMode,setTimerMode]=useState('Focus')
  const timer=useRef(null)

  const planned=useMemo(()=>schedule.find(x=>x.date===selected)||schedule[0],[selected])

  useEffect(()=>{
    if(!supabase){
      setLoading(false)
      setMsg('Supabase environment variables are missing.')
      return
    }
    supabase.auth.getSession().then(({data})=>{
      setSession(data.session)
      setLoading(false)
    })
    const {data:{subscription}}=supabase.auth.onAuthStateChange((_e,s)=>setSession(s))
    return()=>subscription.unsubscribe()
  },[])

  useEffect(()=>{
    if(session){
      seed()
      loadAll()
      const ch=supabase.channel('mcat-sync')
        .on('postgres_changes',{event:'*',schema:'public',table:'daily_tasks',filter:`user_id=eq.${session.user.id}`},()=>loadAll())
        .subscribe()
      return()=>supabase.removeChannel(ch)
    }
  },[session])

  useEffect(()=>{
    if(running){
      timer.current=setInterval(()=>setSeconds(s=>{
        if(s<=1){
          setRunning(false)
          clearInterval(timer.current)
          if(timerMode==='Focus'){
            logSession(focusMin)
            setTimerMode('Break')
            return breakMin*60
          }else{
            setTimerMode('Focus')
            return focusMin*60
          }
        }
        return s-1
      }),1000)
    }
    return()=>clearInterval(timer.current)
  },[running,timerMode,focusMin,breakMin])

  async function auth(e){
    e.preventDefault()
    setMsg('')
    const fd=new FormData(e.currentTarget)
    const email=fd.get('email'),password=fd.get('password')
    const res=authMode==='login'
      ? await supabase.auth.signInWithPassword({email,password})
      : await supabase.auth.signUp({email,password})
    setMsg(res.error?res.error.message:(authMode==='signup'&&!res.data.session?'Check your email to confirm your account.':''))
  }

  async function seed(){
    const uid=session.user.id
    const {count}=await supabase.from('study_days').select('*',{count:'exact',head:true}).eq('user_id',uid)
    if(count>0)return

    const dayRows=schedule.map(r=>({
      user_id:uid,
      study_date:r.date,
      phase:r.phase,
      planned_hours:r.hours,
      is_rest_day:TASKS(r)[0]?.type==='Rest',
      is_full_length_day:/full.?length|FL/i.test(r.assignment+' '+r.notes)
    }))

    const {data:inserted,error}=await supabase.from('study_days').insert(dayRows).select()
    if(error){setMsg(error.message);return}

    const map=Object.fromEntries(inserted.map(d=>[d.study_date,d.id]))
    let taskRows=[]

    schedule.forEach(r=>TASKS(r).forEach((t,i)=>taskRows.push({
      user_id:uid,
      study_day_id:map[r.date],
      task_date:r.date,
      task_type:t.type,
      title:t.title,
      description:r.assignment,
      resource:t.resource,
      estimated_minutes:Math.max(15,Math.round((r.hours*60)/TASKS(r).length)),
      sort_order:i
    })))

    for(let i=0;i<taskRows.length;i+=500)
      await supabase.from('daily_tasks').insert(taskRows.slice(i,i+500))
  }

  async function loadAll(){
    const uid=session.user.id
    const [t,d,q,f,se]=await Promise.all([
      supabase.from('daily_tasks').select('*').eq('user_id',uid).order('task_date').order('sort_order'),
      supabase.from('study_days').select('*').eq('user_id',uid).order('study_date'),
      supabase.from('question_blocks').select('*').eq('user_id',uid).order('question_date',{ascending:false}).limit(100),
      supabase.from('full_length_scores').select('*').eq('user_id',uid).order('exam_date'),
      supabase.from('study_sessions').select('*').eq('user_id',uid).order('session_date',{ascending:false}).limit(300)
    ])

    setTasks(t.data||[])
    setDays(d.data||[])
    setQlogs(q.data||[])
    setFls(f.data||[])
    setSessions(se.data||[])
  }

  async function toggle(t){
    await supabase.from('daily_tasks').update({
      completed:!t.completed,
      completed_at:!t.completed?new Date().toISOString():null
    }).eq('id',t.id)
    loadAll()
  }

  async function logSession(min){
    if(!session)return
    await supabase.from('study_sessions').insert({
      user_id:session.user.id,
      session_date:todayISO(),
      actual_minutes:min,
      planned_minutes:min,
      session_type:'focus',
      ended_at:new Date().toISOString()
    })
    loadAll()
  }

  async function addQuestions(e){
    e.preventDefault()
    const f=new FormData(e.currentTarget)
    const total=+f.get('total'),correct=+f.get('correct')
    if(correct>total){setMsg('Correct answers cannot exceed total questions.');return}
    await supabase.from('question_blocks').insert({
      user_id:session.user.id,
      question_date:todayISO(),
      source:f.get('source'),
      subject:f.get('subject'),
      total_questions:total,
      correct_questions:correct,
      timed:f.get('timed')==='on'
    })
    e.currentTarget.reset()
    loadAll()
  }

  async function addFL(e){
    e.preventDefault()
    const f=new FormData(e.currentTarget)
    const vals=['cp','cars','bb','ps'].map(k=>+f.get(k))
    await supabase.from('full_length_scores').insert({
      user_id:session.user.id,
      exam_date:f.get('date'),
      exam_name:f.get('name'),
      cp_score:vals[0],
      cars_score:vals[1],
      bb_score:vals[2],
      ps_score:vals[3],
      total_score:vals.reduce((a,b)=>a+b,0)
    })
    e.currentTarget.reset()
    loadAll()
  }

  if(loading)return <main className="center"><div className="loader"/></main>

  if(!session)return <main className="auth">
    <div className="authCard">
      <div className="brand">
        <span>λ</span>
        <div><h1>MCAT Study Tracker</h1><p>Built for the long game.</p></div>
      </div>
      <h2>{authMode==='login'?'Welcome back':'Create your account'}</h2>
      <form onSubmit={auth}>
        <input name="email" type="email" placeholder="Email" required/>
        <input name="password" type="password" placeholder="Password" minLength="6" required/>
        <button>{authMode==='login'?'Sign in':'Create account'}</button>
      </form>
      {msg&&<p className="message">{msg}</p>}
      <button className="link" onClick={()=>setAuthMode(authMode==='login'?'signup':'login')}>
        {authMode==='login'?'Need an account? Sign up':'Already have an account? Sign in'}
      </button>
    </div>
  </main>

  const dayTasks=tasks.filter(t=>t.task_date===selected)
  const done=dayTasks.filter(t=>t.completed).length
  const pct=dayTasks.length?Math.round(done/dayTasks.length*100):0
  const allDone=tasks.filter(t=>t.completed).length

  const totalQuestions=qlogs.reduce((a,q)=>a+q.total_questions,0)
  const totalCorrect=qlogs.reduce((a,q)=>a+q.correct_questions,0)
  const accuracy=totalQuestions?Math.round(totalCorrect/totalQuestions*100):0

  const selectedPlannedMinutes=dayTasks.reduce((a,t)=>a+(t.estimated_minutes||0),0)
  const selectedActualMinutes=sessions
    .filter(x=>x.session_date===selected)
    .reduce((a,x)=>a+(x.actual_minutes||0),0)

  const nowDate=new Date(selected+'T12:00:00')
  const monday=new Date(nowDate)
  const weekday=(monday.getDay()+6)%7
  monday.setDate(monday.getDate()-weekday)

  const weekDates=Array.from({length:7},(_,i)=>{
    const d=new Date(monday)
    d.setDate(monday.getDate()+i)
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
  })

  const weekTasks=tasks.filter(t=>weekDates.includes(t.task_date))
  const weekDone=weekTasks.filter(t=>t.completed).length
  const weekPct=weekTasks.length?Math.round(weekDone/weekTasks.length*100):0

  const weekStudyMinutes=sessions
    .filter(x=>weekDates.includes(x.session_date))
    .reduce((a,x)=>a+(x.actual_minutes||0),0)

  const weekQuestions=qlogs
    .filter(q=>weekDates.includes(q.question_date))
    .reduce((a,q)=>a+q.total_questions,0)

  const m=String(Math.floor(seconds/60)).padStart(2,'0')
  const s=String(seconds%60).padStart(2,'0')
  const timerTotal=(timerMode==='Focus'?focusMin:breakMin)*60
  const timerPct=Math.max(0,Math.min(100,100-(seconds/timerTotal*100)))

  const daysToMCAT=Math.max(0,Math.ceil((new Date('2027-04-17T12:00:00')-new Date())/86400000))

  return <main className="shell">
    <aside>
      <div className="logo"><span className="lambda">λ</span><span>MCAT</span></div>
      {['Today','Calendar','Questions','Full Lengths','Analytics'].map(x=>
        <button key={x} className={tab===x?'active':''} onClick={()=>setTab(x)}>{x}</button>
      )}
      <div className="spacer"/>
      <div className="sideExam">
        <small>TEST DAY</small>
        <b>APR 17</b>
        <span>2027</span>
      </div>
      <button onClick={()=>supabase.auth.signOut()}>Sign out</button>
    </aside>

    <section className="content">
      <header>
        <div>
          <p className="eyebrow">{planned?.phase||'MCAT PLAN'}</p>
          <h1>{tab}</h1>
        </div>
        <div className="countdown">
          <b>{daysToMCAT}</b>
          <span>days to MCAT</span>
        </div>
      </header>

      {tab==='Today'&&<>
        <section className="weekSummary">
          <div className="weekTitle">
            <div>
              <p className="eyebrow">THIS WEEK</p>
              <h2>Weekly momentum</h2>
            </div>
            <strong>{weekPct}%</strong>
          </div>

          <div className="weekStats">
            <div>
              <span>STUDY TIME</span>
              <b>{hoursText(weekStudyMinutes)}</b>
              <small>focused this week</small>
            </div>
            <div>
              <span>TASKS</span>
              <b>{weekDone}<em>/{weekTasks.length}</em></b>
              <small>completed</small>
            </div>
            <div>
              <span>QUESTIONS</span>
              <b>{weekQuestions}</b>
              <small>logged this week</small>
            </div>
            <div>
              <span>WEEK PROGRESS</span>
              <b>{weekPct}%</b>
              <small>of scheduled tasks</small>
            </div>
          </div>

          <div className="weekDays">
            {weekDates.map(date=>{
              const dt=tasks.filter(t=>t.task_date===date)
              const dc=dt.filter(t=>t.completed).length
              const dp=dt.length?Math.round(dc/dt.length*100):0
              const d=new Date(date+'T12:00:00')
              return <button
                key={date}
                className={(date===selected?'selected ':'')+(date===todayISO()?'current':'')}
                onClick={()=>setSelected(date)}
              >
                <span>{d.toLocaleDateString('en-US',{weekday:'short'}).toUpperCase()}</span>
                <b>{d.getDate()}</b>
                <i><em style={{height:dp+'%'}}/></i>
                <small>{dp}%</small>
              </button>
            })}
          </div>
        </section>

        <div className="todayHeading">
          <div>
            <p>{new Date(selected+'T12:00:00').toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'})}</p>
            <h2>{planned?.assignment||'Study plan'}</h2>
          </div>
          <div className="todayMetrics">
            <div>
              <span>PLANNED</span>
              <b>{hoursText(selectedPlannedMinutes)}</b>
            </div>
            <div>
              <span>FOCUSED</span>
              <b>{hoursText(selectedActualMinutes)}</b>
            </div>
          </div>
        </div>

        <div className="progressCard">
          <div>
            <span>DAILY PROGRESS</span>
            <b>{done} of {dayTasks.length} tasks complete</b>
          </div>
          <div className="bar"><i style={{width:pct+'%'}}/></div>
          <strong>{pct}%</strong>
        </div>

        <div className="dashboardGrid">
          <div className="card checklistCard">
            <div className="cardTitle">
              <div>
                <p className="eyebrow">TODAY'S MISSION</p>
                <h3>Study plan</h3>
              </div>
              <span className="taskCount">{done}/{dayTasks.length}</span>
            </div>

            <div className="tasks">
              {dayTasks.map(t=>
                <label className={'task '+(t.completed?'done':'')} key={t.id}>
                  <input type="checkbox" checked={t.completed} onChange={()=>toggle(t)}/>
                  <span className="taskCheck"/>
                  <span className="taskBody">
                    <b>{t.task_type}</b>
                    <strong>{t.title}</strong>
                    <small>{t.resource} · {t.estimated_minutes||0} min</small>
                  </span>
                </label>
              )}
              {!dayTasks.length&&<p>No tasks for this date yet.</p>}
            </div>
          </div>

          <div className="card pomodoroCard">
            <div className="timerTop">
              <div>
                <p className="eyebrow">FOCUS MODE</p>
                <h3>Pomodoro</h3>
              </div>
              <select value={focusMin} onChange={e=>{
                const v=+e.target.value
                setFocusMin(v)
                setBreakMin(v===25?5:10)
                setSeconds(v*60)
                setTimerMode('Focus')
                setRunning(false)
              }}>
                <option value="25">25 / 5</option>
                <option value="50">50 / 10</option>
                <option value="60">60 / 10</option>
              </select>
            </div>

            <div className="timerRing" style={{'--timer':timerPct}}>
              <div>
                <span>{timerMode.toUpperCase()}</span>
                <strong>{m}:{s}</strong>
                <small>{running?'Stay locked in.':'Ready when you are.'}</small>
              </div>
            </div>

            <div className="actions">
              <button onClick={()=>setRunning(!running)}>{running?'Pause':'Start focus'}</button>
              <button className="secondary" onClick={()=>{
                setRunning(false)
                setTimerMode('Focus')
                setSeconds(focusMin*60)
              }}>Reset</button>
            </div>

            <div className="timerFooter">
              <div><span>TODAY</span><b>{hoursText(selectedActualMinutes)}</b></div>
              <div><span>GOAL</span><b>{hoursText(selectedPlannedMinutes)}</b></div>
            </div>
          </div>
        </div>
      </>}

      {tab==='Calendar'&&
        <div className="card">
          <div className="calendarHead">
            <h3>Study calendar</h3>
            <input type="date" value={selected} min="2026-09-15" max="2027-04-17" onChange={e=>setSelected(e.target.value)}/>
          </div>
          <div className="monthGrid">
            {schedule.map(r=>{
              const dt=tasks.filter(t=>t.task_date===r.date)
              const dc=dt.filter(t=>t.completed).length
              const p=dt.length?dc/dt.length:0
              return <button key={r.date} onClick={()=>{setSelected(r.date);setTab('Today')}} className={r.date===todayISO()?'today':''}>
                <span>{fmt(r.date)}</span>
                <b>{r.phase.split('/')[0]}</b>
                <i style={{width:(p*100)+'%'}}/>
                <small>{dc}/{dt.length}</small>
              </button>
            })}
          </div>
        </div>
      }

      {tab==='Questions'&&
        <div className="grid2">
          <div className="card">
            <h3>Log a question block</h3>
            <form className="form" onSubmit={addQuestions}>
              <select name="source"><option>UWorld</option><option>AAMC</option><option>Kaplan</option><option>Jack Westin</option></select>
              <select name="subject"><option>B/B</option><option>C/P</option><option>P/S</option><option>CARS</option></select>
              <input name="total" type="number" min="1" placeholder="Total questions" required/>
              <input name="correct" type="number" min="0" placeholder="Correct" required/>
              <label className="check"><input name="timed" type="checkbox"/> Timed block</label>
              <button>Save block</button>
            </form>
          </div>
          <div className="card">
            <h3>Recent performance</h3>
            <div className="bigStat">{accuracy}%<small>overall accuracy</small></div>
            {qlogs.slice(0,8).map(q=><div className="row" key={q.id}>
              <span>{q.source} · {q.subject}</span>
              <b>{q.correct_questions}/{q.total_questions}</b>
            </div>)}
          </div>
        </div>
      }

      {tab==='Full Lengths'&&
        <div className="grid2">
          <div className="card">
            <h3>Log full-length</h3>
            <form className="form" onSubmit={addFL}>
              <input name="date" type="date" required/>
              <input name="name" placeholder="Exam name (e.g. AAMC FL 1)" required/>
              <div className="four">
                <input name="cp" type="number" min="118" max="132" placeholder="C/P" required/>
                <input name="cars" type="number" min="118" max="132" placeholder="CARS" required/>
                <input name="bb" type="number" min="118" max="132" placeholder="B/B" required/>
                <input name="ps" type="number" min="118" max="132" placeholder="P/S" required/>
              </div>
              <button>Save score</button>
            </form>
          </div>
          <div className="card">
            <h3>Score history</h3>
            {fls.length?fls.map(f=><div className="score" key={f.id}>
              <div><b>{f.exam_name}</b><small>{fmt(f.exam_date)}</small></div>
              <strong>{f.total_score}</strong>
            </div>):<p>No full-lengths logged yet.</p>}
          </div>
        </div>
      }

      {tab==='Analytics'&&<>
        <div className="stats">
          <div><b>{allDone}</b><span>tasks completed</span></div>
          <div><b>{tasks.length?Math.round(allDone/tasks.length*100):0}%</b><span>plan completed</span></div>
          <div><b>{totalQuestions}</b><span>questions logged</span></div>
          <div><b>{accuracy||'—'}</b><span>{accuracy?'% accuracy':'accuracy'}</span></div>
        </div>
        <div className="card">
          <h3>Phase roadmap</h3>
          {[
            ['Sep–Oct','Ramp-up + Kaplan/JW'],
            ['Nov–Jan','UWorld-heavy practice'],
            ['Feb–Mar','AAMC official material + FLs'],
            ['April','Final AAMC work + taper']
          ].map((x,i)=><div className="road" key={x[0]}>
            <em>{i+1}</em>
            <div><b>{x[0]}</b><p>{x[1]}</p></div>
          </div>)}
        </div>
      </>}

      {msg&&<div className="toast">{msg}</div>}
    </section>
  </main>
}
