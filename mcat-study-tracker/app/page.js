'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import schedule from '../data/schedule.json'

const fmt = (d) =>
  new Date(`${d}T12:00:00`).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })

const todayISO = () => new Date().toLocaleDateString('en-CA')

const PLAN_START = schedule[0]?.date || '2026-09-19'

const TASKS = (r) => {
  const a = []

  if (r.anki && !/none|rest/i.test(r.anki)) {
    a.push({
      type: 'Anki',
      title: r.anki,
      resource: 'Anki',
      minutes: r.anki_minutes || 35,
    })
  }

  if (Number(r.questions) > 0) {
    a.push({
      type: 'Questions',
      title: `${r.questions} ${r.question_subject || 'MCAT'} questions — timed + full review`,
      resource: r.source || 'Question Bank',
      minutes:
        r.question_minutes ||
        Math.max(30, Number(r.questions) * 3),
    })
  }

  if (Number(r.cars) > 0) {
    a.push({
      type: 'CARS',
      title: `${r.cars} CARS passage${Number(r.cars) === 1 ? '' : 's'} — timed + review`,
      resource: r.cars_source || 'CARS',
      minutes: r.cars_minutes || Number(r.cars) * 20,
    })
  }

  if (r.recall && !/none/i.test(r.recall)) {
    a.push({
      type: 'Content',
      title: r.recall,
      resource: 'Daily Recall',
      minutes: r.recall_minutes || 20,
    })
  }

  if (r.content && !/none|rest/i.test(r.content)) {
    a.push({
      type: 'Content',
      title: r.content,
      resource: 'Targeted Repair',
      minutes: r.content_minutes || 25,
    })
  }

  if (!a.length) {
    a.push({
      type: 'Rest',
      title: r.assignment || 'Recovery / no scheduled studying',
      resource: 'Plan',
      minutes: 0,
    })
  }

  return a
}

const hoursText = (min) => {
  const h = Math.floor(min / 60)
  const m = min % 60

  return h
    ? `${h}h${m ? ` ${m}m` : ''}`
    : `${m}m`
}

export default function Home() {
  const [session, setSession] = useState(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authMode, setAuthMode] = useState('signin')
  const [msg, setMsg] = useState('')

  const [tab, setTab] = useState('Today')

  const [tasks, setTasks] = useState([])
  const [days, setDays] = useState([])
  const [selected, setSelected] = useState(todayISO())

  const [loading, setLoading] = useState(true)

  const [qlogs, setQlogs] = useState([])
  const [fls, setFls] = useState([])
  const [sessions, setSessions] = useState([])

  const [seconds, setSeconds] = useState(25 * 60)
  const [running, setRunning] = useState(false)
  const [focusMin, setFocusMin] = useState(25)
  const [breakMin, setBreakMin] = useState(5)
  const [timerMode, setTimerMode] = useState('Focus')

  const timerRef = useRef(null)

  const planned = useMemo(
    () =>
      schedule.find((x) => x.date === selected) ||
      schedule[0],
    [selected]
  )

  const selectedTasks = useMemo(
    () =>
      tasks
        .filter((t) => t.task_date === selected)
        .sort(
          (a, b) =>
            (a.sort_order || 0) -
            (b.sort_order || 0)
        ),
    [tasks, selected]
  )

  const completed = selectedTasks.filter(
    (t) => t.completed
  ).length

  const pct = selectedTasks.length
    ? Math.round(
        (completed / selectedTasks.length) * 100
      )
    : 0

  const plannedMinutes = selectedTasks.reduce(
    (s, t) =>
      s + (Number(t.estimated_minutes) || 0),
    0
  )

  const actualMinutes = sessions
    .filter((s) => s.session_date === selected)
    .reduce(
      (a, s) =>
        a + (Number(s.actual_minutes) || 0),
      0
    )

  const weekDates = useMemo(() => {
    const base = new Date(`${selected}T12:00:00`)
    const monday = new Date(base)

    const shift = (base.getDay() + 6) % 7

    monday.setDate(base.getDate() - shift)

    return Array.from({ length: 7 }, (_, i) => {
      const x = new Date(monday)

      x.setDate(monday.getDate() + i)

      return x.toLocaleDateString('en-CA')
    })
  }, [selected])

  const weekTasks = tasks.filter((t) =>
    weekDates.includes(t.task_date)
  )

  const weekCompleted = weekTasks.filter(
    (t) => t.completed
  ).length

  const weekPlanned = weekTasks.reduce(
    (s, t) =>
      s + (Number(t.estimated_minutes) || 0),
    0
  )

  const weekActual = sessions
    .filter((s) =>
      weekDates.includes(s.session_date)
    )
    .reduce(
      (a, s) =>
        a + (Number(s.actual_minutes) || 0),
      0
    )

  useEffect(() => {
    if (!supabase) {
      setMsg('Supabase is not configured.')
      setLoading(false)
      return
    }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(
      (_event, s) => {
        setSession(s)
      }
    )

    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) return

    let channel

    ;(async () => {
      await syncSchedule()
      await loadAll()

      channel = supabase
        .channel('daily-task-changes')
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'daily_tasks',
            filter: `user_id=eq.${session.user.id}`,
          },
          () => loadAll()
        )
        .subscribe()
    })()

    return () => {
      if (channel) {
        supabase.removeChannel(channel)
      }
    }
  }, [session])

  useEffect(() => {
    if (!running) return

    timerRef.current = setInterval(() => {
      setSeconds((s) => {
        if (s <= 1) {
          clearInterval(timerRef.current)

          setRunning(false)

          if (timerMode === 'Focus') {
            logSession(focusMin)
          }

          const next =
            timerMode === 'Focus'
              ? 'Break'
              : 'Focus'

          setTimerMode(next)

          return (
            (next === 'Focus'
              ? focusMin
              : breakMin) * 60
          )
        }

        return s - 1
      })
    }, 1000)

    return () =>
      clearInterval(timerRef.current)
  }, [
    running,
    timerMode,
    focusMin,
    breakMin,
  ])

  async function syncSchedule() {
    const uid = session.user.id

    const {
      data: marker,
      error: markerError,
    } = await supabase
      .from('daily_tasks')
      .select('id')
      .eq('user_id', uid)
      .eq('task_date', PLAN_START)
      .eq('resource', 'Daily Recall')
      .limit(1)

    if (markerError) {
      setMsg(markerError.message)
      return
    }

    if (marker?.length) return

    /*
      One-time migration.

      Only planned study_days and daily_tasks
      from September 19 forward are replaced.

      Question logs, Pomodoro sessions,
      full-length scores, and dates before
      September 19 are preserved.
    */

    let { error } = await supabase
      .from('daily_tasks')
      .delete()
      .eq('user_id', uid)
      .gte('task_date', PLAN_START)

    if (error) {
      setMsg(
        `Schedule sync stopped: ${error.message}`
      )
      return
    }

    ;({ error } = await supabase
      .from('study_days')
      .delete()
      .eq('user_id', uid)
      .gte('study_date', PLAN_START))

    if (error) {
      setMsg(
        `Schedule sync stopped: ${error.message}`
      )
      return
    }

    for (const r of schedule) {
      const isFL = /full.?length/i.test(
        `${r.assignment || ''} ${r.source || ''}`
      )

      const {
        data: day,
        error: dayError,
      } = await supabase
        .from('study_days')
        .insert({
          user_id: uid,
          study_date: r.date,
          phase: r.phase || 'Study',
          planned_hours:
            Number(r.hours) || 0,
          is_rest_day:
            Number(r.hours) === 0,
          is_full_length_day: isFL,
        })
        .select()
        .single()

      if (dayError) {
        setMsg(
          `Could not add ${r.date}: ${dayError.message}`
        )
        return
      }

      const rows = TASKS(r).map((t, i) => ({
        user_id: uid,
        study_day_id: day.id,
        task_date: r.date,
        task_type: t.type,
        title: t.title,
        description:
          r.notes ||
          r.assignment ||
          '',
        resource: t.resource,
        estimated_minutes: t.minutes,
        sort_order: i + 1,
        completed: false,
        completed_at: null,
      }))

      const { error: taskError } =
        await supabase
          .from('daily_tasks')
          .insert(rows)

      if (taskError) {
        setMsg(
          `Could not add tasks for ${r.date}: ${taskError.message}`
        )
        return
      }
    }

    setMsg(
      'January 21 MCAT plan synced.'
    )
  }

  async function loadAll() {
    if (!session) return

    const uid = session.user.id

    const [t, d, q, f, se] =
      await Promise.all([
        supabase
          .from('daily_tasks')
          .select('*')
          .eq('user_id', uid)
          .order('task_date')
          .order('sort_order'),

        supabase
          .from('study_days')
          .select('*')
          .eq('user_id', uid)
          .order('study_date'),

        supabase
          .from('question_blocks')
          .select('*')
          .eq('user_id', uid)
          .order('question_date', {
            ascending: false,
          })
          .limit(100),

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
          })
          .limit(500),
      ])

    if (
      t.error ||
      d.error ||
      q.error ||
      f.error ||
      se.error
    ) {
      setMsg(
        t.error?.message ||
          d.error?.message ||
          q.error?.message ||
          f.error?.message ||
          se.error?.message
      )

      return
    }

    setTasks(t.data || [])
    setDays(d.data || [])
    setQlogs(q.data || [])
    setFls(f.data || [])
    setSessions(se.data || [])
  }

  async function toggle(task) {
    const completed = !task.completed

    const { error } = await supabase
      .from('daily_tasks')
      .update({
        completed,
        completed_at: completed
          ? new Date().toISOString()
          : null,
      })
      .eq('id', task.id)

    if (error) {
      setMsg(error.message)
    } else {
      setTasks((x) =>
        x.map((t) =>
          t.id === task.id
            ? {
                ...t,
                completed,
                completed_at: completed
                  ? new Date().toISOString()
                  : null,
              }
            : t
        )
      )
    }
  }

  async function logSession(minutes) {
    if (!session || !minutes) return

    const { error } = await supabase
      .from('study_sessions')
      .insert({
        user_id: session.user.id,
        session_date: todayISO(),
        actual_minutes: minutes,
        planned_minutes: minutes,
        session_type: 'Pomodoro',
        ended_at:
          new Date().toISOString(),
      })

    if (error) {
      setMsg(error.message)
    } else {
      loadAll()
    }
  }

  async function addQuestions(e) {
    e.preventDefault()

    const fd = new FormData(
      e.currentTarget
    )

    const total = Number(fd.get('total'))
    const correct = Number(
      fd.get('correct')
    )

    const { error } = await supabase
      .from('question_blocks')
      .insert({
        user_id: session.user.id,
        question_date: fd.get('date'),
        source: fd.get('source'),
        subject: fd.get('subject'),
        total_questions: total,
        correct_questions: correct,
        timed:
          fd.get('timed') === 'on',
      })

    if (error) {
      setMsg(error.message)
    } else {
      e.currentTarget.reset()
      loadAll()
    }
  }

  async function addFL(e) {
    e.preventDefault()

    const fd = new FormData(
      e.currentTarget
    )

    const cp = Number(fd.get('cp'))
    const cars = Number(fd.get('cars'))
    const bb = Number(fd.get('bb'))
    const ps = Number(fd.get('ps'))

    const { error } = await supabase
      .from('full_length_scores')
      .insert({
        user_id: session.user.id,
        exam_date: fd.get('date'),
        exam_name: fd.get('name'),
        cp_score: cp,
        cars_score: cars,
        bb_score: bb,
        ps_score: ps,
        total_score:
          cp + cars + bb + ps,
      })

    if (error) {
      setMsg(error.message)
    } else {
      e.currentTarget.reset()
      loadAll()
    }
  }

  async function auth(e) {
    e.preventDefault()

    setMsg('')

    const fn =
      authMode === 'signin'
        ? supabase.auth
            .signInWithPassword
        : supabase.auth.signUp

    const { error } = await fn({
      email,
      password,
    })

    if (error) {
      setMsg(error.message)
    }
  }

  function setTimer(kind) {
    setRunning(false)
    setTimerMode(kind)

    setSeconds(
      (kind === 'Focus'
        ? focusMin
        : breakMin) * 60
    )
  }

  if (loading) {
    return (
      <main className="auth">
        <div className="card">
          Loading…
        </div>
      </main>
    )
  }

  if (!session) {
    return (
      <main className="auth">
        <form
          className="card authCard"
          onSubmit={auth}
        >
          <h1>MCAT Study Tracker</h1>

          <p>
            January 21, 2027 plan
          </p>

          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) =>
              setEmail(e.target.value)
            }
            required
          />

          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) =>
              setPassword(e.target.value)
            }
            required
          />

          <button>
            {authMode === 'signin'
              ? 'Sign in'
              : 'Create account'}
          </button>

          <button
            type="button"
            className="secondary"
            onClick={() =>
              setAuthMode((x) =>
                x === 'signin'
                  ? 'signup'
                  : 'signin'
              )
            }
          >
            {authMode === 'signin'
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

  const testDate = new Date(
    '2027-01-21T12:00:00'
  )

  const now = new Date()

  const countdown = Math.max(
    0,
    Math.ceil(
      (testDate - now) /
        (1000 * 60 * 60 * 24)
    )
  )

  return (
    <div className="shell">
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
          ].map((x) => (
            <button
              key={x}
              className={
                tab === x
                  ? 'active'
                  : ''
              }
              onClick={() =>
                setTab(x)
              }
            >
              {x}
            </button>
          ))}
        </nav>

        <div className="sideExam">
          <small>TEST DAY</small>
          <b>JAN 21</b>
          <span>2027</span>
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

      <main className="content">
        <header className="header">
          <div>
            <h1>{tab}</h1>

            <p>
              {planned?.phase ||
                'MCAT preparation'}
            </p>
          </div>

          <div className="countdown">
            <b>{countdown}</b>
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
                    </b>{' '}
                    / {weekTasks.length}{' '}
                    tasks
                  </span>

                  <span>
                    <b>
                      {hoursText(
                        weekActual
                      )}
                    </b>{' '}
                    focused
                  </span>

                  <span>
                    <b>
                      {hoursText(
                        weekPlanned
                      )}
                    </b>{' '}
                    planned
                  </span>
                </div>
              </div>

              <div className="weekDays">
                {weekDates.map(
                  (date) => {
                    const dt =
                      tasks.filter(
                        (t) =>
                          t.task_date ===
                          date
                      )

                    const done =
                      dt.filter(
                        (t) =>
                          t.completed
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

            <div className="todayHeading">
              <div>
                <small>
                  {fmt(
                    selected
                  ).toUpperCase()}
                </small>

                <h2>
                  {planned?.assignment ||
                    'Study Plan'}
                </h2>

                <p>
                  {planned?.notes}
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

              <strong>
                {pct}%
              </strong>

              <div className="progress">
                <i
                  style={{
                    width: `${pct}%`,
                  }}
                />
              </div>
            </section>

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
                  {selectedTasks.length ? (
                    selectedTasks.map(
                      (t) => (
                        <button
                          key={t.id}
                          className={`task ${
                            t.completed
                              ? 'done'
                              : ''
                          }`}
                          onClick={() =>
                            toggle(t)
                          }
                        >
                          <span className="taskCheck">
                            {t.completed
                              ? '✓'
                              : ''}
                          </span>

                          <span className="taskBody">
                            <small>
                              {
                                t.task_type
                              }{' '}
                              ·{' '}
                              {
                                t.resource
                              }
                            </small>

                            <b>
                              {t.title}
                            </b>

                            <em>
                              {
                                t.description
                              }
                            </em>
                          </span>

                          <span>
                            {t.estimated_minutes
                              ? `${t.estimated_minutes}m`
                              : ''}
                          </span>
                        </button>
                      )
                    )
                  ) : (
                    <p>
                      No tasks for this
                      date.
                    </p>
                  )}
                </div>
              </section>

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
                          seconds / 60
                        )
                      ).padStart(
                        2,
                        '0'
                      )}
                      :
                      {String(
                        seconds % 60
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
                        (x) => !x
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
                      value={focusMin}
                      onChange={(e) => {
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
                            value * 60
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
                      value={breakMin}
                      onChange={(e) => {
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
                            value * 60
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

        {tab === 'Calendar' && (
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
              {schedule.map((r) => (
                <button
                  key={r.date}
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
                    setTab('Today')
                  }}
                >
                  <span>
                    {fmt(r.date)}
                  </span>

                  <b>
                    {r.phase}
                  </b>

                  <em>
                    {r.assignment}
                  </em>

                  <strong>
                    {r.hours}h
                  </strong>
                </button>
              ))}
            </div>
          </section>
        )}

        {tab === 'Questions' && (
          <div className="dashboardGrid">
            <form
              className="card formCard"
              onSubmit={addQuestions}
            >
              <h3>
                Log Question Block
              </h3>

              <input
                name="date"
                type="date"
                defaultValue={todayISO()}
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
                />{' '}
                Timed block
              </label>

              <button>
                Save block
              </button>
            </form>

            <section className="card">
              <h3>
                Recent Blocks
              </h3>

              <div className="logList">
                {qlogs.map((q) => (
                  <div key={q.id}>
                    <span>
                      {q.question_date}{' '}
                      · {q.source} ·{' '}
                      {q.subject}
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
                ))}
              </div>
            </section>
          </div>
        )}

        {tab === 'Full Lengths' && (
          <div className="dashboardGrid">
            <form
              className="card formCard"
              onSubmit={addFL}
            >
              <h3>
                Log Full Length
              </h3>

              <input
                name="date"
                type="date"
                defaultValue={todayISO()}
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

              <button>
                Save score
              </button>
            </form>

            <section className="card">
              <h3>
                Full-Length Scores
              </h3>

              <div className="logList">
                {fls.map((f) => (
                  <div key={f.id}>
                    <span>
                      {f.exam_date} ·{' '}
                      {f.exam_name}
                    </span>

                    <b>
                      {f.total_score}
                    </b>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}

        {tab === 'Analytics' && (
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
                Focused this
                selected week
              </p>

              <div className="bigStat">
                {hoursText(
                  weekPlanned
                )}
              </div>

              <p>
                Planned this
                selected week
              </p>
            </section>

            <section className="card">
              <h3>
                Question Accuracy
              </h3>

              {qlogs.length ? (
                <>
                  <div className="bigStat">
                    {Math.round(
                      (100 *
                        qlogs.reduce(
                          (a, q) =>
                            a +
                            Number(
                              q.correct_questions
                            ),
                          0
                        )) /
                        qlogs.reduce(
                          (a, q) =>
                            a +
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
                      (a, q) =>
                        a +
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
                  No question blocks
                  logged yet.
                </p>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  )
}
