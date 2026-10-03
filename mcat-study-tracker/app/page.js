'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import config from '../data/studyConfig.json'
import schedule from '../data/schedule.json'

const PLAN_START = schedule.plan_start || '2026-10-03'
const EXAM_DATE = schedule.exam_date || '2027-01-21'
const SOURCE_TYPE = 'v2_engine'
const SCHEDULE_DAYS = Array.isArray(schedule.days) ? schedule.days : []

const STUDENTS = ['Diya', 'Hamzah']

/* ============================================================
   BASIC HELPERS
   ============================================================ */

function localISO(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

function dateFromISO(iso) {
  if (!iso) return new Date()

  const [year, month, day] = iso.split('-').map(Number)

  return new Date(year, month - 1, day)
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

function formatDate(
  iso,
  {
    weekday = false,
    year = false
  } = {}
) {
  if (!iso) return ''

  return dateFromISO(iso).toLocaleDateString('en-US', {
    weekday: weekday ? 'short' : undefined,
    month: 'short',
    day: 'numeric',
    year: year ? 'numeric' : undefined
  })
}

function formatMinutes(value = 0) {
  const minutes = Math.max(
    0,
    Math.round(Number(value) || 0)
  )

  const hours = Math.floor(minutes / 60)
  const remaining = minutes % 60

  if (!hours) return `${remaining}m`
  if (!remaining) return `${hours}h`

  return `${hours}h ${remaining}m`
}

function getWeekDates(iso) {
  const date = dateFromISO(iso)
  const day = date.getDay()

  const offset = day === 0 ? -6 : 1 - day

  const monday = new Date(date)

  monday.setDate(date.getDate() + offset)

  return Array.from({ length: 7 }, (_, index) => {
    const result = new Date(monday)

    result.setDate(monday.getDate() + index)

    return localISO(result)
  })
}

function getScheduleDay(iso) {
  return (
    SCHEDULE_DAYS.find(
      day => day.date === iso
    ) || null
  )
}

function getStudentSchedule(iso, student) {
  const day = getScheduleDay(iso)

  if (!day) return null

  if (student === 'Diya') {
    return day.diya || null
  }

  if (student === 'Hamzah') {
    return day.hamzah || null
  }

  return null
}

function sumMinutes(tasks = []) {
  return tasks.reduce(
    (sum, task) =>
      sum +
      (Number(task.estimated_minutes) || 0),
    0
  )
}

function getProgress(tasks = []) {
  const realTasks = tasks.filter(
    task => task.task_type !== 'Chapter'
  )

  if (!realTasks.length) return 0

  const completed = realTasks.filter(
    task => task.completed
  ).length

  return Math.round(
    (completed / realTasks.length) * 100
  )
}

/* ============================================================
   HAMZAH CHAPTER HELPERS
   ============================================================ */

function getHamzahChapters() {
  return Array.isArray(config.hamzah?.chapters)
    ? config.hamzah.chapters
    : []
}

function getChapterSequenceFromTask(task) {
  const description = task.description || ''

  const match = description.match(
    /chapter_sequence:(\d+)/
  )

  return match
    ? Number(match[1])
    : null
}

function getCompletedHamzahChapters(tasks) {
  const completed = new Set()

  tasks.forEach(task => {
    if (task.student_name !== 'Hamzah') {
      return
    }

    if (task.task_type !== 'Chapter') {
      return
    }

    if (!task.completed) {
      return
    }

    const sequence =
      getChapterSequenceFromTask(task)

    if (sequence) {
      completed.add(sequence)
    }
  })

  return completed
}

function getCurrentHamzahChapter(tasks) {
  const chapters = getHamzahChapters()

  if (!chapters.length) {
    return null
  }

  const completed =
    getCompletedHamzahChapters(tasks)

  return (
    chapters.find(
      chapter =>
        !completed.has(chapter.sequence)
    ) || null
  )
}

function getHamzahChapterProgress(tasks) {
  const chapters = getHamzahChapters()

  const completed =
    getCompletedHamzahChapters(tasks)

  return {
    completed: completed.size,
    total: chapters.length
  }
}

function chapterLabel(chapter) {
  if (!chapter) {
    return 'Kaplan Content Complete'
  }

  return `${chapter.subject} Ch. ${chapter.chapter}: ${chapter.title}`
}

/* ============================================================
   SCHEDULE TASK GENERATION

   IMPORTANT:
   schedule.json is now the authority.

   We generate BOTH Diya and Hamzah from it.
   ============================================================ */

function buildTask({
  student,
  date,
  item,
  index,
  currentHamzahChapter,
  chapterMode
}) {
  let title =
    item.title || 'Study Task'

  let description =
    item.details || ''

  let subject =
    item.subject || ''

  const usesCurrentChapter =
    student === 'Hamzah' &&
    chapterMode === 'current_unfinished' &&
    currentHamzahChapter &&
    (
      item.title ===
        'Continue Current Kaplan Chapter' ||
      item.subject === 'Current Chapter'
    )

  if (usesCurrentChapter) {
    const label =
      chapterLabel(currentHamzahChapter)

    if (
      item.title ===
      'Continue Current Kaplan Chapter'
    ) {
      title = `Kaplan: ${label}`
    }

    if (
      item.subject === 'Current Chapter'
    ) {
      subject =
        currentHamzahChapter.subject
    }

    description = [
      description,
      `Current chapter: ${label}`
    ]
      .filter(Boolean)
      .join(' ')
  }

  return {
    student_name: student,

    task_date: date,

    current_due_date: date,

    task_type:
      item.type || 'Study',

    title,

    description,

    resource:
      item.resource || '',

    subject,

    estimated_minutes:
      Math.max(
        0,
        Math.round(
          Number(item.minutes) || 0
        )
      ),

    priority:
      Number(item.priority) || 2,

    sort_order:
      index + 1,

    completed: false,

    source_type:
      SOURCE_TYPE,

    status:
      'scheduled',

    carried_forward:
      false,

    carry_count:
      0
  }
}

function generateStudentTasks({
  iso,
  student,
  currentHamzahChapter
}) {
  const plan =
    getStudentSchedule(
      iso,
      student
    )

  if (!plan) {
    console.error(
      `[V4] Missing ${student} schedule for ${iso}`
    )

    return []
  }

  if (!Array.isArray(plan.tasks)) {
    console.error(
      `[V4] ${student} has no tasks array for ${iso}`,
      plan
    )

    return []
  }

  const tasks =
    plan.tasks.map(
      (item, index) =>
        buildTask({
          student,
          date: iso,
          item,
          index,
          currentHamzahChapter,
          chapterMode:
            plan.chapter_mode
        })
    )

  /*
    Add a separate chapter-completion control
    for Hamzah on days where Kaplan content is
    actually being worked on.

    This control is zero minutes and does not
    count toward daily completion percentage.
  */

  const hasChapterWork =
    student === 'Hamzah' &&
    currentHamzahChapter &&
    plan.chapter_mode ===
      'current_unfinished' &&
    plan.tasks.some(
      item =>
        item.title ===
          'Continue Current Kaplan Chapter' ||
        item.subject ===
          'Current Chapter'
    )

  if (hasChapterWork) {
    tasks.push({
      student_name: 'Hamzah',

      task_date: iso,

      current_due_date: iso,

      task_type: 'Chapter',

      title:
        `Mark chapter complete: ` +
        chapterLabel(
          currentHamzahChapter
        ),

      description:
        `chapter_sequence:${currentHamzahChapter.sequence} | ` +
        'Only complete this after finishing the full Kaplan chapter, concept checks, and chapter questions.',

      resource:
        'Kaplan Books',

      subject:
        currentHamzahChapter.subject,

      estimated_minutes:
        0,

      priority:
        3,

      sort_order:
        tasks.length + 1,

      completed:
        false,

      source_type:
        SOURCE_TYPE,

      status:
        'scheduled',

      carried_forward:
        false,

      carry_count:
        0
    })
  }

  return tasks
}

/* ============================================================
   TASK SIGNATURE

   Used to repair partially seeded days.

   We deliberately do NOT simply check:
   "Does Hamzah have a row?"

   We check every expected task.
   ============================================================ */

function taskSignature(task) {
  return [
    task.student_name || '',
    task.task_type || '',
    task.title || '',
    task.resource || '',
    task.subject || ''
  ].join('||')
}

/* ============================================================
   APP
   ============================================================ */

export default function Home() {
  const [session, setSession] =
    useState(null)

  const [authLoading, setAuthLoading] =
    useState(true)

  const [email, setEmail] =
    useState('')

  const [password, setPassword] =
    useState('')

  const [authMode, setAuthMode] =
    useState('signin')

  const [message, setMessage] =
    useState('')

  const [view, setView] =
    useState('Today')

  const [selectedDate, setSelectedDate] =
    useState(localISO())

  const [tasks, setTasks] =
    useState([])

  const [questionLogs, setQuestionLogs] =
    useState([])

  const [fullLengths, setFullLengths] =
    useState([])

  const [studySessions, setStudySessions] =
    useState([])

  const [initialDataLoaded, setInitialDataLoaded] =
    useState(false)

  const [seeding, setSeeding] =
    useState(false)

  const seedLock =
    useRef(false)

  const uid =
    session?.user?.id || null

  /* ==========================================================
     AUTH
     ========================================================== */

  useEffect(() => {
    if (!supabase) {
      setAuthLoading(false)
      return
    }

    supabase.auth
      .getSession()
      .then(({ data }) => {
        setSession(
          data.session || null
        )

        setAuthLoading(false)
      })

    const {
      data: {
        subscription
      }
    } =
      supabase.auth.onAuthStateChange(
        (_event, newSession) => {
          setSession(
            newSession || null
          )
        }
      )

    return () => {
      subscription.unsubscribe()
    }
  }, [])

  async function handleAuth(event) {
    event.preventDefault()

    setMessage('')

    if (!supabase) {
      setMessage(
        'Supabase is not configured.'
      )

      return
    }

    let result

    if (authMode === 'signup') {
      result =
        await supabase.auth.signUp({
          email,
          password
        })
    } else {
      result =
        await supabase.auth
          .signInWithPassword({
            email,
            password
          })
    }

    if (result.error) {
      setMessage(
        result.error.message
      )

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

  /* ==========================================================
     DATABASE LOADING
     ========================================================== */

  async function loadAll({
    showLoading = false
  } = {}) {
    if (!uid || !supabase) {
      return []
    }

    if (showLoading) {
      setInitialDataLoaded(false)
    }

    const [
      taskResult,
      questionResult,
      fullLengthResult,
      sessionResult
    ] =
      await Promise.all([
        supabase
          .from('daily_tasks')
          .select('*')
          .eq('user_id', uid)
          .order(
            'task_date',
            { ascending: true }
          )
          .order(
            'sort_order',
            { ascending: true }
          ),

        supabase
          .from('question_blocks')
          .select('*')
          .eq('user_id', uid)
          .order(
            'question_date',
            { ascending: false }
          ),

        supabase
          .from('full_length_scores')
          .select('*')
          .eq('user_id', uid)
          .order(
            'exam_date',
            { ascending: false }
          ),

        supabase
          .from('study_sessions')
          .select('*')
          .eq('user_id', uid)
          .order(
            'session_date',
            { ascending: false }
          )
      ])

    if (taskResult.error) {
      console.error(
        taskResult.error
      )

      setMessage(
        `Task load error: ${taskResult.error.message}`
      )
    }

    const loadedTasks =
      taskResult.data || []

    setTasks(loadedTasks)

    setQuestionLogs(
      questionResult.data || []
    )

    setFullLengths(
      fullLengthResult.data || []
    )

    setStudySessions(
      sessionResult.data || []
    )

    setInitialDataLoaded(true)

    return loadedTasks
  }

  useEffect(() => {
    if (!uid) return

    loadAll({
      showLoading: true
    })
  }, [uid])

  /* ==========================================================
     HAMZAH CURRENT CHAPTER
     ========================================================== */

  const currentHamzahChapter =
    useMemo(
      () =>
        getCurrentHamzahChapter(
          tasks
        ),
      [tasks]
    )

  const hamzahChapterProgress =
    useMemo(
      () =>
        getHamzahChapterProgress(
          tasks
        ),
      [tasks]
    )

  /* ==========================================================
     ROBUST DAY REPAIR / SEED

     THIS IS THE IMPORTANT FIX.

     Every time a date is opened:

     1. Read that date from schedule.json.
     2. Generate Diya's expected tasks.
     3. Generate Hamzah's expected tasks.
     4. Query Supabase directly.
     5. Compare each expected task.
     6. Insert anything missing.
     7. Reload.

     A single old Hamzah row can no longer block
     his entire schedule.
     ========================================================== */

  async function ensureDay(
    iso,
    chapterOverride = null
  ) {
    if (
      !uid ||
      !supabase ||
      seedLock.current
    ) {
      return
    }

    if (
      iso < PLAN_START ||
      iso > EXAM_DATE
    ) {
      return
    }

    const scheduleDay =
      getScheduleDay(iso)

    if (!scheduleDay) {
      setMessage(
        `No schedule.json entry exists for ${iso}.`
      )

      return
    }

    seedLock.current = true
    setSeeding(true)

    try {
      /*
        Pull existing rows DIRECTLY
        from Supabase.
      */

      const {
        data: existingRows,
        error: existingError
      } =
        await supabase
          .from('daily_tasks')
          .select('*')
          .eq('user_id', uid)
          .eq(
            'source_type',
            SOURCE_TYPE
          )
          .eq(
            'task_date',
            iso
          )

      if (existingError) {
        throw existingError
      }

      /*
        Determine current chapter using
        the freshest data available.
      */

      let chapter =
        chapterOverride ||
        currentHamzahChapter

      if (!chapter) {
        const {
          data: chapterRows,
          error: chapterError
        } =
          await supabase
            .from('daily_tasks')
            .select('*')
            .eq('user_id', uid)
            .eq(
              'source_type',
              SOURCE_TYPE
            )
            .eq(
              'student_name',
              'Hamzah'
            )
            .eq(
              'task_type',
              'Chapter'
            )

        if (chapterError) {
          throw chapterError
        }

        chapter =
          getCurrentHamzahChapter(
            chapterRows || []
          )
      }

      /*
        ALWAYS build BOTH students.
      */

      const expectedDiya =
        generateStudentTasks({
          iso,
          student: 'Diya',
          currentHamzahChapter:
            chapter
        })

      const expectedHamzah =
        generateStudentTasks({
          iso,
          student: 'Hamzah',
          currentHamzahChapter:
            chapter
        })

      console.log(
        `[V4 ${iso}] Diya expected:`,
        expectedDiya.length
      )

      console.log(
        `[V4 ${iso}] Hamzah expected:`,
        expectedHamzah.length
      )

      /*
        Combine all expected tasks.
      */

      const expected = [
        ...expectedDiya,
        ...expectedHamzah
      ]

      const existing =
        existingRows || []

      const existingSignatures =
        new Set(
          existing.map(
            taskSignature
          )
        )

      /*
        Find missing tasks individually.
      */

      const missing =
        expected.filter(
          task =>
            !existingSignatures.has(
              taskSignature(task)
            )
        )

      console.log(
        `[V4 ${iso}] Existing: ${existing.length}`
      )

      console.log(
        `[V4 ${iso}] Missing: ${missing.length}`
      )

      if (missing.length > 0) {
        const rows =
          missing.map(task => ({
            ...task,
            user_id: uid
          }))

        const {
          error: insertError
        } =
          await supabase
            .from('daily_tasks')
            .insert(rows)

        if (insertError) {
          throw insertError
        }

        console.log(
          `[V4 ${iso}] Inserted ${rows.length} missing tasks.`
        )
      }

      /*
        Reload everything so both dashboards
        immediately see the repaired rows.
      */

      await loadAll()
    } catch (error) {
      console.error(
        '[V4 ensureDay]',
        error
      )

      setMessage(
        `Schedule error: ${
          error?.message ||
          'Unknown schedule error'
        }`
      )
    } finally {
      seedLock.current = false
      setSeeding(false)
    }
  }

  /* ==========================================================
     AUTOMATIC DATE SEEDING

     Notice that this DOES NOT depend on
     tasks.length.

     That was one of the fragile parts of the
     old implementation.
     ========================================================== */

  useEffect(() => {
    if (
      !uid ||
      !initialDataLoaded
    ) {
      return
    }

    ensureDay(
      selectedDate,
      currentHamzahChapter
    )
  }, [
    uid,
    selectedDate,
    initialDataLoaded
  ])

  /* ==========================================================
     TASK TOGGLE
     ========================================================== */

  async function toggleTask(task) {
    if (!uid || !supabase) {
      return
    }

    const nextCompleted =
      !task.completed

    const {
      error
    } =
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
                : 'scheduled'
        })
        .eq(
          'id',
          task.id
        )
        .eq(
          'user_id',
          uid
        )

    if (error) {
      setMessage(
        error.message
      )

      return
    }

    const refreshed =
      await loadAll()

    /*
      If Hamzah just completed a chapter,
      his chapter state changes immediately.

      We do NOT rewrite already completed
      historical days.
    */

    if (
      task.student_name ===
        'Hamzah' &&
      task.task_type ===
        'Chapter'
    ) {
      const newChapter =
        getCurrentHamzahChapter(
          refreshed
        )

      console.log(
        '[Hamzah] New current chapter:',
        newChapter
      )
    }
  }

  /* ==========================================================
     OVERFLOW
     ========================================================== */

  async function processOverflow() {
    if (
      !uid ||
      !supabase
    ) {
      return
    }

    const today =
      localISO()

    if (
      today <= PLAN_START ||
      today >= EXAM_DATE
    ) {
      return
    }

    const todayPlan =
      getScheduleDay(today)

    if (
      todayPlan?.day_type ===
        'full_length' ||
      todayPlan?.day_type ===
        'exam'
    ) {
      return
    }

    const {
      data,
      error
    } =
      await supabase
        .from('daily_tasks')
        .select('*')
        .eq(
          'user_id',
          uid
        )
        .eq(
          'source_type',
          SOURCE_TYPE
        )
        .eq(
          'completed',
          false
        )
        .gte(
          'task_date',
          PLAN_START
        )
        .lt(
          'task_date',
          today
        )

    if (error) {
      console.error(error)
      return
    }

    const eligible =
      (data || []).filter(
        task =>
          task.task_type !==
            'Exam' &&
          task.task_type !==
            'Full Length' &&
          task.task_type !==
            'Chapter'
      )

    for (
      const task of eligible
    ) {
      if (
        task.current_due_date ===
        today
      ) {
        continue
      }

      const {
        error: updateError
      } =
        await supabase
          .from('daily_tasks')
          .update({
            current_due_date:
              today,

            carried_forward:
              true,

            carry_count:
              (Number(
                task.carry_count
              ) || 0) + 1,

            status:
              'overdue'
          })
          .eq(
            'id',
            task.id
          )
          .eq(
            'user_id',
            uid
          )

      if (updateError) {
        console.error(
          updateError
        )
      }
    }

    await loadAll()
  }

  useEffect(() => {
    if (
      !uid ||
      !initialDataLoaded
    ) {
      return
    }

    processOverflow()
  }, [
    uid,
    initialDataLoaded
  ])

  /* ==========================================================
     FILTERED TASK DATA
     ========================================================== */

  const studyTasks =
    useMemo(
      () =>
        tasks.filter(
          task =>
            task.source_type ===
              SOURCE_TYPE &&
            task.task_date >=
              PLAN_START
        ),
      [tasks]
    )

  function tasksFor(
    student,
    iso
  ) {
    return studyTasks
      .filter(
        task =>
          task.student_name ===
            student &&
          task.task_date === iso
      )
      .sort(
        (a, b) =>
          (Number(
            a.sort_order
          ) || 0) -
          (Number(
            b.sort_order
          ) || 0)
      )
  }

  function overflowFor(
    student,
    iso
  ) {
    return studyTasks
      .filter(
        task =>
          task.student_name ===
            student &&
          !task.completed &&
          task.carried_forward &&
          task.current_due_date ===
            iso &&
          task.task_date < iso &&
          task.task_type !==
            'Chapter'
      )
      .sort(
        (a, b) => {
          const priority =
            (Number(
              a.priority
            ) || 2) -
            (Number(
              b.priority
            ) || 2)

          if (priority !== 0) {
            return priority
          }

          return (
            a.task_date.localeCompare(
              b.task_date
            )
          )
        }
      )
  }

  const diyaTasks =
    tasksFor(
      'Diya',
      selectedDate
    )

  const hamzahTasks =
    tasksFor(
      'Hamzah',
      selectedDate
    )

  const diyaOverflow =
    overflowFor(
      'Diya',
      selectedDate
    )

  const hamzahOverflow =
    overflowFor(
      'Hamzah',
      selectedDate
    )

  /* ==========================================================
     QUESTION LOGGING
     ========================================================== */

  async function addQuestionBlock(
    data
  ) {
    if (!uid || !supabase) {
      return
    }

    const {
      error
    } =
      await supabase
        .from(
          'question_blocks'
        )
        .insert({
          user_id: uid,

          question_date:
            data.date,

          source:
            `${data.student} — ${data.source}`,

          subject:
            data.subject,

          total_questions:
            Number(
              data.total
            ),

          correct_questions:
            Number(
              data.correct
            ),

          timed:
            Boolean(
              data.timed
            )
        })

    if (error) {
      setMessage(
        error.message
      )

      return
    }

    await loadAll()
  }

  /* ==========================================================
     FULL LENGTH LOGGING
     ========================================================== */

  async function addFullLength(
    data
  ) {
    if (!uid || !supabase) {
      return
    }

    const total =
      Number(data.cp) +
      Number(data.cars) +
      Number(data.bb) +
      Number(data.ps)

    const {
      error
    } =
      await supabase
        .from(
          'full_length_scores'
        )
        .insert({
          user_id:
            uid,

          exam_date:
            data.date,

          exam_name:
            `${data.student} — ${data.name}`,

          cp_score:
            Number(data.cp),

          cars_score:
            Number(
              data.cars
            ),

          bb_score:
            Number(data.bb),

          ps_score:
            Number(data.ps),

          total_score:
            total
        })

    if (error) {
      setMessage(
        error.message
      )

      return
    }

    await loadAll()
  }

  /* ==========================================================
     POMODORO SESSION
     ========================================================== */

  async function logSession(
    student,
    minutes,
    type = 'Focus'
  ) {
    if (
      !uid ||
      !supabase ||
      !minutes
    ) {
      return
    }

    const {
      error
    } =
      await supabase
        .from(
          'study_sessions'
        )
        .insert({
          user_id:
            uid,

          session_date:
            localISO(),

          actual_minutes:
            Number(minutes),

          planned_minutes:
            Number(minutes),

          session_type:
            `${student} — ${type}`,

          ended_at:
            new Date().toISOString()
        })

    if (error) {
      console.error(error)
      return
    }

    await loadAll()
  }

  /* ==========================================================
     AUTH SCREEN
     ========================================================== */

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
          onSubmit={
            handleAuth
          }
        >
          <div className="logo">
            <span>M</span>

            <div>
              <b>
                MCAT TRACKER
              </b>

              <small>
                JANUARY 21,
                2027
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
            Diya + Hamzah
            MCAT Study System
          </p>

          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={
              event =>
                setEmail(
                  event.target.value
                )
            }
            required
          />

          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={
              event =>
                setPassword(
                  event.target.value
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

  /* ==========================================================
     MAIN APP
     ========================================================== */

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
            <b>
              MCAT TRACKER
            </b>

            <small>
              V4 STUDY SYSTEM
            </small>
          </div>
        </div>

        <div className="profileMini">
          <small>
            SHARED ACCOUNT
          </small>

          <b>
            Diya + Hamzah
          </b>

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
            'Analytics'
          ].map(item => (
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

          <b>
            {daysLeft}
          </b>

          <span>
            days remaining
          </span>
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
              Diya + Hamzah •
              MCAT January 21,
              2027
            </p>
          </div>

          <div className="headerRight">
            <div className="countdown">
              <b>
                {daysLeft}
              </b>

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
              diyaOverflow
            }
            hamzahOverflow={
              hamzahOverflow
            }
            allTasks={
              studyTasks
            }
            currentHamzahChapter={
              currentHamzahChapter
            }
            hamzahChapterProgress={
              hamzahChapterProgress
            }
            toggleTask={
              toggleTask
            }
            logSession={
              logSession
            }
            ensureDay={
              ensureDay
            }
            seeding={
              seeding
            }
          />
        )}

        {view ===
          'Calendar' && (
          <CalendarView
            selectedDate={
              selectedDate
            }
            setSelectedDate={
              date => {
                setSelectedDate(
                  date
                )

                setView(
                  'Today'
                )
              }
            }
            tasks={
              studyTasks
            }
          />
        )}

        {view ===
          'Questions' && (
          <QuestionsView
            logs={
              questionLogs
            }
            onAdd={
              addQuestionBlock
            }
          />
        )}

        {view ===
          'Full Lengths' && (
          <FullLengthView
            fullLengths={
              fullLengths
            }
            onAdd={
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
            tasks={
              studyTasks
            }
            questionLogs={
              questionLogs
            }
            fullLengths={
              fullLengths
            }
            sessions={
              studySessions
            }
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
   TODAY VIEW
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
  ensureDay,
  seeding
}) {
  const week =
    getWeekDates(
      selectedDate
    )

  const day =
    getScheduleDay(
      selectedDate
    )

  const diyaPlan =
    day?.diya || null

  const hamzahPlan =
    day?.hamzah || null

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
                {
                  year: true
                }
              )}
            </h2>
          </div>

          <div className="weekStats">
            <span>
              Exam{' '}
              <b>
                {formatDate(
                  EXAM_DATE,
                  {
                    year: true
                  }
                )}
              </b>
            </span>
          </div>
        </div>

        <div className="weekDays">
          {week.map(date => {
            const dateTasks =
              allTasks.filter(
                task =>
                  task.task_date ===
                  date &&
                  task.task_type !==
                  'Chapter'
              )

            const done =
              dateTasks.length >
                0 &&
              dateTasks.every(
                task =>
                  task.completed
              )

            const missed =
              date <
                localISO() &&
              dateTasks.some(
                task =>
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

                  missed
                    ? 'missed'
                    : '',

                  done
                    ? 'complete'
                    : ''
                ]
                  .filter(
                    Boolean
                  )
                  .join(' ')}
                onClick={() => {
                  setSelectedDate(
                    date
                  )
                }}
              >
                <small>
                  {dateFromISO(
                    date
                  ).toLocaleDateString(
                    'en-US',
                    {
                      weekday:
                        'short'
                    }
                  )}
                </small>

                <b>
                  {dateFromISO(
                    date
                  ).getDate()}
                </b>

                <span>
                  {
                    dateTasks.filter(
                      task =>
                        task.completed
                    ).length
                  }
                  /
                  {
                    dateTasks.length
                  }
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {seeding && (
        <div className="message">
          Syncing both
          schedules...
        </div>
      )}

      {!day && (
        <div className="message">
          No schedule entry
          exists for this date.
        </div>
      )}

      <StudentHeader
        name="Diya"
        subtitle="Question-Heavy Track • 512+ Target"
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
        date={
          selectedDate
        }
        plan={
          diyaPlan
        }
        tasks={
          diyaTasks
        }
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
        badge={
          hamzahPlan
            ? formatMinutes(
                hamzahPlan.target_minutes
              )
            : 'NO PLAN'
        }
      />

      <HamzahDashboard
        date={
          selectedDate
        }
        plan={
          hamzahPlan
        }
        tasks={
          hamzahTasks
        }
        overflow={
          hamzahOverflow
        }
        chapter={
          currentHamzahChapter
        }
        chapterProgress={
          hamzahChapterProgress
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
        <small>
          STUDENT
        </small>

        <h2>
          {name}
        </h2>

        <p>
          {subtitle}
        </p>
      </div>

      <strong>
        {badge}
      </strong>
    </div>
  )
}

/* ============================================================
   STANDARD STUDENT DASHBOARD
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
  const realTasks =
    tasks.filter(
      task =>
        task.task_type !==
        'Chapter'
    )

  const completed =
    realTasks.filter(
      task =>
        task.completed
    ).length

  const minutes =
    sumMinutes(
      realTasks
    )

  const progress =
    getProgress(
      realTasks
    )

  return (
    <>
      <OverflowPanel
        student={
          student
        }
        overflow={
          overflow
        }
        toggleTask={
          toggleTask
        }
      />

      <div className="todayHeading">
        <div>
          <small>
            {plan?.phase?.toUpperCase() ||
              'STUDY PLAN'}
          </small>

          <h2>
            {formatDate(
              date,
              {
                weekday: true,
                year: true
              }
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
              {formatMinutes(
                minutes
              )}
            </b>
          </span>

          <span>
            <small>
              DONE
            </small>

            <b>
              {completed}/
              {realTasks.length}
            </b>
          </span>

          <span>
            <small>
              OVERFLOW
            </small>

            <b>
              {formatMinutes(
                sumMinutes(
                  overflow
                )
              )}
            </b>
          </span>
        </div>
      </div>

      <ProgressCard
        progress={
          progress
        }
        completed={
          completed
        }
        total={
          realTasks.length
        }
        minutes={
          minutes
        }
      />

      <div className="dashboardGrid">
        <div className="card">
          <div className="sectionTitle">
            <div>
              <small>
                TODAY'S CHECKLIST
              </small>

              <h2>
                {student}'s Work
              </h2>
            </div>

            <span>
              {plan?.phase}
            </span>
          </div>

          <div className="taskList">
            {realTasks.length ? (
              realTasks.map(
                task => (
                  <TaskRow
                    key={
                      task.id
                    }
                    task={
                      task
                    }
                    onToggle={
                      toggleTask
                    }
                  />
                )
              )
            ) : (
              <p className="empty">
                No scheduled
                tasks for this
                date.
              </p>
            )}
          </div>
        </div>

        <Pomodoro
          student={
            student
          }
          onLog={
            logSession
          }
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
  const realTasks =
    tasks.filter(
      task =>
        task.task_type !==
        'Chapter'
    )

  const chapterTasks =
    tasks.filter(
      task =>
        task.task_type ===
        'Chapter'
    )

  const completed =
    realTasks.filter(
      task =>
        task.completed
    ).length

  const minutes =
    sumMinutes(
      realTasks
    )

  const progress =
    getProgress(
      realTasks
    )

  return (
    <>
      <OverflowPanel
        student="Hamzah"
        overflow={
          overflow
        }
        toggleTask={
          toggleTask
        }
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
              Kaplan chapters
              advance by actual
              completion, not by
              calendar date.
            </p>
          </div>

          <div className="chapterCounter">
            <b>
              {chapterProgress.completed}
            </b>

            <span>
              /{' '}
              {chapterProgress.total}
            </span>
          </div>
        </div>

        <div className="activeChapterCard">
          <small>
            CURRENT KAPLAN
            CHAPTER
          </small>

          {chapter ? (
            <>
              <h2>
                {chapter.subject}{' '}
                Ch.{' '}
                {chapter.chapter}
              </h2>

              <p>
                {chapter.title}
              </p>

              <span>
                Chapter{' '}
                {chapter.sequence}{' '}
                of{' '}
                {chapterProgress.total}
              </span>
            </>
          ) : (
            <>
              <h2>
                Kaplan Complete
              </h2>

              <p>
                All Kaplan
                chapters are
                complete.
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
            {formatDate(
              date,
              {
                weekday: true,
                year: true
              }
            )}
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
            <small>
              PLANNED
            </small>

            <b>
              {formatMinutes(
                minutes
              )}
            </b>
          </span>

          <span>
            <small>
              DONE
            </small>

            <b>
              {completed}/
              {realTasks.length}
            </b>
          </span>

          <span>
            <small>
              OVERFLOW
            </small>

            <b>
              {formatMinutes(
                sumMinutes(
                  overflow
                )
              )}
            </b>
          </span>
        </div>
      </div>

      <ProgressCard
        progress={
          progress
        }
        completed={
          completed
        }
        total={
          realTasks.length
        }
        minutes={
          minutes
        }
      />

      <div className="dashboardGrid">
        <div className="card">
          <div className="sectionTitle">
            <div>
              <small>
                TODAY'S CHECKLIST
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
                task => (
                  <TaskRow
                    key={
                      task.id
                    }
                    task={
                      task
                    }
                    onToggle={
                      toggleTask
                    }
                  />
                )
              )
            ) : (
              <p className="empty">
                No scheduled
                tasks for this
                date.
              </p>
            )}
          </div>

          {chapterTasks.length >
            0 && (
            <div className="chapterChecklist">
              <small>
                CHAPTER
                PROGRESSION
              </small>

              {chapterTasks.map(
                task => (
                  <TaskRow
                    key={
                      task.id
                    }
                    task={
                      task
                    }
                    onToggle={
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
          onLog={
            logSession
          }
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
  if (!overflow.length) {
    return null
  }

  const minutes =
    sumMinutes(
      overflow
    )

  const warning =
    config.global_rules
      ?.overflow_warning_minutes ||
    120

  const critical =
    config.global_rules
      ?.overflow_critical_minutes ||
    240

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
            {student.toUpperCase()}{' '}
            OVERFLOW
          </small>

          <h2>
            Carried Work
          </h2>
        </div>

        <strong>
          {formatMinutes(
            minutes
          )}
        </strong>
      </div>

      <p>
        Missed work keeps its
        original date and is
        carried forward
        separately for this
        student.
      </p>

      <div className="taskList">
        {overflow.map(
          task => (
            <TaskRow
              key={`overflow-${task.id}`}
              task={task}
              onToggle={
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

        task.completed
          ? 'completed'
          : '',

        overflow
          ? 'overflowTask'
          : ''
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
          onToggle(task)
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
        <b>
          Daily Progress
        </b>

        <span>
          {completed} of{' '}
          {total} tasks
          complete •{' '}
          {formatMinutes(
            minutes
          )}{' '}
          planned
        </span>
      </div>

      <strong>
        {progress}%
      </strong>

      <div className="progress">
        <i
          style={{
            width:
              `${progress}%`
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
  const [mode, setMode] =
    useState('Focus')

  const [focusMinutes, setFocusMinutes] =
    useState(50)

  const [breakMinutes, setBreakMinutes] =
    useState(10)

  const [seconds, setSeconds] =
    useState(50 * 60)

  const [running, setRunning] =
    useState(false)

  const intervalRef =
    useRef(null)

  useEffect(() => {
    if (!running) {
      setSeconds(
        (mode === 'Focus'
          ? focusMinutes
          : breakMinutes) *
          60
      )
    }
  }, [
    mode,
    focusMinutes,
    breakMinutes,
    running
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
          previous => {
            if (
              previous <= 1
            ) {
              clearInterval(
                intervalRef.current
              )

              setRunning(
                false
              )

              if (
                mode ===
                'Focus'
              ) {
                onLog(
                  student,
                  focusMinutes,
                  'Pomodoro'
                )
              }

              return 0
            }

            return (
              previous - 1
            )
          }
        )
      }, 1000)

    return () => {
      clearInterval(
        intervalRef.current
      )
    }
  }, [
    running,
    mode,
    focusMinutes,
    student
  ])

  function changeMode(
    next
  ) {
    setRunning(false)
    setMode(next)

    setSeconds(
      (next === 'Focus'
        ? focusMinutes
        : breakMinutes) *
        60
    )
  }

  function reset() {
    setRunning(false)

    setSeconds(
      (mode === 'Focus'
        ? focusMinutes
        : breakMinutes) *
        60
    )
  }

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
          onClick={() =>
            changeMode(
              'Focus'
            )
          }
        >
          Focus
        </button>

        <button
          onClick={() =>
            changeMode(
              'Break'
            )
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
            value={
              focusMinutes
            }
            onChange={
              event =>
                setFocusMinutes(
                  Number(
                    event.target.value
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
            onChange={
              event =>
                setBreakMinutes(
                  Number(
                    event.target.value
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
            previous =>
              !previous
          )
        }
      >
        {running
          ? 'Pause'
          : 'Start'}
      </button>

      <button
        className="secondary"
        style={{
          marginTop: 8
        }}
        onClick={reset}
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
  const [monthOffset, setMonthOffset] =
    useState(0)

  const base =
    dateFromISO(
      selectedDate
    )

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

  const last =
    new Date(
      year,
      monthIndex + 1,
      0
    )

  const first =
    new Date(
      year,
      monthIndex,
      1
    )

  const dates = []

  for (
    let day = 1;
    day <= last.getDate();
    day++
  ) {
    dates.push(
      localISO(
        new Date(
          year,
          monthIndex,
          day
        )
      )
    )
  }

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
                  'numeric'
              }
            )}
          </h2>
        </div>

        <div
          style={{
            display:
              'flex',
            gap: 6
          }}
        >
          <button
            className="secondary"
            onClick={() =>
              setMonthOffset(
                value =>
                  value - 1
              )
            }
          >
            ←
          </button>

          <button
            className="secondary"
            onClick={() =>
              setMonthOffset(
                value =>
                  value + 1
              )
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
              textAlign:
                'center',
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
          paddingLeft:
            `calc(${first.getDay()} * ((100% - 42px) / 7 + 7px))`
        }}
      >
        {dates.map(date => {
          const dateTasks =
            tasks.filter(
              task =>
                task.task_date ===
                  date &&
                task.task_type !==
                  'Chapter'
            )

          const diya =
            dateTasks.filter(
              task =>
                task.student_name ===
                'Diya'
            )

          const hamzah =
            dateTasks.filter(
              task =>
                task.student_name ===
                'Hamzah'
            )

          const complete =
            dateTasks.length >
              0 &&
            dateTasks.every(
              task =>
                task.completed
            )

          const missed =
            date <
              localISO() &&
            dateTasks.some(
              task =>
                !task.completed
            )

          return (
            <button
              key={date}
              className={[
                date ===
                localISO()
                  ? 'current'
                  : '',

                complete
                  ? 'complete'
                  : '',

                missed
                  ? 'missed'
                  : '',

                date >
                localISO()
                  ? 'future'
                  : ''
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
                {dateFromISO(
                  date
                ).toLocaleDateString(
                  'en-US',
                  {
                    weekday:
                      'short'
                  }
                )}
              </small>

              <b>
                {dateFromISO(
                  date
                ).getDate()}
              </b>

              <span>
                D{' '}
                {
                  diya.filter(
                    task =>
                      task.completed
                  ).length
                }
                /{diya.length}
              </span>

              <span>
                H{' '}
                {
                  hamzah.filter(
                    task =>
                      task.completed
                  ).length
                }
                /{hamzah.length}
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

  async function submit(
    event
  ) {
    event.preventDefault()

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
            onChange={
              event =>
                setStudent(
                  event.target.value
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
            onChange={
              event =>
                setDate(
                  event.target.value
                )
            }
          />
        </label>

        <label>
          Resource

          <select
            value={source}
            onChange={
              event =>
                setSource(
                  event.target.value
                )
            }
          >
            <option>
              Kaplan
            </option>

            <option>
              Kaplan QBank
            </option>

            <option>
              UWorld
            </option>

            <option>
              AAMC
            </option>

            <option>
              AAMC Section Bank
            </option>

            <option>
              AAMC Question Pack
            </option>

            <option>
              Other
            </option>
          </select>
        </label>

        <label>
          Section

          <select
            value={subject}
            onChange={
              event =>
                setSubject(
                  event.target.value
                )
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
            onChange={
              event =>
                setTotal(
                  event.target.value
                )
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
            onChange={
              event =>
                setCorrect(
                  event.target.value
                )
            }
          />
        </label>

        <label className="checkboxLabel">
          <input
            type="checkbox"
            checked={timed}
            onChange={
              event =>
                setTimed(
                  event.target.checked
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
              Question History
            </h2>
          </div>
        </div>

        <div className="logList">
          {logs.length ? (
            logs
              .slice(0, 30)
              .map(log => {
                const totalQuestions =
                  Number(
                    log.total_questions
                  ) || 0

                const correctQuestions =
                  Number(
                    log.correct_questions
                  ) || 0

                const accuracy =
                  totalQuestions >
                  0
                    ? Math.round(
                        correctQuestions /
                          totalQuestions *
                          100
                      )
                    : 0

                return (
                  <div
                    className="logRow"
                    key={
                      log.id
                    }
                  >
                    <div>
                      <small>
                        {formatDate(
                          log.question_date
                        )}{' '}
                        •{' '}
                        {
                          log.source
                        }
                      </small>

                      <b>
                        {
                          log.subject
                        }{' '}
                        •{' '}
                        {
                          correctQuestions
                        }
                        /
                        {
                          totalQuestions
                        }
                      </b>
                    </div>

                    <strong>
                      {accuracy}%
                    </strong>
                  </div>
                )
              })
          ) : (
            <p className="empty">
              No question
              blocks logged
              yet.
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

  async function submit(
    event
  ) {
    event.preventDefault()

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
        <small>
          SHARED MILESTONES
        </small>

        <h2>
          Synchronized
          Full-Lengths
        </h2>

        <p>
          Both students take
          the scheduled exam
          on the same day and
          perform deep review
          the following day.
        </p>
      </div>

      <div className="dashboardGrid">
        <form
          className="card form"
          onSubmit={submit}
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
              onChange={
                event =>
                  setStudent(
                    event.target.value
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
            Exam Date

            <input
              type="date"
              value={date}
              onChange={
                event =>
                  setDate(
                    event.target.value
                  )
              }
            />
          </label>

          <label>
            Exam

            <input
              value={name}
              onChange={
                event =>
                  setName(
                    event.target.value
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
              onChange={
                event =>
                  setCp(
                    event.target.value
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
              onChange={
                event =>
                  setCars(
                    event.target.value
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
              onChange={
                event =>
                  setBb(
                    event.target.value
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
              onChange={
                event =>
                  setPs(
                    event.target.value
                  )
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
              <small>
                SCORE HISTORY
              </small>

              <h2>
                Full Lengths
              </h2>
            </div>
          </div>

          <div className="flList">
            {fullLengths.length ? (
              fullLengths.map(
                fl => (
                  <div
                    className="flRow"
                    key={
                      fl.id
                    }
                  >
                    <div>
                      <small>
                        {formatDate(
                          fl.exam_date
                        )}
                      </small>

                      <b>
                        {
                          fl.exam_name
                        }
                      </b>

                      <span>
                        C/P{' '}
                        {
                          fl.cp_score
                        }{' '}
                        • CARS{' '}
                        {
                          fl.cars_score
                        }{' '}
                        • B/B{' '}
                        {
                          fl.bb_score
                        }{' '}
                        • P/S{' '}
                        {
                          fl.ps_score
                        }
                      </span>
                    </div>

                    <strong>
                      {
                        fl.total_score
                      }
                    </strong>
                  </div>
                )
              )
            ) : (
              <p className="empty">
                No full lengths
                logged yet.
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
  const fullLengthDates =
    config.shared
      ?.full_length_dates ||
    []

  return (
    <>
      <div className="card togetherHero">
        <small>
          DIYA + HAMZAH
        </small>

        <h2>
          Study Together
        </h2>

        <p>
          One exam date, one
          shared login, two
          independent study
          plans.
        </p>
      </div>

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
            {fullLengthDates.map(
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
                        {
                          weekday:
                            true,
                          year:
                            true
                        }
                      )}
                    </b>
                  </div>

                  <strong>
                    {date <
                    localISO()
                      ? 'PAST'
                      : date ===
                          localISO()
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
                Recent Sessions
              </h2>
            </div>
          </div>

          <div className="logList">
            {sessions.length ? (
              sessions
                .slice(0, 20)
                .map(session => (
                  <div
                    className="logRow"
                    key={
                      session.id
                    }
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
                No focus
                sessions logged
                yet.
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
  const diya =
    tasks.filter(
      task =>
        task.student_name ===
          'Diya' &&
        task.task_type !==
          'Chapter'
    )

  const hamzah =
    tasks.filter(
      task =>
        task.student_name ===
          'Hamzah' &&
        task.task_type !==
          'Chapter'
    )

  const diyaDone =
    diya.filter(
      task =>
        task.completed
    ).length

  const hamzahDone =
    hamzah.filter(
      task =>
        task.completed
    ).length

  const totalQuestions =
    questionLogs.reduce(
      (sum, log) =>
        sum +
        (Number(
          log.total_questions
        ) || 0),
      0
    )

  const correctQuestions =
    questionLogs.reduce(
      (sum, log) =>
        sum +
        (Number(
          log.correct_questions
        ) || 0),
      0
    )

  const accuracy =
    totalQuestions > 0
      ? Math.round(
          correctQuestions /
            totalQuestions *
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
    fullLengths.length
      ? Math.max(
          ...fullLengths.map(
            fl =>
              Number(
                fl.total_score
              ) || 0
          )
        )
      : 0

  return (
    <div className="analyticsGrid">
      <MetricCard
        label="DIYA COMPLETION"
        value={
          diya.length
            ? `${Math.round(
                diyaDone /
                  diya.length *
                  100
              )}%`
            : '0%'
        }
        detail={`${diyaDone}/${diya.length} tasks`}
      />

      <MetricCard
        label="HAMZAH COMPLETION"
        value={
          hamzah.length
            ? `${Math.round(
                hamzahDone /
                  hamzah.length *
                  100
              )}%`
            : '0%'
        }
        detail={`${hamzahDone}/${hamzah.length} tasks`}
      />

      <MetricCard
        label="HAMZAH KAPLAN"
        value={`${hamzahChapterProgress.completed}/${hamzahChapterProgress.total}`}
        detail="chapters completed"
      />

      <MetricCard
        label="QUESTIONS LOGGED"
        value={
          totalQuestions
        }
        detail={`${accuracy}% overall accuracy`}
      />

      <MetricCard
        label="FOCUS TIME"
        value={
          formatMinutes(
            focusMinutes
          )
        }
        detail={`${sessions.length} sessions`}
      />

      <MetricCard
        label="BEST FL"
        value={
          bestFL || '—'
        }
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
      <small>
        {label}
      </small>

      <b>
        {value}
      </b>

      <span>
        {detail}
      </span>
    </div>
  )
}
