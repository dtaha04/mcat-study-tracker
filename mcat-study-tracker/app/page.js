'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import config from '../data/studyConfig.json'
import schedule from '../data/schedule.json'

const EXAM_DATE = config.exam?.date || '2027-01-21'
const PLAN_START = config.global_rules?.plan_start || '2026-10-03'
const SOURCE_TYPE = 'v2_engine'
const SCHEDULE_DAYS = schedule.days || []

const STUDENTS = {
  Diya: {
    name: 'Diya',
    track: config.diya?.track_name || 'Question-Heavy Track',
    target: config.diya?.target_score || 512
  },
  Hamzah: {
    name: 'Hamzah',
    track: config.hamzah?.track_name || 'Content + Question Track',
    target: config.hamzah?.target_score || 512
  }
}

/* ============================================================
   DATE HELPERS
   ============================================================ */

function localISO(date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function dateFromISO(iso) {
  if (!iso) return new Date()
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function addDays(iso, amount) {
  const date = dateFromISO(iso)
  date.setDate(date.getDate() + amount)
  return localISO(date)
}

function daysBetween(start, end) {
  const a = dateFromISO(start)
  const b = dateFromISO(end)
  return Math.round((b - a) / 86400000)
}

function formatDate(iso, options = {}) {
  if (!iso) return ''

  return dateFromISO(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: options.year ? 'numeric' : undefined,
    weekday: options.weekday ? 'short' : undefined
  })
}

function formatMinutes(minutes = 0) {
  const n = Math.max(0, Math.round(Number(minutes) || 0))
  const hours = Math.floor(n / 60)
  const mins = n % 60

  if (!hours) return `${mins}m`
  if (!mins) return `${hours}h`

  return `${hours}h ${mins}m`
}

function getWeekDates(iso) {
  const date = dateFromISO(iso)
  const day = date.getDay()
  const mondayOffset = day === 0 ? -6 : 1 - day

  const monday = new Date(date)
  monday.setDate(date.getDate() + mondayOffset)

  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    return localISO(d)
  })
}

function getScheduledDay(iso) {
  return SCHEDULE_DAYS.find(day => day.date === iso) || null
}

function getStudentPlan(iso, student) {
  const day = getScheduledDay(iso)

  if (!day) return null

  return student === 'Diya'
    ? day.diya || null
    : day.hamzah || null
}

/* ============================================================
   TASK HELPERS
   ============================================================ */

function makeTask({
  student,
  date,
  type,
  title,
  description = '',
  resource = '',
  subject = '',
  minutes = 0,
  priority = 2,
  sort = 0
}) {
  return {
    student_name: student,
    task_date: date,
    current_due_date: date,
    task_type: type,
    title,
    description,
    resource,
    subject,
    estimated_minutes: Math.max(0, Math.round(Number(minutes) || 0)),
    priority,
    sort_order: sort,
    completed: false,
    source_type: SOURCE_TYPE,
    status: 'scheduled',
    carried_forward: false,
    carry_count: 0
  }
}

function taskMinutes(tasks = []) {
  return tasks.reduce(
    (sum, task) => sum + (Number(task.estimated_minutes) || 0),
    0
  )
}

function taskProgress(tasks = []) {
  const progressTasks = tasks.filter(task => task.task_type !== 'Chapter')

  if (!progressTasks.length) return 0

  const completed = progressTasks.filter(task => task.completed).length

  return Math.round((completed / progressTasks.length) * 100)
}

/* ============================================================
   HAMZAH CHAPTER PROGRESS
   ============================================================ */

function extractChapterSequence(task) {
  const text = `${task.description || ''} ${task.details || ''}`

  const match = text.match(/chapter_sequence:(\d+)/)

  return match ? Number(match[1]) : null
}

function getCompletedHamzahChapterSequences(tasks = []) {
  const completed = new Set()

  tasks.forEach(task => {
    if (
      task.student_name !== 'Hamzah' ||
      task.task_type !== 'Chapter' ||
      !task.completed
    ) {
      return
    }

    const sequence = extractChapterSequence(task)

    if (sequence) completed.add(sequence)
  })

  return completed
}

function getCurrentHamzahChapter(tasks = []) {
  const chapters = config.hamzah?.chapters || []

  if (!chapters.length) return null

  const completed = getCompletedHamzahChapterSequences(tasks)

  return (
    chapters.find(chapter => !completed.has(chapter.sequence)) ||
    null
  )
}

function getHamzahChapterProgress(tasks = []) {
  const completed = getCompletedHamzahChapterSequences(tasks)

  return {
    completed: completed.size,
    total: config.hamzah?.chapters?.length || 58
  }
}

function chapterLabel(chapter) {
  if (!chapter) return 'Kaplan Content Complete'

  return `${chapter.subject} Ch. ${chapter.chapter}: ${chapter.title}`
}

/* ============================================================
   SCHEDULE.JSON -> DATABASE TASKS
   ============================================================ */

function generateScheduledTasks(
  iso,
  student,
  currentHamzahChapter = null
) {
  const day = getScheduledDay(iso)

  if (!day) return []

  const plan =
    student === 'Diya'
      ? day.diya
      : day.hamzah

  if (!plan) return []

  const output = (plan.tasks || []).map((item, index) => {
    let title = item.title || item.type || 'Study Task'
    let description = item.details || ''
    let subject = item.subject || ''
    let resource = item.resource || ''

    const isHamzahCurrentChapter =
      student === 'Hamzah' &&
      plan.chapter_mode === 'current_unfinished' &&
      currentHamzahChapter &&
      (
        title === 'Continue Current Kaplan Chapter' ||
        subject === 'Current Chapter'
      )

    if (isHamzahCurrentChapter) {
      const label = chapterLabel(currentHamzahChapter)

      if (title === 'Continue Current Kaplan Chapter') {
        title = `Kaplan: ${label}`
      }

      if (subject === 'Current Chapter') {
        subject = currentHamzahChapter.subject
      }

      description = [
        description,
        `Current chapter: ${label}`
      ]
        .filter(Boolean)
        .join(' ')
    }

    return makeTask({
      student,
      date: iso,
      type: item.type || 'Study',
      title,
      description,
      resource,
      subject,
      minutes: item.minutes || 0,
      priority: item.priority || 2,
      sort: index + 1
    })
  })

  /*
    Hamzah's chapter completion is intentionally separate
    from the scheduled workload.

    The schedule can say "Continue Current Kaplan Chapter"
    for multiple days. This checkbox is what actually advances
    him to the next chapter.
  */

  const hasCurrentChapterContent =
    student === 'Hamzah' &&
    currentHamzahChapter &&
    plan.chapter_mode === 'current_unfinished' &&
    (plan.tasks || []).some(
      item =>
        item.title === 'Continue Current Kaplan Chapter' ||
        item.subject === 'Current Chapter'
    )

  if (hasCurrentChapterContent) {
    output.push(
      makeTask({
        student: 'Hamzah',
        date: iso,
        type: 'Chapter',
        title: `Mark chapter complete: ${chapterLabel(
          currentHamzahChapter
        )}`,
        description:
          `chapter_sequence:${currentHamzahChapter.sequence} | ` +
          'Only check this after the entire Kaplan chapter, concept checks, and chapter questions are complete.',
        resource: 'Kaplan Books',
        subject: currentHamzahChapter.subject,
        minutes: 0,
        priority: 3,
        sort: output.length + 1
      })
    )
  }

  return output
}

/* ============================================================
   MAIN APP
   ============================================================ */

export default function Home() {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authMode, setAuthMode] = useState('signin')

  const [view, setView] = useState('Today')
  const [message, setMessage] = useState('')

  const [tasks, setTasks] = useState([])
  const [questionLogs, setQuestionLogs] = useState([])
  const [fullLengths, setFullLengths] = useState([])
  const [studySessions, setStudySessions] = useState([])

  const [selectedDate, setSelectedDate] = useState(localISO())
  const [dataLoaded, setDataLoaded] = useState(false)
  const [seeding, setSeeding] = useState(false)

  const uid = session?.user?.id || null

  /* ----------------------------------------------------------
     AUTH
     ---------------------------------------------------------- */

  useEffect(() => {
    if (!supabase) {
      setLoading(false)
      return
    }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session || null)
      setLoading(false)
    })

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession || null)
    })

    return () => subscription.unsubscribe()
  }, [])

  async function handleAuth(e) {
    e.preventDefault()

    setMessage('')

    if (!supabase) {
      setMessage('Supabase is not configured.')
      return
    }

    let result

    if (authMode === 'signup') {
      result = await supabase.auth.signUp({
        email,
        password
      })
    } else {
      result = await supabase.auth.signInWithPassword({
        email,
        password
      })
    }

    if (result.error) {
      setMessage(result.error.message)
      return
    }

    if (authMode === 'signup') {
      setMessage(
        'Account created. Check your email if confirmation is required.'
      )
    }
  }

  async function signOut() {
    if (!supabase) return

    await supabase.auth.signOut()
  }

  /* ----------------------------------------------------------
     LOAD DATA
     ---------------------------------------------------------- */

  async function loadAll() {
    if (!uid || !supabase) return

    setDataLoaded(false)

    const [
      taskResult,
      questionResult,
      flResult,
      sessionResult
    ] = await Promise.all([
      supabase
        .from('daily_tasks')
        .select('*')
        .eq('user_id', uid)
        .order('task_date', { ascending: true })
        .order('sort_order', { ascending: true }),

      supabase
        .from('question_blocks')
        .select('*')
        .eq('user_id', uid)
        .order('question_date', { ascending: false }),

      supabase
        .from('full_length_scores')
        .select('*')
        .eq('user_id', uid)
        .order('exam_date', { ascending: false }),

      supabase
        .from('study_sessions')
        .select('*')
        .eq('user_id', uid)
        .order('session_date', { ascending: false })
    ])

    if (taskResult.error) {
      console.error('daily_tasks:', taskResult.error)
      setMessage(`Task load error: ${taskResult.error.message}`)
    }

    if (taskResult.data) {
      setTasks(taskResult.data)
    }

    if (questionResult.data) {
      setQuestionLogs(questionResult.data)
    }

    if (flResult.data) {
      setFullLengths(flResult.data)
    }

    if (sessionResult.data) {
      setStudySessions(sessionResult.data)
    }

    setDataLoaded(true)
  }

  useEffect(() => {
    if (!uid) return

    loadAll()
  }, [uid])

  /* ----------------------------------------------------------
     CURRENT HAMZAH CHAPTER
     ---------------------------------------------------------- */

  const currentHamzahChapter = useMemo(
    () => getCurrentHamzahChapter(tasks),
    [tasks]
  )

  const hamzahChapterProgress = useMemo(
    () => getHamzahChapterProgress(tasks),
    [tasks]
  )

  /* ----------------------------------------------------------
     SEED A DAY FROM SCHEDULE.JSON
     ---------------------------------------------------------- */

  async function seedDay(iso) {
    if (
      !uid ||
      !supabase ||
      !dataLoaded ||
      seeding
    ) {
      return
    }

    if (iso < PLAN_START || iso > EXAM_DATE) {
      return
    }

    const scheduledDay = getScheduledDay(iso)

    if (!scheduledDay) {
      setMessage(
        `No schedule.json entry exists for ${iso}.`
      )
      return
    }

    setSeeding(true)

    try {
      /*
        We check the DATABASE directly instead of relying only
        on React state. This avoids the race condition that
        caused Hamzah to show 0 of 0.
      */

      const { data: existing, error: existingError } =
        await supabase
          .from('daily_tasks')
          .select('*')
          .eq('user_id', uid)
          .eq('source_type', SOURCE_TYPE)
          .eq('task_date', iso)

      if (existingError) {
        throw existingError
      }

      const existingStudents = new Set(
        (existing || [])
          .map(task => task.student_name)
          .filter(Boolean)
      )

      const inserts = []

      if (!existingStudents.has('Diya')) {
        const diyaTasks = generateScheduledTasks(
          iso,
          'Diya'
        )

        diyaTasks.forEach(task => {
          inserts.push({
            ...task,
            user_id: uid
          })
        })
      }

      if (!existingStudents.has('Hamzah')) {
        const hamzahTasks = generateScheduledTasks(
          iso,
          'Hamzah',
          currentHamzahChapter
        )

        hamzahTasks.forEach(task => {
          inserts.push({
            ...task,
            user_id: uid
          })
        })
      }

      if (!inserts.length) {
        return
      }

      const { error: insertError } =
        await supabase
          .from('daily_tasks')
          .insert(inserts)

      if (insertError) {
        throw insertError
      }

      await loadAll()
    } catch (error) {
      console.error(error)

      setMessage(
        `Schedule error: ${
          error?.message || 'Unknown error'
        }`
      )
    } finally {
      setSeeding(false)
    }
  }

  /*
    Only seed after database state has finished loading.
  */

  useEffect(() => {
    if (!uid || !dataLoaded) return

    seedDay(selectedDate)
  }, [uid, dataLoaded, selectedDate])

  /* ----------------------------------------------------------
     OVERFLOW
     ---------------------------------------------------------- */

  async function processOverflow() {
    if (!uid || !supabase || !dataLoaded) return

    const today = localISO()

    if (today <= PLAN_START || today >= EXAM_DATE) {
      return
    }

    const todaySchedule = getScheduledDay(today)

    if (
      todaySchedule?.day_type === 'full_length' ||
      todaySchedule?.day_type === 'exam'
    ) {
      return
    }

    const { data: overdue, error } =
      await supabase
        .from('daily_tasks')
        .select('*')
        .eq('user_id', uid)
        .eq('source_type', SOURCE_TYPE)
        .eq('completed', false)
        .gte('task_date', PLAN_START)
        .lt('task_date', today)
        .neq('task_type', 'Exam')
        .neq('task_type', 'Full Length')
        .neq('task_type', 'Chapter')

    if (error) {
      console.error(error)
      return
    }

    for (const task of overdue || []) {
      if (task.current_due_date === today) {
        continue
      }

      await supabase
        .from('daily_tasks')
        .update({
          current_due_date: today,
          carried_forward: true,
          carry_count:
            (Number(task.carry_count) || 0) + 1,
          status: 'overdue'
        })
        .eq('id', task.id)
        .eq('user_id', uid)
    }

    await loadAll()
  }

  useEffect(() => {
    if (!uid || !dataLoaded) return

    processOverflow()
  }, [uid])

  /* ----------------------------------------------------------
     TASK ACTIONS
     ---------------------------------------------------------- */

  async function toggleTask(task) {
    if (!uid || !supabase) return

    const completed = !task.completed

    const payload = {
      completed,
      completed_at: completed
        ? new Date().toISOString()
        : null,
      status: completed
        ? 'completed'
        : task.carried_forward
          ? 'overdue'
          : 'scheduled'
    }

    const { error } = await supabase
      .from('daily_tasks')
      .update(payload)
      .eq('id', task.id)
      .eq('user_id', uid)

    if (error) {
      setMessage(error.message)
      return
    }

    /*
      If Hamzah just completed a chapter, reload first.
      His next newly seeded date will use the next chapter.
    */

    await loadAll()
  }

  /* ----------------------------------------------------------
     FILTERED TASKS
     ---------------------------------------------------------- */

  const studyTasks = useMemo(
    () =>
      tasks.filter(
        task =>
          task.source_type === SOURCE_TYPE &&
          task.task_date >= PLAN_START
      ),
    [tasks]
  )

  function studentTasks(student, iso) {
    return studyTasks
      .filter(
        task =>
          task.student_name === student &&
          task.task_date === iso
      )
      .sort(
        (a, b) =>
          (Number(a.sort_order) || 0) -
          (Number(b.sort_order) || 0)
      )
  }

  function studentOverflow(student, iso) {
    return studyTasks
      .filter(
        task =>
          task.student_name === student &&
          !task.completed &&
          task.carried_forward &&
          task.current_due_date === iso &&
          task.task_date < iso &&
          task.task_type !== 'Chapter'
      )
      .sort((a, b) => {
        const priorityDiff =
          (Number(a.priority) || 2) -
          (Number(b.priority) || 2)

        if (priorityDiff !== 0) {
          return priorityDiff
        }

        return a.task_date.localeCompare(b.task_date)
      })
  }

  const diyaSelectedTasks = studentTasks(
    'Diya',
    selectedDate
  )

  const hamzahSelectedTasks = studentTasks(
    'Hamzah',
    selectedDate
  )

  const diyaOverflow = studentOverflow(
    'Diya',
    selectedDate
  )

  const hamzahOverflow = studentOverflow(
    'Hamzah',
    selectedDate
  )

  /* ----------------------------------------------------------
     QUESTION LOGGING
     ---------------------------------------------------------- */

  async function addQuestionBlock(data) {
    if (!uid || !supabase) return

    const payload = {
      user_id: uid,
      question_date: data.date,

      /*
        Existing schema does not yet have student_name
        on question_blocks, so student is encoded into source.
      */

      source: `${data.student} — ${data.source}`,
      subject: data.subject,
      total_questions: Number(data.total),
      correct_questions: Number(data.correct),
      timed: Boolean(data.timed)
    }

    const { error } = await supabase
      .from('question_blocks')
      .insert(payload)

    if (error) {
      setMessage(error.message)
      return
    }

    await loadAll()
  }

  /* ----------------------------------------------------------
     FULL LENGTH LOGGING
     ---------------------------------------------------------- */

  async function addFullLength(data) {
    if (!uid || !supabase) return

    const total =
      Number(data.cp || 0) +
      Number(data.cars || 0) +
      Number(data.bb || 0) +
      Number(data.ps || 0)

    const payload = {
      user_id: uid,
      exam_date: data.date,
      exam_name: `${data.student} — ${data.name}`,
      cp_score: Number(data.cp),
      cars_score: Number(data.cars),
      bb_score: Number(data.bb),
      ps_score: Number(data.ps),
      total_score: total
    }

    const { error } = await supabase
      .from('full_length_scores')
      .insert(payload)

    if (error) {
      setMessage(error.message)
      return
    }

    await loadAll()
  }

  /* ----------------------------------------------------------
     POMODORO SESSION LOGGING
     ---------------------------------------------------------- */

  async function logSession(
    student,
    minutes,
    type = 'Focus'
  ) {
    if (!uid || !supabase || !minutes) return

    const payload = {
      user_id: uid,
      session_date: localISO(),
      actual_minutes: Number(minutes),
      planned_minutes: Number(minutes),
      session_type: `${student} — ${type}`,
      ended_at: new Date().toISOString()
    }

    const { error } = await supabase
      .from('study_sessions')
      .insert(payload)

    if (error) {
      console.error(error)
      return
    }

    await loadAll()
  }

  /* ----------------------------------------------------------
     AUTH SCREEN
     ---------------------------------------------------------- */

  if (loading) {
    return (
      <div className="auth">
        <div className="card authCard">
          <h1>MCAT Study Tracker</h1>
          <p>Loading...</p>
        </div>
      </div>
    )
  }

  if (!session) {
    return (
      <div className="auth">
        <form
          className="card authCard"
          onSubmit={handleAuth}
        >
          <div className="logo">
            <span>M</span>

            <div>
              <b>MCAT TRACKER</b>
              <small>JANUARY 21, 2027</small>
            </div>
          </div>

          <h1>
            {authMode === 'signin'
              ? 'Welcome back'
              : 'Create account'}
          </h1>

          <p>
            Diya + Hamzah MCAT Study System
          </p>

          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={e =>
              setEmail(e.target.value)
            }
            required
          />

          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={e =>
              setPassword(e.target.value)
            }
            required
          />

          <button type="submit">
            {authMode === 'signin'
              ? 'Sign In'
              : 'Create Account'}
          </button>

          <button
            type="button"
            className="secondary"
            onClick={() =>
              setAuthMode(
                authMode === 'signin'
                  ? 'signup'
                  : 'signin'
              )
            }
          >
            {authMode === 'signin'
              ? 'Need an account?'
              : 'Already have an account?'}
          </button>

          {message && (
            <div className="message">
              {message}
            </div>
          )}
        </form>
      </div>
    )
  }

  const daysLeft = Math.max(
    0,
    daysBetween(localISO(), EXAM_DATE)
  )

  /* ----------------------------------------------------------
     MAIN UI
     ---------------------------------------------------------- */

  return (
    <div className="shell">
      <aside className="aside">
        <div className="logo">
          <span>M</span>

          <div>
            <b>MCAT TRACKER</b>
            <small>V4 STUDY SYSTEM</small>
          </div>
        </div>

        <div className="profileMini">
          <small>SHARED ACCOUNT</small>
          <b>Diya + Hamzah</b>
          <span>Target: 512+</span>
        </div>

        <nav>
          {[
            'Today',
            'Calendar',
            'Questions',
            'Full Lengths',
            'Together',
            'Analytics'
          ].map(item => (
            <button
              key={item}
              className={
                view === item ? 'active' : ''
              }
              onClick={() => setView(item)}
            >
              {item}
            </button>
          ))}
        </nav>

        <div className="sideExam">
          <small>MCAT</small>
          <b>{daysLeft}</b>
          <span>days remaining</span>
        </div>

        <button
          className="secondary"
          onClick={signOut}
        >
          Sign Out
        </button>
      </aside>

      <main className="content">
        <header className="header">
          <div>
            <h1>{view}</h1>

            <p>
              Diya + Hamzah • MCAT January 21,
              2027
            </p>
          </div>

          <div className="headerRight">
            <div className="countdown">
              <b>{daysLeft}</b>
              <span>DAYS TO MCAT</span>
            </div>
          </div>
        </header>

        {message && (
          <div className="message">
            {message}
          </div>
        )}

        {view === 'Today' && (
          <TodayView
            selectedDate={selectedDate}
            setSelectedDate={setSelectedDate}
            diyaTasks={diyaSelectedTasks}
            hamzahTasks={hamzahSelectedTasks}
            diyaOverflow={diyaOverflow}
            hamzahOverflow={hamzahOverflow}
            allTasks={studyTasks}
            currentHamzahChapter={
              currentHamzahChapter
            }
            hamzahChapterProgress={
              hamzahChapterProgress
            }
            toggleTask={toggleTask}
            logSession={logSession}
            seedDay={seedDay}
            seeding={seeding}
          />
        )}

        {view === 'Calendar' && (
          <CalendarView
            selectedDate={selectedDate}
            setSelectedDate={date => {
              setSelectedDate(date)
              setView('Today')
            }}
            tasks={studyTasks}
          />
        )}

        {view === 'Questions' && (
          <QuestionsView
            logs={questionLogs}
            onAdd={addQuestionBlock}
          />
        )}

        {view === 'Full Lengths' && (
          <FullLengthView
            fullLengths={fullLengths}
            onAdd={addFullLength}
          />
        )}

        {view === 'Together' && (
          <TogetherView
            sessions={studySessions}
          />
        )}

        {view === 'Analytics' && (
          <AnalyticsView
            tasks={studyTasks}
            questionLogs={questionLogs}
            fullLengths={fullLengths}
            sessions={studySessions}
            hamzahChapterProgress={
              hamzahChapterProgress
            }
          />
        )}
      </main>
    </div>
  )
}

/* ============================================================
   TODAY
   ============================================================ */

function TodayView({
  selectedDate,
  setSelectedDate,
  diyaTasks,
  hamzahTasks,
  diyaOverflow,
  hamzahOverflow,
  allTasks,
  currentHamzahChapter,
  hamzahChapterProgress,
  toggleTask,
  logSession,
  seedDay,
  seeding
}) {
  const week = getWeekDates(selectedDate)

  const scheduledDay =
    getScheduledDay(selectedDate)

  const diyaPlan =
    scheduledDay?.diya || null

  const hamzahPlan =
    scheduledDay?.hamzah || null

  return (
    <>
      <div className="card weekSummary">
        <div className="weekTitle">
          <div>
            <small>STUDY WEEK</small>

            <h2>
              {formatDate(week[0])} –{' '}
              {formatDate(week[6], {
                year: true
              })}
            </h2>
          </div>

          <div className="weekStats">
            <span>
              Exam{' '}
              <b>
                {formatDate(EXAM_DATE, {
                  year: true
                })}
              </b>
            </span>
          </div>
        </div>

        <div className="weekDays">
          {week.map(date => {
            const dayTasks = allTasks.filter(
              task => task.task_date === date
            )

            const actualTasks =
              dayTasks.filter(
                task =>
                  task.task_type !== 'Chapter'
              )

            const done =
              actualTasks.length > 0 &&
              actualTasks.every(
                task => task.completed
              )

            const missed =
              date < localISO() &&
              actualTasks.some(
                task => !task.completed
              )

            return (
              <button
                key={date}
                className={[
                  selectedDate === date
                    ? 'selected'
                    : '',
                  date === localISO()
                    ? 'current'
                    : '',
                  missed ? 'missed' : '',
                  done ? 'complete' : ''
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => {
                  setSelectedDate(date)
                  seedDay(date)
                }}
              >
                <small>
                  {dateFromISO(
                    date
                  ).toLocaleDateString(
                    'en-US',
                    {
                      weekday: 'short'
                    }
                  )}
                </small>

                <b>
                  {dateFromISO(date).getDate()}
                </b>

                <span>
                  {
                    actualTasks.filter(
                      task => task.completed
                    ).length
                  }
                  /{actualTasks.length}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {!scheduledDay && (
        <div className="card message">
          No V4 schedule exists for this date.
        </div>
      )}

      {seeding && (
        <div className="message">
          Loading scheduled tasks...
        </div>
      )}

      <StudentHeader
        name="Diya"
        subtitle={`${STUDENTS.Diya.track} • ${STUDENTS.Diya.target}+ Target`}
        badge={
          diyaPlan
            ? formatMinutes(
                diyaPlan.target_minutes
              )
            : 'NO PLAN'
        }
      />

      <StudentDashboard
        student="Diya"
        date={selectedDate}
        plan={diyaPlan}
        tasks={diyaTasks}
        overflow={diyaOverflow}
        toggleTask={toggleTask}
        logSession={logSession}
      />

      <div className="studentDivider" />

      <StudentHeader
        name="Hamzah"
        subtitle={`${STUDENTS.Hamzah.track} • ${STUDENTS.Hamzah.target}+ Target`}
        badge={
          hamzahPlan
            ? formatMinutes(
                hamzahPlan.target_minutes
              )
            : 'NO PLAN'
        }
      />

      <HamzahDashboard
        date={selectedDate}
        plan={hamzahPlan}
        tasks={hamzahTasks}
        overflow={hamzahOverflow}
        chapter={currentHamzahChapter}
        chapterProgress={
          hamzahChapterProgress
        }
        toggleTask={toggleTask}
        logSession={logSession}
      />
    </>
  )
}

/* ============================================================
   STUDENT HEADER
   ============================================================ */

function StudentHeader({
  name,
  subtitle,
  badge
}) {
  return (
    <div className="studentHeader">
      <div>
        <small>STUDENT</small>
        <h2>{name}</h2>
        <p>{subtitle}</p>
      </div>

      <strong>{badge}</strong>
    </div>
  )
}

/* ============================================================
   DIYA DASHBOARD
   ============================================================ */

function StudentDashboard({
  student,
  date,
  plan,
  tasks,
  overflow,
  toggleTask,
  logSession
}) {
  const realTasks = tasks.filter(
    task => task.task_type !== 'Chapter'
  )

  const completed =
    realTasks.filter(
      task => task.completed
    ).length

  const minutes = taskMinutes(realTasks)
  const progress = taskProgress(realTasks)

  return (
    <>
      <OverflowPanel
        student={student}
        overflow={overflow}
        toggleTask={toggleTask}
      />

      <div className="todayHeading">
        <div>
          <small>
            {plan?.phase?.toUpperCase() ||
              'STUDY PLAN'}
          </small>

          <h2>
            {formatDate(date, {
              weekday: true,
              year: true
            })}
          </h2>

          <p>
            Questions → deep review → targeted
            repair → Anki → recall.
          </p>
        </div>

        <div className="todayMetrics">
          <span>
            <small>PLANNED</small>
            <b>{formatMinutes(minutes)}</b>
          </span>

          <span>
            <small>DONE</small>
            <b>
              {completed}/{realTasks.length}
            </b>
          </span>

          <span>
            <small>OVERFLOW</small>
            <b>
              {formatMinutes(
                taskMinutes(overflow)
              )}
            </b>
          </span>
        </div>
      </div>

      <ProgressCard
        progress={progress}
        completed={completed}
        total={realTasks.length}
        minutes={minutes}
      />

      <div className="dashboardGrid">
        <div className="card">
          <div className="sectionTitle">
            <div>
              <small>TODAY'S CHECKLIST</small>
              <h2>Diya's Work</h2>
            </div>

            <span>{plan?.phase}</span>
          </div>

          <div className="taskList">
            {tasks.length ? (
              tasks.map(task => (
                <TaskRow
                  key={task.id}
                  task={task}
                  onToggle={toggleTask}
                />
              ))
            ) : (
              <p className="empty">
                No tasks loaded for this date.
              </p>
            )}
          </div>
        </div>

        <Pomodoro
          student="Diya"
          onLog={logSession}
        />
      </div>
    </>
  )
}

/* ============================================================
   HAMZAH DASHBOARD
   ============================================================ */

function HamzahDashboard({
  date,
  plan,
  tasks,
  overflow,
  chapter,
  chapterProgress,
  toggleTask,
  logSession
}) {
  const realTasks = tasks.filter(
    task => task.task_type !== 'Chapter'
  )

  const chapterTasks = tasks.filter(
    task => task.task_type === 'Chapter'
  )

  const completed =
    realTasks.filter(
      task => task.completed
    ).length

  const minutes = taskMinutes(realTasks)
  const progress = taskProgress(realTasks)

  return (
    <>
      <OverflowPanel
        student="Hamzah"
        overflow={overflow}
        toggleTask={toggleTask}
      />

      <div className="card hamxahHero">
        <div className="contentHero">
          <div>
            <small>
              {plan?.phase?.toUpperCase() ||
                'CONTENT + QUESTIONS'}
            </small>

            <h2>
              {plan?.study_phase ||
                plan?.phase ||
                'Hamzah MCAT Plan'}
            </h2>

            <p>
              Kaplan content progresses by
              completion, while daily question
              volume increases toward UWorld
              and AAMC.
            </p>
          </div>

          <div className="chapterCounter">
            <b>
              {chapter
                ? chapter.sequence
                : chapterProgress.total}
            </b>

            <span>
              / {chapterProgress.total}
            </span>
          </div>
        </div>

        <div className="activeChapterCard">
          <small>
            CURRENT KAPLAN CHAPTER
          </small>

          {chapter ? (
            <>
              <h2>
                {chapter.subject} Ch.{' '}
                {chapter.chapter}
              </h2>

              <p>{chapter.title}</p>

              <span>
                {chapterProgress.completed} of{' '}
                {chapterProgress.total} chapters
                completed
              </span>
            </>
          ) : (
            <>
              <h2>Kaplan Complete</h2>

              <p>
                All 58 scheduled Kaplan content
                units are complete.
              </p>
            </>
          )}
        </div>
      </div>

      <div className="todayHeading">
        <div>
          <small>
            {plan?.phase?.toUpperCase() ||
              'HAMZAH'}
          </small>

          <h2>
            {formatDate(date, {
              weekday: true,
              year: true
            })}
          </h2>

          <p>
            {plan
              ? `Target workload: ${formatMinutes(
                  plan.target_minutes
                )}.`
              : 'No scheduled workload.'}
          </p>
        </div>

        <div className="todayMetrics">
          <span>
            <small>PLANNED</small>
            <b>{formatMinutes(minutes)}</b>
          </span>

          <span>
            <small>DONE</small>
            <b>
              {completed}/{realTasks.length}
            </b>
          </span>

          <span>
            <small>OVERFLOW</small>
            <b>
              {formatMinutes(
                taskMinutes(overflow)
              )}
            </b>
          </span>
        </div>
      </div>

      <ProgressCard
        progress={progress}
        completed={completed}
        total={realTasks.length}
        minutes={minutes}
      />

      <div className="dashboardGrid">
        <div className="card">
          <div className="sectionTitle">
            <div>
              <small>TODAY'S CHECKLIST</small>
              <h2>Hamzah's Work</h2>
            </div>

            <span>{plan?.phase}</span>
          </div>

          <div className="taskList">
            {realTasks.length ? (
              realTasks.map(task => (
                <TaskRow
                  key={task.id}
                  task={task}
                  onToggle={toggleTask}
                />
              ))
            ) : (
              <p className="empty">
                No tasks loaded for this date.
              </p>
            )}
          </div>

          {chapterTasks.length > 0 && (
            <div className="chapterChecklist">
              <small>
                CHAPTER PROGRESSION
              </small>

              {chapterTasks.map(task => (
                <TaskRow
                  key={task.id}
                  task={task}
                  onToggle={toggleTask}
                />
              ))}
            </div>
          )}
        </div>

        <Pomodoro
          student="Hamzah"
          onLog={logSession}
        />
      </div>
    </>
  )
}

/* ============================================================
   OVERFLOW
   ============================================================ */

function OverflowPanel({
  student,
  overflow,
  toggleTask
}) {
  if (!overflow.length) return null

  const minutes = taskMinutes(overflow)

  const warning =
    config.global_rules
      ?.overflow_warning_minutes || 120

  const critical =
    config.global_rules
      ?.overflow_critical_minutes || 240

  const level =
    minutes >= critical
      ? 'critical'
      : minutes >= warning
        ? 'warning'
        : ''

  return (
    <div
      className={`card overflowPanel ${level}`}
    >
      <div className="sectionTitle">
        <div>
          <small>
            {student.toUpperCase()} OVERFLOW
          </small>

          <h2>Carried Work</h2>
        </div>

        <strong>
          {formatMinutes(minutes)}
        </strong>
      </div>

      <p>
        These tasks were missed on an earlier
        date. Their original calendar date
        remains unchanged.
      </p>

      <div className="taskList">
        {overflow.map(task => (
          <TaskRow
            key={`overflow-${task.id}`}
            task={task}
            onToggle={toggleTask}
            overflow
          />
        ))}
      </div>
    </div>
  )
}

/* ============================================================
   TASK ROW
   ============================================================ */

function TaskRow({
  task,
  onToggle,
  overflow = false
}) {
  return (
    <div
      className={[
        'task',
        task.completed ? 'completed' : '',
        overflow ? 'overflowTask' : ''
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <button
        className={`taskCheck ${
          task.completed ? 'done' : ''
        }`}
        onClick={() => onToggle(task)}
      >
        {task.completed ? '✓' : ''}
      </button>

      <div className="taskBody">
        <small>
          {overflow
            ? `OVERFLOW • ${task.task_type}`
            : task.task_type}
        </small>

        <b>{task.title}</b>

        {task.description && (
          <span>{task.description}</span>
        )}

        <span>
          {Number(task.estimated_minutes) > 0
            ? formatMinutes(
                task.estimated_minutes
              )
            : ''}

          {task.resource
            ? `${
                Number(
                  task.estimated_minutes
                ) > 0
                  ? ' • '
                  : ''
              }${task.resource}`
            : ''}
        </span>
      </div>
    </div>
  )
}

/* ============================================================
   PROGRESS
   ============================================================ */

function ProgressCard({
  progress,
  completed,
  total,
  minutes
}) {
  return (
    <div className="card progressCard">
      <div>
        <b>Daily Progress</b>

        <span>
          {completed} of {total} tasks complete
          • {formatMinutes(minutes)} planned
        </span>
      </div>

      <strong>{progress}%</strong>

      <div className="progress">
        <i
          style={{
            width: `${progress}%`
          }}
        />
      </div>
    </div>
  )
}

/* ============================================================
   POMODORO
   ============================================================ */

function Pomodoro({
  student,
  onLog
}) {
  const [mode, setMode] = useState('Focus')
  const [focusMinutes, setFocusMinutes] = useState(50)
  const [breakMinutes, setBreakMinutes] = useState(10)

  const [seconds, setSeconds] = useState(50 * 60)
  const [running, setRunning] = useState(false)

  const intervalRef = useRef(null)

  useEffect(() => {
    if (!running) {
      setSeconds(
        (mode === 'Focus'
          ? focusMinutes
          : breakMinutes) * 60
      )
    }
  }, [
    focusMinutes,
    breakMinutes,
    mode,
    running
  ])

  useEffect(() => {
    if (!running) {
      clearInterval(intervalRef.current)
      return
    }

    intervalRef.current = setInterval(() => {
      setSeconds(previous => {
        if (previous <= 1) {
          clearInterval(intervalRef.current)
          setRunning(false)

          if (mode === 'Focus') {
            onLog(
              student,
              focusMinutes,
              'Pomodoro'
            )
          }

          return 0
        }

        return previous - 1
      })
    }, 1000)

    return () => {
      clearInterval(intervalRef.current)
    }
  }, [
    running,
    mode,
    focusMinutes,
    student,
    onLog
  ])

  function switchMode(nextMode) {
    setRunning(false)
    setMode(nextMode)

    setSeconds(
      (nextMode === 'Focus'
        ? focusMinutes
        : breakMinutes) * 60
    )
  }

  function reset() {
    setRunning(false)

    setSeconds(
      (mode === 'Focus'
        ? focusMinutes
        : breakMinutes) * 60
    )
  }

  const mins = String(
    Math.floor(seconds / 60)
  ).padStart(2, '0')

  const secs = String(
    seconds % 60
  ).padStart(2, '0')

  return (
    <div className="card pomodoro">
      <div className="sectionTitle">
        <div>
          <small>
            {student.toUpperCase()}
          </small>

          <h2>Pomodoro</h2>
        </div>

        <span>{mode}</span>
      </div>

      <div className="timer">
        {mins}:{secs}
      </div>

      <div className="timerModes">
        <button
          onClick={() =>
            switchMode('Focus')
          }
        >
          Focus
        </button>

        <button
          onClick={() =>
            switchMode('Break')
          }
        >
          Break
        </button>
      </div>

      <div className="timerInputs">
        <label>
          Focus

          <input
            type="number"
            min="1"
            value={focusMinutes}
            onChange={e =>
              setFocusMinutes(
                Number(e.target.value) || 1
              )
            }
          />
        </label>

        <label>
          Break

          <input
            type="number"
            min="1"
            value={breakMinutes}
            onChange={e =>
              setBreakMinutes(
                Number(e.target.value) || 1
              )
            }
          />
        </label>
      </div>

      <button
        className="timerButton"
        onClick={() =>
          setRunning(previous => !previous)
        }
      >
        {running ? 'Pause' : 'Start'}
      </button>

      <button
        className="secondary"
        onClick={reset}
        style={{ marginTop: 8 }}
      >
        Reset
      </button>
    </div>
  )
}

/* ============================================================
   CALENDAR
   ============================================================ */

function CalendarView({
  selectedDate,
  setSelectedDate,
  tasks
}) {
  const [monthOffset, setMonthOffset] = useState(0)

  const base = dateFromISO(selectedDate)

  const month = new Date(
    base.getFullYear(),
    base.getMonth() + monthOffset,
    1
  )

  const year = month.getFullYear()
  const monthIndex = month.getMonth()

  const first = new Date(
    year,
    monthIndex,
    1
  )

  const last = new Date(
    year,
    monthIndex + 1,
    0
  )

  const dates = []

  for (
    let day = 1;
    day <= last.getDate();
    day++
  ) {
    dates.push(
      localISO(
        new Date(year, monthIndex, day)
      )
    )
  }

  return (
    <div className="card">
      <div className="sectionTitle">
        <div>
          <small>STUDY CALENDAR</small>

          <h2>
            {month.toLocaleDateString(
              'en-US',
              {
                month: 'long',
                year: 'numeric'
              }
            )}
          </h2>
        </div>

        <div
          style={{
            display: 'flex',
            gap: 6
          }}
        >
          <button
            className="secondary"
            onClick={() =>
              setMonthOffset(v => v - 1)
            }
          >
            ←
          </button>

          <button
            className="secondary"
            onClick={() =>
              setMonthOffset(v => v + 1)
            }
          >
            →
          </button>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns:
            'repeat(7, 1fr)',
          gap: 7,
          marginBottom: 7
        }}
      >
        {[
          'Sun',
          'Mon',
          'Tue',
          'Wed',
          'Thu',
          'Fri',
          'Sat'
        ].map(day => (
          <small
            key={day}
            style={{
              textAlign: 'center',
              opacity: 0.6
            }}
          >
            {day}
          </small>
        ))}
      </div>

      <div
        className="calendarGrid"
        style={{
          paddingLeft: `calc(${
            first.getDay()
          } * ((100% - 42px) / 7 + 7px))`
        }}
      >
        {dates.map(date => {
          const dayTasks = tasks.filter(
            task => task.task_date === date
          )

          const actualTasks =
            dayTasks.filter(
              task =>
                task.task_type !== 'Chapter'
            )

          const complete =
            actualTasks.length > 0 &&
            actualTasks.every(
              task => task.completed
            )

          const missed =
            date < localISO() &&
            actualTasks.some(
              task => !task.completed
            )

          const future =
            date > localISO()

          const diyaTasks =
            actualTasks.filter(
              task =>
                task.student_name === 'Diya'
            )

          const hamzahTasks =
            actualTasks.filter(
              task =>
                task.student_name ===
                'Hamzah'
            )

          const diyaDone =
            diyaTasks.filter(
              task => task.completed
            ).length

          const hamzahDone =
            hamzahTasks.filter(
              task => task.completed
            ).length

          return (
            <button
              key={date}
              className={[
                date === localISO()
                  ? 'current'
                  : '',
                complete ? 'complete' : '',
                missed ? 'missed' : '',
                future ? 'future' : ''
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() =>
                setSelectedDate(date)
              }
            >
              <small>
                {dateFromISO(
                  date
                ).toLocaleDateString(
                  'en-US',
                  {
                    weekday: 'short'
                  }
                )}
              </small>

              <b>
                {dateFromISO(date).getDate()}
              </b>

              <span>
                D {diyaDone}/{diyaTasks.length}
              </span>

              <span>
                H {hamzahDone}/
                {hamzahTasks.length}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/* ============================================================
   QUESTIONS
   ============================================================ */

function QuestionsView({
  logs,
  onAdd
}) {
  const [student, setStudent] = useState('Diya')
  const [date, setDate] = useState(localISO())
  const [source, setSource] = useState('UWorld')
  const [subject, setSubject] = useState('B/B')
  const [total, setTotal] = useState(20)
  const [correct, setCorrect] = useState(0)
  const [timed, setTimed] = useState(true)

  async function submit(e) {
    e.preventDefault()

    await onAdd({
      student,
      date,
      source,
      subject,
      total,
      correct,
      timed
    })

    setCorrect(0)
  }

  return (
    <div className="dashboardGrid">
      <form
        className="card form"
        onSubmit={submit}
      >
        <div className="sectionTitle">
          <div>
            <small>QUESTION LOG</small>
            <h2>Add Practice Block</h2>
          </div>
        </div>

        <label>
          Student

          <select
            value={student}
            onChange={e =>
              setStudent(e.target.value)
            }
          >
            <option>Diya</option>
            <option>Hamzah</option>
          </select>
        </label>

        <label>
          Date

          <input
            type="date"
            value={date}
            onChange={e =>
              setDate(e.target.value)
            }
          />
        </label>

        <label>
          Resource

          <select
            value={source}
            onChange={e =>
              setSource(e.target.value)
            }
          >
            <option>Kaplan</option>
            <option>Kaplan QBank</option>
            <option>UWorld</option>
            <option>AAMC</option>
            <option>
              AAMC Section Bank
            </option>
            <option>
              AAMC Question Pack
            </option>
            <option>Other</option>
          </select>
        </label>

        <label>
          Section

          <select
            value={subject}
            onChange={e =>
              setSubject(e.target.value)
            }
          >
            <option>B/B</option>
            <option>C/P</option>
            <option>P/S</option>
            <option>CARS</option>
            <option>Mixed</option>
          </select>
        </label>

        <label>
          Questions

          <input
            type="number"
            min="1"
            value={total}
            onChange={e =>
              setTotal(e.target.value)
            }
          />
        </label>

        <label>
          Correct

          <input
            type="number"
            min="0"
            max={total}
            value={correct}
            onChange={e =>
              setCorrect(e.target.value)
            }
          />
        </label>

        <label className="checkboxLabel">
          <input
            type="checkbox"
            checked={timed}
            onChange={e =>
              setTimed(e.target.checked)
            }
          />

          Timed
        </label>

        <button type="submit">
          Save Question Block
        </button>
      </form>

      <div className="card">
        <div className="sectionTitle">
          <div>
            <small>RECENT PRACTICE</small>
            <h2>Question History</h2>
          </div>
        </div>

        <div className="logList">
          {logs.length ? (
            logs.slice(0, 30).map(log => {
              const totalQuestions =
                Number(
                  log.total_questions
                ) || 0

              const correctQuestions =
                Number(
                  log.correct_questions
                ) || 0

              const pct =
                totalQuestions > 0
                  ? Math.round(
                      (correctQuestions /
                        totalQuestions) *
                        100
                    )
                  : 0

              return (
                <div
                  className="logRow"
                  key={log.id}
                >
                  <div>
                    <small>
                      {formatDate(
                        log.question_date
                      )}{' '}
                      • {log.source}
                    </small>

                    <b>
                      {log.subject} •{' '}
                      {correctQuestions}/
                      {totalQuestions}
                    </b>
                  </div>

                  <strong>{pct}%</strong>
                </div>
              )
            })
          ) : (
            <p className="empty">
              No question blocks logged yet.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

/* ============================================================
   FULL LENGTHS
   ============================================================ */

function FullLengthView({
  fullLengths,
  onAdd
}) {
  const [student, setStudent] = useState('Diya')
  const [date, setDate] = useState(localISO())
  const [name, setName] = useState('AAMC FL')

  const [cp, setCp] = useState(125)
  const [cars, setCars] = useState(125)
  const [bb, setBb] = useState(125)
  const [ps, setPs] = useState(125)

  async function submit(e) {
    e.preventDefault()

    await onAdd({
      student,
      date,
      name,
      cp,
      cars,
      bb,
      ps
    })
  }

  return (
    <>
      <div className="card togetherHero">
        <small>SHARED MILESTONES</small>

        <h2>
          Synchronized Full-Lengths
        </h2>

        <p>
          Both students take scheduled
          full-lengths on the same day and
          perform deep review the following
          day.
        </p>
      </div>

      <div className="dashboardGrid">
        <form
          className="card form"
          onSubmit={submit}
        >
          <div className="sectionTitle">
            <div>
              <small>FULL LENGTH</small>
              <h2>Log Score</h2>
            </div>
          </div>

          <label>
            Student

            <select
              value={student}
              onChange={e =>
                setStudent(e.target.value)
              }
            >
              <option>Diya</option>
              <option>Hamzah</option>
            </select>
          </label>

          <label>
            Exam Date

            <input
              type="date"
              value={date}
              onChange={e =>
                setDate(e.target.value)
              }
            />
          </label>

          <label>
            Exam

            <input
              value={name}
              onChange={e =>
                setName(e.target.value)
              }
            />
          </label>

          <label>
            C/P

            <input
              type="number"
              min="118"
              max="132"
              value={cp}
              onChange={e =>
                setCp(e.target.value)
              }
            />
          </label>

          <label>
            CARS

            <input
              type="number"
              min="118"
              max="132"
              value={cars}
              onChange={e =>
                setCars(e.target.value)
              }
            />
          </label>

          <label>
            B/B

            <input
              type="number"
              min="118"
              max="132"
              value={bb}
              onChange={e =>
                setBb(e.target.value)
              }
            />
          </label>

          <label>
            P/S

            <input
              type="number"
              min="118"
              max="132"
              value={ps}
              onChange={e =>
                setPs(e.target.value)
              }
            />
          </label>

          <button type="submit">
            Save Full Length
          </button>
        </form>

        <div className="card">
          <div className="sectionTitle">
            <div>
              <small>SCORE HISTORY</small>
              <h2>Full Lengths</h2>
            </div>
          </div>

          <div className="flList">
            {fullLengths.length ? (
              fullLengths.map(fl => (
                <div
                  className="flRow"
                  key={fl.id}
                >
                  <div>
                    <small>
                      {formatDate(
                        fl.exam_date
                      )}
                    </small>

                    <b>{fl.exam_name}</b>

                    <span>
                      C/P {fl.cp_score} • CARS{' '}
                      {fl.cars_score} • B/B{' '}
                      {fl.bb_score} • P/S{' '}
                      {fl.ps_score}
                    </span>
                  </div>

                  <strong>
                    {fl.total_score}
                  </strong>
                </div>
              ))
            ) : (
              <p className="empty">
                No full lengths logged yet.
              </p>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

/* ============================================================
   TOGETHER
   ============================================================ */

function TogetherView({
  sessions
}) {
  const flDates =
    config.shared?.full_length_dates || []

  return (
    <>
      <div className="card togetherHero">
        <small>DIYA + HAMZAH</small>

        <h2>Study Together</h2>

        <p>
          One MCAT date, one shared login, and
          two independent daily checklists.
        </p>
      </div>

      <div className="dashboardGrid">
        <div className="card">
          <div className="sectionTitle">
            <div>
              <small>FULL LENGTH PLAN</small>
              <h2>Scheduled Exams</h2>
            </div>
          </div>

          <div className="partnerList">
            {flDates.map((date, index) => (
              <div
                className="partnerRow"
                key={date}
              >
                <div>
                  <small>
                    FULL LENGTH {index + 1}
                  </small>

                  <b>
                    {formatDate(date, {
                      weekday: true,
                      year: true
                    })}
                  </b>
                </div>

                <strong>
                  {date < localISO()
                    ? 'PAST'
                    : date === localISO()
                      ? 'TODAY'
                      : `${Math.max(
                          0,
                          daysBetween(
                            localISO(),
                            date
                          )
                        )} DAYS`}
                </strong>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="sectionTitle">
            <div>
              <small>FOCUS TIME</small>
              <h2>Recent Sessions</h2>
            </div>
          </div>

          <div className="logList">
            {sessions.length ? (
              sessions
                .slice(0, 20)
                .map(session => (
                  <div
                    className="logRow"
                    key={session.id}
                  >
                    <div>
                      <small>
                        {formatDate(
                          session.session_date
                        )}
                      </small>

                      <b>
                        {
                          session.session_type
                        }
                      </b>
                    </div>

                    <strong>
                      {formatMinutes(
                        session.actual_minutes
                      )}
                    </strong>
                  </div>
                ))
            ) : (
              <p className="empty">
                No focus sessions logged yet.
              </p>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

/* ============================================================
   ANALYTICS
   ============================================================ */

function AnalyticsView({
  tasks,
  questionLogs,
  fullLengths,
  sessions,
  hamzahChapterProgress
}) {
  const diyaTasks = tasks.filter(
    task =>
      task.student_name === 'Diya' &&
      task.task_type !== 'Chapter'
  )

  const hamzahTasks = tasks.filter(
    task =>
      task.student_name === 'Hamzah' &&
      task.task_type !== 'Chapter'
  )

  const diyaDone = diyaTasks.filter(
    task => task.completed
  ).length

  const hamzahDone = hamzahTasks.filter(
    task => task.completed
  ).length

  const totalQuestions =
    questionLogs.reduce(
      (sum, log) =>
        sum +
        (Number(log.total_questions) || 0),
      0
    )

  const totalCorrect =
    questionLogs.reduce(
      (sum, log) =>
        sum +
        (Number(log.correct_questions) || 0),
      0
    )

  const accuracy =
    totalQuestions > 0
      ? Math.round(
          (totalCorrect / totalQuestions) *
            100
        )
      : 0

  const focusMinutes =
    sessions.reduce(
      (sum, session) =>
        sum +
        (Number(
          session.actual_minutes
        ) || 0),
      0
    )

  const bestFL =
    fullLengths.length > 0
      ? Math.max(
          ...fullLengths.map(
            fl =>
              Number(fl.total_score) || 0
          )
        )
      : 0

  return (
    <div className="analyticsGrid">
      <MetricCard
        label="DIYA COMPLETION"
        value={
          diyaTasks.length
            ? `${Math.round(
                (diyaDone /
                  diyaTasks.length) *
                  100
              )}%`
            : '0%'
        }
        detail={`${diyaDone}/${diyaTasks.length} tasks`}
      />

      <MetricCard
        label="HAMZAH COMPLETION"
        value={
          hamzahTasks.length
            ? `${Math.round(
                (hamzahDone /
                  hamzahTasks.length) *
                  100
              )}%`
            : '0%'
        }
        detail={`${hamzahDone}/${hamzahTasks.length} tasks`}
      />

      <MetricCard
        label="HAMZAH KAPLAN"
        value={`${hamzahChapterProgress.completed}/${hamzahChapterProgress.total}`}
        detail="chapters completed"
      />

      <MetricCard
        label="QUESTIONS LOGGED"
        value={totalQuestions}
        detail={`${accuracy}% overall accuracy`}
      />

      <MetricCard
        label="FOCUS TIME"
        value={formatMinutes(focusMinutes)}
        detail={`${sessions.length} sessions`}
      />

      <MetricCard
        label="BEST FL"
        value={bestFL || '—'}
        detail={`${fullLengths.length} exams logged`}
      />
    </div>
  )
}

function MetricCard({
  label,
  value,
  detail
}) {
  return (
    <div className="card statCard">
      <small>{label}</small>
      <b>{value}</b>
      <span>{detail}</span>
    </div>
  )
}
