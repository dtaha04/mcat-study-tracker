'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import schedule from '../data/schedule.json'

/* =========================================================
   HELPERS
   ========================================================= */

const fmt = (date) =>
  new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })

const todayISO = () => new Date().toLocaleDateString('en-CA')

const PLAN_START = schedule[0]?.date || '2026-09-19'

const hoursText = (minutes) => {
  const total = Number(minutes) || 0
  const h = Math.floor(total / 60)
  const m = total % 60

  if (h > 0) {
    return `${h}h${m ? ` ${m}m` : ''}`
  }

  return `${m}m`
}

/* =========================================================
   BUILD TASKS FROM SCHEDULE.JSON
   ========================================================= */

const TASKS = (r) => {
  const tasks = []

  if (r.anki && !/none|rest/i.test(r.anki)) {
    tasks.push({
      type: 'Anki',
      title: r.anki,
      resource: 'Anki',
      minutes: Number(r.anki_minutes) || 35,
    })
  }

  if (Number(r.questions) > 0) {
    tasks.push({
      type: 'Questions',
      title: `${r.questions} ${
        r.question_subject || 'MCAT'
      } questions — timed + full review`,
      resource: r.source || 'Question Bank',
      minutes:
        Number(r.question_minutes) ||
        Math.max(30, Number(r.questions) * 3),
    })
  }

  if (Number(r.cars) > 0) {
    tasks.push({
      type: 'CARS',
      title: `${r.cars} CARS passage${
        Number(r.cars) === 1 ? '' : 's'
      } — timed + review`,
      resource: r.cars_source || 'CARS',
      minutes:
        Number(r.cars_minutes) ||
        Number(r.cars) * 20,
    })
  }

  if (r.recall && !/none|rest/i.test(r.recall)) {
    tasks.push({
      type: 'Content',
      title: r.recall,
      resource: 'Daily Recall',
      minutes: Number(r.recall_minutes) || 20,
    })
  }

  if (r.content && !/none|rest/i.test(r.content)) {
    tasks.push({
      type: 'Content',
      title: r.content,
      resource: 'Targeted Repair',
      minutes: Number(r.content_minutes) || 25,
    })
  }

  if (!tasks.length) {
    tasks.push({
      type: 'Rest',
      title:
        r.assignment ||
        'Recovery / no scheduled studying',
      resource: 'Plan',
      minutes: 0,
    })
  }

  return tasks
}

/* =========================================================
   APP
   ========================================================= */

export default function Home() {
  /* ---------- AUTH ---------- */

  const [session, setSession] = useState(null)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const [authMode, setAuthMode] =
    useState('signin')

  const [authLoading, setAuthLoading] =
    useState(false)

  const [loading, setLoading] =
    useState(true)

  const [msg, setMsg] =
    useState('')

  /* ---------- APP ---------- */

  const [tab, setTab] =
    useState('Today')

  const [selected, setSelected] =
    useState(todayISO())

  const [tasks, setTasks] =
    useState([])

  const [days, setDays] =
    useState([])

  const [qlogs, setQlogs] =
    useState([])

  const [fls, setFls] =
    useState([])

  const [sessions, setSessions] =
    useState([])

  /* ---------- TIMER ---------- */

  const [focusMin, setFocusMin] =
    useState(25)

  const [breakMin, setBreakMin] =
    useState(5)

  const [timerMode, setTimerMode] =
    useState('Focus')

  const [seconds, setSeconds] =
    useState(25 * 60)

  const [running, setRunning] =
    useState(false)

  const timerRef = useRef(null)

  /* =========================================================
     CURRENT SCHEDULE DAY
     ========================================================= */

  const planned = useMemo(() => {
    return (
      schedule.find(
        (x) => x.date === selected
      ) || null
    )
  }, [selected])

  /* =========================================================
     SELECTED DAY TASKS
     ========================================================= */

  const selectedTasks = useMemo(() => {
    return tasks
      .filter(
        (task) =>
          task.task_date === selected
      )
      .sort(
        (a, b) =>
          (a.sort_order || 0) -
          (b.sort_order || 0)
      )
  }, [tasks, selected])

  const completed =
    selectedTasks.filter(
      (task) => task.completed
    ).length

  const pct =
    selectedTasks.length > 0
      ? Math.round(
          (completed /
            selectedTasks.length) *
            100
        )
      : 0

  const plannedMinutes =
    selectedTasks.reduce(
      (sum, task) =>
        sum +
        (Number(
          task.estimated_minutes
        ) || 0),
      0
    )

  const actualMinutes =
    sessions
      .filter(
        (s) =>
          s.session_date === selected
      )
      .reduce(
        (sum, s) =>
          sum +
          (Number(
            s.actual_minutes
          ) || 0),
        0
      )

  /* =========================================================
     WEEK
     ========================================================= */

  const weekDates = useMemo(() => {
    const base = new Date(
      `${selected}T12:00:00`
    )

    const monday = new Date(base)

    const shift =
      (base.getDay() + 6) % 7

    monday.setDate(
      base.getDate() - shift
    )

    return Array.from(
      { length: 7 },
      (_, index) => {
        const date =
          new Date(monday)

        date.setDate(
          monday.getDate() + index
        )

        return date.toLocaleDateString(
          'en-CA'
        )
      }
    )
  }, [selected])

  const weekTasks =
    tasks.filter((task) =>
      weekDates.includes(
        task.task_date
      )
    )

  const weekCompleted =
    weekTasks.filter(
      (task) => task.completed
    ).length

  const weekPlanned =
    weekTasks.reduce(
      (sum, task) =>
        sum +
        (Number(
          task.estimated_minutes
        ) || 0),
      0
    )

  const weekActual =
    sessions
      .filter((s) =>
        weekDates.includes(
          s.session_date
        )
      )
      .reduce(
        (sum, s) =>
          sum +
          (Number(
            s.actual_minutes
          ) || 0),
        0
      )

  /* =========================================================
     AUTH INITIALIZATION
     ========================================================= */

  useEffect(() => {
    if (!supabase) {
      setMsg(
        'Supabase is not configured.'
      )

      setLoading(false)

      return
    }

    let mounted = true

    async function getSession() {
      const {
        data,
        error,
      } =
        await supabase.auth.getSession()

      if (!mounted) return

      if (error) {
        setMsg(error.message)
      }

      setSession(
        data?.session || null
      )

      setLoading(false)
    }

    getSession()

    const {
      data: { subscription },
    } =
      supabase.auth.onAuthStateChange(
        (_event, newSession) => {
          if (mounted) {
            setSession(newSession)
          }
        }
      )

    return () => {
      mounted = false

      subscription.unsubscribe()
    }
  }, [])

  /* =========================================================
     LOAD USER DATA + REPAIR SCHEDULE
     ========================================================= */

  useEffect(() => {
    if (!session) return

    let cancelled = false
    let channel = null

    async function initialize() {
      await syncSchedule()

      if (cancelled) return

      await loadAll()

      if (cancelled) return

      channel = supabase
        .channel(
          `daily-task-changes-${session.user.id}`
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'daily_tasks',
            filter:
              `user_id=eq.${session.user.id}`,
          },
          () => {
            loadAll()
          }
        )
        .subscribe()
    }

    initialize()

    return () => {
      cancelled = true

      if (channel) {
        supabase.removeChannel(
          channel
        )
      }
    }
  }, [session])

  /* =========================================================
     TIMER
     ========================================================= */

  useEffect(() => {
    if (!running) return

    timerRef.current =
      setInterval(() => {
        setSeconds(
          (current) => {
            if (current <= 1) {
              clearInterval(
                timerRef.current
              )

              setRunning(false)

              if (
                timerMode ===
                'Focus'
              ) {
                logSession(
                  focusMin
                )
              }

              const nextMode =
                timerMode ===
                'Focus'
                  ? 'Break'
                  : 'Focus'

              setTimerMode(
                nextMode
              )

              return (
                (nextMode ===
                'Focus'
                  ? focusMin
                  : breakMin) *
                60
              )
            }

            return current - 1
          }
        )
      }, 1000)

    return () => {
      clearInterval(
        timerRef.current
      )
    }
  }, [
    running,
    timerMode,
    focusMin,
    breakMin,
  ])

  /* =========================================================
     SAFE FULL-SCHEDULE SYNC

     IMPORTANT:
     - checks EVERY date
     - repairs MANY missing dates
     - repairs partially seeded dates
     - does NOT delete completed tasks
     - does NOT reset progress
     ========================================================= */

  async function syncSchedule() {
    if (!session) return

    const uid =
      session.user.id

    setMsg(
      'Checking study schedule...'
    )

    /* ---------- GET EXISTING DAYS ---------- */

    const {
      data: existingDays,
      error: daysError,
    } = await supabase
      .from('study_days')
      .select('*')
      .eq('user_id', uid)
      .gte(
        'study_date',
        PLAN_START
      )

    if (daysError) {
      setMsg(
        `Schedule check failed: ${daysError.message}`
      )

      return
    }

    /* ---------- GET EXISTING TASKS ---------- */

    const {
      data: existingTasks,
      error: tasksError,
    } = await supabase
      .from('daily_tasks')
      .select('*')
      .eq('user_id', uid)
      .gte(
        'task_date',
        PLAN_START
      )

    if (tasksError) {
      setMsg(
        `Schedule check failed: ${tasksError.message}`
      )

      return
    }

    const dayList = [
      ...(existingDays || []),
    ]

    const taskList = [
      ...(existingTasks || []),
    ]

    let addedDays = 0
    let addedTasks = 0

    /* =====================================================
       CHECK EVERY DATE IN SCHEDULE.JSON
       ===================================================== */

    for (const r of schedule) {
      /* ---------- FIND STUDY DAY ---------- */

      let day =
        dayList.find(
          (d) =>
            d.study_date ===
            r.date
        )

      /* ---------- CREATE MISSING STUDY DAY ---------- */

      if (!day) {
        const isFL =
          /full.?length/i.test(
            `${
              r.assignment || ''
            } ${
              r.source || ''
            }`
          )

        const {
          data: newDay,
          error: dayError,
        } = await supabase
          .from('study_days')
          .insert({
            user_id: uid,

            study_date:
              r.date,

            phase:
              r.phase ||
              'Study',

            planned_hours:
              Number(
                r.hours
              ) || 0,

            is_rest_day:
              Number(
                r.hours
              ) === 0,

            is_full_length_day:
              isFL,
          })
          .select()
          .single()

        if (dayError) {
          setMsg(
            `Could not repair ${r.date}: ${dayError.message}`
          )

          return
        }

        day = newDay

        dayList.push(
          newDay
        )

        addedDays++
      }

      /* ---------- EXPECTED TASKS ---------- */

      const expectedTasks =
        TASKS(r)

      const dateTasks =
        taskList.filter(
          (task) =>
            task.task_date ===
            r.date
        )

      /* ===================================================
         CHECK EVERY TASK FOR THIS DATE
         =================================================== */

      for (
        let index = 0;
        index <
        expectedTasks.length;
        index++
      ) {
        const expected =
          expectedTasks[index]

        const alreadyExists =
          dateTasks.some(
            (existing) =>
              existing.task_type ===
                expected.type &&
              existing.resource ===
                expected.resource &&
              existing.title ===
                expected.title
          )

        /* KEEP EXISTING TASK */

        if (alreadyExists) {
          continue
        }

        /* ---------- ADD MISSING TASK ---------- */

        const {
          data: newTask,
          error: taskError,
        } = await supabase
          .from('daily_tasks')
          .insert({
            user_id: uid,

            study_day_id:
              day.id,

            task_date:
              r.date,

            task_type:
              expected.type,

            title:
              expected.title,

            description:
              r.notes ||
              r.assignment ||
              '',

            resource:
              expected.resource,

            estimated_minutes:
              expected.minutes,

            sort_order:
              index + 1,

            completed: false,

            completed_at: null,
          })
          .select()
          .single()

        if (taskError) {
          setMsg(
            `Could not repair tasks for ${r.date}: ${taskError.message}`
          )

          return
        }

        taskList.push(
          newTask
        )

        dateTasks.push(
          newTask
        )

        addedTasks++
      }
    }

    /* ---------- FINISHED ---------- */

    if (
      addedDays === 0 &&
      addedTasks === 0
    ) {
      setMsg('')
    } else {
      setMsg(
        `Schedule repaired — ${addedDays} missing days and ${addedTasks} missing tasks restored.`
      )
    }
  }

  /* =========================================================
     LOAD DATABASE
     ========================================================= */

  async function loadAll() {
    if (!session) return

    const uid =
      session.user.id

    const [
      taskResult,
      dayResult,
      questionResult,
      flResult,
      sessionResult,
    ] =
      await Promise.all([
        supabase
          .from(
            'daily_tasks'
          )
          .select('*')
          .eq(
            'user_id',
            uid
          )
          .order(
            'task_date'
          )
          .order(
            'sort_order'
          ),

        supabase
          .from(
            'study_days'
          )
          .select('*')
          .eq(
            'user_id',
            uid
          )
          .order(
            'study_date'
          ),

        supabase
          .from(
            'question_blocks'
          )
          .select('*')
          .eq(
            'user_id',
            uid
          )
          .order(
            'question_date',
            {
              ascending:
                false,
            }
          )
          .limit(100),

        supabase
          .from(
            'full_length_scores'
          )
          .select('*')
          .eq(
            'user_id',
            uid
          )
          .order(
            'exam_date',
            {
              ascending:
                false,
            }
          ),

        supabase
          .from(
            'study_sessions'
          )
          .select('*')
          .eq(
            'user_id',
            uid
          )
          .order(
            'session_date',
            {
              ascending:
                false,
            }
          )
          .limit(500),
      ])

    const error =
      taskResult.error ||
      dayResult.error ||
      questionResult.error ||
      flResult.error ||
      sessionResult.error

    if (error) {
      setMsg(
        error.message
      )

      return
    }

    setTasks(
      taskResult.data || []
    )

    setDays(
      dayResult.data || []
    )

    setQlogs(
      questionResult.data || []
    )

    setFls(
      flResult.data || []
    )

    setSessions(
      sessionResult.data || []
    )
  }

  /* =========================================================
     COMPLETE / UNCOMPLETE TASK
     ========================================================= */

  async function toggle(task) {
    const newCompleted =
      !task.completed

    const {
      error,
    } = await supabase
      .from('daily_tasks')
      .update({
        completed:
          newCompleted,

        completed_at:
          newCompleted
            ? new Date().toISOString()
            : null,
      })
      .eq(
        'id',
        task.id
      )

    if (error) {
      setMsg(
        error.message
      )

      return
    }

    setTasks(
      (current) =>
        current.map(
          (t) =>
            t.id ===
            task.id
              ? {
                  ...t,

                  completed:
                    newCompleted,

                  completed_at:
                    newCompleted
                      ? new Date().toISOString()
                      : null,
                }
              : t
        )
    )
  }

  /* =========================================================
     LOG POMODORO
     ========================================================= */

  async function logSession(
    minutes
  ) {
    if (
      !session ||
      !minutes
    ) {
      return
    }

    const {
      error,
    } = await supabase
      .from(
        'study_sessions'
      )
      .insert({
        user_id:
          session.user.id,

        session_date:
          todayISO(),

        actual_minutes:
          minutes,

        planned_minutes:
          minutes,

        session_type:
          'Pomodoro',

        ended_at:
          new Date().toISOString(),
      })

    if (error) {
      setMsg(
        error.message
      )

      return
    }

    await loadAll()
  }

  /* =========================================================
     QUESTION LOG
     ========================================================= */

  async function addQuestions(
    e
  ) {
    e.preventDefault()

    const form =
      new FormData(
        e.currentTarget
      )

    const total =
      Number(
        form.get('total')
      )

    const correct =
      Number(
        form.get('correct')
      )

    const {
      error,
    } = await supabase
      .from(
        'question_blocks'
      )
      .insert({
        user_id:
          session.user.id,

        question_date:
          form.get('date'),

        source:
          form.get('source'),

        subject:
          form.get('subject'),

        total_questions:
          total,

        correct_questions:
          correct,

        timed:
          form.get(
            'timed'
          ) === 'on',
      })

    if (error) {
      setMsg(
        error.message
      )

      return
    }

    e.currentTarget.reset()

    await loadAll()
  }

  /* =========================================================
     FULL LENGTH LOG
     ========================================================= */

  async function addFL(e) {
    e.preventDefault()

    const form =
      new FormData(
        e.currentTarget
      )

    const cp =
      Number(
        form.get('cp')
      )

    const cars =
      Number(
        form.get('cars')
      )

    const bb =
      Number(
        form.get('bb')
      )

    const ps =
      Number(
        form.get('ps')
      )

    const {
      error,
    } = await supabase
      .from(
        'full_length_scores'
      )
      .insert({
        user_id:
          session.user.id,

        exam_date:
          form.get('date'),

        exam_name:
          form.get('name'),

        cp_score:
          cp,

        cars_score:
          cars,

        bb_score:
          bb,

        ps_score:
          ps,

        total_score:
          cp +
          cars +
          bb +
          ps,
      })

    if (error) {
      setMsg(
        error.message
      )

      return
    }

    e.currentTarget.reset()

    await loadAll()
  }

  /* =========================================================
     LOGIN / SIGNUP
     ========================================================= */

  async function auth(e) {
    e.preventDefault()

    setMsg('')
    setAuthLoading(true)

    try {
      let result

      if (
        authMode ===
        'signin'
      ) {
        result =
          await supabase.auth.signInWithPassword(
            {
              email:
                email.trim(),

              password,
            }
          )
      } else {
        result =
          await supabase.auth.signUp(
            {
              email:
                email.trim(),

              password,
            }
          )
      }

      if (result.error) {
        setMsg(
          result.error.message
        )

        return
      }

      if (
        result.data
          ?.session
      ) {
        setSession(
          result.data.session
        )
      } else if (
        authMode ===
        'signup'
      ) {
        setMsg(
          'Account created. Check your email if confirmation is required.'
        )
      }
    } catch (error) {
      setMsg(
        error?.message ||
          'Unable to sign in.'
      )
    } finally {
      setAuthLoading(false)
    }
  }

  /* =========================================================
     TIMER CONTROLS
     ========================================================= */

  function setTimer(kind) {
    setRunning(false)

    setTimerMode(kind)

    setSeconds(
      (kind === 'Focus'
        ? focusMin
        : breakMin) *
        60
    )
  }

  /* =========================================================
     LOADING
     ========================================================= */

  if (loading) {
    return (
      <main className="auth">
        <div className="card">
          Loading…
        </div>
      </main>
    )
  }

  /* =========================================================
     LOGIN SCREEN
     ========================================================= */

  if (!session) {
    return (
      <main className="auth">
        <form
          className="card authCard"
          onSubmit={auth}
        >
          <h1>
            MCAT Study Tracker
          </h1>

          <p>
            January 21, 2027 plan
          </p>

          <input
            type="email"
            placeholder="Email"
            autoComplete="email"
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
            autoComplete="current-password"
            value={password}
            onChange={(e) =>
              setPassword(
                e.target.value
              )
            }
            required
          />

          <button
            type="submit"
            disabled={
              authLoading
            }
          >
            {authLoading
              ? 'Signing in...'
              : authMode ===
                'signin'
              ? 'Sign in'
              : 'Create account'}
          </button>

          <button
            type="button"
            className="secondary"
            disabled={
              authLoading
            }
            onClick={() => {
              setMsg('')

              setAuthMode(
                (current) =>
                  current ===
                  'signin'
                    ? 'signup'
                    : 'signin'
              )
            }}
          >
            {authMode ===
            'signin'
              ? 'Need an account?'
              : 'Already have an account?'}
          </button>

          {msg && (
            <p className="message">
              {msg}
            </p>
          )}
        </form>
      </main>
    )
  }

  /* =========================================================
     COUNTDOWN
     ========================================================= */

  const testDate =
    new Date(
      '2027-01-21T12:00:00'
    )

  const now =
    new Date()

  const countdown =
    Math.max(
      0,
      Math.ceil(
        (testDate - now) /
          (1000 *
            60 *
            60 *
            24)
      )
    )

  /* =========================================================
     APP UI
     ========================================================= */

  return (
    <div className="shell">

      {/* =====================================================
          SIDEBAR
          ===================================================== */}

      <aside className="aside">
        <div className="logo">
          <span>λ</span>

          <div>
            <b>MCAT</b>
            <small>
              STUDY TRACKER
            </small>
          </div>
        </div>

        <nav>
          {[
            'Today',
            'Calendar',
            'Questions',
            'Full Lengths',
            'Analytics',
          ].map((item) => (
            <button
              key={item}
              className={
                tab === item
                  ? 'active'
                  : ''
              }
              onClick={() =>
                setTab(item)
              }
            >
              {item}
            </button>
          ))}
        </nav>

        <div className="sideExam">
          <small>
            TEST DAY
          </small>

          <b>
            JAN 21
          </b>

          <span>
            2027
          </span>
        </div>

        <button
          className="secondary"
          onClick={() =>
            supabase.auth.signOut()
          }
        >
          Sign out
        </button>
      </aside>

      {/* =====================================================
          MAIN
          ===================================================== */}

      <main className="content">

        <header className="header">
          <div>
            <h1>
              {tab}
            </h1>

            <p>
              {planned?.phase ||
                'MCAT preparation'}
            </p>
          </div>

          <div className="countdown">
            <b>
              {countdown}
            </b>

            <span>
              days to MCAT
            </span>
          </div>
        </header>

        {msg && (
          <div className="message">
            {msg}
          </div>
        )}

        {/* ===================================================
            TODAY
            =================================================== */}

        {tab === 'Today' && (
          <>
            <section className="card weekSummary">

              <div className="weekTitle">
                <div>
                  <small>
                    THIS WEEK
                  </small>

                  <h2>
                    Weekly Summary
                  </h2>
                </div>

                <div className="weekStats">
                  <span>
                    <b>
                      {weekCompleted}
                    </b>

                    {` / ${weekTasks.length} tasks`}
                  </span>

                  <span>
                    <b>
                      {hoursText(
                        weekActual
                      )}
                    </b>

                    focused
                  </span>

                  <span>
                    <b>
                      {hoursText(
                        weekPlanned
                      )}
                    </b>

                    planned
                  </span>
                </div>
              </div>

              <div className="weekDays">
                {weekDates.map(
                  (date) => {
                    const dt =
                      tasks.filter(
                        (task) =>
                          task.task_date ===
                          date
                      )

                    const done =
                      dt.filter(
                        (task) =>
                          task.completed
                      ).length

                    return (
                      <button
                        key={date}
                        className={
                          selected ===
                          date
                            ? 'selected'
                            : ''
                        }
                        onClick={() =>
                          setSelected(
                            date
                          )
                        }
                      >
                        <small>
                          {new Date(
                            `${date}T12:00:00`
                          ).toLocaleDateString(
                            undefined,
                            {
                              weekday:
                                'short',
                            }
                          )}
                        </small>

                        <b>
                          {new Date(
                            `${date}T12:00:00`
                          ).getDate()}
                        </b>

                        <span>
                          {dt.length
                            ? `${done}/${dt.length}`
                            : '—'}
                        </span>
                      </button>
                    )
                  }
                )}
              </div>
            </section>

            {/* ---------- DAY TITLE ---------- */}

            <div className="todayHeading">
              <div>
                <small>
                  {fmt(
                    selected
                  ).toUpperCase()}
                </small>

                <h2>
                  {planned
                    ?.assignment ||
                    'Study Plan'}
                </h2>

                <p>
                  {planned?.notes ||
                    ''}
                </p>
              </div>

              <div className="todayMetrics">
                <span>
                  <small>
                    PLANNED
                  </small>

                  <b>
                    {hoursText(
                      plannedMinutes
                    )}
                  </b>
                </span>

                <span>
                  <small>
                    FOCUSED
                  </small>

                  <b>
                    {hoursText(
                      actualMinutes
                    )}
                  </b>
                </span>
              </div>
            </div>

            {/* ---------- PROGRESS ---------- */}

            <section className="card progressCard">
              <div>
                <b>
                  Daily progress
                </b>

                <span>
                  {completed} of{' '}
                  {
                    selectedTasks.length
                  }{' '}
                  complete
                </span>
              </div>

              <div className="progress">
                <i
                  style={{
                    width:
                      `${pct}%`,
                  }}
                />
              </div>

              <strong>
                {pct}%
              </strong>
            </section>

            {/* ---------- CHECKLIST + TIMER ---------- */}

            <div className="dashboardGrid">

              <section className="card">
                <div className="sectionTitle">
                  <h3>
                    Today's Checklist
                  </h3>

                  <span>
                    {
                      selectedTasks.length
                    }{' '}
                    tasks
                  </span>
                </div>

                <div className="taskList">
                  {selectedTasks.length >
                  0 ? (
                    selectedTasks.map(
                      (task) => (
                        <button
                          key={
                            task.id
                          }
                          className={`task ${
                            task.completed
                              ? 'done'
                              : ''
                          }`}
                          onClick={() =>
                            toggle(
                              task
                            )
                          }
                        >
                          <span className="taskCheck">
                            {task.completed
                              ? '✓'
                              : ''}
                          </span>

                          <span className="taskBody">
                            <small>
                              {
                                task.task_type
                              }{' '}
                              ·{' '}
                              {
                                task.resource
                              }
                            </small>

                            <b>
                              {
                                task.title
                              }
                            </b>

                            <em>
                              {
                                task.description
                              }
                            </em>
                          </span>

                          <span>
                            {task.estimated_minutes
                              ? `${task.estimated_minutes}m`
                              : ''}
                          </span>
                        </button>
                      )
                    )
                  ) : (
                    <p>
                      No tasks for this date.
                    </p>
                  )}
                </div>
              </section>

              {/* ---------- POMODORO ---------- */}

              <section className="card pomodoroCard">
                <div className="sectionTitle">
                  <h3>
                    Pomodoro
                  </h3>

                  <span>
                    {timerMode}
                  </span>
                </div>

                <div className="timerRing">
                  <div>
                    <b>
                      {String(
                        Math.floor(
                          seconds /
                            60
                        )
                      ).padStart(
                        2,
                        '0'
                      )}
                      :
                      {String(
                        seconds %
                          60
                      ).padStart(
                        2,
                        '0'
                      )}
                    </b>

                    <span>
                      {timerMode.toUpperCase()}
                    </span>
                  </div>
                </div>

                <div className="actions">
                  <button
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

                  <button
                    className="secondary"
                    onClick={() =>
                      setTimer(
                        timerMode
                      )
                    }
                  >
                    Reset
                  </button>
                </div>

                <div className="timerFooter">
                  <label>
                    Focus

                    <input
                      type="number"
                      min="1"
                      value={
                        focusMin
                      }
                      onChange={(
                        e
                      ) => {
                        const value =
                          Number(
                            e.target
                              .value
                          ) || 25

                        setFocusMin(
                          value
                        )

                        if (
                          !running &&
                          timerMode ===
                            'Focus'
                        ) {
                          setSeconds(
                            value *
                              60
                          )
                        }
                      }}
                    />
                  </label>

                  <label>
                    Break

                    <input
                      type="number"
                      min="1"
                      value={
                        breakMin
                      }
                      onChange={(
                        e
                      ) => {
                        const value =
                          Number(
                            e.target
                              .value
                          ) || 5

                        setBreakMin(
                          value
                        )

                        if (
                          !running &&
                          timerMode ===
                            'Break'
                        ) {
                          setSeconds(
                            value *
                              60
                          )
                        }
                      }}
                    />
                  </label>
                </div>

                <div className="actions">
                  <button
                    className="secondary"
                    onClick={() =>
                      setTimer(
                        'Focus'
                      )
                    }
                  >
                    Focus
                  </button>

                  <button
                    className="secondary"
                    onClick={() =>
                      setTimer(
                        'Break'
                      )
                    }
                  >
                    Break
                  </button>
                </div>
              </section>
            </div>
          </>
        )}

        {/* ===================================================
            CALENDAR
            =================================================== */}

        {tab ===
          'Calendar' && (
          <section className="card">
            <div className="sectionTitle">
              <h3>
                Plan Calendar
              </h3>

              <span>
                Sep 19 → Jan 21
              </span>
            </div>

            <div className="calendarList">
              {schedule.map(
                (r) => (
                  <button
                    key={
                      r.date
                    }
                    className={
                      selected ===
                      r.date
                        ? 'selectedRow'
                        : ''
                    }
                    onClick={() => {
                      setSelected(
                        r.date
                      )

                      setTab(
                        'Today'
                      )
                    }}
                  >
                    <span>
                      {fmt(
                        r.date
                      )}
                    </span>

                    <b>
                      {
                        r.phase
                      }
                    </b>

                    <em>
                      {
                        r.assignment
                      }
                    </em>

                    <strong>
                      {
                        r.hours
                      }
                      h
                    </strong>
                  </button>
                )
              )}
            </div>
          </section>
        )}

        {/* ===================================================
            QUESTIONS
            =================================================== */}

        {tab ===
          'Questions' && (
          <div className="dashboardGrid">

            <form
              className="card formCard"
              onSubmit={
                addQuestions
              }
            >
              <h3>
                Log Question Block
              </h3>

              <input
                name="date"
                type="date"
                defaultValue={
                  todayISO()
                }
                required
              />

              <input
                name="source"
                placeholder="Source (UWorld, AAMC…)"
                required
              />

              <input
                name="subject"
                placeholder="Subject (B/B, C/P, P/S, CARS)"
                required
              />

              <div className="formRow">
                <input
                  name="total"
                  type="number"
                  min="1"
                  placeholder="Total"
                  required
                />

                <input
                  name="correct"
                  type="number"
                  min="0"
                  placeholder="Correct"
                  required
                />
              </div>

              <label className="checkLabel">
                <input
                  name="timed"
                  type="checkbox"
                />

                Timed block
              </label>

              <button type="submit">
                Save block
              </button>
            </form>

            <section className="card">
              <h3>
                Recent Blocks
              </h3>

              <div className="logList">
                {qlogs.map(
                  (q) => (
                    <div
                      key={
                        q.id
                      }
                    >
                      <span>
                        {
                          q.question_date
                        }{' '}
                        ·{' '}
                        {
                          q.source
                        }{' '}
                        ·{' '}
                        {
                          q.subject
                        }
                      </span>

                      <b>
                        {
                          q.correct_questions
                        }
                        /
                        {
                          q.total_questions
                        }{' '}
                        ·{' '}
                        {Math.round(
                          (100 *
                            q.correct_questions) /
                            q.total_questions
                        )}
                        %
                      </b>
                    </div>
                  )
                )}
              </div>
            </section>
          </div>
        )}

        {/* ===================================================
            FULL LENGTHS
            =================================================== */}

        {tab ===
          'Full Lengths' && (
          <div className="dashboardGrid">

            <form
              className="card formCard"
              onSubmit={
                addFL
              }
            >
              <h3>
                Log Full Length
              </h3>

              <input
                name="date"
                type="date"
                defaultValue={
                  todayISO()
                }
                required
              />

              <input
                name="name"
                placeholder="Exam name"
                required
              />

              <div className="formRow">
                <input
                  name="cp"
                  type="number"
                  placeholder="C/P"
                  required
                />

                <input
                  name="cars"
                  type="number"
                  placeholder="CARS"
                  required
                />
              </div>

              <div className="formRow">
                <input
                  name="bb"
                  type="number"
                  placeholder="B/B"
                  required
                />

                <input
                  name="ps"
                  type="number"
                  placeholder="P/S"
                  required
                />
              </div>

              <button type="submit">
                Save score
              </button>
            </form>

            <section className="card">
              <h3>
                Full-Length Scores
              </h3>

              <div className="logList">
                {fls.map(
                  (f) => (
                    <div
                      key={
                        f.id
                      }
                    >
                      <span>
                        {
                          f.exam_date
                        }{' '}
                        ·{' '}
                        {
                          f.exam_name
                        }
                      </span>

                      <b>
                        {
                          f.total_score
                        }
                      </b>
                    </div>
                  )
                )}
              </div>
            </section>
          </div>
        )}

        {/* ===================================================
            ANALYTICS
            =================================================== */}

        {tab ===
          'Analytics' && (
          <div className="dashboardGrid">

            <section className="card">
              <h3>
                Study Time
              </h3>

              <div className="bigStat">
                {hoursText(
                  weekActual
                )}
              </div>

              <p>
                Focused this selected week
              </p>

              <div className="bigStat">
                {hoursText(
                  weekPlanned
                )}
              </div>

              <p>
                Planned this selected week
              </p>
            </section>

            <section className="card">
              <h3>
                Question Accuracy
              </h3>

              {qlogs.length >
              0 ? (
                <>
                  <div className="bigStat">
                    {Math.round(
                      (100 *
                        qlogs.reduce(
                          (
                            sum,
                            q
                          ) =>
                            sum +
                            Number(
                              q.correct_questions
                            ),
                          0
                        )) /
                        qlogs.reduce(
                          (
                            sum,
                            q
                          ) =>
                            sum +
                            Number(
                              q.total_questions
                            ),
                          0
                        )
                    )}
                    %
                  </div>

                  <p>
                    Across{' '}
                    {qlogs.reduce(
                      (
                        sum,
                        q
                      ) =>
                        sum +
                        Number(
                          q.total_questions
                        ),
                      0
                    )}{' '}
                    logged questions
                  </p>
                </>
              ) : (
                <p>
                  No question blocks logged yet.
                </p>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  )
}
