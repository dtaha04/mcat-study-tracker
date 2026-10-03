'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import config from '../data/studyConfig.json'
import schedule from '../data/schedule.json'

const PLAN_START = schedule.plan_start || '2026-10-03'
const EXAM_DATE = schedule.exam_date || '2027-01-21'
const SOURCE_TYPE = 'v2_engine'
const DAYS = Array.isArray(schedule.days) ? schedule.days : []

function localISO(d = new Date()) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function fromISO(s) {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function daysBetween(a, b) {
  return Math.round((fromISO(b) - fromISO(a)) / 86400000)
}

function formatDate(s, weekday = false, year = false) {
  return fromISO(s).toLocaleDateString('en-US', {
    weekday: weekday ? 'short' : undefined,
    month: 'short',
    day: 'numeric',
    year: year ? 'numeric' : undefined,
  })
}

function fmtMin(n = 0) {
  n = Math.max(0, Math.round(Number(n) || 0))

  const h = Math.floor(n / 60)
  const m = n % 60

  if (h) {
    return `${h}h${m ? ` ${m}m` : ''}`
  }

  return `${m}m`
}

function dayFor(iso) {
  return DAYS.find((d) => d.date === iso) || null
}

function planFor(iso, student) {
  const day = dayFor(iso)

  if (!day) return null

  if (student === 'Diya') {
    return day.diya || null
  }

  return day.hamzah || null
}

function taskSignature(task) {
  return [
    task.student_name || '',
    task.task_type || '',
    task.title || '',
    task.resource || '',
    task.subject || '',
  ].join('||')
}

function sumMinutes(tasks = []) {
  return tasks.reduce(
    (total, task) => total + (Number(task.estimated_minutes) || 0),
    0
  )
}

function progressPercent(tasks = []) {
  const realTasks = tasks.filter((task) => task.task_type !== 'Chapter')

  if (!realTasks.length) return 0

  const completed = realTasks.filter((task) => task.completed).length

  return Math.round((completed / realTasks.length) * 100)
}

function weekDates(iso) {
  const date = fromISO(iso)
  const dayOfWeek = date.getDay()

  const offset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek

  const monday = new Date(date)
  monday.setDate(date.getDate() + offset)

  return Array.from({ length: 7 }, (_, i) => {
    const next = new Date(monday)
    next.setDate(monday.getDate() + i)
    return localISO(next)
  })
}

/*
  Supports several possible config locations.

  This prevents Hamzah's chapter system from breaking if your
  studyConfig.json uses hamzah, students.hamzah, or friend.
*/
function getHamzahChapters() {
  const possible = [
    config.hamzah?.chapters,
    config.students?.hamzah?.chapters,
    config.friend?.chapters,
    config.students?.friend?.chapters,
    config.chapters,
  ]

  return possible.find(Array.isArray) || []
}

function chapterSequenceFromTask(task) {
  const match = (task.description || '').match(/chapter_sequence:(\d+)/)

  return match ? Number(match[1]) : null
}

function completedChapterSet(tasks) {
  const completed = new Set()

  tasks.forEach((task) => {
    if (
      task.student_name === 'Hamzah' &&
      task.task_type === 'Chapter' &&
      task.completed
    ) {
      const sequence = chapterSequenceFromTask(task)

      if (sequence) {
        completed.add(sequence)
      }
    }
  })

  return completed
}

function getCurrentChapter(tasks) {
  const chapters = getHamzahChapters()
  const completed = completedChapterSet(tasks)

  return (
    chapters.find(
      (chapter) => !completed.has(Number(chapter.sequence))
    ) || null
  )
}

function chapterLabel(chapter) {
  if (!chapter) return 'Current Kaplan Chapter'

  return `${chapter.subject} Ch. ${chapter.chapter}: ${chapter.title}`
}

/*
  THIS IS THE IMPORTANT PART.

  We create the visible checklist DIRECTLY from schedule.json.

  That means Hamzah's tasks do not depend on Supabase successfully
  inserting them first.
*/
function expectedTasks(iso, student, currentChapter) {
  const plan = planFor(iso, student)

  if (!plan || !Array.isArray(plan.tasks)) {
    return []
  }

  const output = plan.tasks.map((item, index) => {
    let title = item.title || 'Study Task'
    let subject = item.subject || ''
    let description = item.details || ''

    const isHamzahChapterTask =
      student === 'Hamzah' &&
      plan.chapter_mode === 'current_unfinished' &&
      (
        title === 'Continue Current Kaplan Chapter' ||
        subject === 'Current Chapter'
      )

    if (isHamzahChapterTask && currentChapter) {
      if (title === 'Continue Current Kaplan Chapter') {
        title = `Kaplan: ${chapterLabel(currentChapter)}`
      }

      if (subject === 'Current Chapter') {
        subject = currentChapter.subject || 'Kaplan'
      }

      description = [
        description,
        `Current chapter: ${chapterLabel(currentChapter)}`,
      ]
        .filter(Boolean)
        .join(' ')
    }

    return {
      _virtual: true,
      _key: `${iso}-${student}-${index}`,

      student_name: student,

      task_date: iso,
      current_due_date: iso,

      task_type: item.type || 'Study',

      title,
      description,

      resource: item.resource || '',
      subject,

      estimated_minutes: Math.max(
        0,
        Math.round(Number(item.minutes) || 0)
      ),

      priority: Number(item.priority) || 2,
      sort_order: index + 1,

      completed: false,

      source_type: SOURCE_TYPE,
      status: 'scheduled',

      carried_forward: false,
      carry_count: 0,
    }
  })

  /*
    Add a special zero-minute chapter completion task.

    This is what lets Hamzah manually advance through the 58 Kaplan
    chapters based on completion rather than date.
  */
  const hasChapterWork =
    student === 'Hamzah' &&
    currentChapter &&
    plan.chapter_mode === 'current_unfinished' &&
    plan.tasks.some(
      (item) =>
        item.title === 'Continue Current Kaplan Chapter' ||
        item.subject === 'Current Chapter'
    )

  if (hasChapterWork) {
    output.push({
      _virtual: true,
      _key: `${iso}-Hamzah-chapter-${currentChapter.sequence}`,

      student_name: 'Hamzah',

      task_date: iso,
      current_due_date: iso,

      task_type: 'Chapter',

      title: `Mark chapter complete: ${chapterLabel(currentChapter)}`,

      description:
        `chapter_sequence:${currentChapter.sequence} | ` +
        `Only check this after the entire Kaplan chapter, ` +
        `concept checks, and chapter questions are complete.`,

      resource: 'Kaplan Books',
      subject: currentChapter.subject || 'Kaplan',

      estimated_minutes: 0,

      priority: 3,
      sort_order: output.length + 1,

      completed: false,

      source_type: SOURCE_TYPE,
      status: 'scheduled',

      carried_forward: false,
      carry_count: 0,
    })
  }

  return output
}

/*
  Database rows override schedule-generated rows.

  BUT if the database row does not exist, the schedule-generated
  task stays visible.

  This is what prevents 0/0.
*/
function mergeExpectedWithDatabase(expected, databaseRows) {
  const databaseMap = new Map(
    databaseRows.map((task) => [
      taskSignature(task),
      task,
    ])
  )

  const merged = expected.map((expectedTask) => {
    const databaseTask = databaseMap.get(
      taskSignature(expectedTask)
    )

    return databaseTask || expectedTask
  })

  const expectedSignatures = new Set(
    expected.map(taskSignature)
  )

  databaseRows.forEach((task) => {
    if (!expectedSignatures.has(taskSignature(task))) {
      merged.push(task)
    }
  })

  return merged.sort(
    (a, b) =>
      (Number(a.sort_order) || 0) -
      (Number(b.sort_order) || 0)
  )
}

export default function Home() {
  const [session, setSession] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authMode, setAuthMode] = useState('signin')

  const [message, setMessage] = useState('')

  const [view, setView] = useState('Today')

  const [selectedDate, setSelectedDate] = useState(
    localISO()
  )

  const [tasks, setTasks] = useState([])
  const [questionLogs, setQuestionLogs] = useState([])
  const [fullLengths, setFullLengths] = useState([])
  const [studySessions, setStudySessions] = useState([])

  const [loaded, setLoaded] = useState(false)
  const [syncing, setSyncing] = useState(false)

  const syncRef = useRef(false)

  const uid = session?.user?.id || null

  /*
    AUTH
  */

  useEffect(() => {
    if (!supabase) {
      setAuthLoading(false)
      return
    }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session || null)
      setAuthLoading(false)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession || null)
    })

    return () => subscription.unsubscribe()
  }, [])

  async function handleAuth(event) {
    event.preventDefault()

    setMessage('')

    const result =
      authMode === 'signup'
        ? await supabase.auth.signUp({
            email,
            password,
          })
        : await supabase.auth.signInWithPassword({
            email,
            password,
          })

    if (result.error) {
      setMessage(result.error.message)
    } else if (authMode === 'signup') {
      setMessage(
        'Account created. Check your email if confirmation is required.'
      )
    }
  }

  /*
    DATABASE LOAD
  */

  async function loadAll() {
    if (!uid || !supabase) return []

    const [
      taskResult,
      questionResult,
      fullLengthResult,
      sessionResult,
    ] = await Promise.all([
      supabase
        .from('daily_tasks')
        .select('*')
        .eq('user_id', uid)
        .order('task_date')
        .order('sort_order'),

      supabase
        .from('question_blocks')
        .select('*')
        .eq('user_id', uid)
        .order('question_date', {
          ascending: false,
        }),

      supabase
        .from('full_length_scores')
        .select('*')
        .eq('user_id', uid)
        .order('exam_date', {
          ascending: false,
        }),

      supabase
        .from('study_sessions')
        .select('*')
        .eq('user_id', uid)
        .order('session_date', {
          ascending: false,
        }),
    ])

    if (taskResult.error) {
      console.error(taskResult.error)

      setMessage(
        `Task load error: ${taskResult.error.message}`
      )
    }

    const taskRows = taskResult.data || []

    setTasks(taskRows)

    setQuestionLogs(questionResult.data || [])

    setFullLengths(fullLengthResult.data || [])

    setStudySessions(sessionResult.data || [])

    setLoaded(true)

    return taskRows
  }

  useEffect(() => {
    if (uid) {
      setLoaded(false)
      loadAll()
    }
  }, [uid])

  /*
    HAMZAH CHAPTER PROGRESS
  */

  const currentChapter = useMemo(
    () => getCurrentChapter(tasks),
    [tasks]
  )

  const chapterProgress = useMemo(() => {
    const chapters = getHamzahChapters()

    return {
      completed: completedChapterSet(tasks).size,
      total: chapters.length,
    }
  }, [tasks])

  /*
    SYNC ONE DAY TO DATABASE

    BOTH STUDENTS are generated independently.

    If Supabase rejects an insert, the checklist STILL displays
    because the visible checklist is generated from schedule.json.
  */

  async function syncDay(iso) {
    if (
      !uid ||
      !supabase ||
      syncRef.current ||
      iso < PLAN_START ||
      iso > EXAM_DATE
    ) {
      return
    }

    const scheduleDay = dayFor(iso)

    if (!scheduleDay) {
      setMessage(
        `No schedule.json entry exists for ${iso}.`
      )

      return
    }

    syncRef.current = true
    setSyncing(true)

    try {
      const {
        data: existing,
        error: existingError,
      } = await supabase
        .from('daily_tasks')
        .select('*')
        .eq('user_id', uid)
        .eq('source_type', SOURCE_TYPE)
        .eq('task_date', iso)

      if (existingError) {
        throw existingError
      }

      const diyaExpected = expectedTasks(
        iso,
        'Diya',
        currentChapter
      )

      const hamzahExpected = expectedTasks(
        iso,
        'Hamzah',
        currentChapter
      )

      const expected = [
        ...diyaExpected,
        ...hamzahExpected,
      ]

      const existingSignatures = new Set(
        (existing || []).map(taskSignature)
      )

      const missing = expected
        .filter(
          (task) =>
            !existingSignatures.has(
              taskSignature(task)
            )
        )
        .map((task) => {
          const {
            _virtual,
            _key,
            ...databaseTask
          } = task

          return {
            ...databaseTask,
            user_id: uid,
          }
        })

      console.log(
        `[MCAT ${iso}] ` +
          `Diya=${diyaExpected.length}, ` +
          `Hamzah=${hamzahExpected.length}, ` +
          `missing=${missing.length}`
      )

      if (missing.length) {
        const { error: insertError } =
          await supabase
            .from('daily_tasks')
            .insert(missing)

        if (insertError) {
          throw insertError
        }
      }

      await loadAll()
    } catch (error) {
      console.error(
        '[MCAT sync]',
        error
      )

      setMessage(
        `Database sync warning: ${
          error?.message || 'Unknown error'
        }. Schedule tasks are still shown.`
      )
    } finally {
      syncRef.current = false
      setSyncing(false)
    }
  }

  useEffect(() => {
    if (uid && loaded) {
      syncDay(selectedDate)
    }
  }, [
    uid,
    loaded,
    selectedDate,
  ])

  /*
    GET DATABASE TASKS FOR ONE STUDENT / DATE
  */

  function databaseTasksFor(
    student,
    iso
  ) {
    return tasks.filter(
      (task) =>
        task.source_type === SOURCE_TYPE &&
        task.student_name === student &&
        task.task_date === iso
    )
  }

  /*
    FINAL DISPLAY TASKS

    schedule.json
         +
    Supabase state
         =
    what the user sees
  */

  function displayTasksFor(
    student,
    iso
  ) {
    const expected = expectedTasks(
      iso,
      student,
      currentChapter
    )

    const databaseRows =
      databaseTasksFor(
        student,
        iso
      )

    return mergeExpectedWithDatabase(
      expected,
      databaseRows
    )
  }

  const diyaTasks =
    displayTasksFor(
      'Diya',
      selectedDate
    )

  const hamzahTasks =
    displayTasksFor(
      'Hamzah',
      selectedDate
    )

  /*
    OVERFLOW
  */

  function overflowFor(
    student,
    iso
  ) {
    return tasks.filter(
      (task) =>
        task.source_type === SOURCE_TYPE &&
        task.student_name === student &&
        !task.completed &&
        task.carried_forward &&
        task.current_due_date === iso &&
        task.task_date < iso &&
        task.task_type !== 'Chapter'
    )
  }

  /*
    TASK TOGGLE

    Virtual schedule tasks are inserted into Supabase when
    first checked.
  */

  async function toggleTask(task) {
    if (!uid || !supabase) return

    const nextCompleted =
      !task.completed

    if (
      task._virtual ||
      !task.id
    ) {
      const {
        _virtual,
        _key,
        ...row
      } = task

      const {
        error,
      } = await supabase
        .from('daily_tasks')
        .insert({
          ...row,

          user_id: uid,

          completed:
            nextCompleted,

          completed_at:
            nextCompleted
              ? new Date().toISOString()
              : null,

          status:
            nextCompleted
              ? 'completed'
              : 'scheduled',
        })

      if (error) {
        setMessage(
          `Could not save task: ${error.message}`
        )

        return
      }
    } else {
      const { error } =
        await supabase
          .from('daily_tasks')
          .update({
            completed:
              nextCompleted,

            completed_at:
              nextCompleted
                ? new Date().toISOString()
                : null,

            status:
              nextCompleted
                ? 'completed'
                : task.carried_forward
                ? 'overdue'
                : 'scheduled',
          })
          .eq('id', task.id)
          .eq('user_id', uid)

      if (error) {
        setMessage(error.message)
        return
      }
    }

    await loadAll()
  }

  /*
    QUESTION LOGGING
  */

  async function addQuestionBlock(
    data
  ) {
    const { error } =
      await supabase
        .from('question_blocks')
        .insert({
          user_id: uid,

          question_date:
            data.date,

          source:
            `${data.student} — ${data.source}`,

          subject:
            data.subject,

          total_questions:
            Number(data.total),

          correct_questions:
            Number(data.correct),

          timed:
            Boolean(data.timed),
        })

    if (error) {
      setMessage(error.message)
    } else {
      await loadAll()
    }
  }

  /*
    FULL LENGTH LOGGING
  */

  async function addFullLength(
    data
  ) {
    const total =
      Number(data.cp) +
      Number(data.cars) +
      Number(data.bb) +
      Number(data.ps)

    const { error } =
      await supabase
        .from('full_length_scores')
        .insert({
          user_id: uid,

          exam_date:
            data.date,

          exam_name:
            `${data.student} — ${data.name}`,

          cp_score:
            Number(data.cp),

          cars_score:
            Number(data.cars),

          bb_score:
            Number(data.bb),

          ps_score:
            Number(data.ps),

          total_score:
            total,
        })

    if (error) {
      setMessage(error.message)
    } else {
      await loadAll()
    }
  }

  /*
    STUDY SESSION
  */

  async function logSession(
    student,
    minutes,
    type = 'Focus'
  ) {
    const { error } =
      await supabase
        .from('study_sessions')
        .insert({
          user_id: uid,

          session_date:
            localISO(),

          actual_minutes:
            Number(minutes),

          planned_minutes:
            Number(minutes),

          session_type:
            `${student} — ${type}`,

          ended_at:
            new Date().toISOString(),
        })

    if (error) {
      setMessage(error.message)
    } else {
      await loadAll()
    }
  }

  /*
    AUTH SCREEN
  */

  if (authLoading) {
    return (
      <div className="auth">
        <div className="card authCard">
          <h1>
            MCAT Study Tracker
          </h1>

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
              <b>
                MCAT TRACKER
              </b>

              <small>
                JANUARY 21, 2027
              </small>
            </div>
          </div>

          <h1>
            {authMode ===
            'signin'
              ? 'Welcome back'
              : 'Create account'}
          </h1>

          <p>
            Diya + Hamzah MCAT
            Study System
          </p>

          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) =>
              setEmail(
                e.target.value
              )
            }
            required
          />

          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) =>
              setPassword(
                e.target.value
              )
            }
            required
          />

          <button type="submit">
            {authMode ===
            'signin'
              ? 'Sign In'
              : 'Create Account'}
          </button>

          <button
            type="button"
            className="secondary"
            onClick={() =>
              setAuthMode(
                authMode ===
                  'signin'
                  ? 'signup'
                  : 'signin'
              )
            }
          >
            {authMode ===
            'signin'
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

  const daysLeft =
    Math.max(
      0,
      daysBetween(
        localISO(),
        EXAM_DATE
      )
    )

  return (
    <div className="shell">
      <aside className="aside">
        <div className="logo">
          <span>M</span>

          <div>
            <b>MCAT TRACKER</b>
            <small>
              V5 STUDY SYSTEM
            </small>
          </div>
        </div>

        <div className="profileMini">
          <small>
            SHARED ACCOUNT
          </small>

          <b>Diya + Hamzah</b>

          <span>
            Target: 512+
          </span>
        </div>

        <nav>
          {[
            'Today',
            'Calendar',
            'Questions',
            'Full Lengths',
            'Together',
            'Analytics',
          ].map((item) => (
            <button
              key={item}
              className={
                view === item
                  ? 'active'
                  : ''
              }
              onClick={() =>
                setView(item)
              }
            >
              {item}
            </button>
          ))}
        </nav>

        <div className="sideExam">
          <small>MCAT</small>
          <b>{daysLeft}</b>
          <span>
            days remaining
          </span>
        </div>

        <button
          className="secondary"
          onClick={() =>
            supabase.auth.signOut()
          }
        >
          Sign Out
        </button>
      </aside>

      <main className="content">
        <header className="header">
          <div>
            <h1>{view}</h1>

            <p>
              Diya + Hamzah •
              MCAT January 21,
              2027
            </p>
          </div>

          <div className="headerRight">
            <div className="countdown">
              <b>{daysLeft}</b>
              <span>
                DAYS TO MCAT
              </span>
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
            selectedDate={
              selectedDate
            }
            setSelectedDate={
              setSelectedDate
            }
            diyaTasks={
              diyaTasks
            }
            hamzahTasks={
              hamzahTasks
            }
            diyaOverflow={
              overflowFor(
                'Diya',
                selectedDate
              )
            }
            hamzahOverflow={
              overflowFor(
                'Hamzah',
                selectedDate
              )
            }
            allTasks={tasks}
            currentChapter={
              currentChapter
            }
            chapterProgress={
              chapterProgress
            }
            toggleTask={
              toggleTask
            }
            logSession={
              logSession
            }
            syncing={syncing}
          />
        )}

        {view ===
          'Calendar' && (
          <CalendarView
            tasks={tasks}
            selectedDate={
              selectedDate
            }
            chooseDate={(
              date
            ) => {
              setSelectedDate(
                date
              )

              setView('Today')
            }}
          />
        )}

        {view ===
          'Questions' && (
          <QuestionsView
            logs={questionLogs}
            addQuestionBlock={
              addQuestionBlock
            }
          />
        )}

        {view ===
          'Full Lengths' && (
          <FullLengthsView
            rows={fullLengths}
            addFullLength={
              addFullLength
            }
          />
        )}

        {view ===
          'Together' && (
          <TogetherView
            sessions={
              studySessions
            }
          />
        )}

        {view ===
          'Analytics' && (
          <AnalyticsView
            tasks={tasks}
            questionLogs={
              questionLogs
            }
            fullLengths={
              fullLengths
            }
            sessions={
              studySessions
            }
            chapterProgress={
              chapterProgress
            }
          />
        )}
      </main>
    </div>
  )
}

/*
  TODAY
*/

function TodayView({
  selectedDate,
  setSelectedDate,
  diyaTasks,
  hamzahTasks,
  diyaOverflow,
  hamzahOverflow,
  allTasks,
  currentChapter,
  chapterProgress,
  toggleTask,
  logSession,
  syncing,
}) {
  const week =
    weekDates(selectedDate)

  const scheduleDay =
    dayFor(selectedDate)

  return (
    <>
      <div className="card weekSummary">
        <div className="weekTitle">
          <div>
            <small>
              STUDY WEEK
            </small>

            <h2>
              {formatDate(
                week[0]
              )}{' '}
              –{' '}
              {formatDate(
                week[6],
                false,
                true
              )}
            </h2>
          </div>
        </div>

        <div className="weekDays">
          {week.map((date) => {
            const expected = [
              ...expectedTasks(
                date,
                'Diya',
                currentChapter
              ),

              ...expectedTasks(
                date,
                'Hamzah',
                currentChapter
              ),
            ].filter(
              (task) =>
                task.task_type !==
                'Chapter'
            )

            const dbRows =
              allTasks.filter(
                (task) =>
                  task.task_date ===
                    date &&
                  task.source_type ===
                    SOURCE_TYPE
              )

            const displayed =
              mergeExpectedWithDatabase(
                expected,
                dbRows
              )

            const completed =
              displayed.length > 0 &&
              displayed.every(
                (task) =>
                  task.completed
              )

            const missed =
              date < localISO() &&
              displayed.some(
                (task) =>
                  !task.completed
              )

            return (
              <button
                key={date}
                className={[
                  selectedDate ===
                  date
                    ? 'selected'
                    : '',

                  date ===
                  localISO()
                    ? 'current'
                    : '',

                  completed
                    ? 'complete'
                    : '',

                  missed
                    ? 'missed'
                    : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() =>
                  setSelectedDate(
                    date
                  )
                }
              >
                <small>
                  {fromISO(
                    date
                  ).toLocaleDateString(
                    'en-US',
                    {
                      weekday:
                        'short',
                    }
                  )}
                </small>

                <b>
                  {fromISO(
                    date
                  ).getDate()}
                </b>

                <span>
                  {
                    displayed.filter(
                      (task) =>
                        task.completed
                    ).length
                  }
                  /
                  {
                    displayed.length
                  }
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {syncing && (
        <div className="message">
          Syncing schedule
          with database...
        </div>
      )}

      {!scheduleDay && (
        <div className="message">
          No schedule entry
          exists for this date.
        </div>
      )}

      <StudentHeader
        name="Diya"
        subtitle="Question-Heavy Track • 512+ Target"
        badge={fmtMin(
          scheduleDay?.diya
            ?.target_minutes ||
            sumMinutes(
              diyaTasks
            )
        )}
      />

      <StudentDashboard
        student="Diya"
        date={selectedDate}
        plan={
          scheduleDay?.diya
        }
        tasks={diyaTasks}
        overflow={
          diyaOverflow
        }
        toggleTask={
          toggleTask
        }
        logSession={
          logSession
        }
      />

      <div className="studentDivider" />

      <StudentHeader
        name="Hamzah"
        subtitle="Content + Question Track • 512+ Target"
        badge={fmtMin(
          scheduleDay?.hamzah
            ?.target_minutes ||
            sumMinutes(
              hamzahTasks
            )
        )}
      />

      <HamzahDashboard
        date={selectedDate}
        plan={
          scheduleDay?.hamzah
        }
        tasks={
          hamzahTasks
        }
        overflow={
          hamzahOverflow
        }
        currentChapter={
          currentChapter
        }
        chapterProgress={
          chapterProgress
        }
        toggleTask={
          toggleTask
        }
        logSession={
          logSession
        }
      />
    </>
  )
}

function StudentHeader({
  name,
  subtitle,
  badge,
}) {
  return (
    <div className="studentHeader">
      <div>
        <small>
          STUDENT
        </small>

        <h2>{name}</h2>

        <p>{subtitle}</p>
      </div>

      <strong>
        {badge}
      </strong>
    </div>
  )
}

/*
  DIYA DASHBOARD
*/

function StudentDashboard({
  student,
  date,
  plan,
  tasks,
  overflow,
  toggleTask,
  logSession,
}) {
  const realTasks =
    tasks.filter(
      (task) =>
        task.task_type !==
        'Chapter'
    )

  const completed =
    realTasks.filter(
      (task) =>
        task.completed
    ).length

  return (
    <>
      <OverflowPanel
        student={student}
        rows={overflow}
        toggleTask={
          toggleTask
        }
      />

      <div className="todayHeading">
        <div>
          <small>
            {(
              plan?.phase ||
              'STUDY PLAN'
            ).toUpperCase()}
          </small>

          <h2>
            {formatDate(
              date,
              true,
              true
            )}
          </h2>

          <p>
            Questions → deep
            review → targeted
            repair → Anki →
            recall.
          </p>
        </div>

        <div className="todayMetrics">
          <span>
            <small>
              PLANNED
            </small>

            <b>
              {fmtMin(
                sumMinutes(
                  realTasks
                )
              )}
            </b>
          </span>

          <span>
            <small>
              DONE
            </small>

            <b>
              {completed}/
              {
                realTasks.length
              }
            </b>
          </span>

          <span>
            <small>
              OVERFLOW
            </small>

            <b>
              {fmtMin(
                sumMinutes(
                  overflow
                )
              )}
            </b>
          </span>
        </div>
      </div>

      <ProgressCard
        percent={
          progressPercent(
            realTasks
          )
        }
        completed={
          completed
        }
        total={
          realTasks.length
        }
        minutes={
          sumMinutes(
            realTasks
          )
        }
      />

      <div className="dashboardGrid">
        <div className="card">
          <div className="sectionTitle">
            <div>
              <small>
                TODAY'S
                CHECKLIST
              </small>

              <h2>
                {student}'s
                Work
              </h2>
            </div>

            <span>
              {plan?.phase}
            </span>
          </div>

          <div className="taskList">
            {realTasks.length ? (
              realTasks.map(
                (task) => (
                  <TaskRow
                    key={
                      task.id ||
                      task._key
                    }
                    task={
                      task
                    }
                    toggleTask={
                      toggleTask
                    }
                  />
                )
              )
            ) : (
              <p className="empty">
                No scheduled
                tasks.
              </p>
            )}
          </div>
        </div>

        <Pomodoro
          student={
            student
          }
          logSession={
            logSession
          }
        />
      </div>
    </>
  )
}

/*
  HAMZAH DASHBOARD
*/

function HamzahDashboard({
  date,
  plan,
  tasks,
  overflow,
  currentChapter,
  chapterProgress,
  toggleTask,
  logSession,
}) {
  const realTasks =
    tasks.filter(
      (task) =>
        task.task_type !==
        'Chapter'
    )

  const chapterTasks =
    tasks.filter(
      (task) =>
        task.task_type ===
        'Chapter'
    )

  const completed =
    realTasks.filter(
      (task) =>
        task.completed
    ).length

  return (
    <>
      <OverflowPanel
        student="Hamzah"
        rows={overflow}
        toggleTask={
          toggleTask
        }
      />

      <div className="card hamxahHero">
        <div className="contentHero">
          <div>
            <small>
              {(
                plan?.phase ||
                'CONTENT + QUESTIONS'
              ).toUpperCase()}
            </small>

            <h2>
              {plan?.study_phase ||
                plan?.phase ||
                'Hamzah MCAT Plan'}
            </h2>

            <p>
              Kaplan chapters
              advance by actual
              completion, not
              calendar date.
            </p>
          </div>

          <div className="chapterCounter">
            <b>
              {
                chapterProgress.completed
              }
            </b>

            <span>
              {' '}
              /{' '}
              {
                chapterProgress.total
              }
            </span>
          </div>
        </div>

        <div className="activeChapterCard">
          <small>
            CURRENT KAPLAN
            CHAPTER
          </small>

          <h2>
            {currentChapter
              ? `${currentChapter.subject} Ch. ${currentChapter.chapter}`
              : 'Kaplan Content'}
          </h2>

          <p>
            {currentChapter
              ?.title ||
              'Follow today’s scheduled content work.'}
          </p>
        </div>
      </div>

      <div className="todayHeading">
        <div>
          <small>
            {(
              plan?.phase ||
              'HAMZAH'
            ).toUpperCase()}
          </small>

          <h2>
            {formatDate(
              date,
              true,
              true
            )}
          </h2>

          <p>
            Target workload:{' '}
            {fmtMin(
              plan?.target_minutes ||
                sumMinutes(
                  realTasks
                )
            )}
            .
          </p>
        </div>

        <div className="todayMetrics">
          <span>
            <small>
              PLANNED
            </small>

            <b>
              {fmtMin(
                sumMinutes(
                  realTasks
                )
              )}
            </b>
          </span>

          <span>
            <small>
              DONE
            </small>

            <b>
              {completed}/
              {
                realTasks.length
              }
            </b>
          </span>

          <span>
            <small>
              OVERFLOW
            </small>

            <b>
              {fmtMin(
                sumMinutes(
                  overflow
                )
              )}
            </b>
          </span>
        </div>
      </div>

      <ProgressCard
        percent={
          progressPercent(
            realTasks
          )
        }
        completed={
          completed
        }
        total={
          realTasks.length
        }
        minutes={
          sumMinutes(
            realTasks
          )
        }
      />

      <div className="dashboardGrid">
        <div className="card">
          <div className="sectionTitle">
            <div>
              <small>
                TODAY'S
                CHECKLIST
              </small>

              <h2>
                Hamzah's Work
              </h2>
            </div>

            <span>
              {plan?.phase}
            </span>
          </div>

          <div className="taskList">
            {realTasks.length ? (
              realTasks.map(
                (task) => (
                  <TaskRow
                    key={
                      task.id ||
                      task._key
                    }
                    task={
                      task
                    }
                    toggleTask={
                      toggleTask
                    }
                  />
                )
              )
            ) : (
              <p className="empty">
                No scheduled
                tasks.
              </p>
            )}
          </div>

          {!!chapterTasks.length && (
            <div className="chapterChecklist">
              <small>
                CHAPTER
                PROGRESSION
              </small>

              {chapterTasks.map(
                (task) => (
                  <TaskRow
                    key={
                      task.id ||
                      task._key
                    }
                    task={
                      task
                    }
                    toggleTask={
                      toggleTask
                    }
                  />
                )
              )}
            </div>
          )}
        </div>

        <Pomodoro
          student="Hamzah"
          logSession={
            logSession
          }
        />
      </div>
    </>
  )
}

/*
  OVERFLOW
*/

function OverflowPanel({
  student,
  rows,
  toggleTask,
}) {
  if (!rows.length) {
    return null
  }

  return (
    <div className="card overflowPanel">
      <div className="sectionTitle">
        <div>
          <small>
            {student.toUpperCase()}{' '}
            OVERFLOW
          </small>

          <h2>
            Carried Work
          </h2>
        </div>

        <strong>
          {fmtMin(
            sumMinutes(rows)
          )}
        </strong>
      </div>

      <div className="taskList">
        {rows.map(
          (task) => (
            <TaskRow
              key={task.id}
              task={task}
              toggleTask={
                toggleTask
              }
              overflow
            />
          )
        )}
      </div>
    </div>
  )
}

/*
  TASK ROW
*/

function TaskRow({
  task,
  toggleTask,
  overflow = false,
}) {
  return (
    <div
      className={[
        'task',

        task.completed
          ? 'completed'
          : '',

        overflow
          ? 'overflowTask'
          : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <button
        className={`taskCheck ${
          task.completed
            ? 'done'
            : ''
        }`}
        onClick={() =>
          toggleTask(task)
        }
      >
        {task.completed
          ? '✓'
          : ''}
      </button>

      <div className="taskBody">
        <small>
          {overflow
            ? `OVERFLOW • ${task.task_type}`
            : task.task_type}
        </small>

        <b>
          {task.title}
        </b>

        {task.description && (
          <span>
            {task.description}
          </span>
        )}

        <span>
          {Number(
            task.estimated_minutes
          ) > 0
            ? fmtMin(
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

/*
  PROGRESS
*/

function ProgressCard({
  percent,
  completed,
  total,
  minutes,
}) {
  return (
    <div className="card progressCard">
      <div>
        <b>
          Daily Progress
        </b>

        <span>
          {completed} of{' '}
          {total} tasks
          complete •{' '}
          {fmtMin(minutes)}{' '}
          planned
        </span>
      </div>

      <strong>
        {percent}%
      </strong>

      <div className="progress">
        <i
          style={{
            width: `${percent}%`,
          }}
        />
      </div>
    </div>
  )
}

/*
  POMODORO
*/

function Pomodoro({
  student,
  logSession,
}) {
  const [focus, setFocus] =
    useState(50)

  const [breakMinutes, setBreakMinutes] =
    useState(10)

  const [mode, setMode] =
    useState('Focus')

  const [seconds, setSeconds] =
    useState(3000)

  const [running, setRunning] =
    useState(false)

  const intervalRef =
    useRef(null)

  useEffect(() => {
    if (!running) {
      setSeconds(
        (mode === 'Focus'
          ? focus
          : breakMinutes) *
          60
      )
    }
  }, [
    mode,
    focus,
    breakMinutes,
    running,
  ])

  useEffect(() => {
    if (!running) {
      clearInterval(
        intervalRef.current
      )

      return
    }

    intervalRef.current =
      setInterval(() => {
        setSeconds(
          (current) => {
            if (current <= 1) {
              clearInterval(
                intervalRef.current
              )

              setRunning(false)

              if (
                mode ===
                'Focus'
              ) {
                logSession(
                  student,
                  focus,
                  'Pomodoro'
                )
              }

              return 0
            }

            return (
              current - 1
            )
          }
        )
      }, 1000)

    return () =>
      clearInterval(
        intervalRef.current
      )
  }, [
    running,
    mode,
    focus,
    student,
  ])

  const minutes =
    String(
      Math.floor(
        seconds / 60
      )
    ).padStart(2, '0')

  const secs =
    String(
      seconds % 60
    ).padStart(2, '0')

  return (
    <div className="card pomodoro">
      <div className="sectionTitle">
        <div>
          <small>
            {student.toUpperCase()}
          </small>

          <h2>
            Pomodoro
          </h2>
        </div>

        <span>
          {mode}
        </span>
      </div>

      <div className="timer">
        {minutes}:{secs}
      </div>

      <div className="timerModes">
        <button
          onClick={() => {
            setRunning(false)
            setMode('Focus')
          }}
        >
          Focus
        </button>

        <button
          onClick={() => {
            setRunning(false)
            setMode('Break')
          }}
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
            value={focus}
            onChange={(e) =>
              setFocus(
                Number(
                  e.target.value
                ) || 1
              )
            }
          />
        </label>

        <label>
          Break

          <input
            type="number"
            min="1"
            value={
              breakMinutes
            }
            onChange={(e) =>
              setBreakMinutes(
                Number(
                  e.target.value
                ) || 1
              )
            }
          />
        </label>
      </div>

      <button
        className="timerButton"
        onClick={() =>
          setRunning(
            (current) =>
              !current
          )
        }
      >
        {running
          ? 'Pause'
          : 'Start'}
      </button>
    </div>
  )
}

/*
  CALENDAR
*/

function CalendarView({
  tasks,
  selectedDate,
  chooseDate,
}) {
  const [monthOffset, setMonthOffset] =
    useState(0)

  const base =
    fromISO(selectedDate)

  const month =
    new Date(
      base.getFullYear(),
      base.getMonth() +
        monthOffset,
      1
    )

  const year =
    month.getFullYear()

  const monthIndex =
    month.getMonth()

  const lastDay =
    new Date(
      year,
      monthIndex + 1,
      0
    ).getDate()

  const dates =
    Array.from(
      {
        length:
          lastDay,
      },
      (_, index) =>
        localISO(
          new Date(
            year,
            monthIndex,
            index + 1
          )
        )
    )

  const currentChapter =
    getCurrentChapter(
      tasks
    )

  return (
    <div className="card">
      <div className="sectionTitle">
        <div>
          <small>
            STUDY CALENDAR
          </small>

          <h2>
            {month.toLocaleDateString(
              'en-US',
              {
                month:
                  'long',
                year:
                  'numeric',
              }
            )}
          </h2>
        </div>

        <div>
          <button
            className="secondary"
            onClick={() =>
              setMonthOffset(
                (current) =>
                  current - 1
              )
            }
          >
            ←
          </button>

          {' '}

          <button
            className="secondary"
            onClick={() =>
              setMonthOffset(
                (current) =>
                  current + 1
              )
            }
          >
            →
          </button>
        </div>
      </div>

      <div className="calendarGrid">
        {dates.map(
          (date) => {
            const expected = [
              ...expectedTasks(
                date,
                'Diya',
                currentChapter
              ),

              ...expectedTasks(
                date,
                'Hamzah',
                currentChapter
              ),
            ].filter(
              (task) =>
                task.task_type !==
                'Chapter'
            )

            const database =
              tasks.filter(
                (task) =>
                  task.task_date ===
                    date &&
                  task.source_type ===
                    SOURCE_TYPE
              )

            const displayed =
              mergeExpectedWithDatabase(
                expected,
                database
              )

            return (
              <button
                key={date}
                className={
                  date ===
                  localISO()
                    ? 'current'
                    : ''
                }
                onClick={() =>
                  chooseDate(
                    date
                  )
                }
              >
                <small>
                  {fromISO(
                    date
                  ).toLocaleDateString(
                    'en-US',
                    {
                      weekday:
                        'short',
                    }
                  )}
                </small>

                <b>
                  {fromISO(
                    date
                  ).getDate()}
                </b>

                <span>
                  {
                    displayed.filter(
                      (task) =>
                        task.completed
                    ).length
                  }
                  /
                  {
                    displayed.length
                  }
                </span>
              </button>
            )
          }
        )}
      </div>
    </div>
  )
}

/*
  QUESTIONS
*/

function QuestionsView({
  logs,
  addQuestionBlock,
}) {
  const [student, setStudent] =
    useState('Diya')

  const [date, setDate] =
    useState(localISO())

  const [source, setSource] =
    useState('UWorld')

  const [subject, setSubject] =
    useState('B/B')

  const [total, setTotal] =
    useState(20)

  const [correct, setCorrect] =
    useState(0)

  const [timed, setTimed] =
    useState(true)

  return (
    <div className="dashboardGrid">
      <form
        className="card form"
        onSubmit={(event) => {
          event.preventDefault()

          addQuestionBlock({
            student,
            date,
            source,
            subject,
            total,
            correct,
            timed,
          })
        }}
      >
        <div className="sectionTitle">
          <div>
            <small>
              QUESTION LOG
            </small>

            <h2>
              Add Practice
              Block
            </h2>
          </div>
        </div>

        <label>
          Student

          <select
            value={student}
            onChange={(e) =>
              setStudent(
                e.target.value
              )
            }
          >
            <option>
              Diya
            </option>

            <option>
              Hamzah
            </option>
          </select>
        </label>

        <label>
          Date

          <input
            type="date"
            value={date}
            onChange={(e) =>
              setDate(
                e.target.value
              )
            }
          />
        </label>

        <label>
          Resource

          <input
            value={source}
            onChange={(e) =>
              setSource(
                e.target.value
              )
            }
          />
        </label>

        <label>
          Section

          <input
            value={subject}
            onChange={(e) =>
              setSubject(
                e.target.value
              )
            }
          />
        </label>

        <label>
          Questions

          <input
            type="number"
            min="1"
            value={total}
            onChange={(e) =>
              setTotal(
                e.target.value
              )
            }
          />
        </label>

        <label>
          Correct

          <input
            type="number"
            min="0"
            value={correct}
            onChange={(e) =>
              setCorrect(
                e.target.value
              )
            }
          />
        </label>

        <label className="checkboxLabel">
          <input
            type="checkbox"
            checked={timed}
            onChange={(e) =>
              setTimed(
                e.target.checked
              )
            }
          />

          Timed
        </label>

        <button type="submit">
          Save Question
          Block
        </button>
      </form>

      <div className="card">
        <div className="sectionTitle">
          <div>
            <small>
              RECENT PRACTICE
            </small>

            <h2>
              Question
              History
            </h2>
          </div>
        </div>

        <div className="logList">
          {logs
            .slice(0, 30)
            .map((row) => {
              const total =
                Number(
                  row.total_questions
                ) || 0

              const correct =
                Number(
                  row.correct_questions
                ) || 0

              const accuracy =
                total
                  ? Math.round(
                      (correct /
                        total) *
                        100
                    )
                  : 0

              return (
                <div
                  className="logRow"
                  key={row.id}
                >
                  <div>
                    <small>
                      {formatDate(
                        row.question_date
                      )}{' '}
                      •{' '}
                      {
                        row.source
                      }
                    </small>

                    <b>
                      {
                        row.subject
                      }{' '}
                      •{' '}
                      {correct}/
                      {total}
                    </b>
                  </div>

                  <strong>
                    {accuracy}%
                  </strong>
                </div>
              )
            })}
        </div>
      </div>
    </div>
  )
}

/*
  FULL LENGTHS
*/

function FullLengthsView({
  rows,
  addFullLength,
}) {
  const [student, setStudent] =
    useState('Diya')

  const [date, setDate] =
    useState(localISO())

  const [name, setName] =
    useState('AAMC FL')

  const [cp, setCp] =
    useState(125)

  const [cars, setCars] =
    useState(125)

  const [bb, setBb] =
    useState(125)

  const [ps, setPs] =
    useState(125)

  return (
    <div className="dashboardGrid">
      <form
        className="card form"
        onSubmit={(event) => {
          event.preventDefault()

          addFullLength({
            student,
            date,
            name,
            cp,
            cars,
            bb,
            ps,
          })
        }}
      >
        <div className="sectionTitle">
          <div>
            <small>
              FULL LENGTH
            </small>

            <h2>
              Log Score
            </h2>
          </div>
        </div>

        <label>
          Student

          <select
            value={student}
            onChange={(e) =>
              setStudent(
                e.target.value
              )
            }
          >
            <option>
              Diya
            </option>

            <option>
              Hamzah
            </option>
          </select>
        </label>

        <label>
          Date

          <input
            type="date"
            value={date}
            onChange={(e) =>
              setDate(
                e.target.value
              )
            }
          />
        </label>

        <label>
          Exam

          <input
            value={name}
            onChange={(e) =>
              setName(
                e.target.value
              )
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
            onChange={(e) =>
              setCp(
                e.target.value
              )
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
            onChange={(e) =>
              setCars(
                e.target.value
              )
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
            onChange={(e) =>
              setBb(
                e.target.value
              )
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
            onChange={(e) =>
              setPs(
                e.target.value
              )
            }
          />
        </label>

        <button type="submit">
          Save Full
          Length
        </button>
      </form>

      <div className="card">
        <div className="sectionTitle">
          <div>
            <small>
              SCORE HISTORY
            </small>

            <h2>
              Full Lengths
            </h2>
          </div>
        </div>

        <div className="flList">
          {rows.map(
            (row) => (
              <div
                className="flRow"
                key={row.id}
              >
                <div>
                  <small>
                    {formatDate(
                      row.exam_date
                    )}
                  </small>

                  <b>
                    {
                      row.exam_name
                    }
                  </b>

                  <span>
                    C/P{' '}
                    {
                      row.cp_score
                    }{' '}
                    • CARS{' '}
                    {
                      row.cars_score
                    }{' '}
                    • B/B{' '}
                    {
                      row.bb_score
                    }{' '}
                    • P/S{' '}
                    {
                      row.ps_score
                    }
                  </span>
                </div>

                <strong>
                  {
                    row.total_score
                  }
                </strong>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  )
}

/*
  TOGETHER
*/

function TogetherView({
  sessions,
}) {
  const dates =
    config.shared
      ?.full_length_dates ||
    []

  return (
    <div className="dashboardGrid">
      <div className="card">
        <div className="sectionTitle">
          <div>
            <small>
              FULL LENGTH
              PLAN
            </small>

            <h2>
              Scheduled
              Exams
            </h2>
          </div>
        </div>

        <div className="partnerList">
          {dates.map(
            (date, index) => (
              <div
                className="partnerRow"
                key={date}
              >
                <div>
                  <small>
                    FULL LENGTH{' '}
                    {index + 1}
                  </small>

                  <b>
                    {formatDate(
                      date,
                      true,
                      true
                    )}
                  </b>
                </div>
              </div>
            )
          )}
        </div>
      </div>

      <div className="card">
        <div className="sectionTitle">
          <div>
            <small>
              FOCUS TIME
            </small>

            <h2>
              Recent
              Sessions
            </h2>
          </div>
        </div>

        <div className="logList">
          {sessions
            .slice(0, 20)
            .map((row) => (
              <div
                className="logRow"
                key={row.id}
              >
                <div>
                  <small>
                    {formatDate(
                      row.session_date
                    )}
                  </small>

                  <b>
                    {
                      row.session_type
                    }
                  </b>
                </div>

                <strong>
                  {fmtMin(
                    row.actual_minutes
                  )}
                </strong>
              </div>
            ))}
        </div>
      </div>
    </div>
  )
}

/*
  ANALYTICS
*/

function AnalyticsView({
  tasks,
  questionLogs,
  fullLengths,
  sessions,
  chapterProgress,
}) {
  const diya =
    tasks.filter(
      (task) =>
        task.student_name ===
          'Diya' &&
        task.task_type !==
          'Chapter'
    )

  const hamzah =
    tasks.filter(
      (task) =>
        task.student_name ===
          'Hamzah' &&
        task.task_type !==
          'Chapter'
    )

  const totalQuestions =
    questionLogs.reduce(
      (total, row) =>
        total +
        (Number(
          row.total_questions
        ) || 0),
      0
    )

  const correctQuestions =
    questionLogs.reduce(
      (total, row) =>
        total +
        (Number(
          row.correct_questions
        ) || 0),
      0
    )

  const focusMinutes =
    sessions.reduce(
      (total, row) =>
        total +
        (Number(
          row.actual_minutes
        ) || 0),
      0
    )

  const diyaPercent =
    diya.length
      ? Math.round(
          (diya.filter(
            (task) =>
              task.completed
          ).length /
            diya.length) *
            100
        )
      : 0

  const hamzahPercent =
    hamzah.length
      ? Math.round(
          (hamzah.filter(
            (task) =>
              task.completed
          ).length /
            hamzah.length) *
            100
        )
      : 0

  const accuracy =
    totalQuestions
      ? Math.round(
          (correctQuestions /
            totalQuestions) *
            100
        )
      : 0

  const bestFullLength =
    fullLengths.length
      ? Math.max(
          ...fullLengths.map(
            (row) =>
              Number(
                row.total_score
              ) || 0
          )
        )
      : '—'

  return (
    <div className="analyticsGrid">
      <Metric
        label="DIYA COMPLETION"
        value={`${diyaPercent}%`}
        subtext={`${
          diya.filter(
            (task) =>
              task.completed
          ).length
        }/${diya.length} tasks`}
      />

      <Metric
        label="HAMZAH COMPLETION"
        value={`${hamzahPercent}%`}
        subtext={`${
          hamzah.filter(
            (task) =>
              task.completed
          ).length
        }/${hamzah.length} tasks`}
      />

      <Metric
        label="HAMZAH KAPLAN"
        value={`${chapterProgress.completed}/${chapterProgress.total}`}
        subtext="chapters completed"
      />

      <Metric
        label="QUESTIONS LOGGED"
        value={
          totalQuestions
        }
        subtext={`${accuracy}% accuracy`}
      />

      <Metric
        label="FOCUS TIME"
        value={fmtMin(
          focusMinutes
        )}
        subtext={`${sessions.length} sessions`}
      />

      <Metric
        label="BEST FL"
        value={
          bestFullLength
        }
        subtext={`${fullLengths.length} exams logged`}
      />
    </div>
  )
}

function Metric({
  label,
  value,
  subtext,
}) {
  return (
    <div className="card statCard">
      <small>
        {label}
      </small>

      <b>{value}</b>

      <span>
        {subtext}
      </span>
    </div>
  )
}
